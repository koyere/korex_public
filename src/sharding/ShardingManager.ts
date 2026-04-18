import { ShardingManager as DiscordShardingManager, Shard } from 'discord.js';
import { createLogger } from '../utils/Logger';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';

export interface ShardStats {
  id: number;
  status: string;
  guilds: number;
  users: number;
  ping: number;
  memory: NodeJS.MemoryUsage;
  uptime: number;
  lastHeartbeat: Date;
}

export interface GlobalStats {
  totalShards: number;
  readyShards: number;
  totalGuilds: number;
  totalUsers: number;
  averagePing: number;
  totalMemory: number;
  uptime: number;
}

/**
 * Gestor de Sharding para Korex
 * Maneja múltiples shards para escalabilidad automática
 */
export class KorexShardingManager extends EventEmitter {
  private manager: DiscordShardingManager;
  private logger = createLogger('sharding');
  private shardStats: Map<number, ShardStats> = new Map();
  private healthCheckInterval?: NodeJS.Timeout;
  private statsInterval?: NodeJS.Timeout;
  private restartQueue: Set<number> = new Set();
  private maxRestarts = 5;
  private restartCooldown = 300000; // 5 minutos
  private shardRestartCounts: Map<number, number> = new Map();

  constructor() {
    super();

    // Configurar ShardingManager
    this.manager = new DiscordShardingManager(
      path.join(__dirname, '../index.js'), // Archivo compilado
      {
        token: process.env.DISCORD_TOKEN!,
        totalShards: this.calculateOptimalShards(),
        shardList: 'auto',
        mode: 'process',
        respawn: false, // Manejamos nosotros los reinicios
        silent: false,
        shardArgs: [],
        execArgv: []
      }
    );

    this.setupEventHandlers();
    this.logger.info(`Sharding Manager initialized with ${this.manager.totalShards} shards`);
  }

  /**
   * Calcular número óptimo de shards
   */
  private calculateOptimalShards(): number | 'auto' {
    const guildCount = parseInt(process.env.ESTIMATED_GUILD_COUNT || '0');
    
    if (guildCount === 0) {
      return 'auto'; // Dejar que Discord decida
    }

    // Reglas de sharding optimizadas
    if (guildCount < 1000) return 1;
    if (guildCount < 2000) return 2;
    if (guildCount < 5000) return Math.ceil(guildCount / 1000);
    
    // Para bots grandes, usar la regla de Discord (2500 guilds por shard) pero con margen
    return Math.ceil(guildCount / 2000);
  }

  /**
   * Configurar event handlers
   */
  private setupEventHandlers(): void {
    // Eventos del manager
    this.manager.on('shardCreate', (shard) => {
      this.logger.info(`Shard ${shard.id} created`);
      this.initializeShardStats(shard.id);
      this.setupShardHandlers(shard);
    });

    // Eventos globales
    process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught Exception:', error);
      this.gracefulShutdown('UNCAUGHT_EXCEPTION');
    });
  }

  /**
   * Configurar handlers específicos del shard
   */
  private setupShardHandlers(shard: Shard): void {
    shard.on('ready', () => {
      this.logger.info(`✅ Shard ${shard.id} ready`);
      this.updateShardStatus(shard.id, 'ready');
      this.emit('shardReady', shard.id);
    });

    shard.on('disconnect', () => {
      this.logger.warn(`🔌 Shard ${shard.id} disconnected`);
      this.updateShardStatus(shard.id, 'disconnected');
      this.emit('shardDisconnect', shard.id);
    });

    shard.on('reconnecting', () => {
      this.logger.info(`🔄 Shard ${shard.id} reconnecting`);
      this.updateShardStatus(shard.id, 'reconnecting');
      this.emit('shardReconnecting', shard.id);
    });

    shard.on('death', () => {
      this.logger.error(`💀 Shard ${shard.id} died`);
      this.updateShardStatus(shard.id, 'dead');
      this.handleShardDeath(shard.id);
      this.emit('shardDeath', shard.id);
    });

    shard.on('error', (error) => {
      this.logger.error(`❌ Shard ${shard.id} error:`, error);
      this.emit('shardError', shard.id, error);
    });

    // Configurar heartbeat
    this.setupShardHeartbeat(shard);
  }

  /**
   * Configurar heartbeat del shard
   */
  private setupShardHeartbeat(shard: Shard): void {
    const heartbeatInterval = setInterval(async () => {
      try {
        const stats = await this.getShardStatsSingle(shard.id);

        if (stats) {
          this.shardStats.set(shard.id, {
            ...stats,
            lastHeartbeat: new Date()
          });
        }
      } catch (error) {
        this.logger.error(`Heartbeat failed for shard ${shard.id}:`, error);
        // Si el heartbeat falla, considerar el shard como problemático
        this.handleShardIssue(shard.id);
      }
    }, 30000); // Cada 30 segundos

    // Limpiar interval cuando el shard muere
    shard.once('death', () => {
      clearInterval(heartbeatInterval);
    });
  }

  /**
   * Inicializar estadísticas del shard
   */
  private initializeShardStats(shardId: number): void {
    this.shardStats.set(shardId, {
      id: shardId,
      status: 'spawning',
      guilds: 0,
      users: 0,
      ping: 0,
      memory: process.memoryUsage(),
      uptime: 0,
      lastHeartbeat: new Date()
    });
  }

  /**
   * Actualizar estado del shard
   */
  private updateShardStatus(shardId: number, status: string): void {
    const stats = this.shardStats.get(shardId);

    if (stats) {
      stats.status = status;
      stats.lastHeartbeat = new Date();
      this.shardStats.set(shardId, stats);
    }
  }

  /**
   * Obtener estadísticas de un shard específico
   */
  private async getShardStatsSingle(shardId: number): Promise<ShardStats | null> {
    try {
      const shard = this.manager.shards.get(shardId);

      if (!shard) return null;

      const result = await shard.eval((client) => {
        return {
          id: client.shard?.ids[0] || 0,
          status: client.ws?.status?.toString() || 'unknown',
          guilds: client.guilds.cache.size,
          users: client.users.cache.size,
          ping: client.ws?.ping || 0,
          memory: process.memoryUsage(),
          uptime: client.uptime || 0
        };
      });

      return {
        ...result,
        lastHeartbeat: new Date()
      };
    } catch (error) {
      this.logger.error(`Error getting stats for shard ${shardId}:`, error);

      return null;
    }
  }

  /**
   * Manejar muerte de shard
   */
  private handleShardDeath(shardId: number): void {
    const restartCount = this.shardRestartCounts.get(shardId) || 0;
    
    if (restartCount >= this.maxRestarts) {
      this.logger.error(`Shard ${shardId} exceeded max restart attempts (${this.maxRestarts})`);
      this.emit('shardMaxRestartsExceeded', shardId);

      return;
    }

    // Agregar a cola de reinicio
    this.restartQueue.add(shardId);
    this.shardRestartCounts.set(shardId, restartCount + 1);

    // Reiniciar después de un delay
    setTimeout(() => {
      this.restartShard(shardId);
    }, 5000); // 5 segundos de delay
  }

  /**
   * Manejar problemas del shard
   */
  private handleShardIssue(shardId: number): void {
    const stats = this.shardStats.get(shardId);

    if (!stats) return;

    const timeSinceLastHeartbeat = Date.now() - stats.lastHeartbeat.getTime();
    
    // Si no hay heartbeat por más de 2 minutos, reiniciar
    if (timeSinceLastHeartbeat > 120000) {
      this.logger.warn(`Shard ${shardId} unresponsive, restarting...`);
      this.restartShard(shardId);
    }
  }

  /**
   * Reiniciar un shard específico
   */
  async restartShard(shardId: number): Promise<void> {
    try {
      this.logger.info(`Restarting shard ${shardId}...`);
      
      const shard = this.manager.shards.get(shardId);

      if (shard) {
        await shard.respawn({
          delay: 5000,
          timeout: 30000
        });
        
        this.restartQueue.delete(shardId);
        this.logger.info(`✅ Shard ${shardId} restarted successfully`);
      }
    } catch (error) {
      this.logger.error(`Failed to restart shard ${shardId}:`, error);
      
      // Si falla el reinicio, intentar de nuevo después de un delay más largo
      setTimeout(() => {
        if (this.restartQueue.has(shardId)) {
          this.restartShard(shardId);
        }
      }, 30000); // 30 segundos
    }
  }

  /**
   * Iniciar el sharding manager
   */
  async start(): Promise<void> {
    try {
      this.logger.info('🚀 Starting Korex Sharding Manager...');
      
      // Verificar configuración
      await this.validateConfiguration();
      
      // Iniciar shards
      await this.manager.spawn({
        amount: this.manager.totalShards,
        delay: 5000, // 5 segundos entre shards
        timeout: 60000 // 1 minuto timeout
      });

      // Iniciar monitoreo
      this.startHealthChecks();
      this.startStatsCollection();

      this.logger.info('✅ All shards spawned successfully');
      this.emit('ready');

    } catch (error) {
      this.logger.error('❌ Failed to start sharding manager:', error);
      throw error;
    }
  }

  /**
   * Validar configuración antes de iniciar
   */
  private async validateConfiguration(): Promise<void> {
    // Verificar token
    if (!process.env.DISCORD_TOKEN) {
      throw new Error('DISCORD_TOKEN is required');
    }

    // Verificar que el archivo del bot existe
    const botFile = path.join(__dirname, '../index.js');

    if (!fs.existsSync(botFile)) {
      throw new Error(`Bot file not found: ${botFile}. Run 'npm run build' first.`);
    }

    // Verificar conexión a base de datos
    // TODO: Agregar verificación de BD cuando sea necesario

    this.logger.info('✅ Configuration validated');
  }

  /**
   * Iniciar health checks
   */
  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthChecks();
    }, 60000); // Cada minuto

    this.logger.info('Health checks started');
  }

  /**
   * Realizar health checks
   */
  private async performHealthChecks(): Promise<void> {
    const now = Date.now();
    
    for (const [shardId, stats] of this.shardStats) {
      const timeSinceHeartbeat = now - stats.lastHeartbeat.getTime();
      
      // Verificar si el shard está respondiendo
      if (timeSinceHeartbeat > 180000) { // 3 minutos
        this.logger.warn(`Shard ${shardId} health check failed - no heartbeat for ${Math.round(timeSinceHeartbeat / 1000)}s`);
        this.handleShardIssue(shardId);
      }

      // Verificar uso de memoria
      if (stats.memory.heapUsed > 1024 * 1024 * 1024) { // 1GB
        this.logger.warn(`Shard ${shardId} high memory usage: ${Math.round(stats.memory.heapUsed / 1024 / 1024)}MB`);
      }
    }
  }

  /**
   * Iniciar recolección de estadísticas
   */
  private startStatsCollection(): void {
    this.statsInterval = setInterval(async () => {
      await this.collectGlobalStats();
    }, 30000); // Cada 30 segundos

    this.logger.info('Stats collection started');
  }

  /**
   * Recopilar estadísticas globales
   */
  private async collectGlobalStats(): Promise<GlobalStats> {
    try {
      const stats = await this.manager.broadcastEval((client) => {
        return {
          guilds: client.guilds.cache.size,
          users: client.users.cache.size,
          ping: client.ws?.ping || 0,
          memory: process.memoryUsage().heapUsed,
          uptime: client.uptime || 0
        };
      });

      const globalStats: GlobalStats = {
        totalShards: this.manager.totalShards as number,
        readyShards: stats.length,
        totalGuilds: stats.reduce((acc, s) => acc + s.guilds, 0),
        totalUsers: stats.reduce((acc, s) => acc + s.users, 0),
        averagePing: Math.round(stats.reduce((acc, s) => acc + s.ping, 0) / stats.length),
        totalMemory: stats.reduce((acc, s) => acc + s.memory, 0),
        uptime: Math.max(...stats.map(s => s.uptime))
      };

      this.emit('statsUpdate', globalStats);

      return globalStats;

    } catch (error) {
      this.logger.error('Error collecting global stats:', error);
      throw error;
    }
  }

  /**
   * Broadcast a todos los shards
   */
  async broadcast(script: string): Promise<any[]> {
    try {
      return await this.manager.broadcastEval((client) => {
        return eval(script);
      });
    } catch (error) {
      this.logger.error('Broadcast failed:', error);
      throw error;
    }
  }

  /**
   * Ejecutar en un shard específico
   */
  async evalOnShard(shardId: number, script: string): Promise<any> {
    try {
      const shard = this.manager.shards.get(shardId);

      if (!shard) {
        throw new Error(`Shard ${shardId} not found`);
      }

      return await shard.eval((client) => {
        return eval(script);
      });
    } catch (error) {
      this.logger.error(`Eval on shard ${shardId} failed:`, error);
      throw error;
    }
  }

  /**
   * Obtener estadísticas de todos los shards
   */
  getShardStats(): ShardStats[] {
    return Array.from(this.shardStats.values());
  }

  /**
   * Obtener estadísticas globales actuales
   */
  async getGlobalStats(): Promise<GlobalStats> {
    return await this.collectGlobalStats();
  }

  /**
   * Obtener información de un shard específico
   */
  getShardInfo(shardId: number): ShardStats | null {
    return this.shardStats.get(shardId) || null;
  }

  /**
   * Apagado graceful
   */
  async gracefulShutdown(signal: string): Promise<void> {
    this.logger.info(`🛑 Graceful shutdown initiated (${signal})`);

    try {
      // Limpiar intervals
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
      }
      if (this.statsInterval) {
        clearInterval(this.statsInterval);
      }

      // Apagar todos los shards
      this.logger.info('Shutting down all shards...');
      await this.manager.broadcastEval((client) => {
        client.destroy();

        return true;
      });

      this.logger.info('✅ Graceful shutdown completed');
      process.exit(0);

    } catch (error) {
      this.logger.error('❌ Error during graceful shutdown:', error);
      process.exit(1);
    }
  }

  /**
   * Reiniciar todos los shards
   */
  async restartAllShards(): Promise<void> {
    this.logger.info('Restarting all shards...');
    
    try {
      await this.manager.respawnAll({
        shardDelay: 5000,
        respawnDelay: 500,
        timeout: 60000
      });
      
      this.logger.info('✅ All shards restarted successfully');
    } catch (error) {
      this.logger.error('❌ Failed to restart all shards:', error);
      throw error;
    }
  }
}