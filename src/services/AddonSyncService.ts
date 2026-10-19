import { Redis } from 'ioredis';
import { KorexClient } from '../client/KorexClient';
import { createLogger } from '../utils/Logger';

/** Reference bundle price if the catalog has no 'bundle' row. */
export const BUNDLE_DEFAULT_PRICE = 14.99;

/** Addons covered by the bundle package. */
export const BUNDLE_ADDONS = new Set([
  'tickets', 'store', 'staff', 'forms', 'links', 'paste', 'analytics-pro', 'events',
]);

export interface AddonEvent {
  type: 'ADDON_ACTIVATED' | 'ADDON_DEACTIVATED' | 'ADDON_CONFIG_UPDATED';
  guildId: string;
  addonName: string;
  timestamp: number;
  data?: any;
}

/**
 * Addon synchronization service across shards via Redis Pub/Sub
 */
export class AddonSyncService {
  private redis: Redis;
  private subscriber: Redis;
  private client: KorexClient;
  private logger = createLogger('addon-sync');

  constructor(client: KorexClient) {
    this.client = client;
    this.redis = client.redis.getClient();

    const subscriberOptions: any = {};
    if (process.env.REDIS_PASSWORD) {
      subscriberOptions.password = process.env.REDIS_PASSWORD;
    }
    this.subscriber = new Redis(process.env.REDIS_URL!, subscriberOptions);

    this.setupSubscriber();
  }

  /**
   * Set up addon event subscriber
   */
  private setupSubscriber(): void {
    // Subscribe to the addon events channel
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
   * Handle addon events
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
   * Handle addon activation
   */
  private handleAddonActivated(event: AddonEvent): void {
    // Update local cache if needed
    const cacheKey = `addon:${event.addonName}:guild_${event.guildId}`;

    this.redis.setex(cacheKey, 3600, 'true'); // 1 hour TTL

    this.logger.info(`Addon ${event.addonName} activated for guild ${event.guildId}`);
    
    // Emit internal event so other services can react
    this.client.emit('addonActivated', {
      guildId: event.guildId,
      addonName: event.addonName,
      data: event.data
    });
  }

  /**
   * Handle addon deactivation
   */
  private handleAddonDeactivated(event: AddonEvent): void {
    // Clear cache
    const cacheKey = `addon:${event.addonName}:guild_${event.guildId}`;

    this.redis.del(cacheKey);

    this.logger.info(`Addon ${event.addonName} deactivated for guild ${event.guildId}`);
    
    // Emit internal event
    this.client.emit('addonDeactivated', {
      guildId: event.guildId,
      addonName: event.addonName,
      data: event.data
    });
  }

  /**
   * Handle addon configuration update
   */
  private handleAddonConfigUpdated(event: AddonEvent): void {
    // Invalidate configuration cache
    const configKey = `addon:${event.addonName}:guild_${event.guildId}:config`;

    this.redis.del(configKey);

    this.logger.info(`Addon config updated for ${event.addonName} in guild ${event.guildId}`);
    
    // Emit internal event
    this.client.emit('addonConfigUpdated', {
      guildId: event.guildId,
      addonName: event.addonName,
      config: event.data
    });
  }

  /**
   * Publish event to all shards
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
   * Check whether an addon is active for a server.
   * For bundle addons, first checks whether the server has an active guildPremium.
   */
  async isAddonActive(guildId: string, addonName: string): Promise<boolean> {
    const cacheKey = `addon:${addonName}:guild_${guildId}`;

    try {
      // 1. Addon-specific cache (< 1 ms)
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) return cached === 'true';

      // 2. For bundle addons, check guildPremium before looking up an individual license
      if (BUNDLE_ADDONS.has(addonName)) {
        const bundleKey = `bundle:guild:${guildId}`;
        const bundleCached = await this.redis.get(bundleKey);

        if (bundleCached === 'true') {
          await this.redis.setex(cacheKey, 3600, 'true');
          return true;
        }

        if (bundleCached === null) {
          // No bundle cache → query DB
          const premium = await this.client.db.guildPremium.findFirst({
            where: { guildId, planId: 'bundle', status: 'ACTIVE', expiresAt: { gt: new Date() } },
          });
          if (premium) {
            await this.redis.setex(bundleKey, 3600, 'true');
            await this.redis.setex(cacheKey, 3600, 'true');
            return true;
          }
          // Negative: short TTL (5 min) so future activations are not blocked
          await this.redis.setex(bundleKey, 300, 'false');
        }
      }

      // 3. Individual license in PostgreSQL
      const license = await this.client.db.addonLicense.findFirst({
        where: { guildId, addonName, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      });

      const isActive = !!license;
      // Negative with short TTL: a purchase/courtesy shows up within ≤ 60 s even if
      // the flow that created it does not invalidate the cache.
      await this.redis.setex(cacheKey, isActive ? 600 : 60, String(isActive));
      return isActive;
    } catch (error) {
      this.logger.error(`Error checking addon status for ${addonName} in guild ${guildId}:`, error);
      return false;
    }
  }

  /**
   * Does the server currently have the right to use the addon? Direct DB query
   * (no cache): its own non-expired ACTIVE license or, for bundle addons, a non-expired
   * ACTIVE bundle. Used before disabling an addon so access that is still covered
   * another way is not removed (e.g. individual license + bundle).
   */
  async hasEntitlement(guildId: string, addonName: string): Promise<boolean> {
    const now = new Date();
    const license = await this.client.db.addonLicense.findFirst({
      where: { guildId, addonName, status: 'ACTIVE', expiresAt: { gt: now } },
      select: { id: true },
    });
    if (license) return true;
    if (!BUNDLE_ADDONS.has(addonName)) return false;
    const bundle = await this.client.db.guildPremium.findFirst({
      where: { guildId, planId: 'bundle', status: 'ACTIVE', expiresAt: { gt: now } },
      select: { id: true },
    });
    return !!bundle;
  }

  /**
   * Revokes access to an addon after losing the license (expired cancellation, expiration,
   * suspension, kickout, admin action): invalidates the cache on all shards and removes
   * the addon from enabledAddons, unless it is still covered by another license or the bundle.
   * Returns true if the addon ended up disabled.
   */
  async revokeAccess(guildId: string, addonName: string): Promise<boolean> {
    await this.redis.del(`addon:${addonName}:guild_${guildId}`).catch(() => 0);
    if (await this.hasEntitlement(guildId, addonName).catch(() => false)) return false;

    await this.client.addons.disableAddon(guildId, addonName).catch(() => false);
    await this.publishEvent({ type: 'ADDON_DEACTIVATED', guildId, addonName });
    return true;
  }

  /** Revokes bundle access: clears its cache and disables addons that have no license of their own. */
  async revokeBundleAccess(guildId: string): Promise<string[]> {
    await this.redis.del(`bundle:guild:${guildId}`).catch(() => 0);
    const disabled: string[] = [];
    for (const addonName of BUNDLE_ADDONS) {
      try {
        if (await this.revokeAccess(guildId, addonName)) disabled.push(addonName);
      } catch (error) {
        this.logger.error(`Error removing ${addonName} from the bundle in guild ${guildId}:`, error);
      }
    }
    return disabled;
  }

  /**
   * Get addon configuration from cache or database
   */
  async getAddonConfig(guildId: string, addonName: string): Promise<any> {
    const configKey = `addon:${addonName}:guild_${guildId}:config`;
    
    try {
      // 1. Check Redis cache
      const cached = await this.redis.get(configKey);

      if (cached) {
        return JSON.parse(cached);
      }
      
      // 2. Query database
      const config = await this.client.db.addonConfig.findUnique({
        where: {
          guildId_addonName: {
            guildId,
            addonName
          }
        }
      });
      
      const configData = config?.config || {};
      
      // 3. Update cache (30 minutes)
      await this.redis.setex(configKey, 1800, JSON.stringify(configData));
      
      return configData;
    } catch (error) {
      this.logger.error(`Error getting addon config for ${addonName} in guild ${guildId}:`, error);

      return {};
    }
  }

  /**
   * Update addon configuration
   */
  async updateAddonConfig(guildId: string, addonName: string, config: any): Promise<void> {
    try {
      // 1. Update in database
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

      // 2. Publish update event
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
   * Activate addon for a server.
   * Uses upsert to correctly handle reactivations after a cancellation.
   */
  async activateAddon(
    guildId: string,
    addonName: string,
    userId: string,
    plan: string = 'individual',
    pricing?: { price: number; currency: string },
  ): Promise<void> {
    try {
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 1);

      // A previous license with days remaining (cancelled but still valid, courtesy…)
      // is not shortened: the latest date is kept.
      const previous = await this.client.db.addonLicense.findUnique({
        where: { guildId_addonName: { guildId, addonName } },
        select: { expiresAt: true },
      });
      if (previous?.expiresAt && previous.expiresAt > expiresAt) {
        expiresAt.setTime(previous.expiresAt.getTime());
      }

      // upsert: creates the license if it does not exist, or reactivates it if it already existed
      await this.client.db.addonLicense.upsert({
        where: { guildId_addonName: { guildId, addonName } },
        update: {
          userId,
          plan,
          status: 'ACTIVE',
          expiresAt,
          courtesy: false,
          cancelledAt: null,
          suspendedAt: null,
          kickoutAt: null,
          paymentFailures: 0,
          lastPaymentFailedAt: null,
          dataWarnedAt: null,
          ...(pricing ? { price: pricing.price, currency: pricing.currency } : {}),
        },
        create: {
          guildId,
          addonName,
          userId,
          plan,
          status: 'ACTIVE',
          expiresAt,
          ...(pricing ? { price: pricing.price, currency: pricing.currency } : {}),
        },
      });

      // Publish activation event to all shards
      await this.publishEvent({
        type: 'ADDON_ACTIVATED',
        guildId,
        addonName,
        data: { userId, plan, expiresAt },
      });

      this.logger.info(`Addon activated: ${addonName} in guild ${guildId}`);
    } catch (error) {
      this.logger.error(`Error activating addon ${addonName} for guild ${guildId}:`, error);
      throw error;
    }
  }

  /**
   * Deactivate addon for a server
   */
  async deactivateAddon(guildId: string, addonName: string): Promise<void> {
    try {
      // 1. Update license in database
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

      // 2. Publish deactivation event
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
   * Suspend addon without cancelling the PayPal subscription.
   * Used when a payment fails and the local retry threshold is exceeded,
   * or when PayPal sends BILLING.SUBSCRIPTION.SUSPENDED.
   */
  async suspendAddon(guildId: string, addonName: string): Promise<void> {
    try {
      await this.client.db.addonLicense.updateMany({
        where: { guildId, addonName, status: 'ACTIVE' },
        data: { status: 'SUSPENDED', suspendedAt: new Date() },
      });

      // Remove from cache → isAddonActive will return false
      const cacheKey = `addon:${addonName}:guild_${guildId}`;
      await this.redis.del(cacheKey);

      // Notify all shards that the addon was deactivated
      await this.publishEvent({ type: 'ADDON_DEACTIVATED', guildId, addonName });

      this.logger.warn(`Addon suspended: ${addonName} in guild ${guildId}`);
    } catch (error) {
      this.logger.error(`Error suspending addon ${addonName} for guild ${guildId}:`, error);
      throw error;
    }
  }

  /**
   * Increments a license's payment failure counter.
   * Returns the new total and whether the threshold was exceeded (addon suspended).
   * Failures are reset automatically when a payment succeeds.
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
        this.logger.warn(`trackPaymentFailure: license not found ${addonName} guild=${guildId}`);
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
          `Addon auto-suspended due to payment failures [${newFailures}/${threshold}]: ${addonName} guild=${guildId}`
        );
      }

      return { failures: newFailures, suspended: shouldSuspend };
    } catch (error) {
      this.logger.error(`Error in trackPaymentFailure ${addonName} guild=${guildId}:`, error);
      return { failures: 0, suspended: false };
    }
  }

  /**
   * Clean up resources on shutdown
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