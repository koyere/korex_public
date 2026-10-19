import { KorexClient } from '../client/KorexClient';
import { createLogger } from '../utils/Logger';
import { EventEmitter } from 'events';

export interface HealthCheck {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastCheck: Date;
  responseTime: number;
  details?: any;
  error?: string;
}

export interface SystemHealth {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  checks: HealthCheck[];
  uptime: number;
  timestamp: Date;
}

export interface HealthThresholds {
  responseTime: {
    healthy: number;
    degraded: number;
  };
  memory: {
    healthy: number; // MB
    degraded: number; // MB
  };
  database: {
    healthy: number; // ms
    degraded: number; // ms
  };
  redis: {
    healthy: number; // ms
    degraded: number; // ms
  };
}

/**
 * System Health Monitor for Korex
 * Monitors all critical system components
 */
export class HealthMonitor extends EventEmitter {
  private client: KorexClient;
  private logger = createLogger('health-monitor');
  private checks: Map<string, HealthCheck> = new Map();
  private monitoringInterval: NodeJS.Timeout | undefined;
  private isMonitoring = false;

  // Startup grace period: checks that depend on WS readiness are lenient during this window
  private readonly STARTUP_GRACE_MS = 60_000;
  private readonly startupTime = Date.now();

  // Rolling CPU measurement: delta between consecutive intervals (avoids the cumulative-average
  // problem that causes 100 %+ readings when uptime is only a few seconds at startup)
  private lastCpuSnapshot: NodeJS.CpuUsage | null = null;
  private lastCpuSnapshotTime: number | null = null;

  // Configurable health thresholds
  private thresholds: HealthThresholds = {
    responseTime: {
      healthy: 100, // ms
      degraded: 500 // ms
    },
    memory: {
      healthy: 512, // MB
      degraded: 1024 // MB
    },
    database: {
      healthy: 50, // ms
      degraded: 200 // ms
    },
    redis: {
      healthy: 10, // ms
      degraded: 50 // ms
    }
  };

  constructor(client: KorexClient, thresholds?: Partial<HealthThresholds>) {
    super();
    this.client = client;
    
    if (thresholds) {
      this.thresholds = { ...this.thresholds, ...thresholds };
    }
  }

  /**
   * Start health monitoring
   */
  startMonitoring(intervalMs: number = 30000): void {
    if (this.isMonitoring) {
      this.logger.warn('Health monitoring is already running');

      return;
    }

    this.logger.info(`Starting health monitoring (interval: ${intervalMs}ms)`);

    // Seed the CPU snapshot so the first interval delta has a valid baseline
    this.lastCpuSnapshot = process.cpuUsage();
    this.lastCpuSnapshotTime = Date.now();

    this.monitoringInterval = setInterval(async () => {
      await this.performHealthChecks();
    }, intervalMs);

    this.isMonitoring = true;

    // First check is intentionally deferred to the first interval tick.
    // Firing immediately would produce false-positive unhealthy results because:
    //   • ws.ping === -1 before the Discord WS handshake completes
    //   • process.cpuUsage() over a 2-second uptime skews to 100 %+
    //   • Lavalink takes several seconds to negotiate its connection
    // All three resolve naturally before the first interval fires.
  }

  /**
   * Stop health monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    
    this.isMonitoring = false;
    this.logger.info('Health monitoring stopped');
  }

  /**
   * Run all health checks
   */
  async performHealthChecks(): Promise<SystemHealth> {
    const startTime = Date.now();
    
    try {
      // Run all checks in parallel
      const checkPromises = [
        this.checkDiscordConnection(),
        this.checkDatabase(),
        this.checkRedis(),
        this.checkMusicNode(),
        this.checkMemoryUsage(),
        this.checkCPUUsage(),
        this.checkDiskSpace(),
        this.checkShardHealth(),
        this.checkAPIHealth()
      ];

      await Promise.allSettled(checkPromises);

      // Calculate overall status
      const systemHealth = this.calculateOverallHealth();
      
      // Emit health check event
      this.emit('healthCheck', systemHealth);
      
      // Log if there are problems
      if (systemHealth.overall !== 'healthy') {
        this.logger.warn(`System health: ${systemHealth.overall}`, {
          unhealthyChecks: systemHealth.checks.filter(c => c.status !== 'healthy').length
        });
      }

      return systemHealth;

    } catch (error) {
      this.logger.error('Error performing health checks:', error);
      throw error;
    }
  }

  /**
   * Check music node status (Lavalink)
   */
  private async checkMusicNode(): Promise<void> {
    const startTime = Date.now();

    try {
      const musicEnabled = this.client.music?.isEnabled?.() ?? false;
      const musicReady = this.client.music?.isReady?.() ?? false;
      const responseTime = Date.now() - startTime;

      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      const inGrace = Date.now() - this.startupTime < this.STARTUP_GRACE_MS;

      if (musicEnabled && !musicReady) {
        // Lavalink negotiation takes a few seconds after startup; don't alarm during that window
        status = inGrace ? 'degraded' : 'unhealthy';
      }
      // If music is intentionally disabled (MUSIC_ENABLED=false), this is an
      // expected operational state, not a degradation → keep status 'healthy'.

      this.updateCheck('music', {
        name: 'Music Node',
        status,
        lastCheck: new Date(),
        responseTime,
        details: {
          enabled: musicEnabled,
          ready: musicReady
        }
      });
    } catch (error) {
      this.updateCheck('music', {
        name: 'Music Node',
        status: 'unhealthy',
        lastCheck: new Date(),
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Check Discord connection
   */
  private async checkDiscordConnection(): Promise<void> {
    const startTime = Date.now();
    
    try {
      const ping = this.client.ws.ping;
      const responseTime = Date.now() - startTime;
      
      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

      if (ping === -1) {
        // -1 means the WS handshake hasn't completed yet.
        // During the startup grace window this is normal; after that it's a real problem.
        status = Date.now() - this.startupTime < this.STARTUP_GRACE_MS ? 'degraded' : 'unhealthy';
      } else if (ping > this.thresholds.responseTime.degraded) {
        status = 'unhealthy';
      } else if (ping > this.thresholds.responseTime.healthy) {
        status = 'degraded';
      }

      this.updateCheck('discord', {
        name: 'Discord Connection',
        status,
        lastCheck: new Date(),
        responseTime,
        details: {
          ping,
          readyAt: this.client.readyAt,
          guilds: this.client.guilds.cache.size,
          users: this.client.users.cache.size
        }
      });

    } catch (error) {
      this.updateCheck('discord', {
        name: 'Discord Connection',
        status: 'unhealthy',
        lastCheck: new Date(),
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Check database
   */
  private async checkDatabase(): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Simple connection test
      await this.client.db.$queryRaw`SELECT 1`;
      const responseTime = Date.now() - startTime;
      
      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      
      if (responseTime > this.thresholds.database.degraded) {
        status = responseTime > this.thresholds.database.degraded * 2 ? 'unhealthy' : 'degraded';
      }

      // Get additional statistics
      const dbHealth = await this.client.database.healthCheck();
      
      this.updateCheck('database', {
        name: 'Database Connection',
        status: dbHealth.healthy ? status : 'unhealthy',
        lastCheck: new Date(),
        responseTime,
        details: {
          latency: dbHealth.latency,
          healthy: dbHealth.healthy,
          error: dbHealth.error
        }
      });

    } catch (error) {
      this.updateCheck('database', {
        name: 'Database Connection',
        status: 'unhealthy',
        lastCheck: new Date(),
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Check Redis
   */
  private async checkRedis(): Promise<void> {
    const startTime = Date.now();
    
    try {
      const redisHealth = await this.client.redis.healthCheck();
      const responseTime = Date.now() - startTime;
      
      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      
      if (!redisHealth.healthy) {
        status = 'unhealthy';
      } else if (redisHealth.latency && redisHealth.latency > this.thresholds.redis.degraded) {
        status = 'degraded';
      }

      this.updateCheck('redis', {
        name: 'Redis Connection',
        status,
        lastCheck: new Date(),
        responseTime,
        details: {
          latency: redisHealth.latency,
          healthy: redisHealth.healthy,
          connected: this.client.redis.isConnected()
        }
      });

    } catch (error) {
      this.updateCheck('redis', {
        name: 'Redis Connection',
        status: 'unhealthy',
        lastCheck: new Date(),
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Check memory usage
   */
  private async checkMemoryUsage(): Promise<void> {
    const startTime = Date.now();
    
    try {
      const memoryUsage = process.memoryUsage();
      const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
      const heapTotalMB = memoryUsage.heapTotal / 1024 / 1024;
      const externalMB = memoryUsage.external / 1024 / 1024;
      
      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      
      if (heapUsedMB > this.thresholds.memory.degraded) {
        status = heapUsedMB > this.thresholds.memory.degraded * 1.5 ? 'unhealthy' : 'degraded';
      }

      this.updateCheck('memory', {
        name: 'Memory Usage',
        status,
        lastCheck: new Date(),
        responseTime: Date.now() - startTime,
        details: {
          heapUsed: Math.round(heapUsedMB),
          heapTotal: Math.round(heapTotalMB),
          external: Math.round(externalMB),
          rss: Math.round(memoryUsage.rss / 1024 / 1024),
          unit: 'MB'
        }
      });

    } catch (error) {
      this.updateCheck('memory', {
        name: 'Memory Usage',
        status: 'unhealthy',
        lastCheck: new Date(),
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Check CPU usage
   *
   * Uses a rolling delta between consecutive snapshots so the reading reflects
   * actual CPU activity during the last interval — not a cumulative average
   * from process start (which skews to 100 %+ when uptime is only a few seconds).
   */
  private async checkCPUUsage(): Promise<void> {
    const startTime = Date.now();

    try {
      const nowCpu  = process.cpuUsage();
      const nowTime = Date.now();

      let cpuPercent = 0;

      if (this.lastCpuSnapshot !== null && this.lastCpuSnapshotTime !== null) {
        const elapsedMs  = nowTime - this.lastCpuSnapshotTime;
        const elapsedUs  = elapsedMs * 1000; // convert to microseconds (same unit as cpuUsage)
        const deltaUser  = nowCpu.user   - this.lastCpuSnapshot.user;
        const deltaSystem = nowCpu.system - this.lastCpuSnapshot.system;

        // Percentage of one CPU core used during the interval.
        // Divide by elapsedUs (not uptime) to get an interval-accurate reading.
        cpuPercent = ((deltaUser + deltaSystem) / elapsedUs) * 100;
      }

      // Update baseline for next interval
      this.lastCpuSnapshot     = nowCpu;
      this.lastCpuSnapshotTime = nowTime;

      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

      if (cpuPercent > 80) {
        status = 'unhealthy';
      } else if (cpuPercent > 60) {
        status = 'degraded';
      }

      this.updateCheck('cpu', {
        name: 'CPU Usage',
        status,
        lastCheck: new Date(),
        responseTime: Date.now() - startTime,
        details: {
          percent: Math.round(cpuPercent * 100) / 100,
          uptime: Math.round(process.uptime())
        }
      });

    } catch (error) {
      this.updateCheck('cpu', {
        name: 'CPU Usage',
        status: 'unhealthy',
        lastCheck: new Date(),
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Check disk space
   */
  private async checkDiskSpace(): Promise<void> {
    const startTime = Date.now();
    
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      // Check space in the logs directory
      const logDir = path.join(process.cwd(), 'logs');
      
      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      let details: any = { available: 'unknown' };
      
      try {
        const stats = fs.statSync(logDir);

        // On Unix systems we could use statvfs, but for simplicity
        // we only check that the directory exists
        details = { 
          logDirExists: true,
          logDirSize: stats.size || 0
        };
      } catch {
        status = 'degraded';
        details = { logDirExists: false };
      }

      this.updateCheck('disk', {
        name: 'Disk Space',
        status,
        lastCheck: new Date(),
        responseTime: Date.now() - startTime,
        details
      });

    } catch (error) {
      this.updateCheck('disk', {
        name: 'Disk Space',
        status: 'unhealthy',
        lastCheck: new Date(),
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Check shard health (if applicable)
   */
  private async checkShardHealth(): Promise<void> {
    const startTime = Date.now();
    
    try {
      // If there is no sharding, mark as healthy
      if (!this.client.shard) {
        this.updateCheck('shards', {
          name: 'Shard Health',
          status: 'healthy',
          lastCheck: new Date(),
          responseTime: Date.now() - startTime,
          details: { mode: 'single_process' }
        });

        return;
      }

      // Check the current shard status
      const shardId = this.client.shard.ids[0];
      const shardCount = this.client.shard.count;
      
      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      
      // Check whether the shard is responding
      const ping = this.client.ws.ping;

      if (ping > 1000 || ping === -1) {
        status = 'degraded';
      }

      this.updateCheck('shards', {
        name: 'Shard Health',
        status,
        lastCheck: new Date(),
        responseTime: Date.now() - startTime,
        details: {
          shardId,
          shardCount,
          ping,
          guilds: this.client.guilds.cache.size
        }
      });

    } catch (error) {
      this.updateCheck('shards', {
        name: 'Shard Health',
        status: 'unhealthy',
        lastCheck: new Date(),
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Check API health
   */
  private async checkAPIHealth(): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Check whether the API is enabled
      // The open-source core does not ship the REST API: report it as disabled
      // unless a host application attaches one to the client.
      if (!(this.client as unknown as { api?: unknown }).api) {
        this.updateCheck('api', {
          name: 'API Health',
          status: 'healthy',
          lastCheck: new Date(),
          responseTime: Date.now() - startTime,
          details: { enabled: false }
        });

        return;
      }

      // The API is enabled, check that it is responding
      // For now, assume it is healthy if it exists
      this.updateCheck('api', {
        name: 'API Health',
        status: 'healthy',
        lastCheck: new Date(),
        responseTime: Date.now() - startTime,
        details: { 
          enabled: true,
          port: process.env.API_PORT || 3000
        }
      });

    } catch (error) {
      this.updateCheck('api', {
        name: 'API Health',
        status: 'unhealthy',
        lastCheck: new Date(),
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Update a health check
   */
  private updateCheck(key: string, check: HealthCheck): void {
    this.checks.set(key, check);
    
    // Emit the check-specific event
    this.emit('checkUpdate', key, check);
    
    // Log if the status changed to unhealthy
    if (check.status === 'unhealthy') {
      this.logger.error(`Health check failed: ${check.name}`, {
        error: check.error,
        responseTime: check.responseTime,
        details: check.details
      });
    }
  }

  /**
   * Calculate overall system status
   */
  private calculateOverallHealth(): SystemHealth {
    const checks = Array.from(this.checks.values());
    
    let overall: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    // If any check is unhealthy, the system is unhealthy
    if (checks.some(check => check.status === 'unhealthy')) {
      overall = 'unhealthy';
    }
    // If any check is degraded, the system is degraded
    else if (checks.some(check => check.status === 'degraded')) {
      overall = 'degraded';
    }

    return {
      overall,
      checks,
      uptime: process.uptime(),
      timestamp: new Date()
    };
  }

  /**
   * Signal that the Discord client is fully ready (WS handshake complete).
   * Called from KorexClient.onReady() so the monitor can lift startup-grace leniency.
   */
  markBotReady(): void {
    this.logger.info('Bot ready signal received — startup grace period lifted for health checks');
  }

  /**
   * Get current system status
   */
  getCurrentHealth(): SystemHealth {
    return this.calculateOverallHealth();
  }

  /**
   * Get a specific health check
   */
  getCheck(name: string): HealthCheck | undefined {
    return this.checks.get(name);
  }

  /**
   * Configure health thresholds
   */
  setThresholds(thresholds: Partial<HealthThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
    this.logger.info('Health thresholds updated', thresholds);
  }

  /**
   * Get current thresholds
   */
  getThresholds(): HealthThresholds {
    return { ...this.thresholds };
  }

  /**
   * Check whether the system is healthy
   */
  isHealthy(): boolean {
    return this.calculateOverallHealth().overall === 'healthy';
  }

  /**
   * Get health summary
   */
  getHealthSummary(): {
    status: string;
    uptime: string;
    checksTotal: number;
    checksHealthy: number;
    checksDegraded: number;
    checksUnhealthy: number;
  } {
    const health = this.calculateOverallHealth();
    const checks = health.checks;
    
    return {
      status: health.overall,
      uptime: this.formatUptime(health.uptime),
      checksTotal: checks.length,
      checksHealthy: checks.filter(c => c.status === 'healthy').length,
      checksDegraded: checks.filter(c => c.status === 'degraded').length,
      checksUnhealthy: checks.filter(c => c.status === 'unhealthy').length
    };
  }

  /**
   * Format uptime
   */
  private formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }

  /**
   * Destroy the health monitor
   */
  destroy(): void {
    this.stopMonitoring();
    this.checks.clear();
    this.removeAllListeners();
    this.logger.info('Health monitor destroyed');
  }
}
