import Redis from 'ioredis';
import { KorexClient } from '../../client/KorexClient';

export class RedisClient {
  public redis: Redis;
  private client: KorexClient;
  private prefix: string;
  private connected: boolean = false;

  constructor(client: KorexClient) {
    this.client = client;
    this.prefix = process.env.REDIS_PREFIX || 'korex:';

    const redisOptions: any = {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      reconnectOnError: (err: Error) => {
        const targetError = 'READONLY';

        return err.message.includes(targetError);
      },
    };

    if (process.env.REDIS_PASSWORD) {
      redisOptions.password = process.env.REDIS_PASSWORD;
    }

    this.redis = new Redis(process.env.REDIS_URL!, redisOptions);

    this.setupEventHandlers();
  }

  /**
   * Set up event handlers
   */
  private setupEventHandlers(): void {
    this.redis.on('connect', () => {
      this.connected = true;
      this.client.logger.info('Redis conectado');
    });

    this.redis.on('ready', () => {
      this.client.logger.debug('Redis ready to receive commands');
    });

    this.redis.on('error', (error) => {
      this.connected = false;
      this.client.logger.error('Redis error:', error);
    });

    this.redis.on('close', () => {
      this.connected = false;
      this.client.logger.warn('Redis connection closed');
    });

    this.redis.on('reconnecting', () => {
      this.client.logger.info('Reconectando a Redis...');
    });
  }

  /**
   * Conectar a Redis
   */
  async connect(): Promise<void> {
    try {
      await this.redis.connect();
      this.connected = true;
    } catch (error) {
      this.client.logger.error('Error conectando a Redis:', error);
      throw error;
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    try {
      await this.redis.disconnect();
      this.connected = false;
      this.client.logger.info('Redis desconectado');
    } catch (error) {
      this.client.logger.error('Error desconectando Redis:', error);
    }
  }

  /**
   * Check whether it is connected
   */
  isConnected(): boolean {
    return this.connected && this.redis.status === 'ready';
  }

  /**
   * Get the native Redis client
   */
  getClient(): Redis {
    return this.redis;
  }

  /**
   * Build prefixed key
   */
  private key(key: string): string {
    return `${this.prefix}${key}`;
  }

  // ═══════════════════════════════════════════════════════════════
  // BASIC OPERATIONS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get value
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await this.redis.get(this.key(key));

      return data ? JSON.parse(data) : null;
    } catch (error) {
      this.client.logger.error(`Error getting key ${key}:`, error);

      return null;
    }
  }

  /**
   * Set value
   */
  async set(key: string, value: any, ttl?: number): Promise<boolean> {
    try {
      const data = JSON.stringify(value);

      if (ttl) {
        await this.redis.setex(this.key(key), ttl, data);
      } else {
        await this.redis.set(this.key(key), data);
      }

      return true;
    } catch (error) {
      this.client.logger.error(`Error setting key ${key}:`, error);

      return false;
    }
  }

  /**
   * Delete key
   */
  async del(key: string): Promise<boolean> {
    try {
      const result = await this.redis.del(this.key(key));

      return result > 0;
    } catch (error) {
      this.client.logger.error(`Error deleting key ${key}:`, error);

      return false;
    }
  }

  /**
   * Check whether it exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(this.key(key));

      return result === 1;
    } catch (error) {
      this.client.logger.error(`Error checking existence of ${key}:`, error);

      // Fail closed for security-sensitive keys (token blacklist).
      // If Redis is down we cannot verify revocation, so treat as revoked.
      if (key.includes('blacklist')) return true;

      return false;
    }
  }

  /**
   * Establecer TTL
   */
  async expire(key: string, seconds: number): Promise<boolean> {
    try {
      const result = await this.redis.expire(this.key(key), seconds);

      return result === 1;
    } catch (error) {
      this.client.logger.error(`Error setting TTL for ${key}:`, error);

      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // OPERACIONES DE HASH
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get hash field
   */
  async hget<T>(hash: string, field: string): Promise<T | null> {
    try {
      const data = await this.redis.hget(this.key(hash), field);

      return data ? JSON.parse(data) : null;
    } catch (error) {
      this.client.logger.error(`Error getting field ${field} from hash ${hash}:`, error);

      return null;
    }
  }

  /**
   * Set hash field
   */
  async hset(hash: string, field: string, value: any): Promise<boolean> {
    try {
      await this.redis.hset(this.key(hash), field, JSON.stringify(value));

      return true;
    } catch (error) {
      this.client.logger.error(`Error setting field ${field} in hash ${hash}:`, error);

      return false;
    }
  }

  /**
   * Get the whole hash
   */
  async hgetall<T>(hash: string): Promise<Record<string, T>> {
    try {
      const data = await this.redis.hgetall(this.key(hash));
      const result: Record<string, T> = {};

      for (const [key, value] of Object.entries(data)) {
        result[key] = JSON.parse(value);
      }

      return result;
    } catch (error) {
      this.client.logger.error(`Error obteniendo hash ${hash}:`, error);

      return {};
    }
  }

  /**
   * Delete hash field
   */
  async hdel(hash: string, field: string): Promise<boolean> {
    try {
      const result = await this.redis.hdel(this.key(hash), field);

      return result > 0;
    } catch (error) {
      this.client.logger.error(`Error deleting field ${field} from hash ${hash}:`, error);

      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // OPERACIONES DE LISTA
  // ═══════════════════════════════════════════════════════════════

  /**
   * Push to the start of the list
   */
  async lpush(key: string, value: any): Promise<number> {
    try {
      return await this.redis.lpush(this.key(key), JSON.stringify(value));
    } catch (error) {
      this.client.logger.error(`Error agregando a lista ${key}:`, error);

      return 0;
    }
  }

  /**
   * Pop from the end of the list
   */
  async rpop<T>(key: string): Promise<T | null> {
    try {
      const data = await this.redis.rpop(this.key(key));

      return data ? JSON.parse(data) : null;
    } catch (error) {
      this.client.logger.error(`Error popping from list ${key}:`, error);

      return null;
    }
  }

  /**
   * Get list length
   */
  async llen(key: string): Promise<number> {
    try {
      return await this.redis.llen(this.key(key));
    } catch (error) {
      this.client.logger.error(`Error getting length of list ${key}:`, error);

      return 0;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PUB/SUB
  // ═══════════════════════════════════════════════════════════════

  /**
   * Publish message
   */
  async publish(channel: string, message: any): Promise<number> {
    try {
      return await this.redis.publish(channel, JSON.stringify(message));
    } catch (error) {
      this.client.logger.error(`Error publishing to channel ${channel}:`, error);

      return 0;
    }
  }

  /**
   * Subscribe to channel
   */
  subscribe(channel: string, callback: (message: any) => void): void {
    const subscriber = this.redis.duplicate();

    subscriber.subscribe(channel);
    subscriber.on('message', (ch, message) => {
      if (ch === channel) {
        try {
          callback(JSON.parse(message));
        } catch (error) {
          this.client.logger.error(`Error processing message from ${channel}:`, error);
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // UTILIDADES
  // ═══════════════════════════════════════════════════════════════

  /**
   * Check Redis health
   */
  async healthCheck(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
    try {
      const start = Date.now();

      await this.redis.ping();
      const latency = Date.now() - start;

      return { healthy: true, latency };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get Redis info
   */
  async getInfo(): Promise<{
    version: string;
    memory: string;
    clients: string;
    keyspace: string;
  }> {
    try {
      const info = await this.redis.info();
      const lines = info.split('\r\n');

      const getField = (field: string) => {
        const line = lines.find((l) => l.startsWith(field));

        return line ? line.split(':')[1] : 'unknown';
      };

      return {
        version: getField('redis_version'),
        memory: getField('used_memory_human'),
        clients: getField('connected_clients'),
        keyspace: getField('db0') || '0',
      };
    } catch (error) {
      this.client.logger.error('Error getting Redis info:', error);

      return {
        version: 'unknown',
        memory: 'unknown',
        clients: 'unknown',
        keyspace: 'unknown',
      };
    }
  }

  /**
   * Clear all keys with the bot prefix
   */
  async flushBotData(): Promise<number> {
    try {
      const keys = await this.redis.keys(`${this.prefix}*`);

      if (keys.length === 0) {
        return 0;
      }

      const result = await this.redis.del(...keys);

      this.client.logger.info(`${result} Redis keys cleared`);

      return result;
    } catch (error) {
      this.client.logger.error('Error clearing Redis data:', error);

      return 0;
    }
  }
}
