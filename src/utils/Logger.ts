import winston from 'winston';
import Transport from 'winston-transport';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { logStream } from './LogStream';

/** Transport que emite cada log al EventEmitter de streaming en tiempo real */
class LiveStreamTransport extends Transport {
  log(info: any, callback: () => void): void {
    setImmediate(() => {
      logStream.emit('log', {
        ts:      new Date().toISOString(),
        level:   info.level,
        service: info.service,
        message: String(info.message),
      });
    });
    callback();
  }
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack, service, ...meta }) => {
    let log = `[${timestamp}] ${level.toUpperCase().padEnd(7)}`;

    if (service) {
      log += ` [${service}]`;
    }

    log += ` | ${message}`;

    if (Object.keys(meta).length > 0) {
      log += ` | ${JSON.stringify(meta)}`;
    }

    if (stack) {
      log += `\n${stack}`;
    }

    return log;
  })
);

const consoleFormat = winston.format.combine(winston.format.colorize({ all: true }), logFormat);

export const createLogger = (name: string) => {
  // Asegurar que el directorio de logs existe
  const fs = require('fs');
  const logsDir = path.join(process.cwd(), 'logs');

  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    defaultMeta: { service: name },
    transports: [
      // Console
      new winston.transports.Console({
        format: consoleFormat,
      }),

      // Streaming en tiempo real hacia el panel admin
      new LiveStreamTransport(),

      // Archivo de logs generales (rotación diaria)
      new DailyRotateFile({
        filename: path.join('logs', '%DATE%-combined.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '14d',
        format: logFormat,
      }),

      // Archivo de errores
      new DailyRotateFile({
        filename: path.join('logs', '%DATE%-error.log'),
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize: '20m',
        maxFiles: '30d',
        format: logFormat,
      }),
    ],
  });

  // En desarrollo, también log debug
  if (process.env.NODE_ENV === 'development') {
    logger.add(
      new DailyRotateFile({
        filename: path.join('logs', '%DATE%-debug.log'),
        datePattern: 'YYYY-MM-DD',
        level: 'debug',
        maxSize: '10m',
        maxFiles: '7d',
        format: logFormat,
      })
    );
  }

  return logger;
};

// Logger principal del bot
export const logger = createLogger('korex');
