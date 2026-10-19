import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Colors,
  EmbedBuilder,
  Guild,
  GuildMember
} from 'discord.js';
import { KorexClient } from '../client/KorexClient';
import { i18n } from './i18n';
import { STATS_WINDOW_DAYS } from '../services/UserStatsService';

/**
 * Embeds and buttons shared by /stats and its buttons (StatsComponents).
 * All data comes from UserStatsService (log_entries, 30-day retention,
 * and guild_users for all-time totals).
 */

export type StatsPeriod = '7d' | '30d' | '90d' | 'all';

export function normalizeStatsPeriod(value: string | null | undefined): StatsPeriod {
  return value === '7d' || value === '90d' || value === 'all' ? value : '30d';
}

export function statsPeriodLabel(period: StatsPeriod, guildId: string): string {
  return i18n.t(`stats.periods.${period}`, guildId);
}

/** Joins non-null lines respecting a field's 1024-character limit */
function joinLines(lines: Array<string | null>): string {
  const text = lines.filter((l): l is string => !!l).join('\n') || '—';

  return text.length > 1024 ? `${text.slice(0, 1021)}...` : text;
}

function line(key: string, guildId: string, value: string): string {
  return i18n.t(`stats.lines.${key}`, guildId, { value });
}

function hour(h: number): string {
  return String(h).padStart(2, '0');
}

function windowFooter(guildId: string, days: number = STATS_WINDOW_DAYS): string {
  return i18n.t('stats.window_footer', guildId, { days: days.toString() });
}

/** Buttons under /stats user */
export function buildUserStatsButtons(guildId: string, userId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`stats_activity_${userId}`)
      .setLabel(i18n.t('stats.buttons.activity', guildId))
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📊'),
    new ButtonBuilder()
      .setCustomId(`stats_channels_${userId}`)
      .setLabel(i18n.t('stats.buttons.channels', guildId))
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📁'),
    new ButtonBuilder()
      .setCustomId(`stats_compare_${userId}`)
      .setLabel(i18n.t('stats.buttons.compare', guildId))
      .setStyle(ButtonStyle.Success)
      .setEmoji('⚖️')
  );
}

/** Buttons under /stats server */
export function buildServerStatsButtons(guildId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
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
}

/** A user's activity breakdown (/stats activity and the Activity button) */
export async function buildActivityEmbed(client: KorexClient, member: GuildMember, period: StatsPeriod): Promise<EmbedBuilder> {
  const guildId = member.guild.id;
  // log_entries only keeps 30 days: 90d / all use the whole available window
  // and add the all-time totals from guild_users.
  const days = period === '7d' ? 7 : STATS_WINDOW_DAYS;
  const extended = period === '90d' || period === 'all';
  const userStats = await client.userStats.getUserStats(member.id, guildId, days);

  const embed = new EmbedBuilder()
    .setColor(Colors.Purple)
    .setTitle(i18n.t('stats.activity.title', guildId, {
      user: member.displayName,
      period: statsPeriodLabel(period, guildId)
    }))
    .setThumbnail(member.user.displayAvatarURL())
    .setFooter({
      text: extended
        ? i18n.t('stats.activity.retention_note', guildId, { days: STATS_WINDOW_DAYS.toString() })
        : windowFooter(guildId, days)
    })
    .setTimestamp();

  if (userStats && userStats.recentMessages > 0) {
    // Top 5 hours (UTC) with the most messages
    const hourlyActivity = Object.entries(userStats.activityByHour)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([h, count]) => i18n.t('stats.activity.hour_line', guildId, {
        hour: hour(Number(h)),
        count: count.toLocaleString()
      }));

    // Weekly pattern (Monday → Sunday)
    const dailyActivity = [1, 2, 3, 4, 5, 6, 0]
      .filter(day => userStats.activityByDay[day])
      .map(day => `${i18n.t(`stats.activity.weekdays.${day}`, guildId)}: ${userStats.activityByDay[day].toLocaleString()}`);

    embed.addFields(
      {
        name: i18n.t('stats.activity.hourly.title_utc', guildId),
        value: joinLines(hourlyActivity),
        inline: true
      },
      {
        name: i18n.t('stats.activity.daily.title', guildId),
        value: joinLines(dailyActivity),
        inline: true
      },
      {
        name: i18n.t('stats.activity.summary.title', guildId),
        value: joinLines([
          line('messages', guildId, userStats.recentMessages.toLocaleString()),
          userStats.peakActivityHour !== null ? line('peak_hour', guildId, hour(userStats.peakActivityHour)) : null,
          line('daily_average', guildId, userStats.averageMessagesPerDay.toFixed(1)),
          i18n.t('stats.lines.active_days', guildId, { value: userStats.activeDays.toString(), days: days.toString() }),
          line('current_streak', guildId, userStats.currentStreak.toString())
        ]),
        inline: false
      }
    );
  } else {
    embed.setDescription(i18n.t('stats.activity.no_data', guildId));
  }

  if (extended && userStats && (userStats.lifetimeMessages !== null || userStats.lifetimeVoiceMinutes !== null)) {
    embed.addFields({
      name: i18n.t('stats.activity.lifetime_title', guildId),
      value: joinLines([
        userStats.lifetimeMessages !== null ? line('messages', guildId, userStats.lifetimeMessages.toLocaleString()) : null,
        userStats.lifetimeVoiceMinutes !== null
          ? line('voice_time', guildId, client.userStats.formatDuration(userStats.lifetimeVoiceMinutes))
          : null
      ]),
      inline: false
    });
  }

  return embed;
}

/** Comparison with the server average (/stats compare and the Compare button) */
export async function buildCompareEmbed(client: KorexClient, member: GuildMember): Promise<EmbedBuilder> {
  const guildId = member.guild.id;
  const comparison = await client.userStats.getUserActivityComparison(member.id, guildId);
  const fmt = (m: number) => client.userStats.formatDuration(m);

  const embed = new EmbedBuilder()
    .setColor(comparison?.aboveAverage ? Colors.Green : Colors.Orange)
    .setTitle(i18n.t('stats.compare.title', guildId, { user: member.displayName }))
    .setThumbnail(member.user.displayAvatarURL())
    .setFooter({ text: windowFooter(guildId) })
    .setTimestamp();

  if (!comparison) {
    embed.setDescription(i18n.t('stats.compare.no_data', guildId));

    return embed;
  }

  const data = comparison.comparisonData;
  const status = (above: boolean) => above ?
    i18n.t('stats.compare.above', guildId) :
    i18n.t('stats.compare.below', guildId);

  embed.addFields(
    {
      name: i18n.t('stats.compare.ranking.title', guildId),
      value: i18n.t('stats.compare.ranking.value', guildId, {
        rank: comparison.userRank.toString(),
        total: comparison.totalUsers.toString(),
        percentile: comparison.topPercent.toString()
      }),
      inline: false
    },
    {
      name: i18n.t('stats.compare.messages.title', guildId),
      value: i18n.t('stats.compare.messages.value', guildId, {
        user: data.userMessages.toLocaleString(),
        average: data.averageMessages.toLocaleString(),
        difference: Math.abs(data.userMessages - data.averageMessages).toLocaleString(),
        status: status(data.userMessages > data.averageMessages)
      }),
      inline: true
    },
    {
      name: i18n.t('stats.compare.voice.title', guildId),
      value: i18n.t('stats.compare.voice.value', guildId, {
        user: fmt(data.userVoiceTime),
        average: fmt(data.averageVoiceTime),
        status: status(data.userVoiceTime > data.averageVoiceTime)
      }),
      inline: true
    },
    {
      name: i18n.t('stats.compare.streak.title', guildId),
      value: i18n.t('stats.compare.streak.value', guildId, {
        user: data.userStreak.toString(),
        average: data.averageStreak.toString(),
        status: status(data.userStreak > data.averageStreak)
      }),
      inline: true
    }
  );

  embed.setDescription(comparison.aboveAverage ?
    i18n.t('stats.compare.overall.above', guildId) :
    i18n.t('stats.compare.overall.below', guildId));

  return embed;
}

/** A user's most used channels (Channels button of /stats user) */
export async function buildUserChannelsEmbed(client: KorexClient, member: GuildMember): Promise<EmbedBuilder> {
  const guildId = member.guild.id;
  const breakdown = await client.userStats.getChannelBreakdown(guildId, member.id, 10);

  const embed = new EmbedBuilder()
    .setColor(Colors.Blue)
    .setTitle(i18n.t('stats.channels.user_title', guildId, { user: member.displayName }))
    .setThumbnail(member.user.displayAvatarURL())
    .setFooter({ text: windowFooter(guildId) })
    .setTimestamp();

  addChannelBreakdownFields(client, embed, breakdown, guildId);

  return embed;
}

/** The server's most active channels (Channels button of /stats server) */
export async function buildServerChannelsEmbed(client: KorexClient, guild: Guild): Promise<EmbedBuilder> {
  const breakdown = await client.userStats.getChannelBreakdown(guild.id, null, 10);

  const embed = new EmbedBuilder()
    .setColor(Colors.Blue)
    .setTitle(i18n.t('stats.channels.server_title', guild.id, { server: guild.name }))
    .setThumbnail(guild.iconURL())
    .setFooter({ text: windowFooter(guild.id) })
    .setTimestamp();

  addChannelBreakdownFields(client, embed, breakdown, guild.id);

  return embed;
}

function addChannelBreakdownFields(
  client: KorexClient,
  embed: EmbedBuilder,
  breakdown: { text: Array<{ channelId: string; messages: number }>; voice: Array<{ channelId: string; minutes: number }> },
  guildId: string
): void {
  if (breakdown.text.length === 0 && breakdown.voice.length === 0) {
    embed.setDescription(i18n.t('stats.channels.no_data', guildId));

    return;
  }

  const label = i18n.t('stats.leaderboard.messages.label', guildId);

  if (breakdown.text.length > 0) {
    embed.addFields({
      name: i18n.t('stats.channels.text_title', guildId),
      value: joinLines(breakdown.text.map((c, i) => `${i + 1}. <#${c.channelId}>: ${c.messages.toLocaleString()} ${label}`)),
      inline: true
    });
  }

  if (breakdown.voice.length > 0) {
    embed.addFields({
      name: i18n.t('stats.channels.voice_title', guildId),
      value: joinLines(breakdown.voice.map((c, i) => `${i + 1}. <#${c.channelId}>: ${client.userStats.formatDuration(c.minutes)}`)),
      inline: true
    });
  }
}

/** Detailed server statistics (Detailed button of /stats server) */
export async function buildServerDetailedEmbed(client: KorexClient, guild: Guild): Promise<EmbedBuilder> {
  const guildId = guild.id;
  const [pattern, overview] = await Promise.all([
    client.userStats.getGuildActivityPattern(guildId),
    client.userStats.getGuildStatsOverview(guildId, guild.memberCount)
  ]);

  const embed = new EmbedBuilder()
    .setColor(Colors.Green)
    .setTitle(i18n.t('stats.detailed.title', guildId, { server: guild.name }))
    .setThumbnail(guild.iconURL())
    .setFooter({ text: windowFooter(guildId) })
    .setTimestamp();

  if (pattern.totalMessages === 0) {
    embed.setDescription(i18n.t('stats.detailed.no_data', guildId));

    return embed;
  }

  const topHours = Object.entries(pattern.byHour)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([h, count]) => i18n.t('stats.activity.hour_line', guildId, { hour: hour(Number(h)), count: count.toLocaleString() }));

  const weekly = [1, 2, 3, 4, 5, 6, 0]
    .filter(day => pattern.byDay[day])
    .map(day => `${i18n.t(`stats.activity.weekdays.${day}`, guildId)}: ${pattern.byDay[day].toLocaleString()}`);

  const activeDays = Math.max(1, pattern.activeDays);

  embed.addFields(
    { name: i18n.t('stats.activity.hourly.title_utc', guildId), value: joinLines(topHours), inline: true },
    { name: i18n.t('stats.activity.daily.title', guildId), value: joinLines(weekly), inline: true },
    {
      name: i18n.t('stats.activity.summary.title', guildId),
      value: joinLines([
        line('messages', guildId, pattern.totalMessages.toLocaleString()),
        line('daily_average', guildId, (pattern.totalMessages / activeDays).toFixed(1)),
        i18n.t('stats.lines.active_days', guildId, { value: pattern.activeDays.toString(), days: STATS_WINDOW_DAYS.toString() }),
        overview ? line('active_users', guildId, overview.activeUsers.toLocaleString()) : null,
        overview ? line('per_user_messages', guildId, overview.averageMessagesPerUser.toLocaleString()) : null,
        overview ? line('voice_time', guildId, client.userStats.formatDuration(overview.totalVoiceTime)) : null
      ]),
      inline: false
    }
  );

  return embed;
}

/** Member growth (Growth button of /stats server) */
export async function buildServerGrowthEmbed(client: KorexClient, guild: Guild): Promise<EmbedBuilder> {
  const guildId = guild.id;
  const weeks = await client.userStats.getGuildGrowth(guildId);
  const joins = weeks.reduce((s, w) => s + w.joins, 0);
  const leaves = weeks.reduce((s, w) => s + w.leaves, 0);
  const net = joins - leaves;
  const base = guild.memberCount - net;
  const growthRate = base > 0 ? (net / base) * 100 : null;
  const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;

  const embed = new EmbedBuilder()
    .setColor(net >= 0 ? Colors.Green : Colors.Orange)
    .setTitle(i18n.t('stats.growth.title', guildId, { server: guild.name }))
    .setThumbnail(guild.iconURL())
    .setFooter({ text: windowFooter(guildId) })
    .setTimestamp();

  embed.addFields({
    name: i18n.t('stats.server.members_title', guildId),
    value: joinLines([
      line('members_now', guildId, guild.memberCount.toLocaleString()),
      line('joins', guildId, joins.toLocaleString()),
      line('leaves', guildId, leaves.toLocaleString()),
      line('net', guildId, signed(net)),
      growthRate !== null ? line('growth', guildId, `${growthRate > 0 ? '+' : ''}${growthRate.toFixed(1)}`) : null
    ]),
    inline: true
  });

  if (weeks.length > 0) {
    embed.addFields({
      name: i18n.t('stats.growth.weekly_title', guildId),
      value: joinLines(weeks.map(w => i18n.t('stats.growth.week_line', guildId, {
        week: w.week,
        joins: w.joins.toString(),
        leaves: w.leaves.toString(),
        net: signed(w.joins - w.leaves)
      }))),
      inline: true
    });
  } else {
    embed.setDescription(i18n.t('stats.growth.no_data', guildId));
  }

  return embed;
}
