import { 
  Guild, 
  GuildMember, 
  TextChannel, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  User
} from 'discord.js';
import { Prisma, PrismaClient } from '@prisma/client';
import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';
import { logger } from '../utils/Logger';
import { botConfig } from '../config/bot.config';

export interface GiveawayRequirement {
  type: 'role' | 'level' | 'invites' | 'messages' | 'balance' | 'account_age';
  value: string | number;
  operator?: 'gte' | 'lte' | 'eq';
}

export interface GiveawayData {
  id: string;
  guildId: string;
  channelId: string;
  messageId?: string;
  title: string;
  description?: string;
  prize: string;
  winners: number;
  entries: number;
  requirements: GiveawayRequirement[];
  bonusEntries: { roleId: string; entries: number }[];
  hostId: string;
  endsAt: Date;
  ended: boolean;
  participants: string[];
  winnerIds: string[];
  createdAt: Date;
  duration?: number;
  remindersSent: string[]; // Track which reminders have been sent
  allowAltAccounts: boolean;
  minAccountAge: number; // Days
}

export interface GiveawayStats {
  totalGiveaways: number;
  activeGiveaways: number;
  totalParticipants: number;
  totalWinners: number;
  averageParticipants: number;
  popularPrizes: string[];
}

interface GiveawayRequirementsData {
  requirements?: GiveawayRequirement[];
  bonusEntries?: { roleId: string; entries: number }[];
  participants?: string[];
  entries?: number;
  remindersSent?: string[];
  allowAltAccounts?: boolean;
  minAccountAge?: number;
  title?: string;
  description?: string;
}

export class GiveawayService {
  private client: KorexClient;
  private prisma: PrismaClient;
  private activeGiveaways: Map<string, NodeJS.Timeout> = new Map();
  private reminderTimeouts: Map<string, NodeJS.Timeout[]> = new Map();

  constructor(client: KorexClient) {
    this.client = client;
    this.prisma = client.db;
    this.initializeActiveGiveaways();
  }

  /**
   * Initialize active giveaways on startup
   */
  private async initializeActiveGiveaways(): Promise<void> {
    try {
      // Get all active giveaways from database
      const activeGiveaways = await this.getActiveGiveaways();
      
      for (const giveaway of activeGiveaways) {
        this.scheduleGiveawayEnd(giveaway);
        this.scheduleReminders(giveaway);
      }

      logger.info(`Initialized ${activeGiveaways.length} active giveaways`);
    } catch (error) {
      logger.error('Failed to initialize active giveaways:', error);
    }
  }

  /**
   * Schedule automatic reminders for giveaway
   */
  private scheduleReminders(giveaway: GiveawayData): void {
    const now = Date.now();
    const endTime = giveaway.endsAt.getTime();

    const reminders = [
      { time: 24 * 60 * 60 * 1000, key: '24h' }, // 24 hours
      { time: 60 * 60 * 1000, key: '1h' },      // 1 hour
      { time: 10 * 60 * 1000, key: '10m' }      // 10 minutes
    ];

    const timeouts: NodeJS.Timeout[] = [];

    for (const reminder of reminders) {
      const reminderTime = endTime - reminder.time;
      const timeUntilReminder = reminderTime - now;

      if (timeUntilReminder > 0 && !giveaway.remindersSent.includes(reminder.key)) {
        const timeout = setTimeout(async () => {
          await this.sendReminder(giveaway, reminder.key);
        }, timeUntilReminder);

        timeouts.push(timeout);
      }
    }

    if (timeouts.length > 0) {
      this.reminderTimeouts.set(giveaway.id, timeouts);
    }
  }

  /**
   * Send reminder notification
   */
  private async sendReminder(giveaway: GiveawayData, reminderType: string): Promise<void> {
    try {
      const guild = this.client.guilds.cache.get(giveaway.guildId);

      if (!guild) return;

      const channel = guild.channels.cache.get(giveaway.channelId) as TextChannel;

      if (!channel) return;

      const timeLeft = giveaway.endsAt.getTime() - Date.now();
      const timeString = this.formatTimeLeft(timeLeft);

      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.warning)
        .setTitle(`⏰ ${i18n.t('giveaways.reminder.title', guild.id)}`)
        .setDescription(i18n.t('giveaways.reminder.description', guild.id, {
          prize: giveaway.prize,
          time: timeString
        }))
        .addFields({
          name: i18n.t('giveaways.embed.participants', guild.id),
          value: giveaway.participants.length.toString(),
          inline: true
        })
        .setTimestamp();

      await channel.send({ embeds: [embed] });

      // Mark reminder as sent
      giveaway.remindersSent.push(reminderType);
      await this.updateGiveaway(giveaway);

      logger.info(`Sent ${reminderType} reminder for giveaway ${giveaway.id}`);
    } catch (error) {
      logger.error(`Failed to send reminder for giveaway ${giveaway.id}:`, error);
    }
  }

  /**
   * Format time left in human readable format
   */
  private formatTimeLeft(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;

    return `${seconds}s`;
  }

  /**
   * Check if account is potentially alt/fake
   */
  private async isAltAccount(user: User, guild: Guild): Promise<{ isAlt: boolean; reason?: string }> {
    const member = guild.members.cache.get(user.id);

    if (!member) return { isAlt: false };

    const accountAge = Date.now() - user.createdTimestamp;
    const accountAgeDays = accountAge / (1000 * 60 * 60 * 24);

    // Check account age (less than 7 days = suspicious)
    if (accountAgeDays < 7) {
      return { 
        isAlt: true, 
        reason: i18n.t('giveaways.alt_detection.new_account', guild.id, { days: Math.floor(accountAgeDays).toString() })
      };
    }

    // Check join date (joined very recently)
    const joinAge = Date.now() - (member.joinedTimestamp || 0);
    const joinAgeDays = joinAge / (1000 * 60 * 60 * 24);

    if (joinAgeDays < 1) {
      return { 
        isAlt: true, 
        reason: i18n.t('giveaways.alt_detection.new_member', guild.id)
      };
    }

    // Check if user has default avatar (suspicious)
    if (!user.avatar) {
      return { 
        isAlt: true, 
        reason: i18n.t('giveaways.alt_detection.default_avatar', guild.id)
      };
    }

    // Check message count (very low activity)
    const messageCount = await this.getUserMessageCount(user.id, guild.id);

    if (messageCount < 5) {
      return { 
        isAlt: true, 
        reason: i18n.t('giveaways.alt_detection.low_activity', guild.id)
      };
    }

    return { isAlt: false };
  }

  /**
   * Get giveaway statistics for a guild
   */
  async getGiveawayStats(guildId: string): Promise<GiveawayStats> {
    try {
      const totalGiveaways = await this.getTotalGiveaways(guildId);
      const activeGiveaways = await this.getActiveGiveawayCount(guildId);
      const totalParticipants = await this.getTotalParticipants(guildId);
      const totalWinners = await this.getTotalWinners(guildId);
      const averageParticipants = totalGiveaways > 0 ? totalParticipants / totalGiveaways : 0;
      const popularPrizes = await this.getPopularPrizes(guildId);

      return {
        totalGiveaways,
        activeGiveaways,
        totalParticipants,
        totalWinners,
        averageParticipants,
        popularPrizes
      };
    } catch (error) {
      logger.error('Failed to get giveaway stats:', error);

      return {
        totalGiveaways: 0,
        activeGiveaways: 0,
        totalParticipants: 0,
        totalWinners: 0,
        averageParticipants: 0,
        popularPrizes: []
      };
    }
  }

  /**
   * Create giveaway management panel embed
   */
  createManagementPanel(giveaways: GiveawayData[], stats: GiveawayStats, guildId: string): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.primary)
      .setTitle(`🎁 ${i18n.t('giveaways.panel.title', guildId)}`)
      .setDescription(i18n.t('giveaways.panel.description', guildId))
      .addFields(
        {
          name: i18n.t('giveaways.panel.stats.total', guildId),
          value: stats.totalGiveaways.toString(),
          inline: true
        },
        {
          name: i18n.t('giveaways.panel.stats.active', guildId),
          value: stats.activeGiveaways.toString(),
          inline: true
        },
        {
          name: i18n.t('giveaways.panel.stats.participants', guildId),
          value: stats.totalParticipants.toString(),
          inline: true
        }
      )
      .setTimestamp();

    if (giveaways.length > 0) {
      const activeList = giveaways
        .filter(g => !g.ended)
        .slice(0, 5)
        .map(g => `• **${g.prize}** - <t:${Math.floor(g.endsAt.getTime() / 1000)}:R>`)
        .join('\n') || i18n.t('giveaways.panel.no_active', guildId);

      embed.addFields({
        name: i18n.t('giveaways.panel.active_list', guildId),
        value: activeList,
        inline: false
      });
    }

    return embed;
  }

  /**
   * Create management panel buttons
   */
  createManagementButtons(guildId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('giveaway_create')
          .setLabel(i18n.t('giveaways.panel.buttons.create', guildId))
          .setStyle(ButtonStyle.Success)
          .setEmoji('➕'),
        new ButtonBuilder()
          .setCustomId('giveaway_list')
          .setLabel(i18n.t('giveaways.panel.buttons.list', guildId))
          .setStyle(ButtonStyle.Primary)
          .setEmoji('📋'),
        new ButtonBuilder()
          .setCustomId('giveaway_stats')
          .setLabel(i18n.t('giveaways.panel.buttons.stats', guildId))
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📊'),
        new ButtonBuilder()
          .setCustomId('giveaway_settings')
          .setLabel(i18n.t('giveaways.panel.buttons.settings', guildId))
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('⚙️')
      );
  }

  /**
   * Create a new giveaway
   */
  async createGiveaway(
    guild: Guild,
    channel: TextChannel,
    host: GuildMember,
    data: Partial<GiveawayData>
  ): Promise<GiveawayData | null> {
    try {
      // Check giveaway limits
      const activeCount = await this.getActiveGiveawayCount(guild.id);

      logger.info(`[GIVEAWAY] Active count: ${activeCount}, Limit: ${botConfig.limits.giveaways}`);
      if (activeCount >= botConfig.limits.giveaways) {
        return null;
      }

      const giveawayId = this.generateGiveawayId();
      const endsAt = new Date(Date.now() + (data.duration || 24 * 60 * 60 * 1000)); // Default 24h

      const giveaway = {
        id: giveawayId,
        guildId: guild.id,
        channelId: channel.id,
        title: data.title || 'Giveaway',
        description: data.description,
        prize: data.prize || 'Mystery Prize',
        winners: data.winners || 1,
        entries: 0,
        requirements: data.requirements || [],
        bonusEntries: data.bonusEntries || [],
        hostId: host.id,
        endsAt,
        ended: false,
        participants: [],
        winnerIds: [],
        createdAt: new Date(),
        remindersSent: [],
        allowAltAccounts: data.allowAltAccounts || false,
        minAccountAge: data.minAccountAge || 7
      } as GiveawayData;

      // Create giveaway embed and message
      const embed = this.createGiveawayEmbed(giveaway, guild.id);
      const components = this.createGiveawayComponents(giveaway, guild.id);

      const message = await channel.send({
        embeds: [embed],
        components: [components]
      });

      giveaway.messageId = message.id;

      // Save to database
      await this.saveGiveaway(giveaway);

      // Schedule automatic end and reminders
      this.scheduleGiveawayEnd(giveaway);
      this.scheduleReminders(giveaway);

      logger.info(`Created giveaway ${giveawayId} in guild ${guild.id}`);

      return giveaway;

    } catch (error) {
      logger.error('Failed to create giveaway:', error);

      return null;
    }
  }

  /**
   * Join a giveaway
   */
  async joinGiveaway(
    giveawayId: string,
    user: User,
    member: GuildMember
  ): Promise<{ success: boolean; reason?: string; entries?: number }> {
    try {
      const giveaway = await this.getGiveaway(giveawayId);

      if (!giveaway) {
        return { success: false, reason: 'Giveaway not found' };
      }

      if (giveaway.ended) {
        return { success: false, reason: 'Giveaway has ended' };
      }

      if (giveaway.participants.includes(user.id)) {
        return { success: false, reason: 'Already participating' };
      }

      // Check for alt accounts if not allowed
      if (!giveaway.allowAltAccounts) {
        const altCheck = await this.isAltAccount(user, member.guild);

        if (altCheck.isAlt) {
          return { success: false, reason: altCheck.reason || 'Alt account detected' };
        }
      }

      // Check requirements
      const requirementCheck = await this.checkRequirements(giveaway, member);

      if (!requirementCheck.passed) {
        return { success: false, reason: requirementCheck.reason || 'Requirements not met' };
      }

      // Calculate entries
      const entries = await this.calculateEntries(giveaway, member);

      // Add participant
      giveaway.participants.push(user.id);
      giveaway.entries += entries;

      // Update database
      await this.updateGiveaway(giveaway);

      // Update message
      await this.updateGiveawayMessage(giveaway);

      return { success: true, entries };

    } catch (error) {
      logger.error('Failed to join giveaway:', error);

      return { success: false, reason: 'Internal error' };
    }
  }
  /**
   * Leave a giveaway
   */
  async leaveGiveaway(
    giveawayId: string,
    user: User,
    member: GuildMember
  ): Promise<{ success: boolean; reason?: string }> {
    try {
      const giveaway = await this.getGiveaway(giveawayId);

      if (!giveaway) {
        return { success: false, reason: 'Giveaway not found' };
      }

      if (giveaway.ended) {
        return { success: false, reason: 'Giveaway has ended' };
      }

      const participantIndex = giveaway.participants.indexOf(user.id);

      if (participantIndex === -1) {
        return { success: false, reason: 'Not participating' };
      }

      // Calculate entries to remove
      const entries = await this.calculateEntries(giveaway, member);

      // Remove participant
      giveaway.participants.splice(participantIndex, 1);
      giveaway.entries = Math.max(0, giveaway.entries - entries);

      // Update database
      await this.updateGiveaway(giveaway);

      // Update message
      await this.updateGiveawayMessage(giveaway);

      return { success: true };

    } catch (error) {
      logger.error('Failed to leave giveaway:', error);

      return { success: false, reason: 'Internal error' };
    }
  }

  /**
   * End a giveaway and pick winners
   */
  async endGiveaway(giveawayId: string, force: boolean = false): Promise<boolean> {
    try {
      const giveaway = await this.getGiveaway(giveawayId);

      if (!giveaway) return false;

      if (giveaway.ended && !force) return false;

      // Pick winners
      const winners = this.pickWinners(giveaway);

      giveaway.winnerIds = winners.map(w => w.id);
      giveaway.ended = true;

      // Update database
      await this.updateGiveaway(giveaway);

      // Update message with results
      await this.updateGiveawayMessage(giveaway, true);

      // Send winner announcement
      await this.announceWinners(giveaway, winners);

      // Clear timeouts
      const timeout = this.activeGiveaways.get(giveawayId);

      if (timeout) {
        clearTimeout(timeout);
        this.activeGiveaways.delete(giveawayId);
      }

      const reminderTimeouts = this.reminderTimeouts.get(giveawayId);

      if (reminderTimeouts) {
        reminderTimeouts.forEach(timeout => clearTimeout(timeout));
        this.reminderTimeouts.delete(giveawayId);
      }

      logger.info(`Ended giveaway ${giveawayId} with ${winners.length} winners`);

      return true;

    } catch (error) {
      logger.error('Failed to end giveaway:', error);

      return false;
    }
  }

  /**
   * Get active giveaways for a guild
   */
  async getGuildGiveaways(_guildId: string): Promise<GiveawayData[]> {
    try {
      // This would fetch from database - placeholder implementation
      return [];
    } catch (error) {
      logger.error('Failed to get guild giveaways:', error);

      return [];
    }
  }

  /**
   * Check if user meets giveaway requirements
   */
  private async checkRequirements(
    giveaway: GiveawayData,
    member: GuildMember
  ): Promise<{ passed: boolean; reason?: string }> {
    for (const requirement of giveaway.requirements) {
      switch (requirement.type) {
        case 'role':
          if (!member.roles.cache.has(requirement.value as string)) {
            return { passed: false, reason: 'Missing required role' };
          }
          break;

        case 'level': {
          const userLevel = await this.getUserLevel(member.id, member.guild.id);

          if (userLevel < (requirement.value as number)) {
            return { passed: false, reason: `Minimum level ${requirement.value} required` };
          }
          break;
        }

        case 'messages': {
          const messageCount = await this.getUserMessageCount(member.id, member.guild.id);

          if (messageCount < (requirement.value as number)) {
            return { passed: false, reason: `Minimum ${requirement.value} messages required` };
          }
          break;
        }

        case 'balance': {
          const balance = await this.getUserBalance(member.id, member.guild.id);

          if (balance < (requirement.value as number)) {
            return { passed: false, reason: `Minimum balance of ${requirement.value} coins required` };
          }
          break;
        }

        case 'account_age': {
          const accountAge = Date.now() - member.user.createdTimestamp;
          const accountAgeDays = accountAge / (1000 * 60 * 60 * 24);

          if (accountAgeDays < (requirement.value as number)) {
            return { passed: false, reason: `Account must be at least ${requirement.value} days old` };
          }
          break;
        }
      }
    }

    return { passed: true };
  }

  /**
   * Calculate entries for a user based on bonus roles
   */
  private async calculateEntries(giveaway: GiveawayData, member: GuildMember): Promise<number> {
    let entries = 1; // Base entry

    for (const bonus of giveaway.bonusEntries) {
      if (member.roles.cache.has(bonus.roleId)) {
        entries += bonus.entries;
      }
    }

    return entries;
  }

  /**
   * Pick random winners from participants
   */
  private pickWinners(giveaway: GiveawayData): { id: string; entries: number }[] {
    if (giveaway.participants.length === 0) return [];

    const winners: { id: string; entries: number }[] = [];
    const participants = [...giveaway.participants];

    const winnersCount = Math.min(giveaway.winners, participants.length);

    for (let i = 0; i < winnersCount; i++) {
      const randomIndex = Math.floor(Math.random() * participants.length);
      const winnerId = participants.splice(randomIndex, 1)[0];
      
      winners.push({
        id: winnerId,
        entries: 1 // Would calculate actual entries
      });
    }

    return winners;
  }

  /**
   * Create giveaway embed
   */
  private createGiveawayEmbed(giveaway: GiveawayData, guildId: string): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.primary)
      .setTitle(`🎉 ${giveaway.title}`)
      .setDescription(giveaway.description || i18n.t('giveaways.embed.description', guildId))
      .addFields(
        {
          name: i18n.t('giveaways.embed.prize', guildId),
          value: giveaway.prize,
          inline: true
        },
        {
          name: i18n.t('giveaways.embed.winners', guildId),
          value: giveaway.winners.toString(),
          inline: true
        },
        {
          name: i18n.t('giveaways.embed.entries', guildId),
          value: giveaway.entries.toString(),
          inline: true
        },
        {
          name: i18n.t('giveaways.embed.ends', guildId),
          value: `<t:${Math.floor(giveaway.endsAt.getTime() / 1000)}:R>`,
          inline: false
        }
      )
      .setTimestamp();

    if (this.client.user?.displayAvatarURL()) {
      embed.setFooter({
        text: i18n.t('giveaways.embed.footer', guildId, { id: giveaway.id }),
        iconURL: this.client.user.displayAvatarURL()
      });
    } else {
      embed.setFooter({
        text: i18n.t('giveaways.embed.footer', guildId, { id: giveaway.id })
      });
    }

    if (giveaway.requirements.length > 0) {
      const requirements = giveaway.requirements.map(req => {
        switch (req.type) {
          case 'role':
            return `• ${i18n.t('giveaways.requirements.role', guildId)} <@&${req.value}>`;
          case 'level':
            return `• ${i18n.t('giveaways.requirements.level', guildId, { level: req.value.toString() })}`;
          case 'messages':
            return `• ${i18n.t('giveaways.requirements.messages', guildId, { count: req.value.toString() })}`;
          case 'balance':
            return `• ${i18n.t('giveaways.requirements.balance', guildId, { amount: req.value.toString() })}`;
          case 'account_age':
            return `• ${i18n.t('giveaways.requirements.account_age', guildId, { days: req.value.toString() })}`;
          default:
            return '';
        }
      }).filter(Boolean).join('\n');

      embed.addFields({
        name: i18n.t('giveaways.embed.requirements', guildId),
        value: requirements,
        inline: false
      });
    }

    return embed;
  }

  /**
   * Create giveaway action buttons
   */
  private createGiveawayComponents(giveaway: GiveawayData, guildId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`giveaway_join_${giveaway.id}`)
          .setLabel(i18n.t('giveaways.buttons.join', guildId))
          .setStyle(ButtonStyle.Success)
          .setEmoji('🎉'),
        new ButtonBuilder()
          .setCustomId(`giveaway_leave_${giveaway.id}`)
          .setLabel(i18n.t('giveaways.buttons.leave', guildId))
          .setStyle(ButtonStyle.Danger)
          .setEmoji('❌'),
        new ButtonBuilder()
          .setCustomId(`giveaway_info_${giveaway.id}`)
          .setLabel(i18n.t('giveaways.buttons.info', guildId))
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('ℹ️')
      );
  }

  // Database helper methods - implemented with Prisma
  private generateGiveawayId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  private async getActiveGiveaways(): Promise<GiveawayData[]> {
    try {
      const giveaways = await this.prisma.giveaway.findMany({
        where: {
          ended: false,
          endsAt: {
            gt: new Date()
          }
        }
      });

      return giveaways.map(g => this.mapPrismaToGiveawayData(g));
    } catch (error) {
      logger.error('Failed to get active giveaways:', error);

      return [];
    }
  }

  async getActiveGiveawayCount(guildId: string): Promise<number> {
    try {
      return await this.prisma.giveaway.count({
        where: {
          guildId,
          ended: false
        }
      });
    } catch (error) {
      logger.error('Failed to get active giveaway count:', error);

      return 0;
    }
  }

  private async getGiveaway(id: string): Promise<GiveawayData | null> {
    try {
      const giveaway = await this.prisma.giveaway.findUnique({
        where: { id }
      });

      return giveaway ? this.mapPrismaToGiveawayData(giveaway) : null;
    } catch (error) {
      logger.error('Failed to get giveaway:', error);

      return null;
    }
  }

  private async saveGiveaway(giveaway: GiveawayData): Promise<void> {
    try {
      const requirementsData = {
        requirements: giveaway.requirements,
        bonusEntries: giveaway.bonusEntries,
        participants: giveaway.participants,
        entries: giveaway.entries,
        remindersSent: giveaway.remindersSent,
        allowAltAccounts: giveaway.allowAltAccounts,
        minAccountAge: giveaway.minAccountAge,
        title: giveaway.title,
        description: giveaway.description
      };

      await this.prisma.giveaway.create({
        data: {
          id: giveaway.id,
          guildId: giveaway.guildId,
          channelId: giveaway.channelId,
          messageId: giveaway.messageId || null,
          hostId: giveaway.hostId,
          prize: giveaway.prize,
          winners: giveaway.winners,
          endsAt: giveaway.endsAt,
          ended: giveaway.ended,
          winnerIds: giveaway.winnerIds,
          requirements: requirementsData as unknown as Prisma.InputJsonValue
        }
      });
    } catch (error) {
      logger.error('Failed to save giveaway:', error);
      throw error;
    }
  }

  private async updateGiveaway(giveaway: GiveawayData): Promise<void> {
    try {
      const requirementsData = {
        requirements: giveaway.requirements,
        bonusEntries: giveaway.bonusEntries,
        participants: giveaway.participants,
        entries: giveaway.entries,
        remindersSent: giveaway.remindersSent,
        allowAltAccounts: giveaway.allowAltAccounts,
        minAccountAge: giveaway.minAccountAge,
        title: giveaway.title,
        description: giveaway.description
      };

      await this.prisma.giveaway.update({
        where: { id: giveaway.id },
        data: {
          messageId: giveaway.messageId || null,
          ended: giveaway.ended,
          winnerIds: giveaway.winnerIds,
          requirements: requirementsData as unknown as Prisma.InputJsonValue
        }
      });
    } catch (error) {
      logger.error('Failed to update giveaway:', error);
      throw error;
    }
  }

  /**
   * Map Prisma giveaway to GiveawayData interface
   */
  private mapPrismaToGiveawayData(prismaGiveaway: {
    id: string;
    guildId: string;
    channelId: string;
    messageId: string | null;
    hostId: string;
    prize: string;
    winners: number;
    endsAt: Date;
    ended: boolean;
    winnerIds: string[];
    createdAt: Date;
    requirements: unknown;
  }): GiveawayData {
    let parsedData: GiveawayRequirementsData = {};
    
    if (prismaGiveaway.requirements && typeof prismaGiveaway.requirements === 'string') {
      try {
        parsedData = JSON.parse(prismaGiveaway.requirements);
      } catch (error) {
        logger.warn('Failed to parse giveaway requirements:', error);
      }
    } else if (prismaGiveaway.requirements && typeof prismaGiveaway.requirements === 'object') {
      parsedData = prismaGiveaway.requirements;
    }

    return {
      id: prismaGiveaway.id,
      guildId: prismaGiveaway.guildId,
      channelId: prismaGiveaway.channelId,
      messageId: prismaGiveaway.messageId ?? undefined,
      title: parsedData.title || 'Giveaway',
      description: parsedData.description,
      prize: prismaGiveaway.prize,
      winners: prismaGiveaway.winners,
      entries: parsedData.entries || 0,
      requirements: parsedData.requirements || [],
      bonusEntries: parsedData.bonusEntries || [],
      hostId: prismaGiveaway.hostId,
      endsAt: prismaGiveaway.endsAt,
      ended: prismaGiveaway.ended,
      participants: parsedData.participants || [],
      winnerIds: prismaGiveaway.winnerIds,
      createdAt: prismaGiveaway.createdAt,
      remindersSent: parsedData.remindersSent || [],
      allowAltAccounts: parsedData.allowAltAccounts || false,
      minAccountAge: parsedData.minAccountAge || 7
    };
  }

  private async updateGiveawayMessage(giveaway: GiveawayData, ended: boolean = false): Promise<void> {
    try {
      const guild = this.client.guilds.cache.get(giveaway.guildId);

      if (!guild) return;

      const channel = guild.channels.cache.get(giveaway.channelId) as TextChannel;

      if (!channel || !giveaway.messageId) return;

      const message = await channel.messages.fetch(giveaway.messageId);

      if (!message) return;

      const embed = this.createGiveawayEmbed(giveaway, guild.id);
      const components = ended ? [] : [this.createGiveawayComponents(giveaway, guild.id)];

      await message.edit({
        embeds: [embed],
        components
      });
    } catch (error) {
      logger.error('Failed to update giveaway message:', error);
    }
  }

  private async announceWinners(giveaway: GiveawayData, winners: { id: string; entries: number }[]): Promise<void> {
    try {
      const guild = this.client.guilds.cache.get(giveaway.guildId);

      if (!guild) return;

      const channel = guild.channels.cache.get(giveaway.channelId) as TextChannel;

      if (!channel) return;

      if (winners.length === 0) {
        const embed = new EmbedBuilder()
          .setColor(botConfig.colors.error)
          .setTitle(`🎉 ${i18n.t('giveaways.ended.no_winners.title', guild.id)}`)
          .setDescription(i18n.t('giveaways.ended.no_winners.description', guild.id, { prize: giveaway.prize }))
          .setTimestamp();

        await channel.send({ embeds: [embed] });

        return;
      }

      const winnerMentions = winners.map(w => `<@${w.id}>`).join(', ');
      
      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.success)
        .setTitle(`🎉 ${i18n.t('giveaways.ended.title', guild.id)}`)
        .setDescription(i18n.t('giveaways.ended.description', guild.id, {
          winners: winnerMentions,
          prize: giveaway.prize
        }))
        .addFields(
          {
            name: i18n.t('giveaways.ended.total_entries', guild.id),
            value: giveaway.entries.toString(),
            inline: true
          },
          {
            name: i18n.t('giveaways.ended.participants', guild.id),
            value: giveaway.participants.length.toString(),
            inline: true
          }
        )
        .setTimestamp();

      await channel.send({ 
        content: winnerMentions,
        embeds: [embed] 
      });

      // Send DM to winners
      for (const winner of winners) {
        try {
          const user = await this.client.users.fetch(winner.id);
          const dmEmbed = new EmbedBuilder()
            .setColor(botConfig.colors.success)
            .setTitle(`🎉 ${i18n.t('giveaways.winner_dm.title', guild.id)}`)
            .setDescription(i18n.t('giveaways.winner_dm.description', guild.id, {
              prize: giveaway.prize,
              server: guild.name
            }))
            .setTimestamp();

          await user.send({ embeds: [dmEmbed] });
        } catch (error) {
          logger.warn(`Failed to send DM to winner ${winner.id}:`, error);
        }
      }

    } catch (error) {
      logger.error('Failed to announce winners:', error);
    }
  }

  private scheduleGiveawayEnd(giveaway: GiveawayData): void {
    const timeUntilEnd = giveaway.endsAt.getTime() - Date.now();
    
    if (timeUntilEnd <= 0) {
      // End immediately if already past end time
      this.endGiveaway(giveaway.id);

      return;
    }

    const timeout = setTimeout(() => {
      this.endGiveaway(giveaway.id);
    }, timeUntilEnd);

    this.activeGiveaways.set(giveaway.id, timeout);
  }

  // Integration helper methods - these integrate with other services properly
  private async getUserLevel(userId: string, guildId: string): Promise<number> {
    try {
      const user = await this.client.levels.getUser(guildId, userId);

      return user.level;
    } catch (error) {
      return 1;
    }
  }

  private async getUserMessageCount(userId: string, guildId: string): Promise<number> {
    try {
      const user = await this.client.levels.getUser(guildId, userId);

      return user.messages;
    } catch (error) {
      return 0;
    }
  }

  private async getUserBalance(userId: string, guildId: string): Promise<number> {
    try {
      const user = await this.client.economy.getUser(guildId, userId);

      return user.balance;
    } catch (error) {
      return 0;
    }
  }

  // Statistics helper methods - implemented with Prisma queries
  private async getTotalGiveaways(guildId: string): Promise<number> {
    try {
      return await this.prisma.giveaway.count({
        where: { guildId }
      });
    } catch (error) {
      logger.error('Failed to get total giveaways:', error);

      return 0;
    }
  }

  private async getTotalParticipants(guildId: string): Promise<number> {
    try {
      const giveaways = await this.prisma.giveaway.findMany({
        where: { guildId },
        select: { requirements: true }
      });

      let totalParticipants = 0;

      for (const giveaway of giveaways) {
        if (giveaway.requirements && typeof giveaway.requirements === 'string') {
          try {
            const data = JSON.parse(giveaway.requirements);

            totalParticipants += (data.participants || []).length;
          } catch (error) {
            // Ignore parsing errors
          }
        } else if (giveaway.requirements && typeof giveaway.requirements === 'object') {
          const data = giveaway.requirements as GiveawayRequirementsData;

          totalParticipants += (data.participants || []).length;
        }
      }

      return totalParticipants;
    } catch (error) {
      logger.error('Failed to get total participants:', error);

      return 0;
    }
  }

  private async getTotalWinners(guildId: string): Promise<number> {
    try {
      const giveaways = await this.prisma.giveaway.findMany({
        where: { 
          guildId,
          ended: true
        },
        select: { winnerIds: true }
      });

      return giveaways.reduce((total, giveaway) => total + giveaway.winnerIds.length, 0);
    } catch (error) {
      logger.error('Failed to get total winners:', error);

      return 0;
    }
  }

  private async getPopularPrizes(guildId: string): Promise<string[]> {
    try {
      const giveaways = await this.prisma.giveaway.findMany({
        where: { guildId },
        select: { prize: true },
        orderBy: { createdAt: 'desc' },
        take: 10
      });

      // Count prize frequency
      const prizeCount = new Map<string, number>();

      for (const giveaway of giveaways) {
        const count = prizeCount.get(giveaway.prize) || 0;

        prizeCount.set(giveaway.prize, count + 1);
      }

      // Sort by frequency and return top 5
      return Array.from(prizeCount.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([prize]) => prize);
    } catch (error) {
      logger.error('Failed to get popular prizes:', error);

      return [];
    }
  }
}
