import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  Colors,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  GuildMember,
  TextChannel,
  VoiceChannel,
  SlashCommandSubcommandsOnlyBuilder
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

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

  private async handleUserStats(interaction: ChatInputCommandInteraction): Promise<void> {
    const user = interaction.options.getUser('user') || interaction.user;
    const member = interaction.guild!.members.cache.get(user.id);
    const guildId = interaction.guild!.id;

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
      
      // Add interactive buttons for more details
      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`stats_activity_${user.id}`)
            .setLabel(i18n.t('stats.buttons.activity', guildId))
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📊'),
          new ButtonBuilder()
            .setCustomId(`stats_channels_${user.id}`)
            .setLabel(i18n.t('stats.buttons.channels', guildId))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📁'),
          new ButtonBuilder()
            .setCustomId(`stats_compare_${user.id}`)
            .setLabel(i18n.t('stats.buttons.compare', guildId))
            .setStyle(ButtonStyle.Success)
            .setEmoji('⚖️')
        );

      await interaction.editReply({
        embeds: [statsEmbed],
        components: [row]
      });

    } catch (error) {
      await interaction.editReply({
        content: i18n.t('stats.user.error', guildId)
      });
    }
  }

  private async handleServerStats(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild!;
    const guildId = guild.id;

    await interaction.deferReply();

    try {
      const statsEmbed = await this.client.userStats.generateGuildStatsReport(guild);
      
      // Add navigation buttons
      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('stats_server_detailed')
            .setLabel(i18n.t('stats.buttons.detailed', guildId))
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📈'),
          new ButtonBuilder()
            .setCustomId('stats_server_channels')
            .setLabel(i18n.t('stats.buttons.channels', guildId))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📁'),
          new ButtonBuilder()
            .setCustomId('stats_server_growth')
            .setLabel(i18n.t('stats.buttons.growth', guildId))
            .setStyle(ButtonStyle.Success)
            .setEmoji('📊')
        );

      await interaction.editReply({
        embeds: [statsEmbed],
        components: [row]
      });

    } catch (error) {
      await interaction.editReply({
        content: i18n.t('stats.server.error', guildId)
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
      
      const embed = new EmbedBuilder()
        .setColor(Colors.Blue)
        .setTitle(i18n.t('stats.channel.title', guildId, { channel: (channel as any).name || 'Unknown' }))
        .setTimestamp();

      if (channelStats) {
        embed.addFields(
          {
            name: i18n.t('stats.channel.messages.title', guildId),
            value: i18n.t('stats.channel.messages.value', guildId, {
              total: channelStats.totalMessages.toLocaleString(),
              daily: channelStats.averageMessagesPerDay.toString(),
              users: channelStats.uniqueUsers.toString()
            }),
            inline: true
          },
          {
            name: i18n.t('stats.channel.activity.title', guildId),
            value: i18n.t('stats.channel.activity.value', guildId, {
              peak: channelStats.peakActivityHour.toString(),
              created: channelStats.createdAt.toLocaleDateString()
            }),
            inline: true
          }
        );

        if (channelStats.mostActiveUsers.length > 0) {
          const topUsers = channelStats.mostActiveUsers
            .slice(0, 5)
            .map((user, index) => `${index + 1}. <@${user.userId}>: ${user.messageCount}`)
            .join('\n');

          embed.addFields({
            name: i18n.t('stats.channel.top_users.title', guildId),
            value: topUsers,
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

    await interaction.deferReply();

    try {
      let leaderboardData: Array<{ userId: string; value: number; rank: number }> = [];
      let title = '';
      let valueLabel = '';

      switch (type) {
        case 'messages':
          const messageLeaders = await this.client.userStats.getTopUsersByMessages(guildId, limit);

          leaderboardData = messageLeaders.map(user => ({
            userId: user.userId,
            value: user.totalMessages,
            rank: user.rank
          }));
          title = i18n.t('stats.leaderboard.messages.title', guildId);
          valueLabel = i18n.t('stats.leaderboard.messages.label', guildId);
          break;

        case 'voice':
          const voiceLeaders = await this.client.userStats.getTopUsersByVoiceTime(guildId, limit);

          leaderboardData = voiceLeaders.map(user => ({
            userId: user.userId,
            value: user.totalVoiceTime,
            rank: user.rank
          }));
          title = i18n.t('stats.leaderboard.voice.title', guildId);
          valueLabel = i18n.t('stats.leaderboard.voice.label', guildId);
          break;

        case 'streak':
          // Mock data for streaks
          leaderboardData = Array.from({ length: limit }, (_, i) => ({
            userId: `user${i + 1}`,
            value: Math.floor(Math.random() * 30) + 1,
            rank: i + 1
          }));
          title = i18n.t('stats.leaderboard.streak.title', guildId);
          valueLabel = i18n.t('stats.leaderboard.streak.label', guildId);
          break;

        case 'daily':
          // Mock data for daily activity
          leaderboardData = Array.from({ length: limit }, (_, i) => ({
            userId: `user${i + 1}`,
            value: Math.floor(Math.random() * 100) + 10,
            rank: i + 1
          }));
          title = i18n.t('stats.leaderboard.daily.title', guildId);
          valueLabel = i18n.t('stats.leaderboard.daily.label', guildId);
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

            return `${medal} <@${entry.userId}>: ${formattedValue} ${valueLabel}`;
          })
          .join('\n');

        embed.setDescription(leaderboardText);
        embed.setFooter({ 
          text: i18n.t('stats.leaderboard.footer', guildId, { 
            count: leaderboardData.length.toString(),
            type 
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
    const member = interaction.guild!.members.cache.get(user.id);
    const guildId = interaction.guild!.id;

    if (!member) {
      await interaction.reply({
        content: i18n.t('stats.compare.user_not_found', guildId),
        ephemeral: true
      });

      return;
    }

    await interaction.deferReply();

    try {
      const comparison = await this.client.userStats.getUserActivityComparison(user.id, guildId);
      
      const embed = new EmbedBuilder()
        .setColor(comparison?.aboveAverage ? Colors.Green : Colors.Orange)
        .setTitle(i18n.t('stats.compare.title', guildId, { user: member.displayName }))
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp();

      if (comparison) {
        embed.addFields(
          {
            name: i18n.t('stats.compare.ranking.title', guildId),
            value: i18n.t('stats.compare.ranking.value', guildId, {
              rank: comparison.userRank.toString(),
              total: comparison.totalUsers.toString(),
              percentile: comparison.percentile.toString()
            }),
            inline: false
          },
          {
            name: i18n.t('stats.compare.messages.title', guildId),
            value: i18n.t('stats.compare.messages.value', guildId, {
              user: comparison.comparisonData.userMessages.toLocaleString(),
              average: comparison.comparisonData.averageMessages.toLocaleString(),
              difference: Math.abs(comparison.comparisonData.userMessages - comparison.comparisonData.averageMessages).toLocaleString(),
              status: comparison.comparisonData.userMessages > comparison.comparisonData.averageMessages ? 
                i18n.t('stats.compare.above', guildId) : 
                i18n.t('stats.compare.below', guildId)
            }),
            inline: true
          },
          {
            name: i18n.t('stats.compare.voice.title', guildId),
            value: i18n.t('stats.compare.voice.value', guildId, {
              user: this.formatDuration(comparison.comparisonData.userVoiceTime),
              average: this.formatDuration(comparison.comparisonData.averageVoiceTime),
              status: comparison.comparisonData.userVoiceTime > comparison.comparisonData.averageVoiceTime ? 
                i18n.t('stats.compare.above', guildId) : 
                i18n.t('stats.compare.below', guildId)
            }),
            inline: true
          },
          {
            name: i18n.t('stats.compare.streak.title', guildId),
            value: i18n.t('stats.compare.streak.value', guildId, {
              user: comparison.comparisonData.userStreak.toString(),
              average: comparison.comparisonData.averageStreak.toString(),
              status: comparison.comparisonData.userStreak > comparison.comparisonData.averageStreak ? 
                i18n.t('stats.compare.above', guildId) : 
                i18n.t('stats.compare.below', guildId)
            }),
            inline: true
          }
        );

        // Add overall assessment
        const overallStatus = comparison.aboveAverage ? 
          i18n.t('stats.compare.overall.above', guildId) : 
          i18n.t('stats.compare.overall.below', guildId);
        
        embed.setDescription(overallStatus);
      } else {
        embed.setDescription(i18n.t('stats.compare.no_data', guildId));
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      await interaction.editReply({
        content: i18n.t('stats.compare.error', guildId)
      });
    }
  }

  private async handleActivity(interaction: ChatInputCommandInteraction): Promise<void> {
    const user = interaction.options.getUser('user') || interaction.user;
    const period = interaction.options.getString('period') || '30d';
    const member = interaction.guild!.members.cache.get(user.id);
    const guildId = interaction.guild!.id;

    if (!member) {
      await interaction.reply({
        content: i18n.t('stats.activity.user_not_found', guildId),
        ephemeral: true
      });

      return;
    }

    await interaction.deferReply();

    try {
      const userStats = await this.client.userStats.getUserStats(user.id, guildId);
      
      const embed = new EmbedBuilder()
        .setColor(Colors.Purple)
        .setTitle(i18n.t('stats.activity.title', guildId, { 
          user: member.displayName,
          period: this.getPeriodLabel(period, guildId)
        }))
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp();

      if (userStats) {
        // Activity by hour (mock data)
        const hourlyActivity = Object.entries(userStats.activityByHour)
          .sort(([a], [b]) => parseInt(a) - parseInt(b))
          .slice(0, 5)
          .map(([hour, count]) => `${hour}:00 - ${count} mensajes`)
          .join('\n');

        // Activity by day of week (mock data)
        const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        const dailyActivity = Object.entries(userStats.activityByDay)
          .map(([day, count]) => `${dayNames[parseInt(day)]}: ${count}`)
          .join('\n');

        embed.addFields(
          {
            name: i18n.t('stats.activity.hourly.title', guildId),
            value: hourlyActivity || i18n.t('stats.activity.no_data', guildId),
            inline: true
          },
          {
            name: i18n.t('stats.activity.daily.title', guildId),
            value: dailyActivity || i18n.t('stats.activity.no_data', guildId),
            inline: true
          },
          {
            name: i18n.t('stats.activity.summary.title', guildId),
            value: i18n.t('stats.activity.summary.value', guildId, {
              peak: userStats.peakActivityHour.toString(),
              average: userStats.averageMessagesPerDay.toFixed(1),
              streak: userStats.currentStreak.toString()
            }),
            inline: false
          }
        );
      } else {
        embed.setDescription(i18n.t('stats.activity.no_data', guildId));
      }

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

  private getPeriodLabel(period: string, guildId: string): string {
    switch (period) {
      case '7d': return i18n.t('stats.periods.7d', guildId);
      case '30d': return i18n.t('stats.periods.30d', guildId);
      case '90d': return i18n.t('stats.periods.90d', guildId);
      case 'all': return i18n.t('stats.periods.all', guildId);
      default: return i18n.t('stats.periods.30d', guildId);
    }
  }
}