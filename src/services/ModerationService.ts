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
import { i18n } from '../utils/i18n';
import { DatabaseManager } from '../client/managers/DatabaseManager';
import { setLongTimeout, LongTimeout } from '../utils/longTimeout';
import { pickWarnEscalationStep, readWarnEscalation, WarnEscalationAction } from '../utils/warnEscalation';

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
  private activeTimeouts = new Map<string, LongTimeout>();

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
          // Incluye las que vencieron con el bot apagado (se deshacen al arrancar)
          expiresAt: { not: null },
          type: {
            in: ['MUTE', 'BAN'],
          },
        },
      });

      for (const action of activeActions) {
        if (action.expiresAt) {
          // Las ya vencidas se programan con un pequeño margen para dar tiempo al login
          const minDate = new Date(Date.now() + 30_000);
          this.scheduleUndo(action.id, action.expiresAt < minDate ? minDate : action.expiresAt);
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
  /**
   * Crea un caso numerado en moderation_cases (tabla que muestran el dashboard
   * y /modlogs). Reintenta si dos casos se crean a la vez con el mismo número.
   */
  public async createCase(data: {
    guildId: string;
    action: 'WARN' | 'TIMEOUT' | 'KICK' | 'BAN' | 'UNBAN' | 'TEMPBAN';
    targetId: string;
    moderatorId: string;
    reason?: string | null;
    duration?: number | null;
    expiresAt?: Date | null;
    active?: boolean;
  }): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const last = await this.db.prisma.moderationCase.findFirst({
        where: { guildId: data.guildId },
        orderBy: { caseNumber: 'desc' },
        select: { caseNumber: true },
      });
      try {
        await this.db.prisma.moderationCase.create({
          data: {
            guildId: data.guildId,
            caseNumber: (last?.caseNumber ?? 0) + 1,
            action: data.action,
            targetId: data.targetId,
            moderatorId: data.moderatorId,
            reason: data.reason ?? null,
            duration: data.duration ?? null,
            expiresAt: data.expiresAt ?? null,
            active: data.active ?? false,
          },
        });
        return;
      } catch (err: any) {
        if (err?.code !== 'P2002') throw err;
      }
    }
  }

  /** Cierra los casos activos de un tipo (p. ej. al desbanear o quitar el mute). */
  private async closeActiveCases(guildId: string, targetId: string, actions: Array<'TIMEOUT' | 'BAN' | 'TEMPBAN'>): Promise<void> {
    await this.db.prisma.moderationCase.updateMany({
      where: { guildId, targetId, action: { in: actions }, active: true },
      data: { active: false },
    });
  }

  private async recordCaseForAction(data: {
    type: ModerationAction['type'];
    guildId: string;
    userId: string;
    moderatorId: string;
    reason: string;
    duration?: number | null;
    expiresAt?: Date | null;
  }): Promise<void> {
    const base = {
      guildId: data.guildId,
      targetId: data.userId,
      moderatorId: data.moderatorId,
      reason: data.reason,
      duration: data.duration ?? null,
      expiresAt: data.expiresAt ?? null,
    };
    switch (data.type) {
      case 'WARN':
        return this.createCase({ ...base, action: 'WARN', active: false });
      case 'KICK':
        return this.createCase({ ...base, action: 'KICK', active: false });
      case 'MUTE':
        // El mute por rol es un silencio temporal: se muestra como TIMEOUT
        return this.createCase({ ...base, action: 'TIMEOUT', active: true });
      case 'BAN':
        return this.createCase({ ...base, action: data.expiresAt ? 'TEMPBAN' : 'BAN', active: true });
      case 'UNBAN':
        await this.closeActiveCases(data.guildId, data.userId, ['BAN', 'TEMPBAN']);
        return this.createCase({ ...base, action: 'UNBAN', active: false });
      case 'UNMUTE':
        return this.closeActiveCases(data.guildId, data.userId, ['TIMEOUT']);
    }
  }

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

    // Historial unificado: el dashboard y /modlogs leen moderation_cases
    await this.recordCaseForAction(data).catch((err) =>
      this.logger.error('Error recording moderation case:', err)
    );

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
   * Registra un ban temporal ya ejecutado (p. ej. /tempban) y programa el desbaneo.
   * Persistirlo en BD hace que sobreviva a reinicios y aparezca en /modlogs.
   */
  public async recordTemporaryBan(
    guild: Guild,
    user: User,
    moderator: User,
    reason: string,
    durationMs: number
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + durationMs);
    const action = await this.createModerationAction({
      type: 'BAN',
      guildId: guild.id,
      userId: user.id,
      moderatorId: moderator.id,
      reason,
      duration: Math.round(durationMs / 60_000),
      expiresAt,
    });
    this.scheduleUndo(action.id, expiresAt);
    await this.logModerationAction(guild, action, user, moderator);
  }

  /**
   * Programa el deshacimiento automático de una acción
   */
  private scheduleUndo(actionId: string, expiresAt: Date): void {
    const timeout = setLongTimeout(async () => {
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
      const t = (key: string, vars?: Record<string, string>) => i18n.t(key, guild.id, vars);
      const embed = new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle(t('moderation.dm.title'))
        .addFields(
          { name: t('moderation.dm.server'), value: guild.name, inline: true },
          { name: t('moderation.dm.action'), value: t(`moderation.action_types.${action}`), inline: true },
          { name: t('moderation.log.reason'), value: reason.slice(0, 1024), inline: false }
        )
        .setTimestamp();

      if (duration) {
        embed.addFields({
          name: t('moderation.log.duration'),
          value: t('moderation.log.minutes', { minutes: String(duration) }),
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
  /**
   * Canal de logs de moderación: el de Logs del dashboard (el mismo que usa el
   * AutoMod) y, si no hay, el creado por /setup.
   */
  public async getModerationLogChannel(guild: Guild): Promise<TextChannel | null> {
    const loggingConfig = await this.db.prisma.loggingConfig.findUnique({
      where: { guildId: guild.id },
      select: { moderationLogChannel: true },
    });
    const config = await this.getModerationConfig(guild.id);
    const channelId = loggingConfig?.moderationLogChannel || config.logChannelId;
    if (!channelId) return null;
    const channel = guild.channels.cache.get(channelId);
    return channel?.isTextBased() ? (channel as TextChannel) : null;
  }

  private async logModerationAction(
    guild: Guild,
    action: ModerationAction,
    user: User,
    moderator: User
  ): Promise<void> {
    try {
      // Mismo canal que usa el AutoMod (Logs → canal de moderación);
      // el de /setup queda como respaldo.
      const logChannel = await this.getModerationLogChannel(guild);

      if (!logChannel) {
        return;
      }

      const t = (key: string, vars?: Record<string, string>) => i18n.t(key, guild.id, vars);
      const embed = new EmbedBuilder()
        .setColor(this.getActionColor(action.type))
        .setTitle(`${this.getActionEmoji(action.type)} ${t(`moderation.action_types.${action.type}`)}`)
        .addFields(
          { name: t('moderation.log.user'), value: `${user.tag} (${user.id})`, inline: true },
          { name: t('moderation.log.moderator'), value: `${moderator.tag}`, inline: true },
          { name: t('moderation.log.reason'), value: action.reason.slice(0, 1024), inline: false }
        )
        .setTimestamp()
        .setFooter({ text: `ID: ${action.id}` });

      if (action.duration) {
        embed.addFields({
          name: t('moderation.log.duration'),
          value: t('moderation.log.minutes', { minutes: String(action.duration) }),
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
      // Configuración del dashboard (Moderación → Acciones automáticas)
      // Los campos del escalado se leen sin tipar: son columnas aditivas (ver warnEscalation.ts)
      const modConfig: any = await (this.db.prisma as any).moderationConfig.findUnique({
        where: { guildId: guild.id },
      });
      const threshold = modConfig?.warnThreshold ?? 3;
      const actionType = modConfig?.warnAction ?? 'timeout';
      const durationSec = modConfig?.warnActionDuration ?? 3600;
      const guildConfig = await this.getModerationConfig(guild.id);

      // Avisos manuales vigentes (los del AutoMod no cuentan para la escalada)
      const warningCount = await this.db.prisma.moderationCase.count({
        where: {
          guildId: guild.id,
          targetId: user.id,
          action: 'WARN',
          moderatorId: { not: guild.client.user!.id },
          createdAt: {
            gte: new Date(Date.now() - guildConfig.warningExpireDays * 24 * 60 * 60 * 1000),
          },
        },
      });

      const member = await guild.members.fetch(user.id).catch(() => null);
      const reason = i18n.t('moderation.auto_action_reason', guild.id, { count: String(warningCount) });

      // 1. Escalado por avisos (desactivado por defecto): se aplica el escalón más alto alcanzado
      if (modConfig?.warnEscalationEnabled === true) {
        const step = pickWarnEscalationStep(readWarnEscalation(modConfig.warnEscalationSteps), warningCount);
        if (step) {
          await this.applyAutoAction(guild, user, member, step.action, step.duration ?? null, reason);
          return;
        }
      }

      // 2. Umbral único: se aplica al llegar al límite y a cada múltiplo (3, 6, 9...)
      if (threshold < 1 || warningCount < threshold || warningCount % threshold !== 0) {
        return;
      }
      const action = (['timeout', 'kick', 'ban'].includes(actionType) ? actionType : 'timeout') as WarnEscalationAction;
      await this.applyAutoAction(guild, user, member, action, action === 'timeout' ? Math.round(durationSec / 60) : null, reason);
    } catch (error) {
      this.logger.error('Error checking auto actions:', error);
    }
  }

  /** Ejecuta una acción automática por avisos. `durationMin`: silencio o baneo temporal (minutos). */
  private async applyAutoAction(
    guild: Guild,
    user: User,
    member: GuildMember | null,
    action: WarnEscalationAction,
    durationMin: number | null,
    reason: string,
  ): Promise<void> {
    const botUser = guild.client.user!;
    switch (action) {
      case 'timeout': {
        if (!member?.moderatable) return;
        const ms = Math.min(Math.max(1, durationMin ?? 60) * 60_000, 28 * 24 * 60 * 60 * 1000);
        await member.timeout(ms, reason);
        await this.createCase({
          guildId: guild.id, action: 'TIMEOUT', targetId: user.id, moderatorId: botUser.id,
          reason, duration: Math.round(ms / 60_000), expiresAt: new Date(Date.now() + ms), active: true,
        });
        break;
      }
      case 'kick':
        if (member?.kickable) await this.kickUser(guild, member, botUser, reason);
        break;
      case 'ban':
        // Sin miembro (ya salió) se puede banear igualmente; nunca a alguien por encima del bot
        if (member && !member.bannable) return;
        await this.banUser(guild, user, botUser, reason, durationMin ?? undefined);
        break;
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
  ): Promise<Array<{
    id: string;
    caseNumber: number;
    type: string;
    moderatorId: string;
    reason: string | null;
    duration: number | null;
    active: boolean;
    createdAt: Date;
  }>> {
    try {
      // Incluye comandos y AutoMod (misma tabla que el dashboard)
      const cases = await this.db.prisma.moderationCase.findMany({
        where: { guildId, targetId: userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      return cases.map((c) => ({
        id: c.id,
        caseNumber: c.caseNumber,
        type: c.action,
        moderatorId: c.moderatorId,
        reason: c.reason,
        duration: c.duration,
        active: c.active,
        createdAt: c.createdAt,
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
