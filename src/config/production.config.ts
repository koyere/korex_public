/**
 * Production configuration for Korex
 * Settings specific to the production environment
 */

export const productionConfig = {
  // Rate limiting settings
  rateLimiting: {
    enabled: true,
    global: {
      maxRequests: 100,
      windowMs: 60000 // 1 minute
    },
    perUser: {
      maxRequests: 30,
      windowMs: 60000 // 30 commands per minute per user
    },
    perGuild: {
      maxRequests: 200,
      windowMs: 60000 // 200 commands per minute per server
    }
  },

  // Logging settings
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    enableMetrics: true,
    enableAlerts: true,
    alertThresholds: {
      errorRate: 10, // errors per minute
      memoryUsage: 1024, // MB
      responseTime: 5000 // ms
    },
    discordAlerts: {
      enabled: !!process.env.ALERT_CHANNEL_ID,
      channelId: process.env.ALERT_CHANNEL_ID
    }
  },

  // Health monitoring settings
  healthMonitoring: {
    enabled: true,
    interval: 30000, // 30 seconds
    thresholds: {
      responseTime: {
        healthy: 100,
        degraded: 500
      },
      memory: {
        healthy: 512,
        degraded: 1024
      },
      database: {
        healthy: 50,
        degraded: 200
      },
      redis: {
        healthy: 10,
        degraded: 50
      }
    }
  },

  // Backup settings
  backups: {
    enabled: process.env.ENABLE_BACKUPS !== 'false',
    schedule: process.env.BACKUP_SCHEDULE || '0 2 * * *', // Daily at 2 AM
    retention: {
      daily: parseInt(process.env.BACKUP_RETENTION_DAILY || '7'),
      weekly: parseInt(process.env.BACKUP_RETENTION_WEEKLY || '4'),
      monthly: parseInt(process.env.BACKUP_RETENTION_MONTHLY || '3')
    },
    compression: true,
    destinations: {
      local: {
        enabled: true,
        path: process.env.BACKUP_PATH || './backups'
      }
    }
  },

  // Sharding settings
  sharding: {
    enabled: process.env.ENABLE_SHARDING === 'true',
    totalShards: process.env.SHARD_COUNT || 'auto',
    estimatedGuilds: parseInt(process.env.ESTIMATED_GUILD_COUNT || '0'),
    autoRestart: true,
    maxRestarts: 5,
    restartCooldown: 300000 // 5 minutes
  },

  // Database settings
  database: {
    optimization: {
      enabled: true,
      autoOptimize: true,
      vacuumSchedule: '0 3 * * 0' // Sundays at 3 AM
    },
    monitoring: {
      slowQueryThreshold: 1000, // 1 second
      enableQueryLogging: process.env.NODE_ENV === 'development'
    }
  },

  // Performance settings
  performance: {
    enableCaching: true,
    cacheTimeout: 300000, // 5 minutes
    enableCompression: true,
    maxMemoryUsage: 2048, // MB
    gcInterval: 300000 // 5 minutes
  },

  // Security settings
  security: {
    enableRateLimiting: true,
    enableCORS: true,
    enableHelmet: true,
    maxRequestSize: '10mb',
    enableRequestLogging: true
  }
};

export type ProductionConfig = typeof productionConfig;