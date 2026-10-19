import {
  GuildMember,
  TextChannel,
  VoiceBasedChannel,
  EmbedBuilder,
  Colors,
  Message,
  PartialMessage,
} from 'discord.js';
import { logger } from '../utils/Logger';
import { DatabaseManager } from '../client/managers/DatabaseManager';
import { i18n } from '../utils/i18n';
import { isCoreModuleEnabled } from '../config/coreModules';

export interface LoggingConfig {
  guildId: string;
  enabled: boolean;
  channels: {
    messageLog?: string;
    memberLog?: string;
    serverLog?: string;
    voiceLog?: string;
    moderationLog?: string;
  };
  events: {
    messageDelete: boolean;
    messageEdit: boolean;
    memberJoin: boolean;
    memberLeave: boolean;
    memberUpdate: boolean;
    roleCreate: boolean;
    roleDelete: boolean;
    roleUpdate: boolean;
    channelCreate: boolean;
    channelDelete: boolean;
    channelUpdate: boolean;
    voiceJoin: boolean;
    voiceLeave: boolean;
    voiceMove: boolean;
    banAdd: boolean;
    banRemove: boolean;
    inviteCreate: boolean;
    inviteDelete: boolean;
  };
}

export interface LogEntry {
  id: string;
  guildId: string;
  type: string;
  userId?: string;
  channelId?: string;
  data: unknown;
  createdAt: Date;
}

export class LoggingService {
  private static instance: LoggingService;
  private logger = logger;
  private db: DatabaseManager;

  private constructor(db: DatabaseManager) {
    this.db = db;
  }

  public static getInstance(db?: DatabaseManager): LoggingService {
    if (!LoggingService.instance) {
      if (!db) {
        throw new Error('DatabaseManager is required for first initialization');
      }
      LoggingService.instance = new LoggingService(db);
    }

    return LoggingService.instance;
  }

  /**
   * Log message deletion
   */
  public async logMessageDelete(message: Message | PartialMessage): Promise<void> {
    try {
      if (!message.guild || message.author?.bot) return;

      const config = await this.getLoggingConfig(message.guild.id);

      if (!config.enabled || !config.events.messageDelete || !config.channels.messageLog
          || this.isIgnored(config, message.channel.id, message.author?.id)) {
        return;
      }

      const logChannel = message.guild.channels.cache.get(
        config.channels.messageLog
      ) as TextChannel;

      if (!logChannel) return;

      const embed = new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle(`🗑️ ${i18n.t('logging.message_deleted', message.guild.id)}`)
        .addFields(
          {
            name: i18n.t('logging.author', message.guild.id),
            value: message.author ? `${message.author.tag} (${message.author.id})` : i18n.t('logging.unknown_author', message.guild.id),
            inline: true,
          },
          {
            name: i18n.t('logging.channel', message.guild.id),
            value: `<#${message.channel.id}>`,
            inline: true,
          },
          {
            name: i18n.t('logging.content', message.guild.id),
            value: this.truncate(message.content) || i18n.t('logging.no_content', message.guild.id),
            inline: false,
          }
        )
        .setTimestamp()
        .setFooter({ text: `ID: ${message.id}` });

      if (message.attachments.size > 0) {
        embed.addFields({
          name: i18n.t('logging.attachments', message.guild.id),
          value: message.attachments.map((att) => att.name).join(', '),
          inline: false,
        });
      }

      await logChannel.send({ embeds: [embed] });

      // Store in database
      await this.createLogEntry({
        guildId: message.guild.id,
        type: 'MESSAGE_DELETE',
        userId: message.author?.id,
        channelId: message.channel.id,
        data: {
          content: message.content,
          attachments: message.attachments.map((att) => ({ name: att.name, url: att.url })),
        },
      });
    } catch (error) {
      this.logger.error('Error logging message deletion:', error);
    }
  }

  /**
   * Log message edit
   */
  public async logMessageEdit(
    oldMessage: Message | PartialMessage,
    newMessage: Message
  ): Promise<void> {
    try {
      if (!newMessage.guild || newMessage.author?.bot) return;
      if (oldMessage.content === newMessage.content) return;

      const config = await this.getLoggingConfig(newMessage.guild.id);

      if (!config.enabled || !config.events.messageEdit || !config.channels.messageLog
          || this.isIgnored(config, newMessage.channel.id, newMessage.author?.id)) {
        return;
      }

      const logChannel = newMessage.guild.channels.cache.get(
        config.channels.messageLog
      ) as TextChannel;

      if (!logChannel) return;

      const embed = new EmbedBuilder()
        .setColor(Colors.Yellow)
        .setTitle(`✏️ ${i18n.t('logging.message_edited', newMessage.guild.id)}`)
        .addFields(
          {
            name: i18n.t('logging.author', newMessage.guild.id),
            value: `${newMessage.author?.tag} (${newMessage.author?.id})`,
            inline: true,
          },
          {
            name: i18n.t('logging.channel', newMessage.guild.id),
            value: `<#${newMessage.channel.id}>`,
            inline: true,
          },
          {
            name: i18n.t('logging.before', newMessage.guild.id),
            value: this.truncate(oldMessage.content) || i18n.t('logging.no_content', newMessage.guild.id),
            inline: false,
          },
          {
            name: i18n.t('logging.after', newMessage.guild.id),
            value: this.truncate(newMessage.content) || i18n.t('logging.no_content', newMessage.guild.id),
            inline: false,
          }
        )
        .setTimestamp()
        .setFooter({ text: `ID: ${newMessage.id}` });

      await logChannel.send({ embeds: [embed] });

      // Store in database
      await this.createLogEntry({
        guildId: newMessage.guild.id,
        type: 'MESSAGE_EDIT',
        userId: newMessage.author?.id,
        channelId: newMessage.channel.id,
        data: {
          oldContent: oldMessage.content,
          newContent: newMessage.content,
        },
      });
    } catch (error) {
      this.logger.error('Error logging message edit:', error);
    }
  }

  /**
   * Log member join
   */
  public async logMemberJoin(member: GuildMember): Promise<void> {
    try {
      const config = await this.getLoggingConfig(member.guild.id);

      if (!config.enabled || !config.events.memberJoin || !config.channels.memberLog || this.isIgnored(config, null, member.id)) {
        return;
      }

      const logChannel = member.guild.channels.cache.get(config.channels.memberLog) as TextChannel;

      if (!logChannel) return;

      const accountAge = Date.now() - member.user.createdTimestamp;
      const accountAgeDays = Math.floor(accountAge / (1000 * 60 * 60 * 24));

      const embed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle(`📥 ${i18n.t('logging.member_joined', member.guild.id)}`)
        .setThumbnail(member.user.displayAvatarURL())
        .addFields(
          {
            name: i18n.t('logging.user', member.guild.id),
            value: `${member.user.tag} (${member.user.id})`,
            inline: true,
          },
          {
            name: i18n.t('logging.account_created', member.guild.id),
            value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
            inline: true,
          },
          {
            name: i18n.t('logging.account_age', member.guild.id),
            value: i18n.t('logging.days_old', member.guild.id, { days: accountAgeDays.toString() }),
            inline: true,
          },
          {
            name: i18n.t('logging.member_count', member.guild.id),
            value: member.guild.memberCount.toString(),
            inline: true,
          }
        )
        .setTimestamp()
        .setFooter({ text: `ID: ${member.user.id}` });

      // Add warning for new accounts
      if (accountAgeDays < 7) {
        embed.addFields({
          name: `⚠️ ${i18n.t('logging.warning', member.guild.id)}`,
          value: i18n.t('logging.new_account_warning', member.guild.id),
          inline: false,
        });
      }

      await logChannel.send({ embeds: [embed] });

      // Store in database
      await this.createLogEntry({
        guildId: member.guild.id,
        type: 'MEMBER_JOIN',
        userId: member.user.id,
        data: {
          accountAge: accountAgeDays,
          memberCount: member.guild.memberCount,
        },
      });
    } catch (error) {
      this.logger.error('Error logging member join:', error);
    }
  }

  /**
   * Log member leave
   */
  public async logMemberLeave(member: GuildMember): Promise<void> {
    try {
      const config = await this.getLoggingConfig(member.guild.id);

      if (!config.enabled || !config.events.memberLeave || !config.channels.memberLog || this.isIgnored(config, null, member.id)) {
        return;
      }

      const logChannel = member.guild.channels.cache.get(config.channels.memberLog) as TextChannel;

      if (!logChannel) return;

      const joinedAt = member.joinedTimestamp;
      const timeInServer = joinedAt ? Date.now() - joinedAt : 0;
      const daysInServer = Math.floor(timeInServer / (1000 * 60 * 60 * 24));

      const embed = new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle(`📤 ${i18n.t('logging.member_left', member.guild.id)}`)
        .setThumbnail(member.user.displayAvatarURL())
        .addFields(
          {
            name: i18n.t('logging.user', member.guild.id),
            value: `${member.user.tag} (${member.user.id})`,
            inline: true,
          },
          {
            name: i18n.t('logging.joined_at', member.guild.id),
            value: joinedAt
              ? `<t:${Math.floor(joinedAt / 1000)}:R>`
              : i18n.t('common.unknown', member.guild.id),
            inline: true,
          },
          {
            name: i18n.t('logging.time_in_server', member.guild.id),
            value: i18n.t('logging.days_old', member.guild.id, { days: daysInServer.toString() }),
            inline: true,
          },
          {
            name: i18n.t('logging.roles', member.guild.id),
            value:
              member.roles.cache
                .filter((r) => r.id !== member.guild.id)
                .map((r) => r.name)
                .join(', ') || i18n.t('common.none', member.guild.id),
            inline: false,
          }
        )
        .setTimestamp()
        .setFooter({ text: `ID: ${member.user.id}` });

      await logChannel.send({ embeds: [embed] });

      // Store in database
      await this.createLogEntry({
        guildId: member.guild.id,
        type: 'MEMBER_LEAVE',
        userId: member.user.id,
        data: {
          timeInServer: daysInServer,
          roles: member.roles.cache
            .filter((r) => r.id !== member.guild.id)
            .map((r) => ({ id: r.id, name: r.name })),
        },
      });
    } catch (error) {
      this.logger.error('Error logging member leave:', error);
    }
  }

  /**
   * Log voice channel join
   */
  public async logVoiceJoin(member: GuildMember, channel: VoiceBasedChannel): Promise<void> {
    try {
      const config = await this.getLoggingConfig(member.guild.id);

      if (!config.enabled || !config.events.voiceJoin || !config.channels.voiceLog || this.isIgnored(config, channel.id, member.id)) {
        return;
      }

      const logChannel = member.guild.channels.cache.get(config.channels.voiceLog) as TextChannel;

      if (!logChannel) return;

      const embed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle(`🔊 ${i18n.t('logging.voice_joined', member.guild.id)}`)
        .addFields(
          {
            name: i18n.t('logging.user', member.guild.id),
            value: `${member.user.tag} (${member.user.id})`,
            inline: true,
          },
          {
            name: i18n.t('logging.channel', member.guild.id),
            value: channel.name,
            inline: true,
          }
        )
        .setTimestamp()
        .setFooter({ text: `ID: ${member.user.id}` });

      await logChannel.send({ embeds: [embed] });

      // Store in database
      await this.createLogEntry({
        guildId: member.guild.id,
        type: 'VOICE_JOIN',
        userId: member.user.id,
        channelId: channel.id,
        data: {
          channelName: channel.name,
        },
      });
    } catch (error) {
      this.logger.error('Error logging voice join:', error);
    }
  }

  /**
   * Log voice channel leave
   */
  public async logVoiceMove(member: GuildMember, from: VoiceBasedChannel, to: VoiceBasedChannel): Promise<void> {
    try {
      const config = await this.getLoggingConfig(member.guild.id);

      if (!config.enabled || !config.events.voiceMove || !config.channels.voiceLog || this.isIgnored(config, to.id, member.id)) {
        return;
      }

      const logChannel = member.guild.channels.cache.get(config.channels.voiceLog) as TextChannel;

      if (!logChannel) return;

      const t = (key: string) => i18n.t(key, member.guild.id);
      const embed = new EmbedBuilder()
        .setColor(Colors.Blue)
        .setTitle(`🔀 ${t('logging.voice_moved')}`)
        .addFields(
          { name: t('logging.user'), value: `${member.user.tag} (${member.user.id})`, inline: true },
          { name: t('logging.from'), value: from.name, inline: true },
          { name: t('logging.to'), value: to.name, inline: true },
        )
        .setTimestamp()
        .setFooter({ text: `ID: ${member.user.id}` });

      await logChannel.send({ embeds: [embed] });

      await this.createLogEntry({
        guildId: member.guild.id,
        type: 'VOICE_MOVE',
        userId: member.user.id,
        channelId: to.id,
        data: { from: from.name, to: to.name },
      });
    } catch (error) {
      this.logger.error('Error logging voice move:', error);
    }
  }

  public async logVoiceLeave(member: GuildMember, channel: VoiceBasedChannel): Promise<void> {
    try {
      const config = await this.getLoggingConfig(member.guild.id);

      if (!config.enabled || !config.events.voiceLeave || !config.channels.voiceLog || this.isIgnored(config, channel.id, member.id)) {
        return;
      }

      const logChannel = member.guild.channels.cache.get(config.channels.voiceLog) as TextChannel;

      if (!logChannel) return;

      const embed = new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle(`🔇 ${i18n.t('logging.voice_left', member.guild.id)}`)
        .addFields(
          {
            name: i18n.t('logging.user', member.guild.id),
            value: `${member.user.tag} (${member.user.id})`,
            inline: true,
          },
          {
            name: i18n.t('logging.channel', member.guild.id),
            value: channel.name,
            inline: true,
          }
        )
        .setTimestamp()
        .setFooter({ text: `ID: ${member.user.id}` });

      await logChannel.send({ embeds: [embed] });

      // Store in database
      await this.createLogEntry({
        guildId: member.guild.id,
        type: 'VOICE_LEAVE',
        userId: member.user.id,
        channelId: channel.id,
        data: {
          channelName: channel.name,
        },
      });
    } catch (error) {
      this.logger.error('Error logging voice leave:', error);
    }
  }

  /**
   * Get logging configuration for a guild
   */
  /**
   * Returns whether the 'logging' module is enabled at the guild level.
   * An empty enabledAddons array (legacy guilds) is treated as "all enabled".
   */
  private async isGuildModuleEnabled(guildId: string, moduleName: string): Promise<boolean> {
    const guild = await this.db.prisma.guild.findUnique({
      where: { id: guildId },
      select: { enabledAddons: true },
    });
    return isCoreModuleEnabled(guild?.enabledAddons, moduleName);
  }

  private configCache = new Map<string, { config: LoggingConfig & { ignoredChannels: string[]; ignoredUsers: string[] }; expires: number }>();

  public invalidateCache(guildId: string): void {
    this.configCache.delete(guildId);
  }

  /**
   * Configuración de logs (tabla logging_configs, la que edita el dashboard en
   * Logs → Configuración; la misma que usan AutoMod y Moderación).
   */
  public async getLoggingConfig(guildId: string): Promise<LoggingConfig & { ignoredChannels: string[]; ignoredUsers: string[] }> {
    const cached = this.configCache.get(guildId);
    if (cached && cached.expires > Date.now()) return cached.config;

    const [moduleEnabled, row] = await Promise.all([
      this.isGuildModuleEnabled(guildId, 'logging'),
      this.db.prisma.loggingConfig.findUnique({ where: { guildId } }),
    ]);

    const config = {
      guildId,
      // El toggle del módulo (Ajustes) manda sobre el interruptor de Logs
      enabled: moduleEnabled && !!row?.enabled,
      channels: {
        messageLog: row?.messageLogChannel ?? undefined,
        memberLog: row?.memberLogChannel ?? undefined,
        serverLog: row?.serverLogChannel ?? undefined,
        voiceLog: row?.voiceLogChannel ?? undefined,
        moderationLog: row?.moderationLogChannel ?? undefined,
      },
      events: {
        messageDelete: row?.logMessageDelete ?? true,
        messageEdit: row?.logMessageEdit ?? true,
        memberJoin: row?.logMemberJoin ?? true,
        memberLeave: row?.logMemberLeave ?? true,
        memberUpdate: row?.logMemberUpdate ?? false,
        roleCreate: row?.logRoleCreate ?? false,
        roleDelete: row?.logRoleDelete ?? false,
        roleUpdate: false,
        channelCreate: row?.logChannelCreate ?? false,
        channelDelete: row?.logChannelDelete ?? false,
        channelUpdate: false,
        voiceJoin: row?.logVoiceJoin ?? true,
        voiceLeave: row?.logVoiceLeave ?? true,
        voiceMove: row?.logVoiceMove ?? true,
        banAdd: row?.logMemberBan ?? false,
        banRemove: row?.logMemberUnban ?? false,
        inviteCreate: false,
        inviteDelete: false,
      },
      ignoredChannels: row?.ignoredChannels ?? [],
      ignoredUsers: row?.ignoredUsers ?? [],
    };
    this.configCache.set(guildId, { config, expires: Date.now() + 60_000 });
    return config;
  }

  /** Canal ignorado o usuario ignorado según la configuración. */
  private isIgnored(config: { ignoredChannels: string[]; ignoredUsers: string[] }, channelId?: string | null, userId?: string | null): boolean {
    return (!!channelId && config.ignoredChannels.includes(channelId)) || (!!userId && config.ignoredUsers.includes(userId));
  }

  /** Los campos de embed admiten 1024 caracteres como máximo. */
  private truncate(text: string | null | undefined, max = 1024): string {
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  /**
   * Create a log entry in the database
   */
  private async createLogEntry(data: {
    guildId: string;
    type: string;
    userId?: string;
    channelId?: string;
    data: unknown;
  }): Promise<LogEntry> {
    try {
      // Temporary implementation until Prisma is regenerated
      const entry = {
        id: this.generateId(),
        guildId: data.guildId,
        type: data.type,
        userId: data.userId || '',
        channelId: data.channelId || '',
        data: data.data,
        createdAt: new Date(),
      };

      // Guardar en log_entries (lo muestra la página Logs del dashboard)
      try {
        await this.db.prisma.logEntry.create({
          data: {
            guildId: entry.guildId,
            type: entry.type,
            userId: entry.userId || null,
            channelId: entry.channelId || null,
            data: (entry.data ?? {}) as any,
          },
        });
      } catch (dbError) {
        this.logger.warn('Could not save log entry to database:', dbError);
      }

      return entry;
    } catch (error) {
      this.logger.error('Error creating log entry:', error);
      throw new Error('Failed to create log entry');
    }
  }

  /**
   * Generate a simple ID
   */
  private generateId(): string {
    return (
      Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
    );
  }

  /**
   * Get log entries for a guild
   */
  public async getLogEntries(
    guildId: string,
    type?: string,
    _limit: number = 50
  ): Promise<LogEntry[]> {
    try {
      // Temporary implementation until Prisma is regenerated
      this.logger.debug(`Getting log entries (temporary implementation): guild=${guildId}, type=${type || 'all'}`);

      return [];
    } catch (error) {
      this.logger.error('Error getting log entries:', error);

      return [];
    }
  }
}
