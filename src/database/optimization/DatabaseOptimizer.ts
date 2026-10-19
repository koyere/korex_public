import { PrismaClient } from '@prisma/client';
import { createLogger } from '../../utils/Logger';

export interface OptimizationResult {
  success: boolean;
  operation: string;
  duration: number;
  details?: string;
  error?: string;
}

export interface DatabaseHealth {
  connectionStatus: 'healthy' | 'degraded' | 'unhealthy';
  averageQueryTime: number;
  slowQueries: number;
  connectionCount: number;
  cacheHitRatio: number;
  indexUsage: number;
  recommendations: string[];
}

/**
 * Database Optimizer for Production
 * Handles indexes, optimized queries and performance monitoring
 */
export class DatabaseOptimizer {
  private prisma: PrismaClient;
  private logger = createLogger('db-optimizer');
  private queryTimes: number[] = [];
  private slowQueryThreshold = 1000; // 1 second

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Run all optimizations
   */
  async optimizeDatabase(): Promise<OptimizationResult[]> {
    this.logger.info('🔧 Starting database optimization...');
    const results: OptimizationResult[] = [];

    try {
      // 1. Create optimized indexes
      results.push(...await this.createOptimizedIndexes());

      // 2. Analyze and optimize queries
      results.push(...await this.analyzeQueries());

      // 3. Configure connections
      results.push(...await this.optimizeConnections());

      // 4. Clean obsolete data
      results.push(...await this.cleanupObsoleteData());

      this.logger.info('✅ Database optimization completed');

      return results;

    } catch (error) {
      this.logger.error('❌ Database optimization failed:', error);
      throw error;
    }
  }

  /**
   * Create optimized indexes for production
   */
  private async createOptimizedIndexes(): Promise<OptimizationResult[]> {
    const results: OptimizationResult[] = [];
    
    const indexes = [
      // Indexes for Guild
      {
        name: 'guild_language_idx',
        sql: 'CREATE INDEX IF NOT EXISTS guild_language_idx ON "guilds" ("language");'
      },
      {
        name: 'guild_created_at_idx',
        sql: 'CREATE INDEX IF NOT EXISTS guild_created_at_idx ON "guilds" ("createdAt");'
      },

      // Indexes for GuildUser (performance-critical)
      {
        name: 'guild_user_xp_idx',
        sql: 'CREATE INDEX IF NOT EXISTS guild_user_xp_idx ON "guild_users" ("guildId", "xp" DESC);'
      },
      {
        name: 'guild_user_level_idx',
        sql: 'CREATE INDEX IF NOT EXISTS guild_user_level_idx ON "guild_users" ("guildId", "level" DESC);'
      },
      {
        name: 'guild_user_balance_idx',
        sql: 'CREATE INDEX IF NOT EXISTS guild_user_balance_idx ON "guild_users" ("guildId", "balance" DESC);'
      },
      {
        name: 'guild_user_last_daily_idx',
        sql: 'CREATE INDEX IF NOT EXISTS guild_user_last_daily_idx ON "guild_users" ("lastDaily");'
      },

      // Indexes for ModerationCase
      {
        name: 'moderation_case_target_idx',
        sql: 'CREATE INDEX IF NOT EXISTS moderation_case_target_idx ON "moderation_cases" ("guildId", "targetId", "createdAt" DESC);'
      },
      {
        name: 'moderation_case_moderator_idx',
        sql: 'CREATE INDEX IF NOT EXISTS moderation_case_moderator_idx ON "moderation_cases" ("moderatorId", "createdAt" DESC);'
      },
      {
        name: 'moderation_case_active_idx',
        sql: 'CREATE INDEX IF NOT EXISTS moderation_case_active_idx ON "moderation_cases" ("guildId", "active", "expiresAt");'
      },

      // Indexes for CommandUsage (analytics)
      {
        name: 'command_usage_guild_command_idx',
        sql: 'CREATE INDEX IF NOT EXISTS command_usage_guild_command_idx ON "command_usage" ("guildId", "command", "createdAt" DESC);'
      },
      {
        name: 'command_usage_date_idx',
        sql: 'CREATE INDEX IF NOT EXISTS command_usage_date_idx ON "command_usage" ("createdAt" DESC);'
      },

      // Indexes for AddonLicense (addon system)
      {
        name: 'addon_license_status_expires_idx',
        sql: 'CREATE INDEX IF NOT EXISTS addon_license_status_expires_idx ON "addon_licenses" ("status", "expiresAt");'
      },
      {
        name: 'addon_license_paypal_idx',
        sql: 'CREATE INDEX IF NOT EXISTS addon_license_paypal_idx ON "addon_licenses" ("paypalSubscriptionId");'
      },

      // Indexes for LogEntry
      {
        name: 'log_entry_guild_type_idx',
        sql: 'CREATE INDEX IF NOT EXISTS log_entry_guild_type_idx ON "log_entries" ("guildId", "type", "createdAt" DESC);'
      },

      // Indexes for Giveaways
      {
        name: 'giveaway_guild_ended_idx',
        sql: 'CREATE INDEX IF NOT EXISTS giveaway_guild_ended_idx ON "giveaways" ("guildId", "ended", "endsAt");'
      },

      // Composite indexes for complex queries
      {
        name: 'guild_user_activity_idx',
        sql: 'CREATE INDEX IF NOT EXISTS guild_user_activity_idx ON "guild_users" ("guildId", "lastXpGain", "messages" DESC);'
      },
      {
        name: 'moderation_case_lookup_idx',
        sql: 'CREATE INDEX IF NOT EXISTS moderation_case_lookup_idx ON "moderation_cases" ("guildId", "caseNumber", "action");'
      }
    ];

    for (const index of indexes) {
      try {
        const startTime = Date.now();

        await this.prisma.$executeRawUnsafe(index.sql);
        const duration = Date.now() - startTime;

        results.push({
          success: true,
          operation: `Create index: ${index.name}`,
          duration,
          details: `Index created successfully`
        });

        this.logger.debug(`✅ Created index: ${index.name} (${duration}ms)`);

      } catch (error) {
        results.push({
          success: false,
          operation: `Create index: ${index.name}`,
          duration: 0,
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        this.logger.warn(`⚠️ Failed to create index ${index.name}:`, error);
      }
    }

    return results;
  }

  /**
   * Analyze and optimize queries
   * Note: Requires the pg_stat_statements extension enabled in PostgreSQL
   */
  private async analyzeQueries(): Promise<OptimizationResult[]> {
    const results: OptimizationResult[] = [];
    const startTime = Date.now();

    try {
      // First check whether pg_stat_statements is available
      const extensionCheck = await this.prisma.$queryRaw`
        SELECT EXISTS (
          SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'
        ) as installed;
      ` as any[];

      if (!extensionCheck[0]?.installed) {
        results.push({
          success: true,
          operation: 'Analyze slow queries',
          duration: Date.now() - startTime,
          details: 'pg_stat_statements extension not installed (optional)'
        });

        return results;
      }

      // Use a query compatible with PostgreSQL 13+ (total_exec_time instead of total_time)
      const slowQueries = await this.prisma.$queryRaw`
        SELECT
          query,
          calls,
          COALESCE(total_exec_time, 0) as total_time,
          COALESCE(mean_exec_time, 0) as mean_time,
          rows
        FROM pg_stat_statements
        WHERE COALESCE(mean_exec_time, 0) > ${this.slowQueryThreshold}
        ORDER BY mean_exec_time DESC NULLS LAST
        LIMIT 10;
      ` as any[];

      const duration = Date.now() - startTime;

      results.push({
        success: true,
        operation: 'Analyze slow queries',
        duration,
        details: `Found ${slowQueries.length} slow queries`
      });

      // Log slow queries for review (only if any)
      if (slowQueries.length > 0) {
        this.logger.warn(`Found ${slowQueries.length} slow queries:`);
        slowQueries.forEach((query: any, index: number) => {
          this.logger.warn(`${index + 1}. Mean time: ${Math.round(query.mean_time || 0)}ms, Calls: ${query.calls}`);
        });
      }

    } catch (error) {
      // pg_stat_statements might not be enabled or might have a different schema
      const duration = Date.now() - startTime;

      this.logger.debug('pg_stat_statements not available or incompatible version');

      results.push({
        success: true, // Not a critical error, it is optional
        operation: 'Analyze slow queries',
        duration,
        details: 'Query analysis skipped (pg_stat_statements not configured)'
      });
    }

    return results;
  }

  /**
   * Optimize connection configuration
   */
  private async optimizeConnections(): Promise<OptimizationResult[]> {
    const results: OptimizationResult[] = [];

    try {
      const startTime = Date.now();

      // Check connection configuration
      const connectionInfo = await this.prisma.$queryRaw`
        SELECT 
          setting as max_connections,
          (SELECT count(*) FROM pg_stat_activity) as current_connections
        FROM pg_settings 
        WHERE name = 'max_connections';
      ` as any[];

      const duration = Date.now() - startTime;

      results.push({
        success: true,
        operation: 'Check connection configuration',
        duration,
        details: `Max: ${connectionInfo[0]?.max_connections}, Current: ${connectionInfo[0]?.current_connections}`
      });

    } catch (error) {
      results.push({
        success: false,
        operation: 'Check connection configuration',
        duration: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    return results;
  }

  /**
   * Clean obsolete data
   */
  private async cleanupObsoleteData(): Promise<OptimizationResult[]> {
    const results: OptimizationResult[] = [];

    const cleanupOperations = [
      {
        name: 'Clean old command usage',
        operation: async () => {
          const thirtyDaysAgo = new Date();

          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          
          const deleted = await this.prisma.commandUsage.deleteMany({
            where: {
              createdAt: { lt: thirtyDaysAgo }
            }
          });
          
          return `Deleted ${deleted.count} old command usage records`;
        }
      },
      {
        name: 'Clean old error logs',
        operation: async () => {
          const sevenDaysAgo = new Date();

          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          
          const deleted = await this.prisma.errorLog.deleteMany({
            where: {
              createdAt: { lt: sevenDaysAgo },
              resolved: true
            }
          });
          
          return `Deleted ${deleted.count} resolved error logs`;
        }
      },
      {
        name: 'Clean expired addon licenses',
        operation: async () => {
          const now = new Date();
          
          // Use queryRaw to avoid issues with the model
          const result = await this.prisma.$executeRaw`
            UPDATE "addon_licenses" 
            SET "status" = 'EXPIRED' 
            WHERE "expiresAt" < ${now} 
            AND "status" IN ('ACTIVE', 'TRIAL')
          `;
          
          return `Expired ${result} addon licenses`;
        }
      },
      {
        name: 'Clean old log entries',
        operation: async () => {
          // 30 days: what the privacy policy states and the Analytics/Logs maximum
          const retentionLimit = new Date();

          retentionLimit.setDate(retentionLimit.getDate() - 30);

          const deleted = await this.prisma.logEntry.deleteMany({
            where: {
              createdAt: { lt: retentionLimit }
            }
          });
          
          return `Deleted ${deleted.count} old log entries`;
        }
      }
    ];

    for (const cleanup of cleanupOperations) {
      try {
        const startTime = Date.now();
        const details = await cleanup.operation();
        const duration = Date.now() - startTime;

        results.push({
          success: true,
          operation: cleanup.name,
          duration,
          details
        });

        this.logger.info(`✅ ${cleanup.name}: ${details} (${duration}ms)`);

      } catch (error) {
        results.push({
          success: false,
          operation: cleanup.name,
          duration: 0,
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        this.logger.error(`❌ ${cleanup.name} failed:`, error);
      }
    }

    return results;
  }

  /**
   * Check database health
   */
  async checkDatabaseHealth(): Promise<DatabaseHealth> {
    try {
      const startTime = Date.now();
      
      // Basic connection test
      await this.prisma.$queryRaw`SELECT 1`;
      const connectionTime = Date.now() - startTime;

      // Get database statistics
      const stats = await this.prisma.$queryRaw`
        SELECT 
          (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') as active_connections,
          (SELECT count(*) FROM pg_stat_activity) as total_connections,
          (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max_connections;
      ` as any[];

      const connectionCount = stats[0]?.total_connections || 0;
      const maxConnections = stats[0]?.max_connections || 100;
      const connectionRatio = connectionCount / maxConnections;

      // Compute health status
      let connectionStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

      if (connectionTime > 1000 || connectionRatio > 0.8) {
        connectionStatus = 'degraded';
      }
      if (connectionTime > 5000 || connectionRatio > 0.95) {
        connectionStatus = 'unhealthy';
      }

      // Generate recommendations
      const recommendations: string[] = [];

      if (connectionRatio > 0.7) {
        recommendations.push('Consider increasing connection pool size');
      }
      if (connectionTime > 500) {
        recommendations.push('Database response time is slow, check network and queries');
      }
      if (this.queryTimes.length > 0) {
        const avgQueryTime = this.queryTimes.reduce((a, b) => a + b, 0) / this.queryTimes.length;

        if (avgQueryTime > 100) {
          recommendations.push('Average query time is high, consider query optimization');
        }
      }

      return {
        connectionStatus,
        averageQueryTime: connectionTime,
        slowQueries: this.queryTimes.filter(t => t > this.slowQueryThreshold).length,
        connectionCount,
        cacheHitRatio: 0.95, // Placeholder - implement if needed
        indexUsage: 0.85, // Placeholder - implement if needed
        recommendations
      };

    } catch (error) {
      this.logger.error('Database health check failed:', error);

      return {
        connectionStatus: 'unhealthy',
        averageQueryTime: -1,
        slowQueries: -1,
        connectionCount: -1,
        cacheHitRatio: -1,
        indexUsage: -1,
        recommendations: ['Database connection failed']
      };
    }
  }

  /**
   * Record query time for monitoring
   */
  recordQueryTime(duration: number): void {
    this.queryTimes.push(duration);
    
    // Keep only the last 1000 records
    if (this.queryTimes.length > 1000) {
      this.queryTimes = this.queryTimes.slice(-1000);
    }

    // Log slow queries
    if (duration > this.slowQueryThreshold) {
      this.logger.warn(`Slow query detected: ${duration}ms`);
    }
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats(): {
    averageQueryTime: number;
    slowQueries: number;
    totalQueries: number;
    slowQueryThreshold: number;
  } {
    const totalQueries = this.queryTimes.length;
    const averageQueryTime = totalQueries > 0 
      ? this.queryTimes.reduce((a, b) => a + b, 0) / totalQueries 
      : 0;
    const slowQueries = this.queryTimes.filter(t => t > this.slowQueryThreshold).length;

    return {
      averageQueryTime,
      slowQueries,
      totalQueries,
      slowQueryThreshold: this.slowQueryThreshold
    };
  }

  /**
   * Run VACUUM and ANALYZE to optimize tables
   */
  async vacuumAnalyze(): Promise<OptimizationResult[]> {
    const results: OptimizationResult[] = [];
    
    const tables = [
      'guilds', 'guild_users', 'moderation_cases', 'command_usage',
      'addon_licenses', 'log_entries', 'giveaways', 'suggestions'
    ];

    for (const table of tables) {
      try {
        const startTime = Date.now();

        await this.prisma.$executeRawUnsafe(`VACUUM ANALYZE "${table}";`);
        const duration = Date.now() - startTime;

        results.push({
          success: true,
          operation: `VACUUM ANALYZE ${table}`,
          duration,
          details: 'Table optimized successfully'
        });

      } catch (error) {
        results.push({
          success: false,
          operation: `VACUUM ANALYZE ${table}`,
          duration: 0,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return results;
  }
}