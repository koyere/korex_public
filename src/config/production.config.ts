/**
 * Configuración de Producción para Korex
 * Configuraciones específicas para entorno de producción
 */

export const productionConfig = {
  // Configuración de Rate Limiting
  rateLimiting: {
    enabled: true,
    global: {
      maxRequests: 100,
      windowMs: 60000 // 1 minuto
    },
    perUser: {
      maxRequests: 30,
      windowMs: 60000 // 30 comandos por minuto por usuario
    },
    perGuild: {
      maxRequests: 200,
      windowMs: 60000 // 200 comandos por minuto por servidor
    }
  },

  // Configuración de Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    enableMetrics: true,
    enableAlerts: true,
    alertThresholds: {
      errorRate: 10, // errores por minuto
      memoryUsage: 1024, // MB
      responseTime: 5000 // ms
    },
    discordAlerts: {
      enabled: !!process.env.ALERT_CHANNEL_ID,
      channelId: process.env.ALERT_CHANNEL_ID
    }
  },

  // Configuración de Health Monitoring
  healthMonitoring: {
    enabled: true,
    interval: 30000, // 30 segundos
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

  // Configuración de Backups
  backups: {
    enabled: process.env.ENABLE_BACKUPS !== 'false',
    schedule: process.env.BACKUP_SCHEDULE || '0 2 * * *', // Diario a las 2 AM
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

  // Configuración de Sharding
  sharding: {
    enabled: process.env.ENABLE_SHARDING === 'true',
    totalShards: process.env.SHARD_COUNT || 'auto',
    estimatedGuilds: parseInt(process.env.ESTIMATED_GUILD_COUNT || '0'),
    autoRestart: true,
    maxRestarts: 5,
    restartCooldown: 300000 // 5 minutos
  },

  // Configuración de Base de Datos
  database: {
    optimization: {
      enabled: true,
      autoOptimize: true,
      vacuumSchedule: '0 3 * * 0' // Domingos a las 3 AM
    },
    monitoring: {
      slowQueryThreshold: 1000, // 1 segundo
      enableQueryLogging: process.env.NODE_ENV === 'development'
    }
  },

  // Configuración de Performance
  performance: {
    enableCaching: true,
    cacheTimeout: 300000, // 5 minutos
    enableCompression: true,
    maxMemoryUsage: 2048, // MB
    gcInterval: 300000 // 5 minutos
  },

  // Configuración de Seguridad
  security: {
    enableRateLimiting: true,
    enableCORS: true,
    enableHelmet: true,
    maxRequestSize: '10mb',
    enableRequestLogging: true
  }
};

export type ProductionConfig = typeof productionConfig;