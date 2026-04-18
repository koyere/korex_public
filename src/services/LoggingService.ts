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

      if (!config.enabled || !config.events.messageDelete || !config.channels.messageLog) {
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
            value: `${message.author?.tag || 'Unknown'} (${message.author?.id || 'Unknown'})`,
            inline: true,
          },
          {
            name: i18n.t('logging.channel', message.guild.id),
            value: `<#${message.channel.id}>`,
            inline: true,
          },
          {
            name: i18n.t('logging.content', message.guild.id),
            value: message.content || i18n.t('logging.no_content', message.guild.id),
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
        userId: message.author?.id || 'Unknown',
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

      if (!config.enabled || !config.events.messageEdit || !config.channels.messageLog) {
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
            value: oldMessage.content || i18n.t('logging.no_content', newMessage.guild.id),
            inline: false,
          },
          {
            name: i18n.t('logging.after', newMessage.guild.id),
            value: newMessage.content || i18n.t('logging.no_content', newMessage.guild.id),
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
        userId: newMessage.author?.id || 'Unknown',
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

      if (!config.enabled || !config.events.memberJoin || !config.channels.memberLog) {
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

      if (!config.enabled || !config.events.memberLeave || !config.channels.memberLog) {
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

      if (!config.enabled || !config.events.voiceJoin || !config.channels.voiceLog) {
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
  public async logVoiceLeave(member: GuildMember, channel: VoiceBasedChannel): Promise<void> {
    try {
      const config = await this.getLoggingConfig(member.guild.id);

      if (!config.enabled || !config.events.voiceLeave || !config.channels.voiceLog) {
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
    if (!guild || guild.enabledAddons.length === 0) return true;
    return guild.enabledAddons.includes(moduleName);
  }

  public async getLoggingConfig(guildId: string): Promise<LoggingConfig> {
    try {
      const [moduleEnabled, config] = await Promise.all([
        this.isGuildModuleEnabled(guildId, 'logging'),
        this.db.prisma.guildConfig.findUnique({ where: { guildId } }),
      ]);

      if (!config) {
        // Create default configuration
        const defaultConfig = await this.db.prisma.guildConfig.create({
          data: {
            guildId,
            loggingEnabled: false,
            loggingChannels: {},
            loggingEvents: {
              messageDelete: true,
              messageEdit: true,
              memberJoin: true,
              memberLeave: true,
              memberUpdate: false,
              roleCreate: true,
              roleDelete: true,
              roleUpdate: false,
              channelCreate: true,
              channelDelete: true,
              channelUpdate: false,
              voiceJoin: true,
              voiceLeave: true,
              voiceMove: true,
              banAdd: true,
              banRemove: true,
              inviteCreate: false,
              inviteDelete: false,
            },
          },
        });

        return {
          guildId: defaultConfig.guildId,
          // Module toggle takes precedence over the per-guild granular setting
          enabled: moduleEnabled ? defaultConfig.loggingEnabled : false,
          channels: (defaultConfig.loggingChannels as LoggingConfig['channels']) || {},
          events: defaultConfig.loggingEvents as LoggingConfig['events'],
        };
      }

      return {
        guildId: config.guildId,
        // Module toggle takes precedence over the per-guild granular setting
        enabled: moduleEnabled ? config.loggingEnabled : false,
        channels: (config.loggingChannels as LoggingConfig['channels']) || {},
        events: config.loggingEvents as LoggingConfig['events'],
      };
    } catch (error) {
      this.logger.error('Error getting logging config:', error);
      throw new Error('Failed to get logging config');
    }
  }

  /**
   * Update logging configuration
   */
  public async updateLoggingConfig(
    guildId: string,
    updates: Partial<LoggingConfig>
  ): Promise<void> {
    try {
      const updateData = {} as Parameters<typeof this.db.prisma.guildConfig.upsert>[0]['update'];
      const createData = { guildId } as Parameters<typeof this.db.prisma.guildConfig.upsert>[0]['create'];

      if (updates.enabled !== undefined) {
        updateData.loggingEnabled = updates.enabled;
        createData.loggingEnabled = updates.enabled;
      }
      if (updates.channels !== undefined) {
        updateData.loggingChannels = updates.channels;
        createData.loggingChannels = updates.channels;
      }
      if (updates.events !== undefined) {
        updateData.loggingEvents = updates.events;
        createData.loggingEvents = updates.events;
      }

      await this.db.prisma.guildConfig.upsert({
        where: { guildId },
        update: updateData,
        create: createData,
      });

      this.logger.info(`Updated logging config for guild ${guildId}`);
    } catch (error) {
      this.logger.error('Error updating logging config:', error);
      throw new Error('Failed to update logging config');
    }
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

      // Try to save to database if possible
      try {
        await this.db.prisma.$executeRaw`
          INSERT INTO log_entries (id, guildId, type, userId, channelId, data, createdAt)
          VALUES (${entry.id}, ${entry.guildId}, ${entry.type}, ${entry.userId || null}, ${entry.channelId || null}, ${JSON.stringify(entry.data)}, ${entry.createdAt})
        `;
      } catch (dbError) {
        this.logger.debug('Could not save log entry to database:', dbError);
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
