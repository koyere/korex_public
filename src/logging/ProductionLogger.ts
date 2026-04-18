import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { KorexClient } from '../client/KorexClient';
import { createLogger } from '../utils/Logger';
import path from 'path';
import fs from 'fs';

export interface LogMetrics {
  totalLogs: number;
  errorCount: number;
  warnCount: number;
  infoCount: number;
  debugCount: number;
  averageLogsPerMinute: number;
  topErrorSources: Array<{ source: string; count: number }>;
  recentErrors: Array<{ timestamp: Date; level: string; message: string; source?: string }>;
}

export interface AlertConfig {
  errorThreshold: number; // Errores por minuto
  memoryThreshold: number; // MB
  responseTimeThreshold: number; // ms
  webhookUrl?: string;
  discordChannelId?: string;
}

/**
 * Sistema de Logging de Producción para Korex
 * Manejo avanzado de logs, métricas y alertas
 */
export class ProductionLogger {
  private client: KorexClient;
  private logger!: winston.Logger;
  private metricsLogger!: winston.Logger;
  private errorLogger!: winston.Logger;
  private baseLogger = createLogger('production-logger');
  
  // Métricas en memoria
  private logCounts = {
    total: 0,
    error: 0,
    warn: 0,
    info: 0,
    debug: 0
  };
  
  private errorSources = new Map<string, number>();
  private recentErrors: Array<{ timestamp: Date; level: string; message: string; source?: string }> = [];
  private logTimestamps: number[] = [];
  
  // Configuración de alertas
  private alertConfig: AlertConfig = {
    errorThreshold: 10, // 10 errores por minuto
    memoryThreshold: 1024, // 1GB
    responseTimeThreshold: 5000 // 5 segundos
  };

  constructor(client: KorexClient, alertConfig?: Partial<AlertConfig>) {
    this.client = client;
    
    if (alertConfig) {
      this.alertConfig = { ...this.alertConfig, ...alertConfig };
    }

    this.setupLoggers();
    this.setupMetricsCollection();
    this.setupAlerts();
  }

  /**
   * Configurar loggers especializados
   */
  private setupLoggers(): void {
    const logDir = path.join(process.cwd(), 'logs', 'production');
    
    // Crear directorio si no existe
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Logger principal con rotación diaria
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
        winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
          return JSON.stringify({
            timestamp,
            level,
            message,
            stack,
            ...meta,
            pid: process.pid,
            memory: process.memoryUsage(),
            uptime: process.uptime()
          });
        })
      ),
      transports: [
        // Archivo principal con rotación
        new DailyRotateFile({
          filename: path.join(logDir, 'korex-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxSize: '100m',
          maxFiles: '30d',
          zippedArchive: true
        }),
        
        // Console para desarrollo
        ...(process.env.NODE_ENV !== 'production' ? [
          new winston.transports.Console({
            format: winston.format.combine(
              winston.format.colorize(),
              winston.format.simple()
            )
          })
        ] : [])
      ]
    });

    // Logger específico para errores
    this.errorLogger = winston.createLogger({
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: [
        new DailyRotateFile({
          filename: path.join(logDir, 'errors-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxSize: '50m',
          maxFiles: '90d',
          zippedArchive: true
        })
      ]
    });

    // Logger para métricas
    this.metricsLogger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new DailyRotateFile({
          filename: path.join(logDir, 'metrics-%DATE%.log'),
          datePattern: 'YYYY-MM-DD-HH',
          maxSize: '20m',
          maxFiles: '7d',
          zippedArchive: true
        })
      ]
    });

    this.baseLogger.info('Production loggers initialized');
  }

  /**
   * Configurar recolección de métricas
   */
  private setupMetricsCollection(): void {
    // Recopilar métricas cada minuto
    setInterval(() => {
      this.collectSystemMetrics();
    }, 60000);

    // Limpiar métricas antiguas cada hora
    setInterval(() => {
      this.cleanupMetrics();
    }, 3600000);

    this.baseLogger.info('Metrics collection started');
  }

  /**
   * Configurar sistema de alertas
   */
  private setupAlerts(): void {
    // Verificar alertas cada 30 segundos
    setInterval(() => {
      this.checkAlerts();
    }, 30000);

    this.baseLogger.info('Alert system initialized');
  }

  /**
   * Log con tracking de métricas
   */
  log(level: string, message: string, meta?: any, source?: string): void {
    const logEntry = {
      level,
      message,
      source,
      timestamp: new Date(),
      ...meta
    };

    // Enviar a logger apropiado
    this.logger.log(level, message, meta);
    
    if (level === 'error') {
      this.errorLogger.error(message, meta);
    }

    // Actualizar métricas
    this.updateMetrics(level, message, source);
  }

  /**
   * Actualizar métricas internas
   */
  private updateMetrics(level: string, message: string, source?: string): void {
    this.logCounts.total++;
    
    switch (level) {
      case 'error':
        this.logCounts.error++;
        this.trackError(message, source);
        break;
      case 'warn':
        this.logCounts.warn++;
        break;
      case 'info':
        this.logCounts.info++;
        break;
      case 'debug':
        this.logCounts.debug++;
        break;
    }

    // Registrar timestamp para cálculo de rate
    this.logTimestamps.push(Date.now());
    
    // Mantener solo los últimos 1000 timestamps
    if (this.logTimestamps.length > 1000) {
      this.logTimestamps = this.logTimestamps.slice(-1000);
    }
  }

  /**
   * Rastrear errores para análisis
   */
  private trackError(message: string, source?: string): void {
    // Agregar a errores recientes
    this.recentErrors.push({
      timestamp: new Date(),
      level: 'error',
      message,
      ...(source && { source })
    });

    // Mantener solo los últimos 100 errores
    if (this.recentErrors.length > 100) {
      this.recentErrors = this.recentErrors.slice(-100);
    }

    // Contar por fuente
    if (source) {
      this.errorSources.set(source, (this.errorSources.get(source) || 0) + 1);
    }
  }

  /**
   * Recopilar métricas del sistema
   */
  private collectSystemMetrics(): void {
    const metrics = {
      timestamp: new Date(),
      system: {
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        uptime: process.uptime(),
        pid: process.pid
      },
      bot: this.client.getBotInfo(),
      logs: this.getLogMetrics(),
      database: null as any, // Se llenará si está disponible
      redis: null as any // Se llenará si está disponible
    };

    // Agregar métricas de base de datos si está disponible
    if (this.client.database) {
      this.client.database.getStats().then(dbStats => {
        metrics.database = dbStats;
      }).catch(() => {
        // Ignorar errores de DB stats
      });
    }

    // Agregar métricas de Redis si está disponible
    if (this.client.redis) {
      this.client.redis.healthCheck().then(redisHealth => {
        metrics.redis = redisHealth;
      }).catch(() => {
        // Ignorar errores de Redis stats
      });
    }

    this.metricsLogger.info('system_metrics', metrics);
  }

  /**
   * Verificar condiciones de alerta
   */
  private async checkAlerts(): Promise<void> {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Verificar rate de errores
    const recentErrorCount = this.recentErrors.filter(
      error => error.timestamp.getTime() > oneMinuteAgo
    ).length;

    if (recentErrorCount > this.alertConfig.errorThreshold) {
      await this.sendAlert('HIGH_ERROR_RATE', {
        errorCount: recentErrorCount,
        threshold: this.alertConfig.errorThreshold,
        timeWindow: '1 minute'
      });
    }

    // Verificar uso de memoria
    const memoryUsage = process.memoryUsage();
    const memoryMB = memoryUsage.heapUsed / 1024 / 1024;

    if (memoryMB > this.alertConfig.memoryThreshold) {
      await this.sendAlert('HIGH_MEMORY_USAGE', {
        currentUsage: Math.round(memoryMB),
        threshold: this.alertConfig.memoryThreshold,
        unit: 'MB'
      });
    }

    // Verificar tiempo de respuesta del bot
    if (this.client.ws.ping > this.alertConfig.responseTimeThreshold) {
      await this.sendAlert('HIGH_RESPONSE_TIME', {
        currentPing: this.client.ws.ping,
        threshold: this.alertConfig.responseTimeThreshold,
        unit: 'ms'
      });
    }
  }

  /**
   * Enviar alerta
   */
  private async sendAlert(type: string, data: any): Promise<void> {
    const alert = {
      type,
      timestamp: new Date(),
      severity: 'HIGH',
      data,
      botInfo: {
        guilds: this.client.guilds.cache.size,
        users: this.client.users.cache.size,
        uptime: Math.round(process.uptime() / 60) // minutos
      }
    };

    // Log la alerta
    this.errorLogger.error('ALERT_TRIGGERED', alert);

    // Enviar a Discord si está configurado
    if (this.alertConfig.discordChannelId) {
      try {
        const channel = await this.client.channels.fetch(this.alertConfig.discordChannelId);

        if (channel?.isTextBased() && 'send' in channel) {
          await channel.send({
            embeds: [{
              title: `🚨 Alert: ${type}`,
              description: `**Severity:** ${alert.severity}\n**Time:** ${alert.timestamp.toISOString()}`,
              fields: Object.entries(data).map(([key, value]) => ({
                name: key.replace(/_/g, ' ').toUpperCase(),
                value: String(value),
                inline: true
              })),
              color: 0xFF0000,
              timestamp: alert.timestamp.toISOString()
            }]
          });
        }
      } catch (error) {
        this.baseLogger.error('Failed to send Discord alert:', error);
      }
    }

    // Enviar webhook si está configurado
    if (this.alertConfig.webhookUrl) {
      try {
        const fetch = (await import('node-fetch')).default;

        await fetch(this.alertConfig.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(alert)
        });
      } catch (error) {
        this.baseLogger.error('Failed to send webhook alert:', error);
      }
    }
  }

  /**
   * Obtener métricas de logs
   */
  getLogMetrics(): LogMetrics {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    
    // Calcular logs por minuto
    const recentLogs = this.logTimestamps.filter(timestamp => timestamp > oneMinuteAgo);
    const averageLogsPerMinute = recentLogs.length;

    // Top fuentes de errores
    const topErrorSources = Array.from(this.errorSources.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([source, count]) => ({ source, count }));

    return {
      totalLogs: this.logCounts.total,
      errorCount: this.logCounts.error,
      warnCount: this.logCounts.warn,
      infoCount: this.logCounts.info,
      debugCount: this.logCounts.debug,
      averageLogsPerMinute,
      topErrorSources,
      recentErrors: this.recentErrors.slice(-20) // Últimos 20 errores
    };
  }

  /**
   * Limpiar métricas antiguas
   */
  private cleanupMetrics(): void {
    const oneHourAgo = Date.now() - 3600000;
    
    // Limpiar timestamps antiguos
    this.logTimestamps = this.logTimestamps.filter(timestamp => timestamp > oneHourAgo);
    
    // Limpiar errores antiguos (mantener últimas 24 horas)
    const oneDayAgo = Date.now() - 86400000;

    this.recentErrors = this.recentErrors.filter(
      error => error.timestamp.getTime() > oneDayAgo
    );

    this.baseLogger.debug('Metrics cleanup completed');
  }

  /**
   * Exportar logs para análisis
   */
  async exportLogs(
    startDate: Date,
    endDate: Date,
    level?: string
  ): Promise<string> {
    const logDir = path.join(process.cwd(), 'logs', 'production');
    const exportDir = path.join(logDir, 'exports');
    
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }

    const exportFile = path.join(
      exportDir,
      `export-${startDate.toISOString().split('T')[0]}-to-${endDate.toISOString().split('T')[0]}.json`
    );

    // Implementar exportación de logs
    // Por ahora, retornar la ruta del archivo
    this.baseLogger.info(`Log export requested: ${exportFile}`);
    
    return exportFile;
  }

  /**
   * Configurar nivel de log dinámicamente
   */
  setLogLevel(level: string): void {
    this.logger.level = level;
    this.baseLogger.info(`Log level changed to: ${level}`);
  }

  /**
   * Obtener estadísticas de archivos de log
   */
  getLogFileStats(): {
    totalSize: number;
    fileCount: number;
    oldestFile: Date | null;
    newestFile: Date | null;
  } {
    const logDir = path.join(process.cwd(), 'logs', 'production');
    
    if (!fs.existsSync(logDir)) {
      return {
        totalSize: 0,
        fileCount: 0,
        oldestFile: null,
        newestFile: null
      };
    }

    const files = fs.readdirSync(logDir);
    let totalSize = 0;
    let oldestFile: Date | null = null;
    let newestFile: Date | null = null;

    files.forEach(file => {
      const filePath = path.join(logDir, file);
      const stats = fs.statSync(filePath);
      
      totalSize += stats.size;
      
      if (!oldestFile || stats.birthtime < oldestFile) {
        oldestFile = stats.birthtime;
      }
      
      if (!newestFile || stats.birthtime > newestFile) {
        newestFile = stats.birthtime;
      }
    });

    return {
      totalSize,
      fileCount: files.length,
      oldestFile,
      newestFile
    };
  }

  /**
   * Destruir el logger de producción
   */
  destroy(): void {
    this.logger.close();
    this.errorLogger.close();
    this.metricsLogger.close();
    this.baseLogger.info('Production logger destroyed');
  }
}