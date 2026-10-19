import { RedisClient } from './RedisClient';
import { KorexClient } from '../../client/KorexClient';

export class CacheManager {
  private client: KorexClient;
  private redis: RedisClient;
  private defaultTTL = 300; // 5 minutos

  constructor(client: KorexClient) {
    this.client = client;
    this.redis = client.redis;
  }

  // ═══════════════════════════════════════════════════════════════
  // GUILD CONFIGURATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get guild configuration (cached)
   */
  async getGuildConfig(guildId: string) {
    const cacheKey = `guild:${guildId}:config`;

    // Try to get from cache
    let config = await this.redis.get(cacheKey);

    if (!config) {
      // If not cached, get from DB
      config = await this.client.db.guild.findUnique({
        where: { id: guildId },
        include: {
          moderationConfig: true,
          welcomeConfig: true,
          levelConfig: true,
          economyConfig: true,
          loggingConfig: true,
          musicConfig: true,
        },
      });

      if (config) {
        // Store in cache
        await this.redis.set(cacheKey, config, this.defaultTTL);
      }
    }

    return config;
  }

  /**
   * Invalidate guild configuration cache
   */
  async invalidateGuildConfig(guildId: string): Promise<void> {
    await this.redis.del(`guild:${guildId}:config`);
    this.client.logger.debug(`Configuration cache invalidated for guild ${guildId}`);
  }

  /**
   * Update guild configuration in cache
   */
  async updateGuildConfig(guildId: string, config: any): Promise<void> {
    const cacheKey = `guild:${guildId}:config`;

    await this.redis.set(cacheKey, config, this.defaultTTL);
  }

  // ═══════════════════════════════════════════════════════════════
  // USUARIOS EN GUILD
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get user in guild (cached)
   */
  async getGuildUser(guildId: string, userId: string) {
    const cacheKey = `guild:${guildId}:user:${userId}`;

    let user = await this.redis.get(cacheKey);

    if (!user) {
      user = await this.client.db.guildUser.findUnique({
        where: {
          guildId_userId: { guildId, userId },
        },
      });

      if (user) {
        await this.redis.set(cacheKey, user, 60); // 1 minute for user data
      }
    }

    return user;
  }

  /**
   * Invalidate guild user cache
   */
  async invalidateGuildUser(guildId: string, userId: string): Promise<void> {
    await this.redis.del(`guild:${guildId}:user:${userId}`);
  }

  /**
   * Update guild user in cache
   */
  async updateGuildUser(guildId: string, userId: string, user: any): Promise<void> {
    const cacheKey = `guild:${guildId}:user:${userId}`;

    await this.redis.set(cacheKey, user, 60);
  }

  // ═══════════════════════════════════════════════════════════════
  // COOLDOWNS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get cooldown
   */
  async getCooldown(type: string, userId: string): Promise<number | null> {
    const cacheKey = `cooldown:${type}:${userId}`;
    const timestamp = await this.redis.get<number>(cacheKey);

    if (!timestamp) {
      return null;
    }

    const now = Date.now();

    if (now >= timestamp) {
      // Cooldown expirado
      await this.redis.del(cacheKey);

      return null;
    }

    return (timestamp - now) / 1000; // Retornar segundos restantes
  }

  /**
   * Establecer cooldown
   */
  async setCooldown(type: string, userId: string, seconds: number): Promise<void> {
    const cacheKey = `cooldown:${type}:${userId}`;
    const expiresAt = Date.now() + seconds * 1000;

    await this.redis.set(cacheKey, expiresAt, seconds);
  }

  /**
   * Remover cooldown
   */
  async removeCooldown(type: string, userId: string): Promise<void> {
    const cacheKey = `cooldown:${type}:${userId}`;

    await this.redis.del(cacheKey);
  }

  // ═══════════════════════════════════════════════════════════════
  // MUSIC SESSIONS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get music session
   */
  async getMusicSession(guildId: string) {
    return await this.redis.get(`music:${guildId}`);
  }

  /**
   * Set music session
   */
  async setMusicSession(guildId: string, session: any): Promise<void> {
    await this.redis.set(`music:${guildId}`, session, 3600); // 1 hora
  }

  /**
   * Delete music session
   */
  async deleteMusicSession(guildId: string): Promise<void> {
    await this.redis.del(`music:${guildId}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // DATOS TEMPORALES
  // ═══════════════════════════════════════════════════════════════

  /**
   * Store temporary data
   */
  async setTempData(key: string, data: any, ttl: number = 300): Promise<void> {
    await this.redis.set(`temp:${key}`, data, ttl);
  }

  /**
   * Get temporary data
   */
  async getTempData<T>(key: string): Promise<T | null> {
    return await this.redis.get<T>(`temp:${key}`);
  }

  /**
   * Delete temporary data
   */
  async deleteTempData(key: string): Promise<void> {
    await this.redis.del(`temp:${key}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // RATE LIMITING
  // ═══════════════════════════════════════════════════════════════

  /**
   * Check rate limit
   */
  async checkRateLimit(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const cacheKey = `ratelimit:${key}`;
    const now = Date.now();
    const windowMs = windowSeconds * 1000;

    // Get current data
    const data = await this.redis.get<{ count: number; resetTime: number }>(cacheKey);

    if (!data || now >= data.resetTime) {
      // Nueva ventana
      const resetTime = now + windowMs;

      await this.redis.set(cacheKey, { count: 1, resetTime }, windowSeconds);

      return {
        allowed: true,
        remaining: limit - 1,
        resetTime,
      };
    }

    if (data.count >= limit) {
      // Limit reached
      return {
        allowed: false,
        remaining: 0,
        resetTime: data.resetTime,
      };
    }

    // Incrementar contador
    const newCount = data.count + 1;

    await this.redis.set(
      cacheKey,
      { count: newCount, resetTime: data.resetTime },
      Math.ceil((data.resetTime - now) / 1000)
    );

    return {
      allowed: true,
      remaining: limit - newCount,
      resetTime: data.resetTime,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // STATISTICS AND ANALYTICS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Incrementar contador
   */
  async incrementCounter(key: string, amount: number = 1): Promise<number> {
    const cacheKey = `counter:${key}`;

    try {
      // Redis INCR is atomic
      const result = await this.redis.redis.incrby(cacheKey, amount);

      return result;
    } catch (error) {
      this.client.logger.error(`Error incrementando contador ${key}:`, error);

      return 0;
    }
  }

  /**
   * Get counter
   */
  async getCounter(key: string): Promise<number> {
    const cacheKey = `counter:${key}`;
    const value = await this.redis.get<number>(cacheKey);

    return value || 0;
  }

  /**
   * Resetear contador
   */
  async resetCounter(key: string): Promise<void> {
    const cacheKey = `counter:${key}`;

    await this.redis.del(cacheKey);
  }

  // ═══════════════════════════════════════════════════════════════
  // UTILIDADES
  // ═══════════════════════════════════════════════════════════════

  /**
   * Clear cache by pattern
   */
  async clearPattern(pattern: string): Promise<number> {
    try {
      const keys = await this.redis.redis.keys(`${this.redis['prefix']}${pattern}`);

      if (keys.length === 0) {
        return 0;
      }

      const result = await this.redis.redis.del(...keys);

      this.client.logger.debug(`${result} keys cleared with pattern: ${pattern}`);

      return result;
    } catch (error) {
      this.client.logger.error(`Error clearing pattern ${pattern}:`, error);

      return 0;
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    connected: boolean;
    keyCount: number;
    memory: string;
    hitRate?: number;
  }> {
    try {
      const info = await this.redis.getInfo();
      const keyCount = parseInt(info.keyspace.split('=')[1]?.split(',')[0] || '0');

      return {
        connected: this.redis.isConnected(),
        keyCount,
        memory: info.memory,
      };
    } catch (error) {
      return {
        connected: false,
        keyCount: 0,
        memory: 'unknown',
      };
    }
  }

  /**
   * Clear the whole bot cache
   */
  async flush(): Promise<number> {
    return await this.redis.flushBotData();
  }
}
