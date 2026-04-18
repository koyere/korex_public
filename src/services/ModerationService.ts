import {
  Guild,
  GuildMember,
  User,
  TextChannel,
  EmbedBuilder,
  Colors,
  PermissionFlagsBits,
  GuildBan,
} from 'discord.js';
import { logger } from '../utils/Logger';
import { DatabaseManager } from '../client/managers/DatabaseManager';

export interface ModerationAction {
  id: string;
  type: 'WARN' | 'MUTE' | 'KICK' | 'BAN' | 'UNBAN' | 'UNMUTE';
  guildId: string;
  userId: string;
  moderatorId: string;
  reason: string;
  duration: number | null; // en minutos
  expiresAt: Date | null;
  isActive: boolean;
  createdAt: Date;
}

export interface ModerationConfig {
  guildId: string;
  autoModEnabled: boolean;
  logChannelId: string | null;
  muteRoleId: string | null;
  maxWarnings: number;
  warningExpireDays: number;
  autoActions: {
    warnings: number;
    action: 'MUTE' | 'KICK' | 'BAN';
    duration?: number;
  }[];
}

export interface AutoModRule {
  type: 'SPAM' | 'CAPS' | 'LINKS' | 'MENTIONS' | 'PROFANITY';
  enabled: boolean;
  threshold?: number;
  action: 'WARN' | 'MUTE' | 'KICK';
  duration?: number;
}

export class ModerationService {
  private static instance: ModerationService;
  private logger = logger;
  private db: DatabaseManager;
  private activeTimeouts = new Map<string, NodeJS.Timeout>();

  private constructor(db: DatabaseManager) {
    this.db = db;
    this.loadActiveTimeouts();
  }

  public static getInstance(db?: DatabaseManager): ModerationService {
    if (!ModerationService.instance) {
      if (!db) {
        throw new Error('DatabaseManager is required for first initialization');
      }
      ModerationService.instance = new ModerationService(db);
    }

    return ModerationService.instance;
  }

  /**
   * Carga los timeouts activos al iniciar
   */
  private async loadActiveTimeouts(): Promise<void> {
    try {
      // Solo cargar si hay conexión a base de datos válida
      if (!process.env.DATABASE_URL || process.env.NODE_ENV === 'test') {
        this.logger.debug('Skipping timeout loading - no valid database configuration');

        return;
      }

      // Verificar si el cliente Prisma está disponible
      if (!this.db?.prisma) {
        this.logger.debug('Prisma client not available, skipping timeout loading');

        return;
      }

      const activeActions = await this.db.prisma.moderationActionLog.findMany({
        where: {
          isActive: true,
          expiresAt: {
            gt: new Date(),
          },
          type: {
            in: ['MUTE', 'BAN'],
          },
        },
      });

      for (const action of activeActions) {
        if (action.expiresAt) {
          this.scheduleUndo(action.id, action.expiresAt);
        }
      }

      this.logger.info(`Loaded ${activeActions.length} active moderation timeouts`);
    } catch (error) {
      this.logger.debug(
        'Could not load active timeouts (database not available):',
        (error as Error)?.message || 'Unknown error'
      );
    }
  }

  /**
   * Advierte a un usuario
   */
  public async warnUser(
    guild: Guild,
    user: User,
    moderator: User,
    reason: string
  ): Promise<ModerationAction> {
    try {
      // Crear la acción de moderación
      const action = await this.createModerationAction({
        type: 'WARN',
        guildId: guild.id,
        userId: user.id,
        moderatorId: moderator.id,
        reason,
      });

      // Enviar DM al usuario
      await this.sendUserNotification(user, guild, 'WARN', reason);

      // Log en el canal de moderación
      await this.logModerationAction(guild, action, user, moderator);

      // Verificar si necesita auto-acción
      await this.checkAutoActions(guild, user);

      this.logger.info(`User ${user.tag} warned in ${guild.name} by ${moderator.tag}`);

      return action;
    } catch (error) {
      this.logger.error('Error warning user:', error);
      throw new Error('Failed to warn user');
    }
  }

  /**
   * Mutea a un usuario
   */
  public async muteUser(
    guild: Guild,
    member: GuildMember,
    moderator: User,
    reason: string,
    duration?: number // en minutos
  ): Promise<ModerationAction> {
    try {
      const config = await this.getModerationConfig(guild.id);

      if (!config.muteRoleId) {
        throw new Error('Mute role not configured for this server');
      }

      const muteRole = guild.roles.cache.get(config.muteRoleId);

      if (!muteRole) {
        throw new Error('Mute role not found');
      }

      // Aplicar el rol de mute
      await member.roles.add(muteRole, `Muted by ${moderator.tag}: ${reason}`);

      // Calcular expiración
      const expiresAt = duration ? new Date(Date.now() + duration * 60 * 1000) : undefined;

      // Crear la acción de moderación
      const action = await this.createModerationAction({
        type: 'MUTE',
        guildId: guild.id,
        userId: member.id,
        moderatorId: moderator.id,
        reason,
        duration: duration || null,
        expiresAt: expiresAt || null,
      });

      // Programar desmute automático
      if (expiresAt) {
        this.scheduleUndo(action.id, expiresAt);
      }

      // Notificaciones
      await this.sendUserNotification(member.user, guild, 'MUTE', reason, duration);
      await this.logModerationAction(guild, action, member.user, moderator);

      this.logger.info(`User ${member.user.tag} muted in ${guild.name} by ${moderator.tag}`);

      return action;
    } catch (error) {
      this.logger.error('Error muting user:', error);
      throw new Error('Failed to mute user');
    }
  }

  /**
   * Desmutea a un usuario
   */
  public async unmuteUser(
    guild: Guild,
    member: GuildMember,
    moderator: User,
    reason: string = 'Manual unmute'
  ): Promise<void> {
    try {
      const config = await this.getModerationConfig(guild.id);

      if (config.muteRoleId) {
        const muteRole = guild.roles.cache.get(config.muteRoleId);

        if (muteRole && member.roles.cache.has(muteRole.id)) {
          await member.roles.remove(muteRole, `Unmuted by ${moderator.tag}: ${reason}`);
        }
      }

      // Desactivar acciones de mute activas
      await this.db.prisma.moderationActionLog.updateMany({
        where: {
          guildId: guild.id,
          userId: member.id,
          type: 'MUTE',
          isActive: true,
        },
        data: {
          isActive: false,
        },
      });

      // Crear acción de unmute
      await this.createModerationAction({
        type: 'UNMUTE',
        guildId: guild.id,
        userId: member.id,
        moderatorId: moderator.id,
        reason,
      });

      this.logger.info(`User ${member.user.tag} unmuted in ${guild.name} by ${moderator.tag}`);
    } catch (error) {
      this.logger.error('Error unmuting user:', error);
      throw new Error('Failed to unmute user');
    }
  }

  /**
   * Expulsa a un usuario
   */
  public async kickUser(
    guild: Guild,
    member: GuildMember,
    moderator: User,
    reason: string
  ): Promise<ModerationAction> {
    try {
      // Crear la acción antes de expulsar
      const action = await this.createModerationAction({
        type: 'KICK',
        guildId: guild.id,
        userId: member.id,
        moderatorId: moderator.id,
        reason,
      });

      // Notificar al usuario antes de expulsar
      await this.sendUserNotification(member.user, guild, 'KICK', reason);

      // Expulsar
      await member.kick(`Kicked by ${moderator.tag}: ${reason}`);

      // Log
      await this.logModerationAction(guild, action, member.user, moderator);

      this.logger.info(`User ${member.user.tag} kicked from ${guild.name} by ${moderator.tag}`);

      return action;
    } catch (error) {
      this.logger.error('Error kicking user:', error);
      throw new Error('Failed to kick user');
    }
  }

  /**
   * Banea a un usuario
   */
  public async banUser(
    guild: Guild,
    user: User,
    moderator: User,
    reason: string,
    duration?: number, // en minutos
    deleteMessageDays: number = 0
  ): Promise<ModerationAction> {
    try {
      // Calcular expiración
      const expiresAt = duration ? new Date(Date.now() + duration * 60 * 1000) : undefined;

      // Crear la acción de moderación
      const action = await this.createModerationAction({
        type: 'BAN',
        guildId: guild.id,
        userId: user.id,
        moderatorId: moderator.id,
        reason,
        duration: duration || null,
        expiresAt: expiresAt || null,
      });

      // Notificar al usuario
      await this.sendUserNotification(user, guild, 'BAN', reason, duration);

      // Banear
      await guild.members.ban(user, {
        reason: `Banned by ${moderator.tag}: ${reason}`,
        deleteMessageDays,
      });

      // Programar desbaneo automático
      if (expiresAt) {
        this.scheduleUndo(action.id, expiresAt);
      }

      // Log
      await this.logModerationAction(guild, action, user, moderator);

      this.logger.info(`User ${user.tag} banned from ${guild.name} by ${moderator.tag}`);

      return action;
    } catch (error) {
      this.logger.error('Error banning user:', error);
      throw new Error('Failed to ban user');
    }
  }

  /**
   * Desbanea a un usuario
   */
  public async unbanUser(
    guild: Guild,
    user: User,
    moderator: User,
    reason: string = 'Manual unban'
  ): Promise<void> {
    try {
      // Verificar si está baneado
      const ban = await guild.bans.fetch(user.id).catch(() => null);

      if (!ban) {
        throw new Error('User is not banned');
      }

      // Desbanear
      await guild.members.unban(user, `Unbanned by ${moderator.tag}: ${reason}`);

      // Desactivar acciones de ban activas
      await this.db.prisma.moderationActionLog.updateMany({
        where: {
          guildId: guild.id,
          userId: user.id,
          type: 'BAN',
          isActive: true,
        },
        data: {
          isActive: false,
        },
      });

      // Crear acción de unban
      await this.createModerationAction({
        type: 'UNBAN',
        guildId: guild.id,
        userId: user.id,
        moderatorId: moderator.id,
        reason,
      });

      this.logger.info(`User ${user.tag} unbanned from ${guild.name} by ${moderator.tag}`);
    } catch (error) {
      this.logger.error('Error unbanning user:', error);
      throw new Error('Failed to unban user');
    }
  }

  /**
   * Crea una acción de moderación en la base de datos
   */
  private async createModerationAction(data: {
    type: ModerationAction['type'];
    guildId: string;
    userId: string;
    moderatorId: string;
    reason: string;
    duration?: number | null;
    expiresAt?: Date | null;
  }): Promise<ModerationAction> {
    const dbAction = await this.db.prisma.moderationActionLog.create({
      data: {
        ...data,
        duration: data.duration || null,
        expiresAt: data.expiresAt || null,
        isActive: ['MUTE', 'BAN'].includes(data.type),
      },
    });

    return {
      id: dbAction.id,
      type: dbAction.type as ModerationAction['type'],
      guildId: dbAction.guildId,
      userId: dbAction.userId,
      moderatorId: dbAction.moderatorId,
      reason: dbAction.reason,
      duration: dbAction.duration || null,
      expiresAt: dbAction.expiresAt || null,
      isActive: dbAction.isActive,
      createdAt: dbAction.createdAt,
    };
  }

  /**
   * Programa el deshacimiento automático de una acción
   */
  private scheduleUndo(actionId: string, expiresAt: Date): void {
    const timeout = setTimeout(async () => {
      await this.executeAutoUndo(actionId);
      this.activeTimeouts.delete(actionId);
    }, expiresAt.getTime() - Date.now());

    this.activeTimeouts.set(actionId, timeout);
  }

  /**
   * Ejecuta el deshacimiento automático
   */
  private async executeAutoUndo(actionId: string): Promise<void> {
    try {
      const action = await this.db.prisma.moderationActionLog.findUnique({
        where: { id: actionId },
      });

      if (!action || !action.isActive) {
        return;
      }

      // Obtener el guild y el usuario
      const guild = await this.db.client.guilds.fetch(action.guildId).catch(() => null);

      if (!guild) {
        return;
      }

      const user = await this.db.client.users.fetch(action.userId).catch(() => null);

      if (!user) {
        return;
      }

      // Ejecutar la acción correspondiente
      if (action.type === 'MUTE') {
        const member = await guild.members.fetch(user.id).catch(() => null);

        if (member) {
          await this.unmuteUser(guild, member, this.db.client.user!, 'Automatic unmute (expired)');
        }
      } else if (action.type === 'BAN') {
        await this.unbanUser(guild, user, this.db.client.user!, 'Automatic unban (expired)');
      }

      this.logger.info(`Auto-undo executed for action ${actionId}`);
    } catch (error) {
      this.logger.error(`Error executing auto-undo for action ${actionId}:`, error);
    }
  }

  /**
   * Envía notificación al usuario
   */
  private async sendUserNotification(
    user: User,
    guild: Guild,
    action: string,
    reason: string,
    duration?: number
  ): Promise<void> {
    try {
      const embed = new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle(`🔨 Acción de Moderación`)
        .addFields(
          { name: 'Servidor', value: guild.name, inline: true },
          { name: 'Acción', value: action, inline: true },
          { name: 'Razón', value: reason, inline: false }
        )
        .setTimestamp();

      if (duration) {
        embed.addFields({
          name: 'Duración',
          value: `${duration} minutos`,
          inline: true,
        });
      }

      await user.send({ embeds: [embed] });
    } catch (error) {
      // Usuario tiene DMs deshabilitados
      this.logger.debug(`Could not send DM to user ${user.tag}`);
    }
  }

  /**
   * Registra la acción en el canal de logs
   */
  private async logModerationAction(
    guild: Guild,
    action: ModerationAction,
    user: User,
    moderator: User
  ): Promise<void> {
    try {
      const config = await this.getModerationConfig(guild.id);

      if (!config.logChannelId) {
        return;
      }

      const logChannel = guild.channels.cache.get(config.logChannelId) as TextChannel;

      if (!logChannel) {
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(this.getActionColor(action.type))
        .setTitle(`${this.getActionEmoji(action.type)} ${action.type}`)
        .addFields(
          { name: 'Usuario', value: `${user.tag} (${user.id})`, inline: true },
          { name: 'Moderador', value: `${moderator.tag}`, inline: true },
          { name: 'Razón', value: action.reason, inline: false }
        )
        .setTimestamp()
        .setFooter({ text: `ID: ${action.id}` });

      if (action.duration) {
        embed.addFields({
          name: 'Duración',
          value: `${action.duration} minutos`,
          inline: true,
        });
      }

      await logChannel.send({ embeds: [embed] });
    } catch (error) {
      this.logger.error('Error logging moderation action:', error);
    }
  }

  /**
   * Verifica si se necesitan auto-acciones basadas en warnings
   */
  private async checkAutoActions(guild: Guild, user: User): Promise<void> {
    try {
      const config = await this.getModerationConfig(guild.id);

      // Contar warnings activos
      const warningCount = await this.db.prisma.moderationActionLog.count({
        where: {
          guildId: guild.id,
          userId: user.id,
          type: 'WARN',
          createdAt: {
            gte: new Date(Date.now() - config.warningExpireDays * 24 * 60 * 60 * 1000),
          },
        },
      });

      // Buscar auto-acción aplicable
      const autoAction = config.autoActions
        .sort((a, b) => b.warnings - a.warnings)
        .find((action) => warningCount >= action.warnings);

      if (!autoAction) {
        return;
      }

      const member = await guild.members.fetch(user.id).catch(() => null);

      if (!member) {
        return;
      }

      const botUser = guild.client.user!;
      const reason = `Auto-action: ${warningCount} warnings reached`;

      // Ejecutar auto-acción
      switch (autoAction.action) {
        case 'MUTE':
          await this.muteUser(guild, member, botUser, reason, autoAction.duration);
          break;
        case 'KICK':
          await this.kickUser(guild, member, botUser, reason);
          break;
        case 'BAN':
          await this.banUser(guild, user, botUser, reason, autoAction.duration);
          break;
      }
    } catch (error) {
      this.logger.error('Error checking auto actions:', error);
    }
  }

  /**
   * Obtiene la configuración de moderación de un servidor
   */
  public async getModerationConfig(guildId: string): Promise<ModerationConfig> {
    try {
      const config = await this.db.prisma.guildConfig.findUnique({
        where: { guildId },
      });

      if (!config) {
        // Crear configuración por defecto
        const defaultConfig = await this.db.prisma.guildConfig.create({
          data: {
            guildId,
            autoModEnabled: false,
            maxWarnings: 3,
            warningExpireDays: 30,
            autoActions: [
              { warnings: 3, action: 'MUTE', duration: 60 },
              { warnings: 5, action: 'KICK' },
              { warnings: 7, action: 'BAN', duration: 1440 },
            ],
          },
        });

        return {
          guildId: defaultConfig.guildId,
          autoModEnabled: defaultConfig.autoModEnabled,
          logChannelId: defaultConfig.logChannelId || null,
          muteRoleId: defaultConfig.muteRoleId || null,
          maxWarnings: defaultConfig.maxWarnings,
          warningExpireDays: defaultConfig.warningExpireDays,
          autoActions: defaultConfig.autoActions as any,
        };
      }

      return {
        guildId: config.guildId,
        autoModEnabled: config.autoModEnabled,
        logChannelId: config.logChannelId || null,
        muteRoleId: config.muteRoleId || null,
        maxWarnings: config.maxWarnings,
        warningExpireDays: config.warningExpireDays,
        autoActions: config.autoActions as any,
      };
    } catch (error) {
      this.logger.error('Error getting moderation config:', error);
      throw new Error('Failed to get moderation config');
    }
  }

  /**
   * Obtiene el historial de moderación de un usuario
   */
  public async getUserModerationHistory(
    guildId: string,
    userId: string,
    limit: number = 10
  ): Promise<ModerationAction[]> {
    try {
      const actions = await this.db.prisma.moderationActionLog.findMany({
        where: {
          guildId,
          userId,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: limit,
      });

      return actions.map((action) => ({
        id: action.id,
        type: action.type as ModerationAction['type'],
        guildId: action.guildId,
        userId: action.userId,
        moderatorId: action.moderatorId,
        reason: action.reason,
        duration: action.duration || null,
        expiresAt: action.expiresAt || null,
        isActive: action.isActive,
        createdAt: action.createdAt,
      }));
    } catch (error) {
      this.logger.error('Error getting user moderation history:', error);

      return [];
    }
  }

  /**
   * Obtiene el color para el embed según el tipo de acción
   */
  private getActionColor(type: string): number {
    switch (type) {
      case 'WARN':
        return Colors.Yellow;
      case 'MUTE':
      case 'UNMUTE':
        return Colors.Orange;
      case 'KICK':
        return Colors.Red;
      case 'BAN':
      case 'UNBAN':
        return Colors.DarkRed;
      default:
        return Colors.Blurple;
    }
  }

  /**
   * Obtiene el emoji para el tipo de acción
   */
  private getActionEmoji(type: string): string {
    switch (type) {
      case 'WARN':
        return '⚠️';
      case 'MUTE':
        return '🔇';
      case 'UNMUTE':
        return '🔊';
      case 'KICK':
        return '👢';
      case 'BAN':
        return '🔨';
      case 'UNBAN':
        return '🔓';
      default:
        return '📝';
    }
  }
}
