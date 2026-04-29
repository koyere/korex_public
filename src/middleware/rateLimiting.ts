import { CommandInteraction, MessageFlags } from 'discord.js';
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
  }

  private get redisPrefix(): string {
    return `${process.env.REDIS_PREFIX || 'korex:'}rl:`;
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    const redis = this.client.redis.getClient();
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');
    return keys;
  }

  /**
   * Verificar rate limit — patrón INCR+EXPIRE atómico sobre Redis
   */
  async checkRateLimit(
    interaction: CommandInteraction,
    config: RateLimitConfig
  ): Promise<RateLimitResult> {
    const key = config.keyGenerator
      ? config.keyGenerator(interaction)
      : this.generateKey(interaction, 'user');

    const redisKey = `${this.redisPrefix}${key}`;
    const windowSecs = Math.ceil(config.windowMs / 1000);
    const redis = this.client.redis.getClient();

    const count = await redis.incr(redisKey);
    if (count === 1) {
      // Primera petición en esta ventana — fijar TTL
      await redis.expire(redisKey, windowSecs);
    }

    const ttl = await redis.ttl(redisKey);
    const resetTime = new Date(Date.now() + Math.max(ttl, 0) * 1000);
    const remaining = Math.max(0, config.maxRequests - count);

    const info: RateLimitInfo = {
      totalHits: count,
      totalRequests: count,
      resetTime,
      remaining,
    };

    if (count > config.maxRequests) {
      const retryAfter = ttl > 0 ? ttl : windowSecs;

      if (config.onLimitReached) {
        await config.onLimitReached(interaction, resetTime);
      }

      return { allowed: false, info, retryAfter };
    }

    return { allowed: true, info };
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
  async getLimitInfo(key: string): Promise<RateLimitInfo | null> {
    const redis = this.client.redis.getClient();
    const redisKey = `${this.redisPrefix}${key}`;
    const [raw, ttl] = await Promise.all([
      redis.get(redisKey),
      redis.ttl(redisKey),
    ]);

    if (raw === null || ttl < 0) return null;
    const hits = parseInt(raw, 10);

    return {
      totalHits: hits,
      totalRequests: hits,
      resetTime: new Date(Date.now() + ttl * 1000),
      remaining: 0,
    };
  }

  /**
   * Resetear límite para una clave específica
   */
  async resetLimit(key: string): Promise<boolean> {
    const redis = this.client.redis.getClient();
    const result = await redis.del(`${this.redisPrefix}${key}`);
    return result > 0;
  }

  /**
   * Resetear todos los límites de un usuario
   */
  async resetUserLimits(userId: string): Promise<number> {
    const keys = await this.scanKeys(`${this.redisPrefix}user:${userId}:*`);
    if (keys.length === 0) return 0;
    const redis = this.client.redis.getClient();
    await redis.del(...keys);
    return keys.length;
  }

  /**
   * Resetear todos los límites de un servidor
   */
  async resetGuildLimits(guildId: string): Promise<number> {
    const keys = await this.scanKeys(`${this.redisPrefix}guild:${guildId}:*`);
    if (keys.length === 0) return 0;
    const redis = this.client.redis.getClient();
    await redis.del(...keys);
    return keys.length;
  }

  /**
   * Obtener estadísticas de rate limiting
   */
  async getStats(): Promise<{
    totalLimits: number;
    activeLimits: number;
    topLimitedUsers: Array<{ userId: string; limits: number }>;
    topLimitedGuilds: Array<{ guildId: string; limits: number }>;
  }> {
    const allKeys = await this.scanKeys(`${this.redisPrefix}*`);
    const userMap = new Map<string, number>();
    const guildMap = new Map<string, number>();

    for (const key of allKeys) {
      const relative = key.slice(this.redisPrefix.length);
      if (relative.startsWith('user:')) {
        const userId = relative.split(':')[1];
        userMap.set(userId, (userMap.get(userId) || 0) + 1);
      } else if (relative.startsWith('guild:')) {
        const guildId = relative.split(':')[1];
        guildMap.set(guildId, (guildMap.get(guildId) || 0) + 1);
      }
    }

    return {
      totalLimits: allKeys.length,
      activeLimits: allKeys.length,
      topLimitedUsers: Array.from(userMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([userId, limits]) => ({ userId, limits })),
      topLimitedGuilds: Array.from(guildMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([guildId, limits]) => ({ guildId, limits })),
    };
  }

  /**
   * Configurar límites personalizados para un comando
   */
  setCustomLimit(commandName: string, config: RateLimitConfig): void {
    this.logger.info(`Custom rate limit set for command: ${commandName}`);
  }

  /**
   * Verificar si un usuario está siendo limitado excesivamente
   */
  async isUserAbusing(userId: string): Promise<boolean> {
    const keys = await this.scanKeys(`${this.redisPrefix}user:${userId}:*`);
    return keys.length > 10;
  }

  /**
   * Destruir el rate limiter
   */
  destroy(): void {
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
