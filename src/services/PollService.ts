import { 
  Guild, 
  GuildMember, 
  TextChannel, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  User
} from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';
import { logger } from '../utils/Logger';
import { botConfig } from '../config/bot.config';

export type PollType = 'simple' | 'multiple' | 'dropdown' | 'ranking';

export interface PollOption {
  id: string;
  text: string;
  emoji?: string;
  votes: number;
  voters: string[];
}

export interface PollRestriction {
  type: 'role' | 'level' | 'age' | 'messages';
  value: string | number;
  operator?: 'gte' | 'lte' | 'eq';
}

export interface PollData {
  id: string;
  guildId: string;
  channelId: string;
  messageId?: string;
  title: string;
  description?: string;
  type: PollType;
  options: PollOption[];
  restrictions: PollRestriction[];
  settings: {
    anonymous: boolean;
    multipleChoice: boolean;
    maxChoices?: number;
    showResults: 'always' | 'after_vote' | 'after_end';
    allowChangeVote: boolean;
    duration?: number; // Add duration property for creation
  };
  hostId: string;
  endsAt?: Date;
  ended: boolean;
  totalVotes: number;
  participants: string[];
  createdAt: Date;
}

interface PollResults {
  pollId: string;
  title: string;
  type: PollType;
  totalVotes: number;
  totalParticipants: number;
  ended: boolean;
  options: Array<{
    id: string;
    text: string;
    emoji?: string;
    votes: number;
    percentage: number;
    voters: string[];
  }>;
  winner:
    | { option: PollOption; type: 'single' }
    | { options: PollOption[]; type: 'tie' }
    | null;
  createdAt: Date;
  endedAt: Date | null;
}

type PollActionRow = ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>;

export class PollService {
  private client: KorexClient;
  private prisma: PrismaClient;
  private activePolls: Map<string, NodeJS.Timeout> = new Map();

  constructor(client: KorexClient) {
    this.client = client;
    this.prisma = client.db;
    this.initializeActivePolls();
  }

  /**
   * Initialize active polls on startup
   */
  private async initializeActivePolls(): Promise<void> {
    try {
      // Get all active polls from database
      const activePolls = await this.getActivePolls();
      
      for (const poll of activePolls) {
        if (poll.endsAt) {
          this.schedulePollEnd(poll);
        }
      }

      logger.info(`Initialized ${activePolls.length} active polls`);
    } catch (error) {
      logger.error('Failed to initialize active polls:', error);
    }
  }

  /**
   * Create a new poll
   */
  async createPoll(
    guild: Guild,
    channel: TextChannel,
    host: GuildMember,
    data: Partial<PollData>
  ): Promise<PollData | null> {
    try {
      // Check poll limits
      const activeCount = await this.getActivePollCount(guild.id);

      if (activeCount >= botConfig.limits.polls) {
        return null;
      }

      const pollId = this.generatePollId();
      const endsAt = data.endsAt || (data.settings?.duration ? 
        new Date(Date.now() + (data.settings.duration as number)) : undefined);

      const poll = {
        id: pollId,
        guildId: guild.id,
        channelId: channel.id,
        title: data.title || 'Poll',
        description: data.description,
        type: data.type || 'simple',
        options: (data.options || []).map(opt => ({
          id: opt.id,
          text: opt.text,
          emoji: opt.emoji,
          votes: (opt as any).votes ?? 0,
          voters: Array.isArray((opt as any).voters) ? (opt as any).voters : [],
        })),
        restrictions: data.restrictions || [],
        settings: {
          anonymous: data.settings?.anonymous || false,
          multipleChoice: data.settings?.multipleChoice || false,
          maxChoices: data.settings?.maxChoices || undefined,
          showResults: data.settings?.showResults || 'always',
          allowChangeVote: data.settings?.allowChangeVote || true,
          ...data.settings
        },
        hostId: host.id,
        endsAt,
        ended: false,
        totalVotes: 0,
        participants: [],
        createdAt: new Date()
      } as PollData;

      // Create poll embed and message
      const embed = this.createPollEmbed(poll, guild.id);
      const components = this.createPollComponents(poll, guild.id);

      const message = await channel.send({
        embeds: [embed],
        components
      });

      poll.messageId = message.id;

      // Save to database
      await this.savePoll(poll);

      // Schedule automatic end if duration is set
      if (poll.endsAt) {
        this.schedulePollEnd(poll);
      }

      logger.info(`Created poll ${pollId} in guild ${guild.id}`);

      return poll;

    } catch (error) {
      logger.error('Failed to create poll:', error);

      return null;
    }
  }

  /**
   * Vote in a poll
   */
  async vote(
    pollId: string,
    user: User,
    member: GuildMember,
    optionIds: string[]
  ): Promise<{ success: boolean; reason?: string; results?: PollResults | null }> {
    try {
      const poll = await this.getPoll(pollId);

      if (!poll) {
        return { success: false, reason: 'Poll not found' };
      }

      if (poll.ended) {
        return { success: false, reason: 'Poll has ended' };
      }

      // Check restrictions
      const restrictionCheck = await this.checkRestrictions(poll, member);

      if (!restrictionCheck.passed) {
        return { success: false, reason: restrictionCheck.reason || 'Requirements not met' };
      }

      // Check if user already voted
      const hasVoted = poll.participants.includes(user.id);

      if (hasVoted && !poll.settings.allowChangeVote) {
        return { success: false, reason: 'Vote change not allowed' };
      }

      // Validate vote options
      const validationResult = this.validateVoteOptions(poll, optionIds);

      if (!validationResult.valid) {
        return { success: false, reason: validationResult.reason || 'Invalid vote options' };
      }

      // Remove previous votes if changing vote
      if (hasVoted) {
        this.removePreviousVotes(poll, user.id);
      } else {
        poll.participants.push(user.id);
      }

      // Add new votes
      for (const optionId of optionIds) {
        const option = poll.options.find(o => o.id === optionId);

        if (option) {
          if (!poll.settings.anonymous) {
            option.voters.push(user.id);
          }
          option.votes++;
        }
      }

      // Update total votes
      poll.totalVotes = poll.options.reduce((sum, option) => sum + option.votes, 0);

      // Update database
      await this.updatePoll(poll);

      // Update message
      await this.updatePollMessage(poll);

      // Return results if configured to show after vote
      const results = poll.settings.showResults === 'after_vote' || poll.settings.showResults === 'always' 
        ? this.calculateResults(poll) 
        : null;

      return { success: true, results };

    } catch (error) {
      logger.error('Failed to vote in poll:', error);

      return { success: false, reason: 'Internal error' };
    }
  }

  /**
   * End a poll and show final results
   */
  async endPoll(pollId: string, force: boolean = false): Promise<boolean> {
    try {
      const poll = await this.getPoll(pollId);

      if (!poll) return false;

      if (poll.ended && !force) return false;

      poll.ended = true;

      // Update database
      await this.updatePoll(poll);

      // Update message with final results
      await this.updatePollMessage(poll, true);

      // Send results summary if configured
      await this.sendPollResults(poll);

      // Clear timeout
      const timeout = this.activePolls.get(pollId);

      if (timeout) {
        clearTimeout(timeout);
        this.activePolls.delete(pollId);
      }

      logger.info(`Ended poll ${pollId} with ${poll.totalVotes} total votes`);

      return true;

    } catch (error) {
      logger.error('Failed to end poll:', error);

      return false;
    }
  }

  /**
   * Get poll statistics and results
   */
  async getPollResults(pollId: string): Promise<PollResults | null> {
    try {
      const poll = await this.getPoll(pollId);

      if (!poll) return null;

      return this.calculateResults(poll);
    } catch (error) {
      logger.error('Failed to get poll results:', error);

      return null;
    }
  }

  /**
   * Export poll results to various formats
   */
  async exportPollResults(pollId: string, format: 'json' | 'csv' | 'text' = 'json'): Promise<string | null> {
    try {
      const poll = await this.getPoll(pollId);

      if (!poll) return null;

      const results = this.calculateResults(poll);

      switch (format) {
        case 'json':
          return JSON.stringify(results, null, 2);
        case 'csv':
          return this.formatResultsAsCSV(results);
        case 'text':
          return this.formatResultsAsText(results);
        default:
          return JSON.stringify(results, null, 2);
      }
    } catch (error) {
      logger.error('Failed to export poll results:', error);

      return null;
    }
  }

  /**
   * Get all polls for a guild
   */
  async getGuildPollsForGuild(guildId: string): Promise<PollData[]> {
    try {
      return await this.getGuildPolls(guildId);
    } catch (error) {
      logger.error('Failed to get guild polls:', error);
      return [];
    }
  }

  /**
   * Check if user meets poll restrictions
   */
  private async checkRestrictions(
    poll: PollData,
    member: GuildMember
  ): Promise<{ passed: boolean; reason?: string }> {
    for (const restriction of poll.restrictions) {
      switch (restriction.type) {
        case 'role':
          if (!member.roles.cache.has(restriction.value as string)) {
            return { passed: false, reason: 'Missing required role' };
          }
          break;

        case 'level': {
          const userLevel = await this.getUserLevel(member.id, member.guild.id);

          if (userLevel < (restriction.value as number)) {
            return { passed: false, reason: `Minimum level ${restriction.value} required` };
          }
          break;
        }

        case 'age': {
          const accountAge = Date.now() - member.user.createdTimestamp;
          const requiredAge = (restriction.value as number) * 24 * 60 * 60 * 1000; // days to ms

          if (accountAge < requiredAge) {
            return { passed: false, reason: `Account must be ${restriction.value} days old` };
          }
          break;
        }

        case 'messages': {
          const messageCount = await this.getUserMessageCount(member.id, member.guild.id);

          if (messageCount < (restriction.value as number)) {
            return { passed: false, reason: `Minimum ${restriction.value} messages required` };
          }
          break;
        }
      }
    }

    return { passed: true };
  }

  /**
   * Validate vote options
   */
  private validateVoteOptions(poll: PollData, optionIds: string[]): { valid: boolean; reason?: string } {
    if (optionIds.length === 0) {
      return { valid: false, reason: 'No options selected' };
    }

    // Check if all option IDs exist
    for (const optionId of optionIds) {
      if (!poll.options.find(o => o.id === optionId)) {
        return { valid: false, reason: 'Invalid option selected' };
      }
    }

    // Check multiple choice restrictions
    if (!poll.settings.multipleChoice && optionIds.length > 1) {
      return { valid: false, reason: 'Multiple choices not allowed' };
    }

    // Check max choices limit
    if (poll.settings.maxChoices && optionIds.length > poll.settings.maxChoices) {
      return { valid: false, reason: `Maximum ${poll.settings.maxChoices} choices allowed` };
    }

    return { valid: true };
  }

  /**
   * Remove previous votes from a user
   */
  private removePreviousVotes(poll: PollData, userId: string): void {
    for (const option of poll.options) {
      const voterIndex = option.voters.indexOf(userId);

      if (voterIndex !== -1) {
        option.voters.splice(voterIndex, 1);
        option.votes = Math.max(0, option.votes - 1);
      }
    }
  }

  /**
   * Calculate poll results and statistics
   */
  private calculateResults(poll: PollData): PollResults {
    const totalVotes = poll.totalVotes;
    const results = {
      pollId: poll.id,
      title: poll.title,
      type: poll.type,
      totalVotes,
      totalParticipants: poll.participants.length,
      ended: poll.ended,
      options: poll.options.map(option => ({
        id: option.id,
        text: option.text,
        emoji: option.emoji,
        votes: option.votes,
        percentage: totalVotes > 0 ? Math.round((option.votes / totalVotes) * 100) : 0,
        voters: poll.settings.anonymous ? [] : option.voters
      })),
      winner: null as any,
      createdAt: poll.createdAt,
      endedAt: poll.ended ? new Date() : null
    };

    // Determine winner(s)
    if (totalVotes > 0) {
      const maxVotes = Math.max(...poll.options.map(o => o.votes));
      const winners = poll.options.filter(o => o.votes === maxVotes);
      
      if (winners.length === 1) {
        results.winner = {
          option: winners[0],
          type: 'single'
        };
      } else if (winners.length > 1) {
        results.winner = {
          options: winners,
          type: 'tie'
        };
      }
    }

    return results;
  }

  /**
   * Create poll embed
   */
  private createPollEmbed(poll: PollData, guildId: string): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.primary)
      .setTitle(`📊 ${poll.title}`)
      .setDescription(poll.description || i18n.t('polls.embed.description', guildId))
      .setTimestamp();

    // Add poll options
    if (poll.options.length > 0) {
      const optionsText = poll.options.map((option, index) => {
        const emoji = option.emoji || `${index + 1}️⃣`;
        const percentage = poll.totalVotes > 0 ? Math.round((option.votes / poll.totalVotes) * 100) : 0;
        const progressBar = this.createProgressBar(percentage);
        
        return `${emoji} **${option.text}**\n${progressBar} ${option.votes ?? 0} ${i18n.t('polls.embed.votes_label', guildId)} (${percentage}%)`;
      }).join('\n\n');

      embed.addFields({
        name: i18n.t('polls.embed.options', guildId),
        value: optionsText,
        inline: false
      });
    }

    // Add poll info
    embed.addFields(
      {
        name: i18n.t('polls.embed.type', guildId),
        value: i18n.t(`polls.types.${poll.type}`, guildId),
        inline: true
      },
      {
        name: i18n.t('polls.embed.total_votes', guildId),
        value: poll.totalVotes.toString(),
        inline: true
      },
      {
        name: i18n.t('polls.embed.participants', guildId),
        value: poll.participants.length.toString(),
        inline: true
      }
    );

    if (poll.endsAt && !poll.ended) {
      embed.addFields({
        name: i18n.t('polls.embed.ends', guildId),
        value: `<t:${Math.floor(poll.endsAt.getTime() / 1000)}:R>`,
        inline: false
      });
    }

    if (poll.ended) {
      embed.setColor(botConfig.colors.success);
      embed.addFields({
        name: i18n.t('polls.embed.status', guildId),
        value: i18n.t('polls.status.ended', guildId),
        inline: false
      });
    }

    if (this.client.user?.displayAvatarURL()) {
      embed.setFooter({
        text: i18n.t('polls.embed.footer', guildId, { id: poll.id }),
        iconURL: this.client.user.displayAvatarURL()
      });
    } else {
      embed.setFooter({
        text: i18n.t('polls.embed.footer', guildId, { id: poll.id })
      });
    }

    return embed;
  }

  /**
   * Create poll interaction components
   */
  private createPollComponents(poll: PollData, guildId: string): PollActionRow[] {
    const components: PollActionRow[] = [];

    if (poll.ended) {
      // Show results button only
      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`poll_results_${poll.id}`)
            .setLabel(i18n.t('polls.buttons.results', guildId))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📊')
        );

      components.push(row);

      return components;
    }

    switch (poll.type) {
      case 'simple':
      case 'multiple':
        // Use buttons for simple polls (max 5 options)
        if (poll.options.length <= 5) {
          const buttonRows = this.createButtonRows(poll, guildId);

          components.push(...buttonRows);
        } else {
          // Use dropdown for more options
          const dropdown = this.createDropdownMenu(poll, guildId);

          components.push(dropdown);
        }
        break;

      case 'dropdown': {
        const dropdown = this.createDropdownMenu(poll, guildId);

        components.push(dropdown);
        break;
      }

      case 'ranking': {
        // Special ranking interface (simplified for now)
        const rankingDropdown = this.createRankingDropdown(poll, guildId);

        components.push(rankingDropdown);
        break;
      }
    }

    // Add control buttons
    const controlRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`poll_results_${poll.id}`)
          .setLabel(i18n.t('polls.buttons.results', guildId))
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📊'),
        new ButtonBuilder()
          .setCustomId(`poll_info_${poll.id}`)
          .setLabel(i18n.t('polls.buttons.info', guildId))
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('ℹ️')
      );

    components.push(controlRow);

    return components;
  }

  /**
   * Create button rows for voting
   */
  private createButtonRows(poll: PollData, _guildId: string): ActionRowBuilder<ButtonBuilder>[] {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    const buttonsPerRow = 5;

    for (let i = 0; i < poll.options.length; i += buttonsPerRow) {
      const row = new ActionRowBuilder<ButtonBuilder>();
      const optionsSlice = poll.options.slice(i, i + buttonsPerRow);

      for (const option of optionsSlice) {
        const button = new ButtonBuilder()
          .setCustomId(`poll_vote_${poll.id}_${option.id}`)
          .setLabel(option.text.substring(0, 80)) // Discord limit
          .setStyle(ButtonStyle.Primary);

        if (option.emoji) {
          button.setEmoji(option.emoji);
        }

        row.addComponents(button);
      }

      rows.push(row);
    }

    return rows;
  }

  /**
   * Create dropdown menu for voting
   */
  private createDropdownMenu(poll: PollData, guildId: string): ActionRowBuilder<StringSelectMenuBuilder> {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`poll_dropdown_${poll.id}`)
      .setPlaceholder(i18n.t('polls.dropdown.placeholder', guildId))
      .setMinValues(1)
      .setMaxValues(poll.settings.multipleChoice ? Math.min(poll.options.length, poll.settings.maxChoices || 25) : 1);

    for (const option of poll.options.slice(0, 25)) { // Discord limit
      const selectOption = new StringSelectMenuOptionBuilder()
        .setLabel(option.text.substring(0, 100)) // Discord limit
        .setValue(option.id);

      if (option.emoji) {
        selectOption.setEmoji(option.emoji);
      }

      selectMenu.addOptions(selectOption);
    }

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
  }

  /**
   * Create ranking dropdown (simplified)
   */
  private createRankingDropdown(poll: PollData, guildId: string): ActionRowBuilder<StringSelectMenuBuilder> {
    // For now, treat as multiple choice dropdown
    // In a full implementation, this would have a more complex ranking interface
    return this.createDropdownMenu(poll, guildId);
  }

  /**
   * Create progress bar for vote visualization
   */
  private createProgressBar(percentage: number, length: number = 10): string {
    const filled = Math.round((percentage / 100) * length);
    const empty = length - filled;

    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  /**
   * Format results as CSV
   */
  private formatResultsAsCSV(results: PollResults): string {
    let csv = 'Option,Votes,Percentage\n';

    for (const option of results.options) {
      csv += `"${option.text}",${option.votes},${option.percentage}%\n`;
    }

    return csv;
  }

  /**
   * Format results as text
   */
  private formatResultsAsText(results: PollResults): string {
    let text = `Poll Results: ${results.title}\n`;

    text += `Total Votes: ${results.totalVotes}\n`;
    text += `Total Participants: ${results.totalParticipants}\n\n`;
    
    for (const option of results.options) {
      text += `${option.text}: ${option.votes} votes (${option.percentage}%)\n`;
    }
    
    return text;
  }

  // Helper methods
  private generatePollId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  private rowToPollData(row: any): PollData {
    const options = Array.isArray(row.options) ? row.options : [];
    const settings = row.settings && typeof row.settings === 'object' ? row.settings : {};
    const restrictions = Array.isArray(row.restrictions) ? row.restrictions : [];
    const participants = Array.isArray(row.participants) ? row.participants : [];
    const totalVotes = options.reduce((sum: number, o: any) => sum + (o.votes || 0), 0);

    return {
      id: row.id,
      guildId: row.guildId,
      channelId: row.channelId,
      messageId: row.messageId ?? undefined,
      title: row.question,
      description: row.description ?? undefined,
      type: (row.type as PollType) || 'simple',
      options: options.map((o: any) => ({
        id: o.id || `opt_${Math.random()}`,
        text: o.text || String(o),
        emoji: o.emoji,
        votes: o.votes || 0,
        voters: Array.isArray(o.voters) ? o.voters : [],
      })),
      settings: {
        anonymous: settings.anonymous ?? row.anonymous ?? false,
        multipleChoice: settings.multipleChoice ?? false,
        maxChoices: settings.maxChoices,
        showResults: settings.showResults ?? 'always',
        allowChangeVote: settings.allowChangeVote ?? true,
      },
      restrictions,
      hostId: row.creatorId ?? '',
      endsAt: row.endTime ?? undefined,
      ended: !row.active,
      totalVotes,
      participants,
      createdAt: row.createdAt,
    };
  }

  private async getActivePolls(): Promise<PollData[]> {
    const rows = await this.prisma.poll.findMany({ where: { active: true } });
    return rows.map(r => this.rowToPollData(r));
  }

  async getActivePollCount(guildId: string): Promise<number> {
    return this.prisma.poll.count({ where: { guildId, active: true } });
  }

  async getGuildPolls(guildId: string): Promise<PollData[]> {
    const rows = await this.prisma.poll.findMany({
      where: { guildId },
      orderBy: { createdAt: 'desc' }
    });
    return rows.map(r => this.rowToPollData(r));
  }

  private async getPoll(id: string): Promise<PollData | null> {
    const row = await this.prisma.poll.findUnique({ where: { id } });
    if (!row) return null;
    return this.rowToPollData(row);
  }

  private async savePoll(poll: PollData): Promise<void> {
    await this.prisma.poll.upsert({
      where: { id: poll.id },
      create: {
        id: poll.id,
        guildId: poll.guildId,
        channelId: poll.channelId,
        messageId: poll.messageId,
        creatorId: poll.hostId,
        question: poll.title,
        description: poll.description,
        type: poll.type,
        options: poll.options as any,
        settings: poll.settings as any,
        restrictions: poll.restrictions as any,
        participants: poll.participants as any,
        anonymous: poll.settings.anonymous,
        endTime: poll.endsAt,
        active: !poll.ended,
      },
      update: {
        messageId: poll.messageId,
        options: poll.options as any,
        settings: poll.settings as any,
        restrictions: poll.restrictions as any,
        participants: poll.participants as any,
        anonymous: poll.settings.anonymous,
        endTime: poll.endsAt,
        active: !poll.ended,
      }
    });
  }

  private async updatePoll(poll: PollData): Promise<void> {
    await this.prisma.poll.update({
      where: { id: poll.id },
      data: {
        options: poll.options as any,
        participants: poll.participants as any,
        active: !poll.ended,
        endTime: poll.endsAt,
        messageId: poll.messageId,
      }
    });
  }

  private async updatePollMessage(poll: PollData, ended: boolean = false): Promise<void> {
    try {
      if (!poll.messageId) return;
      const guild = this.client.guilds.cache.get(poll.guildId);
      if (!guild) return;
      const channel = guild.channels.cache.get(poll.channelId) as TextChannel;
      if (!channel) return;
      const message = await channel.messages.fetch(poll.messageId).catch(() => null);
      if (!message) return;
      const embed = this.createPollEmbed(poll, poll.guildId);
      const components = this.createPollComponents(poll, poll.guildId);
      await message.edit({ embeds: [embed], components });
    } catch (error) {
      logger.error('Failed to update poll message:', error);
    }
  }

  private async sendPollResults(_poll: PollData): Promise<void> {
    // Results are shown in the updated poll message; no separate summary needed
  }

  private schedulePollEnd(poll: PollData): void {
    if (!poll.endsAt) return;

    const timeUntilEnd = poll.endsAt.getTime() - Date.now();
    
    if (timeUntilEnd <= 0) {
      // End immediately if already past end time
      this.endPoll(poll.id);

      return;
    }

    const timeout = setTimeout(() => {
      this.endPoll(poll.id);
    }, timeUntilEnd);

    this.activePolls.set(poll.id, timeout);
  }

  private async getUserLevel(_userId: string, _guildId: string): Promise<number> {
    // Placeholder - would integrate with LevelService
    return 1;
  }

  private async getUserMessageCount(_userId: string, _guildId: string): Promise<number> {
    // Placeholder - would get from database
    return 0;
  }
}
