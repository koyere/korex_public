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
   * Inicializa la conexión a la base de datos
   */
  public setDatabase(db: DatabaseManager): void {
    this.db = db;
  }

  /**
   * Configura los manejadores globales de errores
   */
  private setupGlobalHandlers(): void {
    // Errores no capturados
    process.on('uncaughtException', (error: Error) => {
      this.handleSystemError(error, 'CRITICAL', {
        type: 'uncaughtException',
        timestamp: new Date(),
      });
    });

    // Promesas rechazadas no manejadas
    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
      this.handleSystemError(reason instanceof Error ? reason : new Error(String(reason)), 'HIGH', {
        type: 'unhandledRejection',
        promise: promise.toString(),
        timestamp: new Date(),
      });
    });

    // Advertencias
    process.on('warning', (warning: any) => {
      this.logger.warn('Process warning:', {
        name: warning.name,
        message: warning.message,
        stack: warning.stack,
      });
    });
  }

  /**
   * Maneja errores de comandos slash
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

    // Registrar el error
    await this.logError(error, 'COMMAND_ERROR', context, severity);

    // Responder al usuario
    await this.sendErrorResponse(interaction, error, severity);

    // Incrementar contador de errores
    this.incrementErrorCount(`command:${interaction.commandName}`);
  }

  /**
   * Maneja errores de interacciones (botones, menús, modales)
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
   * Maneja errores de componentes UI (botones, menús, modales)
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
   * Maneja errores de addons
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

    // Si es crítico, desactivar el addon temporalmente
    if (severity === 'CRITICAL') {
      this.logger.warn(`Critical error in addon ${addonId}, consider disabling it`);
    }

    this.incrementErrorCount(`addon:${addonId}`);
  }

  /**
   * Maneja errores del sistema
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

    // Si es crítico, podríamos enviar notificaciones a administradores
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
   * Registra un error en la base de datos y logs
   */
  private async logError(
    error: Error,
    type: ErrorReport['type'],
    context: ErrorContext,
    severity: ErrorReport['severity']
  ): Promise<void> {
    try {
      // Log inmediato
      this.logger.error(`${type}: ${error.message}`, {
        stack: error.stack,
        context,
        severity,
      });

      // Verificar rate limiting
      const rateLimitKey = `${type}:${context.guildId || 'global'}`;

      if (this.isRateLimited(rateLimitKey)) {
        return;
      }

      // Guardar en base de datos solo si está disponible
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
      // Si falla la BD, al menos logear
      this.logger.error('Failed to save error to database:', dbError);
    }
  }

  /**
   * Envía una respuesta de error al usuario
   */
  private async sendErrorResponse(
    interaction: InteractionType,
    error: Error,
    severity: ErrorReport['severity']
  ): Promise<void> {
    try {
      // No responder si ya se respondió
      if (interaction.replied || interaction.deferred) {
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(this.getErrorColor(severity))
        .setTitle('❌ Error')
        .setTimestamp();

      // Mensaje según severidad
      switch (severity) {
        case 'LOW':
          embed.setDescription('Ocurrió un error menor. Por favor, inténtalo de nuevo.');
          break;
        case 'MEDIUM':
          embed.setDescription('Ocurrió un error. Si persiste, contacta a un administrador.');
          break;
        case 'HIGH':
        case 'CRITICAL':
          embed.setDescription('Ocurrió un error grave. Los administradores han sido notificados.');
          embed.addFields({
            name: 'Código de Error',
            value: `\`${Date.now().toString(36).toUpperCase()}\``,
            inline: true,
          });
          break;
      }

      // En desarrollo, mostrar más detalles
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
   * Determina la severidad de un error
   */
  private determineSeverity(error: Error): ErrorReport['severity'] {
    const message = error.message.toLowerCase();
    const stack = error.stack?.toLowerCase() || '';

    // Errores críticos
    if (
      message.includes('database') ||
      message.includes('connection') ||
      message.includes('timeout') ||
      stack.includes('prisma') ||
      error.name === 'DatabaseError'
    ) {
      return 'CRITICAL';
    }

    // Errores altos
    if (
      message.includes('permission') ||
      message.includes('unauthorized') ||
      message.includes('forbidden') ||
      error.name === 'DiscordAPIError'
    ) {
      return 'HIGH';
    }

    // Errores medios
    if (
      message.includes('validation') ||
      message.includes('invalid') ||
      message.includes('not found')
    ) {
      return 'MEDIUM';
    }

    // Por defecto, bajo
    return 'LOW';
  }

  /**
   * Obtiene el color del embed según la severidad
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
   * Incrementa el contador de errores
   */
  private incrementErrorCount(key: string): void {
    const current = this.errorCounts.get(key) || 0;

    this.errorCounts.set(key, current + 1);

    // Limpiar contadores antiguos cada hora
    setTimeout(
      () => {
        this.errorCounts.delete(key);
      },
      60 * 60 * 1000
    );
  }

  /**
   * Verifica si está en rate limit
   */
  private isRateLimited(key: string): boolean {
    const now = Date.now();
    const lastError = this.rateLimitMap.get(key) || 0;

    // Rate limit: máximo 1 error del mismo tipo por minuto
    if (now - lastError < 60 * 1000) {
      return true;
    }

    this.rateLimitMap.set(key, now);

    return false;
  }

  /**
   * Maneja errores de eventos
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
   * Obtiene estadísticas de errores
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
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Últimas 24h
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
   * Marca errores como resueltos
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
