import {
  CommandInteraction,
  ButtonInteraction,
  SelectMenuInteraction,
  ModalSubmitInteraction,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import { logger } from '../utils/Logger';
import { DatabaseManager } from '../client/managers/DatabaseManager';

export interface ErrorContext {
  userId?: string;
  guildId?: string | null;
  channelId?: string | null;
  commandName?: string;
  addonId?: string;
  timestamp: Date;
  userAgent?: string;
  additionalData?: Record<string, any>;
}

export interface ErrorReport {
  id: string;
  type: 'COMMAND_ERROR' | 'INTERACTION_ERROR' | 'SYSTEM_ERROR' | 'ADDON_ERROR';
  message: string;
  stack?: string;
  context: ErrorContext;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  resolved: boolean;
  createdAt: Date;
}

type InteractionType =
  | CommandInteraction
  | ButtonInteraction
  | SelectMenuInteraction
  | ModalSubmitInteraction;

export class ErrorHandler {
  private static instance: ErrorHandler;
  private logger = logger;
  private db: DatabaseManager | null = null;
  private errorCounts = new Map<string, number>();
  private rateLimitMap = new Map<string, number>();

  private constructor() {
    this.setupGlobalHandlers();
  }

  public static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }

    return ErrorHandler.instance;
  }

  /**
   * Initializes the database connection
   */
  public setDatabase(db: DatabaseManager): void {
    this.db = db;
  }

  /**
   * Sets up the global error handlers
   */
  private setupGlobalHandlers(): void {
    // Uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      this.handleSystemError(error, 'CRITICAL', {
        type: 'uncaughtException',
        timestamp: new Date(),
      });
    });

    // Unhandled promise rejections
    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
      this.handleSystemError(reason instanceof Error ? reason : new Error(String(reason)), 'HIGH', {
        type: 'unhandledRejection',
        promise: promise.toString(),
        timestamp: new Date(),
      });
    });

    // Warnings
    process.on('warning', (warning: any) => {
      this.logger.warn('Process warning:', {
        name: warning.name,
        message: warning.message,
        stack: warning.stack,
      });
    });
  }

  /**
   * Handles slash command errors
   */
  public async handleCommandError(
    error: Error,
    interaction: CommandInteraction,
    additionalContext?: Record<string, any>
  ): Promise<void> {
    const context: ErrorContext = {
      userId: interaction.user.id,
      guildId: interaction.guildId || null,
      channelId: interaction.channelId || null,
      commandName: interaction.commandName,
      timestamp: new Date(),
    };

    if (additionalContext) {
      context.additionalData = additionalContext;
    }

    const severity = this.determineSeverity(error);

    // Log the error
    await this.logError(error, 'COMMAND_ERROR', context, severity);

    // Reply to the user
    await this.sendErrorResponse(interaction, error, severity);

    // Increment error counter
    this.incrementErrorCount(`command:${interaction.commandName}`);
  }

  /**
   * Handles interaction errors (buttons, menus, modals)
   */
  public async handleInteractionError(
    error: Error,
    interaction: InteractionType,
    additionalContext?: Record<string, any>
  ): Promise<void> {
    const context: ErrorContext = {
      userId: interaction.user.id,
      guildId: interaction.guildId || null,
      channelId: interaction.channelId || null,
      timestamp: new Date(),
    };

    if (additionalContext) {
      context.additionalData = additionalContext;
    }

    const severity = this.determineSeverity(error);

    await this.logError(error, 'INTERACTION_ERROR', context, severity);
    await this.sendErrorResponse(interaction, error, severity);

    this.incrementErrorCount('interaction:general');
  }

  /**
   * Handles UI component errors (buttons, menus, modals)
   */
  public async handleComponentError(
    error: Error,
    context: {
      customId: string;
      type: string;
      addon?: string | null;
      interaction?: any;
    }
  ): Promise<void> {
    const errorContext: ErrorContext = {
      userId: context.interaction?.user?.id,
      guildId: context.interaction?.guildId || undefined,
      channelId: context.interaction?.channelId || undefined,
      timestamp: new Date(),
      additionalData: {
        customId: context.customId,
        componentType: context.type,
        addon: context.addon,
      },
    };

    const severity = this.determineSeverity(error);

    await this.logError(error, 'INTERACTION_ERROR', errorContext, severity);

    this.incrementErrorCount(`component:${context.customId}`);
  }

  /**
   * Handles addon errors
   */
  public async handleAddonError(
    error: Error,
    addonId: string,
    contextData?: Partial<ErrorContext>
  ): Promise<void> {
    const context: ErrorContext = {
      timestamp: new Date(),
      addonId,
    };

    if (contextData) {
      Object.assign(context, contextData);
    }

    const severity = this.determineSeverity(error);

    await this.logError(error, 'ADDON_ERROR', context, severity);

    // If critical, temporarily disable the addon
    if (severity === 'CRITICAL') {
      this.logger.warn(`Critical error in addon ${addonId}, consider disabling it`);
    }

    this.incrementErrorCount(`addon:${addonId}`);
  }

  /**
   * Handles system errors
   */
  public async handleSystemError(
    error: Error,
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
    additionalContext?: Record<string, any>
  ): Promise<void> {
    const context: ErrorContext = {
      timestamp: new Date(),
    };

    if (additionalContext) {
      context.additionalData = additionalContext;
    }

    await this.logError(error, 'SYSTEM_ERROR', context, severity);

    // If critical, we could send notifications to administrators
    if (severity === 'CRITICAL') {
      this.logger.error('CRITICAL SYSTEM ERROR - Immediate attention required', {
        error: error.message,
        stack: error.stack,
        context: additionalContext,
      });
    }

    this.incrementErrorCount('system:general');
  }

  /**
   * Records an error in the database and logs
   */
  private async logError(
    error: Error,
    type: ErrorReport['type'],
    context: ErrorContext,
    severity: ErrorReport['severity']
  ): Promise<void> {
    try {
      // Immediate log
      this.logger.error(`${type}: ${error.message}`, {
        stack: error.stack,
        context,
        severity,
      });

      // Check rate limiting
      const rateLimitKey = `${type}:${context.guildId || 'global'}`;

      if (this.isRateLimited(rateLimitKey)) {
        return;
      }

      // Save to the database only if it is available
      if (this.db) {
        await this.db.prisma.errorLog.create({
          data: {
            type,
            message: error.message,
            stack: error.stack || null,
            context: context as any,
            severity,
            resolved: false,
          },
        });
      }
    } catch (dbError) {
      // If the DB fails, at least log it
      this.logger.error('Failed to save error to database:', dbError);
    }
  }

  /**
   * Sends an error response to the user
   */
  private async sendErrorResponse(
    interaction: InteractionType,
    error: Error,
    severity: ErrorReport['severity']
  ): Promise<void> {
    try {
      // Do not reply if a reply was already sent
      if (interaction.replied || interaction.deferred) {
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(this.getErrorColor(severity))
        .setTitle('❌ Error')
        .setTimestamp();

      // Message based on severity
      switch (severity) {
        case 'LOW':
          embed.setDescription('A minor error occurred. Please try again.');
          break;
        case 'MEDIUM':
          embed.setDescription('An error occurred. If it persists, contact an administrator.');
          break;
        case 'HIGH':
        case 'CRITICAL':
          embed.setDescription('A serious error occurred. The administrators have been notified.');
          embed.addFields({
            name: 'Error Code',
            value: `\`${Date.now().toString(36).toUpperCase()}\``,
            inline: true,
          });
          break;
      }

      // In development, show more details
      if (process.env.NODE_ENV === 'development') {
        embed.addFields({
          name: 'Error Details (Dev Mode)',
          value: `\`\`\`${error.message.slice(0, 1000)}\`\`\``,
          inline: false,
        });
      }

      await interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });
    } catch (responseError) {
      this.logger.error('Failed to send error response:', responseError);
    }
  }

  /**
   * Determines the severity of an error
   */
  private determineSeverity(error: Error): ErrorReport['severity'] {
    const message = error.message.toLowerCase();
    const stack = error.stack?.toLowerCase() || '';

    // Critical errors
    if (
      message.includes('database') ||
      message.includes('connection') ||
      message.includes('timeout') ||
      stack.includes('prisma') ||
      error.name === 'DatabaseError'
    ) {
      return 'CRITICAL';
    }

    // High errors
    if (
      message.includes('permission') ||
      message.includes('unauthorized') ||
      message.includes('forbidden') ||
      error.name === 'DiscordAPIError'
    ) {
      return 'HIGH';
    }

    // Medium errors
    if (
      message.includes('validation') ||
      message.includes('invalid') ||
      message.includes('not found')
    ) {
      return 'MEDIUM';
    }

    // Default: low
    return 'LOW';
  }

  /**
   * Gets the embed color based on severity
   */
  private getErrorColor(severity: ErrorReport['severity']): number {
    switch (severity) {
      case 'LOW':
        return Colors.Yellow;
      case 'MEDIUM':
        return Colors.Orange;
      case 'HIGH':
        return Colors.Red;
      case 'CRITICAL':
        return Colors.DarkRed;
      default:
        return Colors.Red;
    }
  }

  /**
   * Increments the error counter
   */
  private incrementErrorCount(key: string): void {
    const current = this.errorCounts.get(key) || 0;

    this.errorCounts.set(key, current + 1);

    // Clear old counters every hour
    setTimeout(
      () => {
        this.errorCounts.delete(key);
      },
      60 * 60 * 1000
    );
  }

  /**
   * Checks whether it is rate limited
   */
  private isRateLimited(key: string): boolean {
    const now = Date.now();
    const lastError = this.rateLimitMap.get(key) || 0;

    // Rate limit: at most 1 error of the same type per minute
    if (now - lastError < 60 * 1000) {
      return true;
    }

    this.rateLimitMap.set(key, now);

    return false;
  }

  /**
   * Handles event errors
   */
  public async handleEventError(
    error: Error,
    context: {
      eventName: string;
      addon?: string;
      args?: any[];
    }
  ): Promise<void> {
    const errorContext: ErrorContext = {
      timestamp: new Date(),
      additionalData: {
        eventName: context.eventName,
        args: context.args,
      },
    };

    if (context.addon) {
      errorContext.addonId = context.addon;
    }

    const severity = this.determineSeverity(error);

    await this.logError(error, 'SYSTEM_ERROR', errorContext, severity);

    this.incrementErrorCount(`event:${context.eventName}`);
  }

  /**
   * Gets error statistics
   */
  public async getErrorStats(): Promise<{
    total: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
    recent: number;
    resolved: number;
  }> {
    try {
      if (!this.db) {
        return {
          total: 0,
          byType: {},
          bySeverity: {},
          recent: 0,
          resolved: 0,
        };
      }

      const [total, byType, bySeverity, recent, resolved] = await Promise.all([
        this.db.prisma.errorLog.count(),
        this.db.prisma.errorLog.groupBy({
          by: ['type'],
          _count: { type: true },
        }),
        this.db.prisma.errorLog.groupBy({
          by: ['severity'],
          _count: { severity: true },
        }),
        this.db.prisma.errorLog.count({
          where: {
            createdAt: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24h
            },
          },
        }),
        this.db.prisma.errorLog.count({
          where: { resolved: true },
        }),
      ]);

      const typeStats: Record<string, number> = {};

      byType.forEach((item: any) => {
        typeStats[item.type] = item._count.type;
      });

      const severityStats: Record<string, number> = {};

      bySeverity.forEach((item: any) => {
        severityStats[item.severity] = item._count.severity;
      });

      return {
        total,
        byType: typeStats,
        bySeverity: severityStats,
        recent,
        resolved,
      };
    } catch (error) {
      this.logger.error('Error getting error stats:', error);

      return {
        total: 0,
        byType: {},
        bySeverity: {},
        recent: 0,
        resolved: 0,
      };
    }
  }

  /**
   * Marks errors as resolved
   */
  public async resolveErrors(errorIds: string[]): Promise<void> {
    try {
      if (!this.db) {
        throw new Error('Database not available');
      }

      await this.db.prisma.errorLog.updateMany({
        where: {
          id: { in: errorIds },
        },
        data: {
          resolved: true,
        },
      });

      this.logger.info(`Resolved ${errorIds.length} errors`);
    } catch (error) {
      this.logger.error('Error resolving errors:', error);
      throw new Error('Failed to resolve errors');
    }
  }
}
