import {
  Guild,
  GuildMember,
  Message,
  VoiceState,
  EmbedBuilder,
  Colors
} from 'discord.js';
import { Prisma } from '@prisma/client';
import { logger } from '../utils/Logger';
import { DatabaseManager } from '../client/managers/DatabaseManager';
import { i18n } from '../utils/i18n';

/**
 * Estadísticas de usuarios/servidor a partir de datos REALES:
 *  - log_entries (type 'message' | 'voice' | 'join' | 'leave'), retención 30 días
 *    → todo lo "reciente" es de los últimos 30 días. Fechas/horas en UTC.
 *  - guild_users (messages / voiceMinutes) → contadores históricos (LevelService).
 * El registro de la actividad lo hacen AnalyticsService (mensajes, joins/leaves)
 * y LevelService (sesiones de voz); este servicio solo consulta.
 */

/** Ventana máxima disponible (retención de log_entries) */
export const STATS_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface UserStats {
  userId: string;
  guildId: string;
  periodDays: number;
  /** Mensajes en el periodo (log_entries) */
  recentMessages: number;
  /** Minutos de voz en el periodo (log_entries) */
  recentVoiceMinutes: number;
  /** Canales de voz distintos usados en el periodo */
  voiceChannels: number;
  /** Contadores históricos de guild_users (null si no hay registro) */
  lifetimeMessages: number | null;
  lifetimeVoiceMinutes: number | null;
  /** Días distintos con mensajes en el periodo */
  activeDays: number;
  /** Días consecutivos con mensajes que terminan hoy o ayer (UTC) */
  currentStreak: number;
  /** Racha más larga dentro del periodo */
  longestStreak: number;
  averageMessagesPerDay: number;
  /** Hora UTC con más mensajes (null sin mensajes) */
  peakActivityHour: number | null;
  activityByHour: Record<number, number>; // hora UTC -> mensajes
  activityByDay: Record<number, number>; // día semana (0=domingo) -> mensajes
  lastActiveDate: Date | null;
}

export interface ChannelStats {
  channelId: string;
  guildId: string;
  totalMessages: number;
  uniqueUsers: number;
  averageMessagesPerDay: number;
  peakActivityHour: number | null;
  mostActiveUsers: Array<{ userId: string; messageCount: number }>;
  voiceMinutes: number;
  voiceUsers: number;
  topVoiceUsers: Array<{ userId: string; minutes: number }>;
}

export interface GuildStatsOverview {
  guildId: string;
  totalMessages: number;
  totalVoiceTime: number; // minutos
  activeUsers: number;
  averageMessagesPerUser: number;
  averageVoiceTimePerUser: number;
  mostActiveChannel: string | null; // channelId
  mostActiveVoiceChannel: string | null; // channelId
  peakActivityHour: number | null;
  joins: number;
  leaves: number;
  /** % de crecimiento neto sobre los miembros al inicio del periodo (null si no calculable) */
  growthRate: number | null;
  updatedAt: Date;
}

export interface ActivityComparison {
  userRank: number;
  totalUsers: number;
  /** % de usuarios activos por debajo del usuario */
  percentile: number;
  /** "Top X%" */
  topPercent: number;
  aboveAverage: boolean;
  comparisonData: {
    userMessages: number;
    averageMessages: number;
    userVoiceTime: number;
    averageVoiceTime: number;
    userStreak: number;
    averageStreak: number;
  };
}

export class UserStatsService {
  private static instance: UserStatsService;
  private logger = logger;
  private db: DatabaseManager;

  private constructor(db: DatabaseManager) {
    this.db = db;
  }

  public static getInstance(db?: DatabaseManager): UserStatsService {
    if (!UserStatsService.instance) {
      if (!db) {
        throw new Error('DatabaseManager is required for first initialization');
      }
      UserStatsService.instance = new UserStatsService(db);
    }

    return UserStatsService.instance;
  }

  private get prisma() {
    return this.db.prisma;
  }

  private since(days: number = STATS_WINDOW_DAYS): Date {
    return new Date(Date.now() - days * DAY_MS);
  }

  /** Fecha UTC (YYYY-MM-DD) desplazada `offset` días respecto a hoy */
  private utcDay(offset: number = 0): string {
    return new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);
  }

  /**
   * El tracking real lo hacen AnalyticsService (log_entries 'message') y
   * LevelService (log_entries 'voice'). Se mantienen por compatibilidad con los eventos.
   */
  public async handleMessage(_message: Message): Promise<void> {
    // no-op
  }

  public async handleVoiceStateUpdate(_oldState: VoiceState, _newState: VoiceState): Promise<void> {
    // no-op
  }

  /**
   * Estadísticas de un usuario en los últimos `days` días (máx. 30) + totales históricos.
   * Devuelve null si no hay ningún dato del usuario.
   */
  public async getUserStats(userId: string, guildId: string, days: number = STATS_WINDOW_DAYS): Promise<UserStats | null> {
    try {
      const periodDays = Math.min(Math.max(1, days), STATS_WINDOW_DAYS);
      const since = this.since(periodDays);
      const msgWhere = { guildId, userId, type: 'message', createdAt: { gte: since } };

      const [msgAgg, voiceRows, dayRows, hourRows, dowRows, guildUser] = await Promise.all([
        this.prisma.logEntry.aggregate({ where: msgWhere, _count: { _all: true }, _max: { createdAt: true } }),
        this.prisma.$queryRaw<Array<{ minutes: number | null; channels: number; last: Date | null }>>`
          SELECT COALESCE(SUM(("data"->>'minutes')::numeric), 0)::float8 AS minutes,
                 COUNT(DISTINCT "channelId")::int AS channels,
                 MAX("createdAt") AS last
          FROM log_entries
          WHERE "guildId" = ${guildId} AND "userId" = ${userId} AND type = 'voice' AND "createdAt" >= ${since}
        `,
        this.prisma.$queryRaw<Array<{ d: string }>>`
          SELECT DISTINCT to_char("createdAt", 'YYYY-MM-DD') AS d
          FROM log_entries
          WHERE "guildId" = ${guildId} AND "userId" = ${userId} AND type = 'message' AND "createdAt" >= ${since}
          ORDER BY d ASC
        `,
        this.prisma.$queryRaw<Array<{ k: number; c: number }>>`
          SELECT EXTRACT(HOUR FROM "createdAt")::int AS k, COUNT(*)::int AS c
          FROM log_entries
          WHERE "guildId" = ${guildId} AND "userId" = ${userId} AND type = 'message' AND "createdAt" >= ${since}
          GROUP BY 1
        `,
        this.prisma.$queryRaw<Array<{ k: number; c: number }>>`
          SELECT EXTRACT(DOW FROM "createdAt")::int AS k, COUNT(*)::int AS c
          FROM log_entries
          WHERE "guildId" = ${guildId} AND "userId" = ${userId} AND type = 'message' AND "createdAt" >= ${since}
          GROUP BY 1
        `,
        this.prisma.guildUser.findUnique({
          where: { guildId_userId: { guildId, userId } },
          select: { messages: true, voiceMinutes: true }
        })
      ]);

      const recentMessages = msgAgg._count._all;
      const recentVoiceMinutes = Math.round(Number(voiceRows[0]?.minutes ?? 0));

      if (!guildUser && recentMessages === 0 && recentVoiceMinutes === 0) return null;

      const activityByHour: Record<number, number> = {};

      for (const r of hourRows) activityByHour[Number(r.k)] = Number(r.c);
      const activityByDay: Record<number, number> = {};

      for (const r of dowRows) activityByDay[Number(r.k)] = Number(r.c);

      const { current, longest } = this.computeStreaks(dayRows.map(r => r.d));

      const lastMsg = msgAgg._max.createdAt;
      const lastVoice = voiceRows[0]?.last ?? null;
      const lastActiveDate = lastMsg && lastVoice
        ? (lastMsg > lastVoice ? lastMsg : lastVoice)
        : (lastMsg ?? lastVoice);

      return {
        userId,
        guildId,
        periodDays,
        recentMessages,
        recentVoiceMinutes,
        voiceChannels: Number(voiceRows[0]?.channels ?? 0),
        lifetimeMessages: guildUser?.messages ?? null,
        lifetimeVoiceMinutes: guildUser?.voiceMinutes ?? null,
        activeDays: dayRows.length,
        currentStreak: current,
        longestStreak: longest,
        averageMessagesPerDay: recentMessages / periodDays,
        peakActivityHour: this.peakOf(activityByHour),
        activityByHour,
        activityByDay,
        lastActiveDate
      };
    } catch (error) {
      this.logger.error('Error getting user stats:', error);

      return null;
    }
  }

  /** Rachas a partir de días UTC (YYYY-MM-DD) ordenados ascendentemente */
  private computeStreaks(days: string[]): { current: number; longest: number } {
    let longest = 0;
    let run = 0;
    let prev: number | null = null;

    for (const d of days) {
      const t = Date.parse(`${d}T00:00:00Z`);

      run = prev !== null && t - prev === DAY_MS ? run + 1 : 1;
      if (run > longest) longest = run;
      prev = t;
    }

    // La racha actual solo cuenta si el último día activo es hoy o ayer
    const last = days[days.length - 1];
    const current = last === this.utcDay(0) || last === this.utcDay(-1) ? run : 0;

    return { current, longest };
  }

  private peakOf(map: Record<number, number>): number | null {
    let peak: number | null = null;
    let max = 0;

    for (const [k, v] of Object.entries(map)) {
      if (v > max) {
        max = v;
        peak = Number(k);
      }
    }

    return peak;
  }

  /**
   * Racha actual (días consecutivos con mensajes hasta hoy/ayer, UTC) por usuario.
   * Gaps-and-islands en SQL; solo devuelve usuarios con racha > 0.
   */
  private async getCurrentStreaks(guildId: string, limit?: number): Promise<Array<{ userId: string; streak: number }>> {
    const since = this.since();
    const yesterday = this.utcDay(-1);
    const limitSql = limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<Array<{ userId: string; streak: number }>>`
      WITH days AS (
        SELECT DISTINCT "userId", ("createdAt")::date AS d
        FROM log_entries
        WHERE "guildId" = ${guildId} AND type = 'message' AND "userId" IS NOT NULL AND "createdAt" >= ${since}
      ), islands AS (
        SELECT "userId", d, d - (ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY d))::int AS g
        FROM days
      ), streaks AS (
        SELECT "userId", COUNT(*)::int AS streak, MAX(d) AS last_day
        FROM islands
        GROUP BY "userId", g
      )
      SELECT "userId", streak FROM streaks
      WHERE last_day >= ${yesterday}::date
      ORDER BY streak DESC, "userId" ASC
      ${limitSql}
    `;

    return rows.map(r => ({ userId: r.userId, streak: Number(r.streak) }));
  }

  /**
   * Compara al usuario con los usuarios activos (con mensajes) de los últimos 30 días.
   */
  public async getUserActivityComparison(userId: string, guildId: string): Promise<ActivityComparison | null> {
    try {
      const since = this.since();

      const [msgGroups, voiceAgg, streaks] = await Promise.all([
        this.prisma.logEntry.groupBy({
          by: ['userId'],
          where: { guildId, type: 'message', userId: { not: null }, createdAt: { gte: since } },
          _count: { _all: true }
        }),
        this.prisma.$queryRaw<Array<{ total: number | null; users: number; mine: number | null }>>`
          SELECT COALESCE(SUM(("data"->>'minutes')::numeric), 0)::float8 AS total,
                 COUNT(DISTINCT "userId")::int AS users,
                 COALESCE(SUM(("data"->>'minutes')::numeric) FILTER (WHERE "userId" = ${userId}), 0)::float8 AS mine
          FROM log_entries
          WHERE "guildId" = ${guildId} AND type = 'voice' AND "userId" IS NOT NULL AND "createdAt" >= ${since}
        `,
        this.getCurrentStreaks(guildId)
      ]);

      const counts = msgGroups.map(g => ({ userId: g.userId as string, count: g._count._all }));
      const mine = counts.find(c => c.userId === userId);

      // Sin mensajes del usuario en la ventana no hay ranking que mostrar
      if (!mine || counts.length === 0) return null;

      const totalUsers = counts.length;
      const userRank = counts.filter(c => c.count > mine.count).length + 1;
      const below = counts.filter(c => c.count < mine.count).length;
      const averageMessages = counts.reduce((s, c) => s + c.count, 0) / totalUsers;

      const voiceTotal = Number(voiceAgg[0]?.total ?? 0);
      const voiceUsers = Number(voiceAgg[0]?.users ?? 0);
      const userVoiceTime = Math.round(Number(voiceAgg[0]?.mine ?? 0));
      const averageVoiceTime = voiceUsers > 0 ? Math.round(voiceTotal / voiceUsers) : 0;

      // Media de racha actual sobre los usuarios activos (los sin racha cuentan 0)
      const streakSum = streaks.reduce((s, r) => s + r.streak, 0);
      const userStreak = streaks.find(s => s.userId === userId)?.streak ?? 0;

      return {
        userRank,
        totalUsers,
        percentile: Math.round((below / totalUsers) * 100),
        topPercent: Math.max(1, Math.ceil((userRank / totalUsers) * 100)),
        aboveAverage: mine.count > averageMessages,
        comparisonData: {
          userMessages: mine.count,
          averageMessages: Math.round(averageMessages),
          userVoiceTime,
          averageVoiceTime,
          userStreak,
          averageStreak: Math.round((streakSum / totalUsers) * 10) / 10
        }
      };
    } catch (error) {
      this.logger.error('Error getting user activity comparison:', error);

      return null;
    }
  }

  /**
   * Resumen del servidor (últimos 30 días). `memberCount` permite calcular el % de crecimiento.
   */
  public async getGuildStatsOverview(guildId: string, memberCount?: number): Promise<GuildStatsOverview | null> {
    try {
      const since = this.since();

      const [totalMessages, activeRows, topText, voiceRows, hourRows, joins, leaves] = await Promise.all([
        this.prisma.logEntry.count({ where: { guildId, type: 'message', createdAt: { gte: since } } }),
        this.prisma.$queryRaw<Array<{ users: number }>>`
          SELECT COUNT(DISTINCT "userId")::int AS users
          FROM log_entries
          WHERE "guildId" = ${guildId} AND type IN ('message', 'voice') AND "userId" IS NOT NULL AND "createdAt" >= ${since}
        `,
        this.prisma.logEntry.groupBy({
          by: ['channelId'],
          where: { guildId, type: 'message', channelId: { not: null }, createdAt: { gte: since } },
          _count: { channelId: true },
          orderBy: { _count: { channelId: 'desc' } },
          take: 1
        }),
        this.prisma.$queryRaw<Array<{ channelId: string | null; minutes: number }>>`
          SELECT "channelId", SUM(("data"->>'minutes')::numeric)::float8 AS minutes
          FROM log_entries
          WHERE "guildId" = ${guildId} AND type = 'voice' AND "createdAt" >= ${since}
          GROUP BY "channelId"
          ORDER BY minutes DESC NULLS LAST
        `,
        this.prisma.$queryRaw<Array<{ k: number; c: number }>>`
          SELECT EXTRACT(HOUR FROM "createdAt")::int AS k, COUNT(*)::int AS c
          FROM log_entries
          WHERE "guildId" = ${guildId} AND type = 'message' AND "createdAt" >= ${since}
          GROUP BY 1
        `,
        this.prisma.logEntry.count({ where: { guildId, type: 'join', createdAt: { gte: since } } }),
        this.prisma.logEntry.count({ where: { guildId, type: 'leave', createdAt: { gte: since } } })
      ]);

      const activeUsers = Number(activeRows[0]?.users ?? 0);
      const totalVoiceTime = Math.round(voiceRows.reduce((s, r) => s + Number(r.minutes ?? 0), 0));
      const hours: Record<number, number> = {};

      for (const r of hourRows) hours[Number(r.k)] = Number(r.c);

      // Crecimiento neto relativo a los miembros que había al inicio de la ventana
      let growthRate: number | null = null;

      if (memberCount !== undefined) {
        const base = memberCount - (joins - leaves);

        if (base > 0) growthRate = ((joins - leaves) / base) * 100;
      }

      const topVoice = voiceRows.find(r => r.channelId && Number(r.minutes) > 0);

      return {
        guildId,
        totalMessages,
        totalVoiceTime,
        activeUsers,
        averageMessagesPerUser: activeUsers > 0 ? Math.round(totalMessages / activeUsers) : 0,
        averageVoiceTimePerUser: activeUsers > 0 ? Math.round(totalVoiceTime / activeUsers) : 0,
        mostActiveChannel: topText[0]?.channelId ?? null,
        mostActiveVoiceChannel: topVoice?.channelId ?? null,
        peakActivityHour: this.peakOf(hours),
        joins,
        leaves,
        growthRate,
        updatedAt: new Date()
      };
    } catch (error) {
      this.logger.error('Error getting guild stats overview:', error);

      return null;
    }
  }

  /**
   * Estadísticas de un canal (últimos 30 días): mensajes y, si aplica, voz.
   * Devuelve null si el canal no tiene actividad registrada.
   */
  public async getChannelStats(channelId: string, guildId: string): Promise<ChannelStats | null> {
    try {
      const since = this.since();
      const msgWhere = { guildId, channelId, type: 'message', createdAt: { gte: since } };

      const [msgAgg, msgUsers, hourRows, voiceUsers] = await Promise.all([
        this.prisma.logEntry.aggregate({ where: msgWhere, _count: { _all: true }, _min: { createdAt: true } }),
        this.prisma.logEntry.groupBy({
          by: ['userId'],
          where: { ...msgWhere, userId: { not: null } },
          _count: { userId: true },
          orderBy: { _count: { userId: 'desc' } }
        }),
        this.prisma.$queryRaw<Array<{ k: number; c: number }>>`
          SELECT EXTRACT(HOUR FROM "createdAt")::int AS k, COUNT(*)::int AS c
          FROM log_entries
          WHERE "guildId" = ${guildId} AND "channelId" = ${channelId} AND type = 'message' AND "createdAt" >= ${since}
          GROUP BY 1
        `,
        this.prisma.$queryRaw<Array<{ userId: string; minutes: number }>>`
          SELECT "userId", SUM(("data"->>'minutes')::numeric)::float8 AS minutes
          FROM log_entries
          WHERE "guildId" = ${guildId} AND "channelId" = ${channelId} AND type = 'voice'
            AND "userId" IS NOT NULL AND "createdAt" >= ${since}
          GROUP BY "userId"
          ORDER BY minutes DESC NULLS LAST
        `
      ]);

      const totalMessages = msgAgg._count._all;
      const voiceMinutes = Math.round(voiceUsers.reduce((s, r) => s + Number(r.minutes ?? 0), 0));

      if (totalMessages === 0 && voiceMinutes === 0) return null;

      // Promedio sobre los días cubiertos por los datos (máx. 30)
      const first = msgAgg._min.createdAt;
      const spanDays = first
        ? Math.min(STATS_WINDOW_DAYS, Math.max(1, Math.ceil((Date.now() - first.getTime()) / DAY_MS)))
        : STATS_WINDOW_DAYS;
      const hours: Record<number, number> = {};

      for (const r of hourRows) hours[Number(r.k)] = Number(r.c);

      return {
        channelId,
        guildId,
        totalMessages,
        uniqueUsers: msgUsers.length,
        averageMessagesPerDay: Math.round((totalMessages / spanDays) * 10) / 10,
        peakActivityHour: this.peakOf(hours),
        mostActiveUsers: msgUsers.slice(0, 5).map(u => ({ userId: u.userId as string, messageCount: u._count.userId })),
        voiceMinutes,
        voiceUsers: voiceUsers.length,
        topVoiceUsers: voiceUsers
          .slice(0, 5)
          .map(u => ({ userId: u.userId, minutes: Math.round(Number(u.minutes ?? 0)) }))
          .filter(u => u.minutes > 0)
      };
    } catch (error) {
      this.logger.error('Error getting channel stats:', error);

      return null;
    }
  }

  /**
   * Top usuarios por mensajes (últimos 30 días)
   */
  public async getTopUsersByMessages(guildId: string, limit: number = 10): Promise<Array<{ userId: string; totalMessages: number; rank: number }>> {
    try {
      const rows = await this.prisma.logEntry.groupBy({
        by: ['userId'],
        where: { guildId, type: 'message', userId: { not: null }, createdAt: { gte: this.since() } },
        _count: { userId: true },
        orderBy: { _count: { userId: 'desc' } },
        take: limit
      });

      return rows.map((r, i) => ({ userId: r.userId as string, totalMessages: r._count.userId, rank: i + 1 }));
    } catch (error) {
      this.logger.error('Error getting top users by messages:', error);

      return [];
    }
  }

  /**
   * Top usuarios por mensajes enviados hoy (UTC)
   */
  public async getTopUsersToday(guildId: string, limit: number = 10): Promise<Array<{ userId: string; messages: number; rank: number }>> {
    try {
      const startOfDay = new Date(`${this.utcDay(0)}T00:00:00Z`);
      const rows = await this.prisma.logEntry.groupBy({
        by: ['userId'],
        where: { guildId, type: 'message', userId: { not: null }, createdAt: { gte: startOfDay } },
        _count: { userId: true },
        orderBy: { _count: { userId: 'desc' } },
        take: limit
      });

      return rows.map((r, i) => ({ userId: r.userId as string, messages: r._count.userId, rank: i + 1 }));
    } catch (error) {
      this.logger.error('Error getting top users today:', error);

      return [];
    }
  }

  /**
   * Top usuarios por racha actual de días con mensajes
   */
  public async getTopUsersByStreak(guildId: string, limit: number = 10): Promise<Array<{ userId: string; streak: number; rank: number }>> {
    try {
      const rows = await this.getCurrentStreaks(guildId, limit);

      return rows.map((r, i) => ({ ...r, rank: i + 1 }));
    } catch (error) {
      this.logger.error('Error getting top users by streak:', error);

      return [];
    }
  }

  /**
   * Top usuarios por minutos de voz (últimos 30 días)
   */
  public async getTopUsersByVoiceTime(guildId: string, limit: number = 10): Promise<Array<{ userId: string; totalVoiceTime: number; rank: number }>> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ userId: string; minutes: number }>>`
        SELECT "userId", SUM(("data"->>'minutes')::numeric)::float8 AS minutes
        FROM log_entries
        WHERE "guildId" = ${guildId} AND type = 'voice' AND "userId" IS NOT NULL AND "createdAt" >= ${this.since()}
        GROUP BY "userId"
        HAVING SUM(("data"->>'minutes')::numeric) > 0
        ORDER BY minutes DESC
        LIMIT ${limit}
      `;

      return rows.map((r, i) => ({ userId: r.userId, totalVoiceTime: Math.round(Number(r.minutes)), rank: i + 1 }));
    } catch (error) {
      this.logger.error('Error getting top users by voice time:', error);

      return [];
    }
  }

  /**
   * Canales más usados (últimos 30 días): texto por mensajes y voz por minutos.
   * Con `userId` se limita a la actividad de ese usuario.
   */
  public async getChannelBreakdown(guildId: string, userId: string | null = null, limit: number = 10): Promise<{
    text: Array<{ channelId: string; messages: number }>;
    voice: Array<{ channelId: string; minutes: number }>;
  }> {
    try {
      const since = this.since();
      const userFilter = userId ? Prisma.sql`AND "userId" = ${userId}` : Prisma.empty;

      const [textRows, voiceRows] = await Promise.all([
        this.prisma.logEntry.groupBy({
          by: ['channelId'],
          where: { guildId, type: 'message', channelId: { not: null }, createdAt: { gte: since }, ...(userId ? { userId } : {}) },
          _count: { channelId: true },
          orderBy: { _count: { channelId: 'desc' } },
          take: limit
        }),
        this.prisma.$queryRaw<Array<{ channelId: string; minutes: number }>>`
          SELECT "channelId", SUM(("data"->>'minutes')::numeric)::float8 AS minutes
          FROM log_entries
          WHERE "guildId" = ${guildId} AND type = 'voice' AND "channelId" IS NOT NULL
            AND "createdAt" >= ${since} ${userFilter}
          GROUP BY "channelId"
          HAVING SUM(("data"->>'minutes')::numeric) > 0
          ORDER BY minutes DESC
          LIMIT ${limit}
        `
      ]);

      return {
        text: textRows.map(r => ({ channelId: r.channelId as string, messages: r._count.channelId })),
        voice: voiceRows.map(r => ({ channelId: r.channelId, minutes: Math.round(Number(r.minutes)) }))
      };
    } catch (error) {
      this.logger.error('Error getting channel breakdown:', error);

      return { text: [], voice: [] };
    }
  }

  /**
   * Patrón de actividad del servidor (últimos 30 días): mensajes por hora UTC y por día de la semana.
   */
  public async getGuildActivityPattern(guildId: string): Promise<{
    totalMessages: number;
    activeDays: number;
    byHour: Record<number, number>;
    byDay: Record<number, number>;
  }> {
    const since = this.since();
    const [hourRows, dowRows, dayRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ k: number; c: number }>>`
        SELECT EXTRACT(HOUR FROM "createdAt")::int AS k, COUNT(*)::int AS c
        FROM log_entries
        WHERE "guildId" = ${guildId} AND type = 'message' AND "createdAt" >= ${since}
        GROUP BY 1
      `,
      this.prisma.$queryRaw<Array<{ k: number; c: number }>>`
        SELECT EXTRACT(DOW FROM "createdAt")::int AS k, COUNT(*)::int AS c
        FROM log_entries
        WHERE "guildId" = ${guildId} AND type = 'message' AND "createdAt" >= ${since}
        GROUP BY 1
      `,
      this.prisma.$queryRaw<Array<{ days: number }>>`
        SELECT COUNT(DISTINCT to_char("createdAt", 'YYYY-MM-DD'))::int AS days
        FROM log_entries
        WHERE "guildId" = ${guildId} AND type = 'message' AND "createdAt" >= ${since}
      `
    ]);

    const byHour: Record<number, number> = {};
    const byDay: Record<number, number> = {};
    let totalMessages = 0;

    for (const r of hourRows) {
      byHour[Number(r.k)] = Number(r.c);
      totalMessages += Number(r.c);
    }
    for (const r of dowRows) byDay[Number(r.k)] = Number(r.c);

    return { totalMessages, activeDays: Number(dayRows[0]?.days ?? 0), byHour, byDay };
  }

  /**
   * Altas y bajas por semana (lunes UTC) en los últimos 30 días.
   */
  public async getGuildGrowth(guildId: string): Promise<Array<{ week: string; joins: number; leaves: number }>> {
    const rows = await this.prisma.$queryRaw<Array<{ w: string; joins: number; leaves: number }>>`
      SELECT to_char(date_trunc('week', "createdAt"), 'YYYY-MM-DD') AS w,
             COUNT(*) FILTER (WHERE type = 'join')::int AS joins,
             COUNT(*) FILTER (WHERE type = 'leave')::int AS leaves
      FROM log_entries
      WHERE "guildId" = ${guildId} AND type IN ('join', 'leave') AND "createdAt" >= ${this.since()}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    return rows.map(r => ({ week: r.w, joins: Number(r.joins), leaves: Number(r.leaves) }));
  }

  /**
   * Generate user stats report
   */
  public async generateUserStatsReport(member: GuildMember): Promise<EmbedBuilder> {
    const guildId = member.guild.id;

    try {
      const [stats, comparison] = await Promise.all([
        this.getUserStats(member.id, guildId),
        this.getUserActivityComparison(member.id, guildId)
      ]);

      const embed = new EmbedBuilder()
        .setColor(Colors.Blue)
        .setTitle(i18n.t('user_stats.report.title', guildId, { user: member.displayName }))
        .setThumbnail(member.user.displayAvatarURL())
        .setFooter({ text: i18n.t('stats.window_footer', guildId, { days: STATS_WINDOW_DAYS.toString() }) })
        .setTimestamp();

      if (!stats) {
        embed.setDescription(i18n.t('user_stats.report.no_data', guildId));

        return embed;
      }

      const line = (key: string, value: string) => i18n.t(`stats.lines.${key}`, guildId, { value });

      const msgLines = [
        line('recent', stats.recentMessages.toLocaleString()),
        stats.lifetimeMessages !== null ? line('lifetime', stats.lifetimeMessages.toLocaleString()) : null,
        line('daily_average', stats.averageMessagesPerDay.toFixed(1)),
        stats.peakActivityHour !== null ? line('peak_hour', String(stats.peakActivityHour).padStart(2, '0')) : null
      ];

      const voiceLines = [
        line('recent', this.formatDuration(stats.recentVoiceMinutes)),
        stats.lifetimeVoiceMinutes !== null ? line('lifetime', this.formatDuration(stats.lifetimeVoiceMinutes)) : null,
        stats.voiceChannels > 0 ? line('voice_channels', stats.voiceChannels.toString()) : null
      ];

      const activityLines = [
        line('current_streak', stats.currentStreak.toString()),
        line('longest_streak', stats.longestStreak.toString()),
        i18n.t('stats.lines.active_days', guildId, { value: stats.activeDays.toString(), days: stats.periodDays.toString() }),
        stats.lastActiveDate ? line('last_active', `<t:${Math.floor(stats.lastActiveDate.getTime() / 1000)}:R>`) : null
      ];

      embed.addFields(
        { name: i18n.t('user_stats.report.messages.title', guildId), value: this.joinLines(msgLines), inline: true },
        { name: i18n.t('user_stats.report.voice.title', guildId), value: this.joinLines(voiceLines), inline: true },
        { name: i18n.t('user_stats.report.activity.title', guildId), value: this.joinLines(activityLines), inline: true }
      );

      if (comparison) {
        embed.addFields({
          name: i18n.t('user_stats.report.comparison.title', guildId),
          value: i18n.t('user_stats.report.comparison.value', guildId, {
            rank: comparison.userRank.toString(),
            total: comparison.totalUsers.toString(),
            percentile: comparison.percentile.toString(),
            status: comparison.aboveAverage
              ? i18n.t('user_stats.report.above_average', guildId)
              : i18n.t('user_stats.report.below_average', guildId)
          }),
          inline: false
        });
      }

      return embed;

    } catch (error) {
      this.logger.error('Error generating user stats report:', error);

      return new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle(i18n.t('common.error', guildId))
        .setDescription(i18n.t('user_stats.report.error', guildId));
    }
  }

  /**
   * Generate guild stats report
   */
  public async generateGuildStatsReport(guild: Guild): Promise<EmbedBuilder> {
    const guildId = guild.id;

    try {
      const [guildStats, topMessageUsers, topVoiceUsers] = await Promise.all([
        this.getGuildStatsOverview(guildId, guild.memberCount),
        this.getTopUsersByMessages(guildId, 5),
        this.getTopUsersByVoiceTime(guildId, 5)
      ]);

      const embed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle(i18n.t('user_stats.guild_report.title', guildId, { server: guild.name }))
        .setThumbnail(guild.iconURL())
        .setFooter({ text: i18n.t('stats.window_footer', guildId, { days: STATS_WINDOW_DAYS.toString() }) })
        .setTimestamp();

      if (!guildStats || (guildStats.totalMessages === 0 && guildStats.totalVoiceTime === 0
        && guildStats.joins === 0 && guildStats.leaves === 0)) {
        embed.setDescription(i18n.t('user_stats.guild_report.no_data', guildId));

        return embed;
      }

      const line = (key: string, value: string) => i18n.t(`stats.lines.${key}`, guildId, { value });

      const overview = [
        line('messages', guildStats.totalMessages.toLocaleString()),
        line('voice_time', this.formatDuration(guildStats.totalVoiceTime)),
        line('active_users', guildStats.activeUsers.toLocaleString())
      ];

      const averages = [
        line('per_user_messages', guildStats.averageMessagesPerUser.toLocaleString()),
        line('per_user_voice', this.formatDuration(guildStats.averageVoiceTimePerUser)),
        guildStats.peakActivityHour !== null ? line('peak_hour', String(guildStats.peakActivityHour).padStart(2, '0')) : null
      ];

      const net = guildStats.joins - guildStats.leaves;
      const members = [
        line('joins', guildStats.joins.toLocaleString()),
        line('leaves', guildStats.leaves.toLocaleString()),
        line('net', `${net > 0 ? '+' : ''}${net}`),
        guildStats.growthRate !== null
          ? line('growth', `${guildStats.growthRate > 0 ? '+' : ''}${guildStats.growthRate.toFixed(1)}`)
          : null
      ];

      embed.addFields(
        { name: i18n.t('user_stats.guild_report.overview.title', guildId), value: this.joinLines(overview), inline: true },
        { name: i18n.t('user_stats.guild_report.averages.title', guildId), value: this.joinLines(averages), inline: true },
        { name: i18n.t('stats.server.members_title', guildId), value: this.joinLines(members), inline: true }
      );

      const channels = [
        guildStats.mostActiveChannel ? line('top_text_channel', `<#${guildStats.mostActiveChannel}>`) : null,
        guildStats.mostActiveVoiceChannel ? line('top_voice_channel', `<#${guildStats.mostActiveVoiceChannel}>`) : null
      ];

      if (channels.some(Boolean)) {
        embed.addFields({ name: i18n.t('stats.server.channels_title', guildId), value: this.joinLines(channels), inline: false });
      }

      if (topMessageUsers.length > 0) {
        const label = i18n.t('stats.leaderboard.messages.label', guildId);

        embed.addFields({
          name: i18n.t('user_stats.guild_report.top_messages.title', guildId),
          value: this.joinLines(topMessageUsers.map(u => `${u.rank}. <@${u.userId}>: ${u.totalMessages.toLocaleString()} ${label}`)),
          inline: true
        });
      }

      if (topVoiceUsers.length > 0) {
        embed.addFields({
          name: i18n.t('stats.server.top_voice_title', guildId),
          value: this.joinLines(topVoiceUsers.map(u => `${u.rank}. <@${u.userId}>: ${this.formatDuration(u.totalVoiceTime)}`)),
          inline: true
        });
      }

      return embed;

    } catch (error) {
      this.logger.error('Error generating guild stats report:', error);

      return new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle(i18n.t('common.error', guildId))
        .setDescription(i18n.t('user_stats.guild_report.error', guildId));
    }
  }

  /** Une líneas no nulas respetando el límite de 1024 caracteres de un field */
  private joinLines(lines: Array<string | null>): string {
    const text = lines.filter((l): l is string => !!l).join('\n') || '—';

    return text.length > 1024 ? `${text.slice(0, 1021)}...` : text;
  }

  /**
   * Format duration in minutes to human readable format
   */
  public formatDuration(minutes: number): string {
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

  /**
   * Cleanup method for graceful shutdown (sin estado en memoria)
   */
  public async cleanup(): Promise<void> {
    this.logger.info('UserStatsService cleanup completed');
  }
}
