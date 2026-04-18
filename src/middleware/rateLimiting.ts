import { CommandInteraction, User, Guild, MessageFlags } from 'discord.js';
import { KorexClient } from '../client/KorexClient';
import { createLogger } from '../utils/Logger';
import { i18n } from '../utils/i18n';

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (interaction: CommandInteraction) => string;
  onLimitReached?: (interaction: CommandInteraction, resetTime: Date) => Promise<void>;
}

export interface RateLimitInfo {
  totalHits: number;
  totalRequests: number;
  resetTime: Date;
  remaining: number;
}

export interface RateLimitResult {
  allowed: boolean;
  info: RateLimitInfo;
  retryAfter?: number;
}

/**
 * Sistema de Rate Limiting para Korex
 * Previene abuso y spam de comandos
 */
export class RateLimiter {
  private client: KorexClient;
  private logger = createLogger('rate-limiter');
  private limits: Map<string, RateLimitInfo> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  // Configuraciones predefinidas
  public static readonly CONFIGS = {
    // Límites generales
    GLOBAL: {
      maxRequests: 60,
      windowMs: 60000 // 1 minuto
    },
    
    // Límites por usuario
    USER: {
      maxRequests: 30,
      windowMs: 60000 // 30 comandos por minuto por usuario
    },
    
    // Límites por servidor
    GUILD: {
      maxRequests: 100,
      windowMs: 60000 // 100 comandos por minuto por servidor
    },
    
    // Límites estrictos para comandos pesados
    HEAVY: {
      maxRequests: 5,
      windowMs: 60000 // 5 comandos por minuto
    },
    
    // Límites para comandos de moderación
    MODERATION: {
      maxRequests: 20,
      windowMs: 60000 // 20 acciones de moderación por minuto
    },
    
    // Límites para comandos económicos
    ECONOMY: {
      maxRequests: 15,
      windowMs: 60000 // 15 comandos económicos por minuto
    },
    
    // Límites para comandos de música
    MUSIC: {
      maxRequests: 10,
      windowMs: 30000 // 10 comandos de música por 30 segundos
    },
    
    // Límites para comandos de diversión
    FUN: {
      maxRequests: 20,
      windowMs: 60000 // 20 comandos de diversión por minuto
    }
  };

  constructor(client: KorexClient) {
    this.client = client;
    
    // Limpiar límites expirados cada 5 minutos
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 300000);
  }

  /**
   * Verificar rate limit
   */
  async checkRateLimit(
    interaction: CommandInteraction,
    config: RateLimitConfig
  ): Promise<RateLimitResult> {
    const key = config.keyGenerator 
      ? config.keyGenerator(interaction)
      : this.generateKey(interaction, 'user');

    const now = Date.now();
    const windowStart = now - config.windowMs;
    
    // Obtener o crear información de límite
    let limitInfo = this.limits.get(key);
    
    if (!limitInfo || limitInfo.resetTime.getTime() <= now) {
      // Crear nueva ventana de tiempo
      limitInfo = {
        totalHits: 0,
        totalRequests: 0,
        resetTime: new Date(now + config.windowMs),
        remaining: config.maxRequests
      };
    }

    // Incrementar contadores
    limitInfo.totalRequests++;
    
    // Verificar si se excede el límite
    if (limitInfo.totalHits >= config.maxRequests) {
      const retryAfter = Math.ceil((limitInfo.resetTime.getTime() - now) / 1000);
      
      // Llamar callback si se proporciona
      if (config.onLimitReached) {
        await config.onLimitReached(interaction, limitInfo.resetTime);
      }

      this.limits.set(key, limitInfo);
      
      return {
        allowed: false,
        info: limitInfo,
        retryAfter
      };
    }

    // Incrementar hits y actualizar remaining
    limitInfo.totalHits++;
    limitInfo.remaining = Math.max(0, config.maxRequests - limitInfo.totalHits);
    
    this.limits.set(key, limitInfo);
    
    return {
      allowed: true,
      info: limitInfo
    };
  }

  /**
   * Middleware de rate limiting para comandos
   */
  static createMiddleware(config: RateLimitConfig) {
    return async function rateLimitMiddleware(
      this: any,
      interaction: CommandInteraction,
      next: () => Promise<void>
    ) {
      const client = this.client as KorexClient;
      const rateLimiter = client.rateLimiter;
      
      if (!rateLimiter) {
        return next();
      }

      const result = await rateLimiter.checkRateLimit(interaction, config);
      
      if (!result.allowed) {
        const retryAfter = result.retryAfter || 60;

        await interaction.reply({
          content: i18n.t('errors.rate_limit', interaction.guildId || undefined, {
            retryAfter: retryAfter.toString(),
            remaining: Math.ceil(retryAfter / 60).toString()
          }),
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      return next();
    };
  }

  /**
   * Decorador para rate limiting
   */
  static RateLimit(configName: keyof typeof RateLimiter.CONFIGS | RateLimitConfig) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
      const originalMethod = descriptor.value;
      
      descriptor.value = async function (interaction: CommandInteraction) {
        const client = (this as any).client as KorexClient;
        const rateLimiter = client.rateLimiter;
        
        if (!rateLimiter) {
          return originalMethod.apply(this, [interaction]);
        }

        const config = typeof configName === 'string' 
          ? RateLimiter.CONFIGS[configName]
          : configName;

        const result = await rateLimiter.checkRateLimit(interaction, config);
        
        if (!result.allowed) {
          const retryAfter = result.retryAfter || 60;

          await interaction.reply({
            content: i18n.t('errors.rate_limit', interaction.guildId || undefined, {
              retryAfter: retryAfter.toString(),
              remaining: Math.ceil(retryAfter / 60).toString()
            }),
            flags: MessageFlags.Ephemeral
          });

          return;
        }

        return originalMethod.apply(this, [interaction]);
      };

      return descriptor;
    };
  }

  /**
   * Generar clave para rate limiting
   */
  private generateKey(interaction: CommandInteraction, type: 'user' | 'guild' | 'global'): string {
    const command = interaction.commandName;
    
    switch (type) {
      case 'user':
        return `user:${interaction.user.id}:${command}`;
      case 'guild':
        return `guild:${interaction.guildId}:${command}`;
      case 'global':
        return `global:${command}`;
      default:
        return `unknown:${command}`;
    }
  }

  /**
   * Verificar múltiples límites
   */
  async checkMultipleLimits(
    interaction: CommandInteraction,
    configs: { name: string; config: RateLimitConfig }[]
  ): Promise<{ allowed: boolean; failedLimit?: string; result?: RateLimitResult }> {
    for (const { name, config } of configs) {
      const result = await this.checkRateLimit(interaction, config);
      
      if (!result.allowed) {
        return {
          allowed: false,
          failedLimit: name,
          result
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Obtener información de límite actual
   */
  getLimitInfo(key: string): RateLimitInfo | null {
    return this.limits.get(key) || null;
  }

  /**
   * Resetear límite para una clave específica
   */
  resetLimit(key: string): boolean {
    return this.limits.delete(key);
  }

  /**
   * Resetear todos los límites de un usuario
   */
  resetUserLimits(userId: string): number {
    let resetCount = 0;
    
    for (const [key] of this.limits) {
      if (key.startsWith(`user:${userId}:`)) {
        this.limits.delete(key);
        resetCount++;
      }
    }
    
    return resetCount;
  }

  /**
   * Resetear todos los límites de un servidor
   */
  resetGuildLimits(guildId: string): number {
    let resetCount = 0;
    
    for (const [key] of this.limits) {
      if (key.startsWith(`guild:${guildId}:`)) {
        this.limits.delete(key);
        resetCount++;
      }
    }
    
    return resetCount;
  }

  /**
   * Limpiar límites expirados
   */
  private cleanup(): void {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [key, info] of this.limits) {
      if (info.resetTime.getTime() <= now) {
        this.limits.delete(key);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      this.logger.debug(`Cleaned up ${cleanedCount} expired rate limits`);
    }
  }

  /**
   * Obtener estadísticas de rate limiting
   */
  getStats(): {
    totalLimits: number;
    activeLimits: number;
    topLimitedUsers: Array<{ userId: string; limits: number }>;
    topLimitedGuilds: Array<{ guildId: string; limits: number }>;
  } {
    const now = Date.now();
    const activeLimits = Array.from(this.limits.values())
      .filter(info => info.resetTime.getTime() > now);

    // Contar límites por usuario
    const userLimits = new Map<string, number>();
    const guildLimits = new Map<string, number>();

    for (const [key] of this.limits) {
      if (key.startsWith('user:')) {
        const userId = key.split(':')[1];

        userLimits.set(userId, (userLimits.get(userId) || 0) + 1);
      } else if (key.startsWith('guild:')) {
        const guildId = key.split(':')[1];

        guildLimits.set(guildId, (guildLimits.get(guildId) || 0) + 1);
      }
    }

    // Top usuarios con más límites
    const topLimitedUsers = Array.from(userLimits.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([userId, limits]) => ({ userId, limits }));

    // Top servidores con más límites
    const topLimitedGuilds = Array.from(guildLimits.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([guildId, limits]) => ({ guildId, limits }));

    return {
      totalLimits: this.limits.size,
      activeLimits: activeLimits.length,
      topLimitedUsers,
      topLimitedGuilds
    };
  }

  /**
   * Configurar límites personalizados para un comando
   */
  setCustomLimit(commandName: string, config: RateLimitConfig): void {
    // Implementar si es necesario para configuración dinámica
    this.logger.info(`Custom rate limit set for command: ${commandName}`);
  }

  /**
   * Verificar si un usuario está siendo limitado excesivamente
   */
  isUserAbusing(userId: string): boolean {
    let userLimitCount = 0;
    
    for (const [key] of this.limits) {
      if (key.startsWith(`user:${userId}:`)) {
        userLimitCount++;
      }
    }
    
    // Si un usuario tiene más de 10 límites activos, podría estar abusando
    return userLimitCount > 10;
  }

  /**
   * Destruir el rate limiter
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.limits.clear();
    this.logger.info('Rate limiter destroyed');
  }
}

/**
 * Configuraciones específicas por tipo de comando
 */
export const CommandRateLimits = {
  // Comandos de moderación
  moderation: {
    maxRequests: 15,
    windowMs: 60000,
    keyGenerator: (interaction: CommandInteraction) => 
      `moderation:${interaction.user.id}:${interaction.guildId}`
  },

  // Comandos económicos
  economy: {
    maxRequests: 10,
    windowMs: 60000,
    keyGenerator: (interaction: CommandInteraction) => 
      `economy:${interaction.user.id}:${interaction.guildId}`
  },

  // Comandos de música
  music: {
    maxRequests: 8,
    windowMs: 30000,
    keyGenerator: (interaction: CommandInteraction) => 
      `music:${interaction.guildId}`
  },

  // Comandos pesados (que requieren mucho procesamiento)
  heavy: {
    maxRequests: 3,
    windowMs: 60000,
    keyGenerator: (interaction: CommandInteraction) => 
      `heavy:${interaction.user.id}`
  },

  // Comandos de diversión
  fun: {
    maxRequests: 15,
    windowMs: 60000,
    keyGenerator: (interaction: CommandInteraction) => 
      `fun:${interaction.user.id}:${interaction.guildId}`
  }
} as const;