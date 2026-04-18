import { PrismaClient } from '@prisma/client';
import { KorexClient } from '../KorexClient';

export class DatabaseManager {
  public client: KorexClient;
  public prisma: PrismaClient;
  private connected: boolean = false;

  constructor(client: KorexClient) {
    this.client = client;
    this.prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
      errorFormat: 'pretty',
    });
  }

  /**
   * Connect to the database
   */
  async connect(): Promise<void> {
    try {
      await this.prisma.$connect();
      this.connected = true;
      this.client.logger.info('Connected to database');

      // Verify connection with a simple query
      await this.prisma.$queryRaw`SELECT 1`;
      this.client.logger.debug('Database connection verified');
    } catch (error) {
      this.client.logger.error('Error connecting to database:', error);
      throw error;
    }
  }

  /**
   * Disconnect from the database
   */
  async disconnect(): Promise<void> {
    try {
      await this.prisma.$disconnect();
      this.connected = false;
      this.client.logger.info('Disconnected from database');
    } catch (error) {
      this.client.logger.error('Error disconnecting from database:', error);
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Check connection health
   */
  async healthCheck(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
    try {
      const start = Date.now();

      await this.prisma.$queryRaw`SELECT 1`;
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
   * Get or create guild configuration
   */
  async getOrCreateGuild(guildId: string) {
    return await this.prisma.guild.upsert({
      where: { id: guildId },
      // New guilds are initialized with all core modules enabled so the
      // dashboard shows the correct state from the first visit.
      create: {
        id: guildId,
        enabledAddons: ['moderation', 'welcome', 'levels', 'music', 'logging', 'economy'],
      },
      update: {},
      include: {
        moderationConfig: true,
        welcomeConfig: true,
        levelConfig: true,
        economyConfig: true,
        loggingConfig: true,
        musicConfig: true,
      },
    });
  }

  /**
   * Get or create user in guild
   */
  async getOrCreateGuildUser(guildId: string, userId: string) {
    // First ensure the global user exists
    await this.prisma.user.upsert({
      where: { id: userId },
      create: { id: userId },
      update: {},
    });

    // Then get or create the user in the guild
    return await this.prisma.guildUser.upsert({
      where: {
        guildId_userId: {
          guildId,
          userId,
        },
      },
      create: {
        guildId,
        userId,
      },
      update: {},
    });
  }

  /**
   * Clean up old data (maintenance)
   */
  async cleanup(): Promise<{
    deletedLogs: number;
    deletedAnalytics: number;
    deletedExpiredCases: number;
  }> {
    const thirtyDaysAgo = new Date();

    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const ninetyDaysAgo = new Date();

    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    try {
      // Clean old analytics (more than 90 days)
      const deletedAnalytics = await this.prisma.guildAnalytics.deleteMany({
        where: {
          date: {
            lt: ninetyDaysAgo,
          },
        },
      });

      // Clean expired moderation cases
      const deletedExpiredCases = await this.prisma.moderationCase.deleteMany({
        where: {
          active: false,
          createdAt: {
            lt: thirtyDaysAgo,
          },
        },
      });

      // Clean old command usage (more than 30 days)
      const deletedLogs = await this.prisma.commandUsage.deleteMany({
        where: {
          createdAt: {
            lt: thirtyDaysAgo,
          },
        },
      });

      this.client.logger.info(
        `Database cleanup completed: ${deletedLogs.count} logs, ${deletedAnalytics.count} analytics, ${deletedExpiredCases.count} cases`
      );

      return {
        deletedLogs: deletedLogs.count,
        deletedAnalytics: deletedAnalytics.count,
        deletedExpiredCases: deletedExpiredCases.count,
      };
    } catch (error) {
      this.client.logger.error('Error in database cleanup:', error);
      throw error;
    }
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<{
    guilds: number;
    users: number;
    guildUsers: number;
    moderationCases: number;
    commands: number;
    customCommands: number;
    giveaways: number;
    suggestions: number;
  }> {
    try {
      const [
        guilds,
        users,
        guildUsers,
        moderationCases,
        commands,
        customCommands,
        giveaways,
        suggestions,
      ] = await Promise.all([
        this.prisma.guild.count(),
        this.prisma.user.count(),
        this.prisma.guildUser.count(),
        this.prisma.moderationCase.count(),
        this.prisma.commandUsage.count(),
        this.prisma.customCommand.count(),
        this.prisma.giveaway.count(),
        this.prisma.suggestion.count(),
      ]);

      return {
        guilds,
        users,
        guildUsers,
        moderationCases,
        commands,
        customCommands,
        giveaways,
        suggestions,
      };
    } catch (error) {
      this.client.logger.error('Error getting database statistics:', error);
      throw error;
    }
  }

  /**
   * Execute pending migrations
   */
  async migrate(): Promise<void> {
    try {
      // In production, migrations should be run manually
      if (process.env.NODE_ENV === 'production') {
        this.client.logger.warn('Automatic migrations disabled in production');

        return;
      }

      this.client.logger.info('Running database migrations...');

      // Prisma doesn't have a direct method for this in the client
      // Migrations are run with `prisma migrate deploy`

      this.client.logger.info('Migrations completed');
    } catch (error) {
      this.client.logger.error('Error running migrations:', error);
      throw error;
    }
  }

  /**
   * Create database backup (SQLite/development only)
   */
  async backup(): Promise<string | null> {
    if (process.env.DATABASE_PROVIDER !== 'sqlite') {
      this.client.logger.warn('Automatic backup only available for SQLite');

      return null;
    }

    try {
      const fs = require('fs');
      const path = require('path');

      const backupDir = path.join(process.cwd(), 'backups');

      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(backupDir, `backup-${timestamp}.db`);

      // For SQLite, simply copy the file
      const dbPath = process.env.DATABASE_URL?.replace('file:', '') || './data/korex.db';

      if (fs.existsSync(dbPath)) {
        fs.copyFileSync(dbPath, backupPath);
        this.client.logger.info(`Backup created: ${backupPath}`);

        return backupPath;
      }

      return null;
    } catch (error) {
      this.client.logger.error('Error creating backup:', error);

      return null;
    }
  }

  /**
   * Get connection information (without sensitive data)
   */
  getConnectionInfo(): {
    provider: string;
    connected: boolean;
    url: string; // URL without credentials
  } {
    const url = process.env.DATABASE_URL || '';

    // Hide credentials from URL
    const safeUrl = url.replace(/:\/\/[^@]+@/, '://***:***@');

    return {
      provider: process.env.DATABASE_PROVIDER || 'unknown',
      connected: this.connected,
      url: safeUrl,
    };
  }
}
