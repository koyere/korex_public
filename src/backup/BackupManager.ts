import { KorexClient } from '../client/KorexClient';
import { createLogger } from '../utils/Logger';
import { spawn } from 'child_process';
import { createWriteStream, createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import { createGzip, createGunzip } from 'zlib';
import path from 'path';
import fs from 'fs/promises';
import * as cron from 'node-cron';

export interface BackupConfig {
  enabled: boolean;
  schedule: string; // Cron expression
  retention: {
    daily: number; // Days
    weekly: number; // Weeks
    monthly: number; // Months
  };
  compression: boolean;
  encryption: boolean;
  destinations: {
    local: {
      enabled: boolean;
      path: string;
    };
    s3?: {
      enabled: boolean;
      bucket: string;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
    };
  };
}

export interface BackupResult {
  success: boolean;
  backupId: string;
  timestamp: Date;
  size: number;
  duration: number;
  type: 'database' | 'files' | 'full';
  destination: string;
  error?: string;
}

export interface BackupInfo {
  id: string;
  timestamp: Date;
  type: 'database' | 'files' | 'full';
  size: number;
  compressed: boolean;
  encrypted: boolean;
  path: string;
}

/**
 * Automatic Backup Manager for Korex
 * Handles scheduled backups of the database and critical files
 */
export class BackupManager {
  private client: KorexClient;
  private logger = createLogger('backup-manager');
  private config: BackupConfig;
  private scheduledJobs: Map<string, cron.ScheduledTask> = new Map();
  private isRunning = false;

  // Default configuration
  private defaultConfig: BackupConfig = {
    enabled: true,
    schedule: '0 2 * * *', // Daily at 2 AM
    retention: {
      daily: 7,   // 7 days
      weekly: 4,  // 4 weeks
      monthly: 3  // 3 months
    },
    compression: true,
    encryption: false,
    destinations: {
      local: {
        enabled: true,
        path: path.join(process.cwd(), 'backups')
      }
    }
  };

  constructor(client: KorexClient, config?: Partial<BackupConfig>) {
    this.client = client;
    this.config = { ...this.defaultConfig, ...config };
    
    // Create backups directory if it does not exist
    this.ensureBackupDirectory();
  }

  /**
   * Start the backup system
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('Backup system is disabled');

      return;
    }

    if (this.isRunning) {
      this.logger.warn('Backup system is already running');

      return;
    }

    this.logger.info('Starting backup system...');

    try {
      // Schedule automatic backup
      this.scheduleBackups();
      
      // Clean old backups on startup
      await this.cleanupOldBackups();
      
      this.isRunning = true;
      this.logger.info(`✅ Backup system started (schedule: ${this.config.schedule})`);

    } catch (error) {
      this.logger.error('Failed to start backup system:', error);
      throw error;
    }
  }

  /**
   * Stop the backup system
   */
  stop(): void {
    this.logger.info('Stopping backup system...');
    
    // Stop scheduled jobs
    for (const [name, job] of this.scheduledJobs) {
      job.stop();
      this.logger.debug(`Stopped scheduled job: ${name}`);
    }
    
    this.scheduledJobs.clear();
    this.isRunning = false;
    
    this.logger.info('✅ Backup system stopped');
  }

  /**
   * Schedule automatic backups
   */
  private scheduleBackups(): void {
    // Daily full backup
    const dailyJob = cron.schedule(this.config.schedule, async () => {
      this.logger.info('Starting scheduled backup...');
      try {
        await this.createFullBackup();
        this.logger.info('✅ Scheduled backup completed');
      } catch (error) {
        this.logger.error('❌ Scheduled backup failed:', error);
      }
    }, {
      scheduled: false,
      timezone: process.env.TZ || 'UTC'
    });

    // Database backup every 6 hours
    const dbJob = cron.schedule('0 */6 * * *', async () => {
      this.logger.info('Starting scheduled database backup...');
      try {
        await this.createDatabaseBackup();
        this.logger.info('✅ Scheduled database backup completed');
      } catch (error) {
        this.logger.error('❌ Scheduled database backup failed:', error);
      }
    }, {
      scheduled: false,
      timezone: process.env.TZ || 'UTC'
    });

    // Weekly cleanup
    const cleanupJob = cron.schedule('0 3 * * 0', async () => {
      this.logger.info('Starting scheduled cleanup...');
      try {
        await this.cleanupOldBackups();
        this.logger.info('✅ Scheduled cleanup completed');
      } catch (error) {
        this.logger.error('❌ Scheduled cleanup failed:', error);
      }
    }, {
      scheduled: false,
      timezone: process.env.TZ || 'UTC'
    });

    // Start jobs
    dailyJob.start();
    dbJob.start();
    cleanupJob.start();

    this.scheduledJobs.set('daily', dailyJob);
    this.scheduledJobs.set('database', dbJob);
    this.scheduledJobs.set('cleanup', cleanupJob);

    this.logger.info('Backup jobs scheduled');
  }

  /**
   * Create full backup
   */
  async createFullBackup(): Promise<BackupResult> {
    const backupId = this.generateBackupId('full');
    const startTime = Date.now();
    
    this.logger.info(`Creating full backup: ${backupId}`);

    try {
      // Create database backup
      const dbResult = await this.createDatabaseBackup();
      
      // Create critical files backup
      const filesResult = await this.createFilesBackup();
      
      const duration = Date.now() - startTime;
      const totalSize = dbResult.size + filesResult.size;

      const result: BackupResult = {
        success: true,
        backupId,
        timestamp: new Date(),
        size: totalSize,
        duration,
        type: 'full',
        destination: this.config.destinations.local.path
      };

      this.logger.info(`✅ Full backup completed: ${backupId} (${this.formatSize(totalSize)}, ${duration}ms)`);

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      
      const result: BackupResult = {
        success: false,
        backupId,
        timestamp: new Date(),
        size: 0,
        duration,
        type: 'full',
        destination: this.config.destinations.local.path,
        error: error instanceof Error ? error.message : 'Unknown error'
      };

      this.logger.error(`❌ Full backup failed: ${backupId}`, error);

      return result;
    }
  }

  /**
   * Create database backup
   */
  async createDatabaseBackup(): Promise<BackupResult> {
    const backupId = this.generateBackupId('database');
    const startTime = Date.now();
    
    this.logger.info(`Creating database backup: ${backupId}`);

    try {
      const backupPath = path.join(
        this.config.destinations.local.path,
        'database',
        `${backupId}.sql`
      );

      // Create directory if it does not exist
      await fs.mkdir(path.dirname(backupPath), { recursive: true });

      // Run pg_dump
      await this.executePgDump(backupPath);

      // Compress if enabled
      let finalPath = backupPath;

      if (this.config.compression) {
        finalPath = await this.compressFile(backupPath);
        await fs.unlink(backupPath); // Remove uncompressed file
      }

      // Get file size
      const stats = await fs.stat(finalPath);
      const duration = Date.now() - startTime;

      const result: BackupResult = {
        success: true,
        backupId,
        timestamp: new Date(),
        size: stats.size,
        duration,
        type: 'database',
        destination: finalPath
      };

      this.logger.info(`✅ Database backup completed: ${backupId} (${this.formatSize(stats.size)}, ${duration}ms)`);

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      
      const result: BackupResult = {
        success: false,
        backupId,
        timestamp: new Date(),
        size: 0,
        duration,
        type: 'database',
        destination: this.config.destinations.local.path,
        error: error instanceof Error ? error.message : 'Unknown error'
      };

      this.logger.error(`❌ Database backup failed: ${backupId}`, error);

      return result;
    }
  }

  /**
   * Create critical files backup
   */
  async createFilesBackup(): Promise<BackupResult> {
    const backupId = this.generateBackupId('files');
    const startTime = Date.now();
    
    this.logger.info(`Creating files backup: ${backupId}`);

    try {
      const backupPath = path.join(
        this.config.destinations.local.path,
        'files',
        `${backupId}.tar`
      );

      // Create directory if it does not exist
      await fs.mkdir(path.dirname(backupPath), { recursive: true });

      // Critical files and directories to back up
      const criticalPaths = [
        'src/languages', // Translations
        'src/addons/*/addon.config.ts', // Addon configurations
        '.env.example',
        'package.json',
        'tsconfig.json',
        'logs/production' // Recent production logs
      ];

      // Create tar file
      await this.createTarArchive(backupPath, criticalPaths);

      // Compress if enabled
      let finalPath = backupPath;

      if (this.config.compression) {
        finalPath = await this.compressFile(backupPath);
        await fs.unlink(backupPath); // Remove uncompressed file
      }

      // Get file size
      const stats = await fs.stat(finalPath);
      const duration = Date.now() - startTime;

      const result: BackupResult = {
        success: true,
        backupId,
        timestamp: new Date(),
        size: stats.size,
        duration,
        type: 'files',
        destination: finalPath
      };

      this.logger.info(`✅ Files backup completed: ${backupId} (${this.formatSize(stats.size)}, ${duration}ms)`);

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      
      const result: BackupResult = {
        success: false,
        backupId,
        timestamp: new Date(),
        size: 0,
        duration,
        type: 'files',
        destination: this.config.destinations.local.path,
        error: error instanceof Error ? error.message : 'Unknown error'
      };

      this.logger.error(`❌ Files backup failed: ${backupId}`, error);

      return result;
    }
  }

  /**
   * Run pg_dump
   */
  private async executePgDump(outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const databaseUrl = process.env.DATABASE_URL;

      if (!databaseUrl) {
        reject(new Error('DATABASE_URL not configured'));

        return;
      }

      // Parse database URL
      const url = new URL(databaseUrl);
      
      const pgDump = spawn('pg_dump', [
        '--host', url.hostname,
        '--port', url.port || '5432',
        '--username', url.username,
        '--dbname', url.pathname.slice(1),
        '--no-password',
        '--verbose',
        '--clean',
        '--if-exists',
        '--file', outputPath
      ], {
        env: {
          ...process.env,
          PGPASSWORD: url.password
        }
      });

      let stderr = '';

      pgDump.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      pgDump.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`pg_dump failed with code ${code}: ${stderr}`));
        }
      });

      pgDump.on('error', (error) => {
        reject(new Error(`pg_dump error: ${error.message}`));
      });
    });
  }

  /**
   * Create tar file
   */
  private async createTarArchive(outputPath: string, paths: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const tar = spawn('tar', [
        '-cf', outputPath,
        ...paths.filter(p => {
          try {
            // Check the path exists before adding it
            require('fs').accessSync(p);

            return true;
          } catch {
            return false;
          }
        })
      ]);

      let stderr = '';

      tar.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      tar.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`tar failed with code ${code}: ${stderr}`));
        }
      });

      tar.on('error', (error) => {
        reject(new Error(`tar error: ${error.message}`));
      });
    });
  }

  /**
   * Compress file
   */
  private async compressFile(filePath: string): Promise<string> {
    const compressedPath = `${filePath}.gz`;
    
    await pipeline(
      createReadStream(filePath),
      createGzip({ level: 9 }),
      createWriteStream(compressedPath)
    );

    return compressedPath;
  }

  /**
   * Decompress file
   */
  async decompressFile(compressedPath: string): Promise<string> {
    const decompressedPath = compressedPath.replace(/\.gz$/, '');
    
    await pipeline(
      createReadStream(compressedPath),
      createGunzip(),
      createWriteStream(decompressedPath)
    );

    return decompressedPath;
  }

  /**
   * Clean old backups
   */
  async cleanupOldBackups(): Promise<void> {
    this.logger.info('Starting backup cleanup...');

    try {
      const backupDir = this.config.destinations.local.path;
      const backups = await this.listBackups();
      
      const now = new Date();
      let deletedCount = 0;

      for (const backup of backups) {
        const age = now.getTime() - backup.timestamp.getTime();
        const ageDays = age / (1000 * 60 * 60 * 24);
        
        let shouldDelete = false;

        // Apply retention policies
        if (backup.type === 'database' && ageDays > this.config.retention.daily) {
          shouldDelete = true;
        } else if (backup.type === 'files' && ageDays > this.config.retention.weekly * 7) {
          shouldDelete = true;
        } else if (backup.type === 'full' && ageDays > this.config.retention.monthly * 30) {
          shouldDelete = true;
        }

        if (shouldDelete) {
          try {
            await fs.unlink(backup.path);
            deletedCount++;
            this.logger.debug(`Deleted old backup: ${backup.id}`);
          } catch (error) {
            this.logger.warn(`Failed to delete backup ${backup.id}:`, error);
          }
        }
      }

      this.logger.info(`✅ Backup cleanup completed (deleted ${deletedCount} old backups)`);

    } catch (error) {
      this.logger.error('❌ Backup cleanup failed:', error);
    }
  }

  /**
   * List available backups
   */
  async listBackups(): Promise<BackupInfo[]> {
    const backups: BackupInfo[] = [];
    const backupDir = this.config.destinations.local.path;

    try {
      // Search subdirectories
      const subdirs = ['database', 'files'];
      
      for (const subdir of subdirs) {
        const subdirPath = path.join(backupDir, subdir);
        
        try {
          const files = await fs.readdir(subdirPath);
          
          for (const file of files) {
            const filePath = path.join(subdirPath, file);
            const stats = await fs.stat(filePath);
            
            // Parse backup info from the file name
            const backupInfo = this.parseBackupFilename(file, filePath, stats);

            if (backupInfo) {
              backups.push(backupInfo);
            }
          }
        } catch {
          // Subdirectory does not exist, continue
        }
      }

      // Sort by timestamp (newest first)
      backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    } catch (error) {
      this.logger.error('Error listing backups:', error);
    }

    return backups;
  }

  /**
   * Parse backup file name
   */
  private parseBackupFilename(filename: string, fullPath: string, stats: any): BackupInfo | null {
    // Expected format: backup_YYYYMMDD_HHMMSS_type.ext
    const match = filename.match(/^backup_(\d{8})_(\d{6})_(\w+)\.(sql|tar)(\.gz)?$/);
    
    if (!match) {
      return null;
    }

    const [, dateStr, timeStr, type, , compressed] = match;
    
    // Parse date and time
    const year = parseInt(dateStr.substring(0, 4));
    const month = parseInt(dateStr.substring(4, 6)) - 1; // Zero-based month
    const day = parseInt(dateStr.substring(6, 8));
    const hour = parseInt(timeStr.substring(0, 2));
    const minute = parseInt(timeStr.substring(2, 4));
    const second = parseInt(timeStr.substring(4, 6));
    
    const timestamp = new Date(year, month, day, hour, minute, second);

    return {
      id: `backup_${dateStr}_${timeStr}_${type}`,
      timestamp,
      type: type as 'database' | 'files' | 'full',
      size: stats.size,
      compressed: !!compressed,
      encrypted: false, // TODO: Implement encryption if needed
      path: fullPath
    };
  }

  /**
   * Restore backup
   */
  async restoreBackup(backupId: string): Promise<boolean> {
    this.logger.info(`Starting backup restore: ${backupId}`);

    try {
      const backups = await this.listBackups();
      const backup = backups.find(b => b.id === backupId);
      
      if (!backup) {
        throw new Error(`Backup not found: ${backupId}`);
      }

      if (backup.type === 'database') {
        await this.restoreDatabaseBackup(backup);
      } else {
        throw new Error(`Restore not implemented for backup type: ${backup.type}`);
      }

      this.logger.info(`✅ Backup restore completed: ${backupId}`);

      return true;

    } catch (error) {
      this.logger.error(`❌ Backup restore failed: ${backupId}`, error);

      return false;
    }
  }

  /**
   * Restore database backup
   */
  private async restoreDatabaseBackup(backup: BackupInfo): Promise<void> {
    let sqlFile = backup.path;

    // Decompress if needed
    if (backup.compressed) {
      sqlFile = await this.decompressFile(backup.path);
    }

    // Run psql to restore
    return new Promise((resolve, reject) => {
      const databaseUrl = process.env.DATABASE_URL;

      if (!databaseUrl) {
        reject(new Error('DATABASE_URL not configured'));

        return;
      }

      const url = new URL(databaseUrl);
      
      const psql = spawn('psql', [
        '--host', url.hostname,
        '--port', url.port || '5432',
        '--username', url.username,
        '--dbname', url.pathname.slice(1),
        '--file', sqlFile
      ], {
        env: {
          ...process.env,
          PGPASSWORD: url.password
        }
      });

      let stderr = '';

      psql.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      psql.on('close', async (code) => {
        // Clean up temporary decompressed file
        if (backup.compressed && sqlFile !== backup.path) {
          try {
            await fs.unlink(sqlFile);
          } catch {
            // Ignore cleanup errors
          }
        }

        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`psql failed with code ${code}: ${stderr}`));
        }
      });

      psql.on('error', (error) => {
        reject(new Error(`psql error: ${error.message}`));
      });
    });
  }

  /**
   * Generate backup ID
   */
  private generateBackupId(type: string): string {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');

    return `backup_${dateStr}_${timeStr}_${type}`;
  }

  /**
   * Ensure the backups directory exists
   */
  private async ensureBackupDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.config.destinations.local.path, { recursive: true });
      await fs.mkdir(path.join(this.config.destinations.local.path, 'database'), { recursive: true });
      await fs.mkdir(path.join(this.config.destinations.local.path, 'files'), { recursive: true });
    } catch (error) {
      this.logger.error('Failed to create backup directories:', error);
      throw error;
    }
  }

  /**
   * Format file size
   */
  private formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${Math.round(size * 100) / 100} ${units[unitIndex]}`;
  }

  /**
   * Get backup statistics
   */
  async getBackupStats(): Promise<{
    totalBackups: number;
    totalSize: number;
    lastBackup: Date | null;
    oldestBackup: Date | null;
    backupsByType: Record<string, number>;
  }> {
    const backups = await this.listBackups();
    
    const stats = {
      totalBackups: backups.length,
      totalSize: backups.reduce((sum, backup) => sum + backup.size, 0),
      lastBackup: backups.length > 0 ? backups[0].timestamp : null,
      oldestBackup: backups.length > 0 ? backups[backups.length - 1].timestamp : null,
      backupsByType: {} as Record<string, number>
    };

    // Count by type
    for (const backup of backups) {
      stats.backupsByType[backup.type] = (stats.backupsByType[backup.type] || 0) + 1;
    }

    return stats;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<BackupConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Restart if running
    if (this.isRunning) {
      this.stop();
      this.start();
    }
    
    this.logger.info('Backup configuration updated');
  }

  /**
   * Get current configuration
   */
  getConfig(): BackupConfig {
    return { ...this.config };
  }
}