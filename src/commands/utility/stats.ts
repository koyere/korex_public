import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  Colors,
  GuildMember,
  SlashCommandSubcommandsOnlyBuilder
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { STATS_WINDOW_DAYS } from '../../services/UserStatsService';
import {
  buildActivityEmbed,
  buildCompareEmbed,
  buildServerStatsButtons,
  buildUserStatsButtons,
  normalizeStatsPeriod
} from '../../utils/statsEmbeds';

export default class StatsCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'stats',
      description: 'View detailed user and server statistics',
      category: 'utility',
      cooldown: 10,
      permissions: {
        user: [],
        bot: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]
      }
    });
  }

  data(): SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription('View detailed user and server statistics')
      .addSubcommand(subcommand =>
        subcommand
          .setName('user')
          .setDescription('View user statistics')
          .addUserOption(option =>
            option
              .setName('user')
              .setDescription('User to view statistics for (defaults to yourself)')
              .setRequired(false)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('server')
          .setDescription('View server statistics')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('channel')
          .setDescription('View channel statistics')
          .addChannelOption(option =>
            option
              .setName('channel')
              .setDescription('Channel to view statistics for (defaults to current channel)')
              .setRequired(false)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('leaderboard')
          .setDescription('View server leaderboards')
          .addStringOption(option =>
            option
              .setName('type')
              .setDescription('Type of leaderboard to display')
              .setRequired(true)
              .addChoices(
                { name: 'Messages', value: 'messages' },
                { name: 'Voice Time', value: 'voice' },
                { name: 'Activity Streak', value: 'streak' },
                { name: 'Daily Activity', value: 'daily' }
              )
          )
          .addIntegerOption(option =>
            option
              .setName('limit')
              .setDescription('Number of users to show (1-25)')
              .setMinValue(1)
              .setMaxValue(25)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('compare')
          .setDescription('Compare your stats with server averages')
          .addUserOption(option =>
            option
              .setName('user')
              .setDescription('User to compare (defaults to yourself)')
              .setRequired(false)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('activity')
          .setDescription('View detailed activity breakdown')
          .addUserOption(option =>
            option
              .setName('user')
              .setDescription('User to view activity for (defaults to yourself)')
              .setRequired(false)
          )
          .addStringOption(option =>
            option
              .setName('period')
              .setDescription('Time period to analyze')
              .addChoices(
                { name: 'Last 7 days', value: '7d' },
                { name: 'Last 30 days', value: '30d' },
                { name: 'Last 90 days', value: '90d' },
                { name: 'All time', value: 'all' }
              )
          )
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'user':
        await this.handleUserStats(interaction);
        break;
      case 'server':
        await this.handleServerStats(interaction);
        break;
      case 'channel':
        await this.handleChannelStats(interaction);
        break;
      case 'leaderboard':
        await this.handleLeaderboard(interaction);
        break;
      case 'compare':
        await this.handleCompare(interaction);
        break;
      case 'activity':
        await this.handleActivity(interaction);
        break;
    }
  }

  /** Member from cache or, if missing, from the API */
  private async resolveMember(interaction: ChatInputCommandInteraction, userId: string): Promise<GuildMember | null> {
    const guild = interaction.guild!;

    return guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
  }

  private windowFooter(guildId: string, days: number = STATS_WINDOW_DAYS): string {
    return i18n.t('stats.window_footer', guildId, { days: days.toString() });
  }

  /** Joins non-null lines respecting a field's 1024-character limit */
  private joinLines(lines: Array<string | null>): string {
    const text = lines.filter((l): l is string => !!l).join('\n') || '—';

    return text.length > 1024 ? `${text.slice(0, 1021)}...` : text;
  }

  private line(key: string, guildId: string, value: string): string {
    return i18n.t(`stats.lines.${key}`, guildId, { value });
  }

  private hour(h: number): string {
    return String(h).padStart(2, '0');
  }

  private async handleUserStats(interaction: ChatInputCommandInteraction): Promise<void> {
    const user = interaction.options.getUser('user') || interaction.user;
    const guildId = interaction.guild!.id;
    const member = await this.resolveMember(interaction, user.id);

    if (!member) {
      await interaction.reply({
        content: i18n.t('stats.user.not_found', guildId),
        ephemeral: true
      });

      return;
    }

    await interaction.deferReply();

    try {
      const statsEmbed = await this.client.userStats.generateUserStatsReport(member);

      // Buttons with more detail (StatsComponents)
      await interaction.editReply({
        embeds: [statsEmbed],
        components: [buildUserStatsButtons(guildId, user.id)]
      });

    } catch (error) {
      await interaction.editReply({
        content: i18n.t('stats.user.error', guildId)
      });
    }
  }

  private async handleServerStats(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild!;

    await interaction.deferReply();

    try {
      const statsEmbed = await this.client.userStats.generateGuildStatsReport(guild);

      // Navigation buttons (StatsComponents)
      await interaction.editReply({
        embeds: [statsEmbed],
        components: [buildServerStatsButtons(guild.id)]
      });

    } catch (error) {
      await interaction.editReply({
        content: i18n.t('stats.server.error', guild.id)
      });
    }
  }

  private async handleChannelStats(interaction: ChatInputCommandInteraction): Promise<void> {
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const guildId = interaction.guild!.id;

    if (!channel || (channel.type !== 0 && channel.type !== 2 && channel.type !== 13)) { // Text, Voice, Stage channels
      await interaction.reply({
        content: i18n.t('stats.channel.invalid', guildId),
        ephemeral: true
      });

      return;
    }

    await interaction.deferReply();

    try {
      const channelStats = await this.client.userStats.getChannelStats(channel.id, guildId);
      const createdAt: Date | null = (channel as any).createdAt ?? null;

      const embed = new EmbedBuilder()
        .setColor(Colors.Blue)
        .setTitle(i18n.t('stats.channel.title', guildId, { channel: (channel as any).name || channel.id }))
        .setFooter({ text: this.windowFooter(guildId) })
        .setTimestamp();

      if (channelStats) {
        if (channelStats.totalMessages > 0) {
          embed.addFields({
            name: i18n.t('stats.channel.messages.title', guildId),
            value: i18n.t('stats.channel.messages.value', guildId, {
              total: channelStats.totalMessages.toLocaleString(),
              daily: channelStats.averageMessagesPerDay.toString(),
              users: channelStats.uniqueUsers.toString()
            }),
            inline: true
          });
        }

        if (channelStats.voiceMinutes > 0) {
          embed.addFields({
            name: i18n.t('stats.channel.voice_title', guildId),
            value: this.joinLines([
              this.line('voice_time', guildId, this.formatDuration(channelStats.voiceMinutes)),
              this.line('unique_users', guildId, channelStats.voiceUsers.toString())
            ]),
            inline: true
          });
        }

        const info = [
          channelStats.peakActivityHour !== null ? this.line('peak_hour', guildId, this.hour(channelStats.peakActivityHour)) : null,
          createdAt ? this.line('created', guildId, `<t:${Math.floor(createdAt.getTime() / 1000)}:D>`) : null
        ];

        if (info.some(Boolean)) {
          embed.addFields({
            name: i18n.t('stats.channel.activity.title', guildId),
            value: this.joinLines(info),
            inline: true
          });
        }

        if (channelStats.mostActiveUsers.length > 0) {
          const topUsers = channelStats.mostActiveUsers
            .map((user, index) => `${index + 1}. <@${user.userId}>: ${user.messageCount.toLocaleString()}`);

          embed.addFields({
            name: i18n.t('stats.channel.top_users.title', guildId),
            value: this.joinLines(topUsers),
            inline: false
          });
        }

        if (channelStats.topVoiceUsers.length > 0) {
          const topVoice = channelStats.topVoiceUsers
            .map((user, index) => `${index + 1}. <@${user.userId}>: ${this.formatDuration(user.minutes)}`);

          embed.addFields({
            name: i18n.t('stats.server.top_voice_title', guildId),
            value: this.joinLines(topVoice),
            inline: false
          });
        }
      } else {
        embed.setDescription(i18n.t('stats.channel.no_data', guildId));
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      await interaction.editReply({
        content: i18n.t('stats.channel.error', guildId)
      });
    }
  }

  private async handleLeaderboard(interaction: ChatInputCommandInteraction): Promise<void> {
    const type = interaction.options.getString('type', true);
    const limit = interaction.options.getInteger('limit') || 10;
    const guildId = interaction.guild!.id;
    const stats = this.client.userStats;

    await interaction.deferReply();

    try {
      let leaderboardData: Array<{ userId: string; value: number }> = [];
      let title = '';
      let valueLabel = '';
      let footerKey = 'stats.leaderboard.footer_window';

      switch (type) {
        case 'messages':
          leaderboardData = (await stats.getTopUsersByMessages(guildId, limit))
            .map(u => ({ userId: u.userId, value: u.totalMessages }));
          title = i18n.t('stats.leaderboard.messages.title', guildId);
          valueLabel = i18n.t('stats.leaderboard.messages.label', guildId);
          break;

        case 'voice':
          leaderboardData = (await stats.getTopUsersByVoiceTime(guildId, limit))
            .map(u => ({ userId: u.userId, value: u.totalVoiceTime }));
          title = i18n.t('stats.leaderboard.voice.title', guildId);
          valueLabel = i18n.t('stats.leaderboard.voice.label', guildId);
          break;

        case 'streak':
          leaderboardData = (await stats.getTopUsersByStreak(guildId, limit))
            .map(u => ({ userId: u.userId, value: u.streak }));
          title = i18n.t('stats.leaderboard.streak.title', guildId);
          valueLabel = i18n.t('stats.leaderboard.streak.label', guildId);
          footerKey = 'stats.leaderboard.footer_streak';
          break;

        case 'daily':
          leaderboardData = (await stats.getTopUsersToday(guildId, limit))
            .map(u => ({ userId: u.userId, value: u.messages }));
          title = i18n.t('stats.leaderboard.daily.title', guildId);
          valueLabel = i18n.t('stats.leaderboard.daily.label_messages', guildId);
          footerKey = 'stats.leaderboard.footer_today';
          break;
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.Gold)
        .setTitle(title)
        .setTimestamp();

      if (leaderboardData.length > 0) {
        const leaderboardText = leaderboardData
          .map((entry, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
            const formattedValue = type === 'voice' ?
              this.formatDuration(entry.value) :
              entry.value.toLocaleString();

            return `${medal} <@${entry.userId}>: ${formattedValue} ${valueLabel}`.trimEnd();
          })
          .join('\n');

        embed.setDescription(leaderboardText.slice(0, 4096));
        embed.setFooter({
          text: i18n.t(footerKey, guildId, {
            count: leaderboardData.length.toString(),
            days: STATS_WINDOW_DAYS.toString()
          })
        });
      } else {
        embed.setDescription(i18n.t('stats.leaderboard.no_data', guildId));
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      await interaction.editReply({
        content: i18n.t('stats.leaderboard.error', guildId)
      });
    }
  }

  private async handleCompare(interaction: ChatInputCommandInteraction): Promise<void> {
    const user = interaction.options.getUser('user') || interaction.user;
    const guildId = interaction.guild!.id;
    const member = await this.resolveMember(interaction, user.id);

    if (!member) {
      await interaction.reply({
        content: i18n.t('stats.compare.user_not_found', guildId),
        ephemeral: true
      });

      return;
    }

    await interaction.deferReply();

    try {
      const embed = await buildCompareEmbed(this.client, member);

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      await interaction.editReply({
        content: i18n.t('stats.compare.error', guildId)
      });
    }
  }

  private async handleActivity(interaction: ChatInputCommandInteraction): Promise<void> {
    const user = interaction.options.getUser('user') || interaction.user;
    // log_entries keeps 30 days: 90d / all add the historical totals (see buildActivityEmbed)
    const period = normalizeStatsPeriod(interaction.options.getString('period'));
    const guildId = interaction.guild!.id;
    const member = await this.resolveMember(interaction, user.id);

    if (!member) {
      await interaction.reply({
        content: i18n.t('stats.activity.user_not_found', guildId),
        ephemeral: true
      });

      return;
    }

    await interaction.deferReply();

    try {
      const embed = await buildActivityEmbed(this.client, member, period);

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      await interaction.editReply({
        content: i18n.t('stats.activity.error', guildId)
      });
    }
  }

  private formatDuration(minutes: number): string {
    if (minutes < 60) {
      return `${minutes}m`;
    } else if (minutes < 1440) {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;

      return `${hours}h ${mins}m`;
    } else {
      const days = Math.floor(minutes / 1440);
      const hours = Math.floor((minutes % 1440) / 60);

      return `${days}d ${hours}h`;
    }
  }
}