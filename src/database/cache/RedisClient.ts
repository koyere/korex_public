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
   * Configurar event handlers
   */
  private setupEventHandlers(): void {
    this.redis.on('connect', () => {
      this.connected = true;
      this.client.logger.info('Redis conectado');
    });

    this.redis.on('ready', () => {
      this.client.logger.debug('Redis listo para recibir comandos');
    });

    this.redis.on('error', (error) => {
      this.connected = false;
      this.client.logger.error('Error de Redis:', error);
    });

    this.redis.on('close', () => {
      this.connected = false;
      this.client.logger.warn('Conexión Redis cerrada');
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
   * Desconectar de Redis
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
   * Verificar si está conectado
   */
  isConnected(): boolean {
    return this.connected && this.redis.status === 'ready';
  }

  /**
   * Obtener cliente Redis nativo
   */
  getClient(): Redis {
    return this.redis;
  }

  /**
   * Generar clave con prefijo
   */
  private key(key: string): string {
    return `${this.prefix}${key}`;
  }

  // ═══════════════════════════════════════════════════════════════
  // OPERACIONES BÁSICAS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Obtener valor
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await this.redis.get(this.key(key));

      return data ? JSON.parse(data) : null;
    } catch (error) {
      this.client.logger.error(`Error obteniendo clave ${key}:`, error);

      return null;
    }
  }

  /**
   * Establecer valor
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
      this.client.logger.error(`Error estableciendo clave ${key}:`, error);

      return false;
    }
  }

  /**
   * Eliminar clave
   */
  async del(key: string): Promise<boolean> {
    try {
      const result = await this.redis.del(this.key(key));

      return result > 0;
    } catch (error) {
      this.client.logger.error(`Error eliminando clave ${key}:`, error);

      return false;
    }
  }

  /**
   * Verificar si existe
   */
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(this.key(key));

      return result === 1;
    } catch (error) {
      this.client.logger.error(`Error verificando existencia de ${key}:`, error);

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
      this.client.logger.error(`Error estableciendo TTL para ${key}:`, error);

      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // OPERACIONES DE HASH
  // ═══════════════════════════════════════════════════════════════

  /**
   * Obtener campo de hash
   */
  async hget<T>(hash: string, field: string): Promise<T | null> {
    try {
      const data = await this.redis.hget(this.key(hash), field);

      return data ? JSON.parse(data) : null;
    } catch (error) {
      this.client.logger.error(`Error obteniendo campo ${field} de hash ${hash}:`, error);

      return null;
    }
  }

  /**
   * Establecer campo de hash
   */
  async hset(hash: string, field: string, value: any): Promise<boolean> {
    try {
      await this.redis.hset(this.key(hash), field, JSON.stringify(value));

      return true;
    } catch (error) {
      this.client.logger.error(`Error estableciendo campo ${field} en hash ${hash}:`, error);

      return false;
    }
  }

  /**
   * Obtener todo el hash
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
   * Eliminar campo de hash
   */
  async hdel(hash: string, field: string): Promise<boolean> {
    try {
      const result = await this.redis.hdel(this.key(hash), field);

      return result > 0;
    } catch (error) {
      this.client.logger.error(`Error eliminando campo ${field} de hash ${hash}:`, error);

      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // OPERACIONES DE LISTA
  // ═══════════════════════════════════════════════════════════════

  /**
   * Agregar al inicio de la lista
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
   * Remover del final de la lista
   */
  async rpop<T>(key: string): Promise<T | null> {
    try {
      const data = await this.redis.rpop(this.key(key));

      return data ? JSON.parse(data) : null;
    } catch (error) {
      this.client.logger.error(`Error removiendo de lista ${key}:`, error);

      return null;
    }
  }

  /**
   * Obtener longitud de lista
   */
  async llen(key: string): Promise<number> {
    try {
      return await this.redis.llen(this.key(key));
    } catch (error) {
      this.client.logger.error(`Error obteniendo longitud de lista ${key}:`, error);

      return 0;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PUB/SUB
  // ═══════════════════════════════════════════════════════════════

  /**
   * Publicar mensaje
   */
  async publish(channel: string, message: any): Promise<number> {
    try {
      return await this.redis.publish(channel, JSON.stringify(message));
    } catch (error) {
      this.client.logger.error(`Error publicando en canal ${channel}:`, error);

      return 0;
    }
  }

  /**
   * Suscribirse a canal
   */
  subscribe(channel: string, callback: (message: any) => void): void {
    const subscriber = this.redis.duplicate();

    subscriber.subscribe(channel);
    subscriber.on('message', (ch, message) => {
      if (ch === channel) {
        try {
          callback(JSON.parse(message));
        } catch (error) {
          this.client.logger.error(`Error procesando mensaje de ${channel}:`, error);
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // UTILIDADES
  // ═══════════════════════════════════════════════════════════════

  /**
   * Verificar salud de Redis
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
   * Obtener información de Redis
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
      this.client.logger.error('Error obteniendo info de Redis:', error);

      return {
        version: 'unknown',
        memory: 'unknown',
        clients: 'unknown',
        keyspace: 'unknown',
      };
    }
  }

  /**
   * Limpiar todas las claves con el prefijo del bot
   */
  async flushBotData(): Promise<number> {
    try {
      const keys = await this.redis.keys(`${this.prefix}*`);

      if (keys.length === 0) {
        return 0;
      }

      const result = await this.redis.del(...keys);

      this.client.logger.info(`${result} claves de Redis limpiadas`);

      return result;
    } catch (error) {
      this.client.logger.error('Error limpiando datos de Redis:', error);

      return 0;
    }
  }
}
