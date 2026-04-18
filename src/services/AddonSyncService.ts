import { Redis } from 'ioredis';
import { KorexClient } from '../client/KorexClient';
import { createLogger } from '../utils/Logger';

export interface AddonEvent {
  type: 'ADDON_ACTIVATED' | 'ADDON_DEACTIVATED' | 'ADDON_CONFIG_UPDATED';
  guildId: string;
  addonName: string;
  timestamp: number;
  data?: any;
}

/**
 * Servicio de sincronización de addons entre shards via Redis Pub/Sub
 */
export class AddonSyncService {
  private redis: Redis;
  private subscriber: Redis;
  private client: KorexClient;
  private logger = createLogger('addon-sync');

  constructor(client: KorexClient) {
    this.client = client;
    this.redis = client.redis.getClient();
    this.subscriber = new Redis(process.env.REDIS_URL!);
    
    this.setupSubscriber();
  }

  /**
   * Configurar suscriptor de eventos de addons
   */
  private setupSubscriber(): void {
    // Suscribirse al canal de eventos de addons
    this.subscriber.subscribe('addon:events');
    
    this.subscriber.on('message', (channel, message) => {
      if (channel === 'addon:events') {
        try {
          const event: AddonEvent = JSON.parse(message);

          this.handleAddonEvent(event);
        } catch (error) {
          this.logger.error('Error parsing addon event:', error);
        }
      }
    });

    this.logger.info('Addon sync service initialized');
  }

  /**
   * Manejar eventos de addons
   */
  private handleAddonEvent(event: AddonEvent): void {
    this.logger.debug(`Received addon event: ${event.type} for ${event.addonName} in guild ${event.guildId}`);

    switch (event.type) {
      case 'ADDON_ACTIVATED':
        this.handleAddonActivated(event);
        break;
        
      case 'ADDON_DEACTIVATED':
        this.handleAddonDeactivated(event);
        break;
        
      case 'ADDON_CONFIG_UPDATED':
        this.handleAddonConfigUpdated(event);
        break;
    }
  }

  /**
   * Manejar activación de addon
   */
  private handleAddonActivated(event: AddonEvent): void {
    // Actualizar cache local si es necesario
    const cacheKey = `addon:${event.addonName}:guild_${event.guildId}`;

    this.redis.setex(cacheKey, 3600, 'true'); // 1 hora TTL

    this.logger.info(`Addon ${event.addonName} activated for guild ${event.guildId}`);
    
    // Emitir evento interno para que otros servicios puedan reaccionar
    this.client.emit('addonActivated', {
      guildId: event.guildId,
      addonName: event.addonName,
      data: event.data
    });
  }

  /**
   * Manejar desactivación de addon
   */
  private handleAddonDeactivated(event: AddonEvent): void {
    // Limpiar cache
    const cacheKey = `addon:${event.addonName}:guild_${event.guildId}`;

    this.redis.del(cacheKey);

    this.logger.info(`Addon ${event.addonName} deactivated for guild ${event.guildId}`);
    
    // Emitir evento interno
    this.client.emit('addonDeactivated', {
      guildId: event.guildId,
      addonName: event.addonName,
      data: event.data
    });
  }

  /**
   * Manejar actualización de configuración de addon
   */
  private handleAddonConfigUpdated(event: AddonEvent): void {
    // Invalidar cache de configuración
    const configKey = `addon:${event.addonName}:guild_${event.guildId}:config`;

    this.redis.del(configKey);

    this.logger.info(`Addon config updated for ${event.addonName} in guild ${event.guildId}`);
    
    // Emitir evento interno
    this.client.emit('addonConfigUpdated', {
      guildId: event.guildId,
      addonName: event.addonName,
      config: event.data
    });
  }

  /**
   * Publicar evento a todos los shards
   */
  async publishEvent(event: Omit<AddonEvent, 'timestamp'>): Promise<void> {
    const fullEvent: AddonEvent = {
      ...event,
      timestamp: Date.now()
    };

    try {
      await this.redis.publish('addon:events', JSON.stringify(fullEvent));
      this.logger.debug(`Published addon event: ${event.type} for ${event.addonName}`);
    } catch (error) {
      this.logger.error('Error publishing addon event:', error);
    }
  }

  /**
   * Verificar si un addon está activo para un servidor
   */
  async isAddonActive(guildId: string, addonName: string): Promise<boolean> {
    const cacheKey = `addon:${addonName}:guild_${guildId}`;
    
    try {
      // 1. Verificar cache Redis (< 1ms)
      const cached = await this.redis.get(cacheKey);

      if (cached !== null) {
        return cached === 'true';
      }
      
      // 2. Si no hay cache, consultar PostgreSQL
      const license = await this.client.db.addonLicense.findFirst({
        where: {
          guildId,
          addonName,
          status: 'ACTIVE',
          expiresAt: { gt: new Date() }
        }
      });
      
      const isActive = !!license;
      
      // 3. Actualizar cache (1 hora)
      await this.redis.setex(cacheKey, 3600, String(isActive));
      
      return isActive;
    } catch (error) {
      this.logger.error(`Error checking addon status for ${addonName} in guild ${guildId}:`, error);

      return false;
    }
  }

  /**
   * Obtener configuración de addon desde cache o base de datos
   */
  async getAddonConfig(guildId: string, addonName: string): Promise<any> {
    const configKey = `addon:${addonName}:guild_${guildId}:config`;
    
    try {
      // 1. Verificar cache Redis
      const cached = await this.redis.get(configKey);

      if (cached) {
        return JSON.parse(cached);
      }
      
      // 2. Consultar base de datos
      const config = await this.client.db.addonConfig.findUnique({
        where: {
          guildId_addonName: {
            guildId,
            addonName
          }
        }
      });
      
      const configData = config?.config || {};
      
      // 3. Actualizar cache (30 minutos)
      await this.redis.setex(configKey, 1800, JSON.stringify(configData));
      
      return configData;
    } catch (error) {
      this.logger.error(`Error getting addon config for ${addonName} in guild ${guildId}:`, error);

      return {};
    }
  }

  /**
   * Actualizar configuración de addon
   */
  async updateAddonConfig(guildId: string, addonName: string, config: any): Promise<void> {
    try {
      // 1. Actualizar en base de datos
      await this.client.db.addonConfig.upsert({
        where: {
          guildId_addonName: {
            guildId,
            addonName
          }
        },
        update: {
          config,
          updatedAt: new Date()
        },
        create: {
          guildId,
          addonName,
          config
        }
      });

      // 2. Publicar evento de actualización
      await this.publishEvent({
        type: 'ADDON_CONFIG_UPDATED',
        guildId,
        addonName,
        data: config
      });

      this.logger.info(`Updated config for addon ${addonName} in guild ${guildId}`);
    } catch (error) {
      this.logger.error(`Error updating addon config for ${addonName} in guild ${guildId}:`, error);
      throw error;
    }
  }

  /**
   * Activar addon para un servidor.
   * Usa upsert para manejar correctamente las reactivaciones tras una cancelación.
   */
  async activateAddon(guildId: string, addonName: string, userId: string, plan: string = 'individual'): Promise<void> {
    try {
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 1);

      // upsert: crea la licencia si no existe, o la reactiva si ya existía
      await this.client.db.addonLicense.upsert({
        where: { guildId_addonName: { guildId, addonName } },
        update: {
          userId,
          plan,
          status: 'ACTIVE',
          expiresAt,
          cancelledAt: null,
          suspendedAt: null,
          paymentFailures: 0,
          lastPaymentFailedAt: null,
        },
        create: {
          guildId,
          addonName,
          userId,
          plan,
          status: 'ACTIVE',
          expiresAt,
        },
      });

      // Publicar evento de activación a todos los shards
      await this.publishEvent({
        type: 'ADDON_ACTIVATED',
        guildId,
        addonName,
        data: { userId, plan, expiresAt },
      });

      this.logger.info(`Addon activado: ${addonName} en guild ${guildId}`);
    } catch (error) {
      this.logger.error(`Error activando addon ${addonName} para guild ${guildId}:`, error);
      throw error;
    }
  }

  /**
   * Desactivar addon para un servidor
   */
  async deactivateAddon(guildId: string, addonName: string): Promise<void> {
    try {
      // 1. Actualizar licencia en base de datos
      await this.client.db.addonLicense.updateMany({
        where: {
          guildId,
          addonName,
          status: 'ACTIVE'
        },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date()
        }
      });

      // 2. Publicar evento de desactivación
      await this.publishEvent({
        type: 'ADDON_DEACTIVATED',
        guildId,
        addonName
      });

      this.logger.info(`Deactivated addon ${addonName} for guild ${guildId}`);
    } catch (error) {
      this.logger.error(`Error deactivating addon ${addonName} for guild ${guildId}:`, error);
      throw error;
    }
  }

  /**
   * Suspender addon sin cancelar la suscripción PayPal.
   * Se usa cuando un pago falla y se supera el umbral de reintentos locales,
   * o cuando PayPal notifica BILLING.SUBSCRIPTION.SUSPENDED.
   */
  async suspendAddon(guildId: string, addonName: string): Promise<void> {
    try {
      await this.client.db.addonLicense.updateMany({
        where: { guildId, addonName, status: 'ACTIVE' },
        data: { status: 'SUSPENDED', suspendedAt: new Date() },
      });

      // Eliminar del cache → isAddonActive devolverá false
      const cacheKey = `addon:${addonName}:guild_${guildId}`;
      await this.redis.del(cacheKey);

      // Notificar a todos los shards que el addon fue desactivado
      await this.publishEvent({ type: 'ADDON_DEACTIVATED', guildId, addonName });

      this.logger.warn(`Addon suspendido: ${addonName} en guild ${guildId}`);
    } catch (error) {
      this.logger.error(`Error suspendiendo addon ${addonName} para guild ${guildId}:`, error);
      throw error;
    }
  }

  /**
   * Incrementa el contador de fallos de pago de una licencia.
   * Devuelve el nuevo total y si se superó el umbral (addon suspendido).
   * Los fallos se resetean automáticamente cuando un pago es exitoso.
   */
  async trackPaymentFailure(
    guildId: string,
    addonName: string,
    threshold: number = 2
  ): Promise<{ failures: number; suspended: boolean }> {
    try {
      const license = await this.client.db.addonLicense.findFirst({
        where: { guildId, addonName, status: 'ACTIVE' },
      });

      if (!license) {
        this.logger.warn(`trackPaymentFailure: licencia no encontrada ${addonName} guild=${guildId}`);
        return { failures: 0, suspended: false };
      }

      const newFailures = license.paymentFailures + 1;
      const shouldSuspend = newFailures >= threshold;

      await this.client.db.addonLicense.update({
        where: { id: license.id },
        data: {
          paymentFailures: newFailures,
          lastPaymentFailedAt: new Date(),
          ...(shouldSuspend ? { status: 'SUSPENDED', suspendedAt: new Date() } : {}),
        },
      });

      if (shouldSuspend) {
        const cacheKey = `addon:${addonName}:guild_${guildId}`;
        await this.redis.del(cacheKey);
        await this.publishEvent({ type: 'ADDON_DEACTIVATED', guildId, addonName });
        this.logger.warn(
          `Addon auto-suspendido por fallos de pago [${newFailures}/${threshold}]: ${addonName} guild=${guildId}`
        );
      }

      return { failures: newFailures, suspended: shouldSuspend };
    } catch (error) {
      this.logger.error(`Error en trackPaymentFailure ${addonName} guild=${guildId}:`, error);
      return { failures: 0, suspended: false };
    }
  }

  /**
   * Limpiar recursos al cerrar
   */
  async destroy(): Promise<void> {
    try {
      await this.subscriber.unsubscribe('addon:events');
      await this.subscriber.quit();
      this.logger.info('Addon sync service destroyed');
    } catch (error) {
      this.logger.error('Error destroying addon sync service:', error);
    }
  }
}