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
 * Sharding manager for Korex
 * Handles multiple shards for automatic scalability
 */
export class KorexShardingManager extends EventEmitter {
  private manager: DiscordShardingManager;
  private logger = createLogger('sharding');
  private shardStats: Map<number, ShardStats> = new Map();
  private healthCheckInterval?: NodeJS.Timeout;
  private statsInterval?: NodeJS.Timeout;
  private restartQueue: Set<number> = new Set();
  private maxRestarts = 5;
  private restartCooldown = 300000; // 5 minutes
  private shardRestartCounts: Map<number, number> = new Map();

  constructor() {
    super();

    // Configure ShardingManager
    this.manager = new DiscordShardingManager(
      path.join(__dirname, '../index.js'), // Compiled file
      {
        token: process.env.DISCORD_TOKEN!,
        totalShards: this.calculateOptimalShards(),
        shardList: 'auto',
        mode: 'process',
        respawn: false, // We handle restarts ourselves
        silent: false,
        shardArgs: [],
        execArgv: []
      }
    );

    this.setupEventHandlers();
    this.logger.info(`Sharding Manager initialized with ${this.manager.totalShards} shards`);
  }

  /**
   * Calculate the optimal number of shards
   */
  private calculateOptimalShards(): number | 'auto' {
    const guildCount = parseInt(process.env.ESTIMATED_GUILD_COUNT || '0');
    
    if (guildCount === 0) {
      return 'auto'; // Let Discord decide
    }

    // Optimized sharding rules
    if (guildCount < 1000) return 1;
    if (guildCount < 2000) return 2;
    if (guildCount < 5000) return Math.ceil(guildCount / 1000);
    
    // For large bots, use Discord's rule (2500 guilds per shard) but with headroom
    return Math.ceil(guildCount / 2000);
  }

  /**
   * Configure event handlers
   */
  private setupEventHandlers(): void {
    // Manager events
    this.manager.on('shardCreate', (shard) => {
      this.logger.info(`Shard ${shard.id} created`);
      this.initializeShardStats(shard.id);
      this.setupShardHandlers(shard);
    });

    // Global events
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
   * Configure shard-specific handlers
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

    // Configure heartbeat
    this.setupShardHeartbeat(shard);
  }

  /**
   * Configure shard heartbeat
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
        // If the heartbeat fails, consider the shard problematic
        this.handleShardIssue(shard.id);
      }
    }, 30000); // Every 30 seconds

    // Clear interval when the shard dies
    shard.once('death', () => {
      clearInterval(heartbeatInterval);
    });
  }

  /**
   * Initialize shard statistics
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
   * Update shard status
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
   * Get statistics for a specific shard
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
   * Handle shard death
   */
  private handleShardDeath(shardId: number): void {
    const restartCount = this.shardRestartCounts.get(shardId) || 0;
    
    if (restartCount >= this.maxRestarts) {
      this.logger.error(`Shard ${shardId} exceeded max restart attempts (${this.maxRestarts})`);
      this.emit('shardMaxRestartsExceeded', shardId);

      return;
    }

    // Add to restart queue
    this.restartQueue.add(shardId);
    this.shardRestartCounts.set(shardId, restartCount + 1);

    // Restart after a delay
    setTimeout(() => {
      this.restartShard(shardId);
    }, 5000); // 5 second delay
  }

  /**
   * Handle shard issues
   */
  private handleShardIssue(shardId: number): void {
    const stats = this.shardStats.get(shardId);

    if (!stats) return;

    const timeSinceLastHeartbeat = Date.now() - stats.lastHeartbeat.getTime();
    
    // If there is no heartbeat for more than 2 minutes, restart
    if (timeSinceLastHeartbeat > 120000) {
      this.logger.warn(`Shard ${shardId} unresponsive, restarting...`);
      this.restartShard(shardId);
    }
  }

  /**
   * Restart a specific shard
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
      
      // If the restart fails, try again after a longer delay
      setTimeout(() => {
        if (this.restartQueue.has(shardId)) {
          this.restartShard(shardId);
        }
      }, 30000); // 30 seconds
    }
  }

  /**
   * Start the sharding manager
   */
  async start(): Promise<void> {
    try {
      this.logger.info('🚀 Starting Korex Sharding Manager...');
      
      // Validate configuration
      await this.validateConfiguration();
      
      // Spawn shards
      await this.manager.spawn({
        amount: this.manager.totalShards,
        delay: 5000, // 5 seconds between shards
        timeout: 60000 // 1 minute timeout
      });

      // Start monitoring
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
   * Validate configuration before starting
   */
  private async validateConfiguration(): Promise<void> {
    // Check token
    if (!process.env.DISCORD_TOKEN) {
      throw new Error('DISCORD_TOKEN is required');
    }

    // Check that the bot file exists
    const botFile = path.join(__dirname, '../index.js');

    if (!fs.existsSync(botFile)) {
      throw new Error(`Bot file not found: ${botFile}. Run 'npm run build' first.`);
    }

    // Check database connection
    // TODO: Add DB check when needed

    this.logger.info('✅ Configuration validated');
  }

  /**
   * Start health checks
   */
  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthChecks();
    }, 60000); // Every minute

    this.logger.info('Health checks started');
  }

  /**
   * Run health checks
   */
  private async performHealthChecks(): Promise<void> {
    const now = Date.now();
    
    for (const [shardId, stats] of this.shardStats) {
      const timeSinceHeartbeat = now - stats.lastHeartbeat.getTime();
      
      // Check whether the shard is responding
      if (timeSinceHeartbeat > 180000) { // 3 minutes
        this.logger.warn(`Shard ${shardId} health check failed - no heartbeat for ${Math.round(timeSinceHeartbeat / 1000)}s`);
        this.handleShardIssue(shardId);
      }

      // Check memory usage
      if (stats.memory.heapUsed > 1024 * 1024 * 1024) { // 1GB
        this.logger.warn(`Shard ${shardId} high memory usage: ${Math.round(stats.memory.heapUsed / 1024 / 1024)}MB`);
      }
    }
  }

  /**
   * Start stats collection
   */
  private startStatsCollection(): void {
    this.statsInterval = setInterval(async () => {
      await this.collectGlobalStats();
    }, 30000); // Every 30 seconds

    this.logger.info('Stats collection started');
  }

  /**
   * Collect global statistics
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
   * Update the bot's presence on all shards
   */
  async broadcastPresence(status: 'online' | 'idle' | 'dnd' | 'invisible'): Promise<void> {
    try {
      await this.manager.broadcastEval(
        (client, context) => {
          client.user?.setStatus(context.status as any);
        },
        { context: { status } }
      );
    } catch (error) {
      this.logger.error('broadcastPresence failed:', error);
      throw error;
    }
  }

  /**
   * Get statistics for all shards
   */
  getShardStats(): ShardStats[] {
    return Array.from(this.shardStats.values());
  }

  /**
   * Get current global statistics
   */
  async getGlobalStats(): Promise<GlobalStats> {
    return await this.collectGlobalStats();
  }

  /**
   * Get information about a specific shard
   */
  getShardInfo(shardId: number): ShardStats | null {
    return this.shardStats.get(shardId) || null;
  }

  /**
   * Graceful shutdown
   */
  async gracefulShutdown(signal: string): Promise<void> {
    this.logger.info(`🛑 Graceful shutdown initiated (${signal})`);

    try {
      // Clear intervals
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
      }
      if (this.statsInterval) {
        clearInterval(this.statsInterval);
      }

      // Shut down all shards
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
   * Restart all shards
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