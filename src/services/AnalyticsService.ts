import { PrismaClient } from '../generated/prisma/client';
import { KorexClient } from '../client/KorexClient';

export class AnalyticsService {
  private client: KorexClient;
  private prisma: PrismaClient;

  constructor(client: KorexClient) {
    this.client = client;
    this.prisma = client.database.prisma;
  }

  /**
   * Track command usage
   */
  async trackCommand(guildId: string, userId: string, command: string, success: boolean = true): Promise<void> {
    try {
      await this.prisma.commandUsage.create({
        data: { guildId, userId, command, success }
      });
    } catch (error) {
      this.client.logger.error('Error tracking command:', error);
    }
  }

  /**
   * Track activity (joins, leaves, messages)
   */
  /**
   * Messages (by far the most frequent event) are buffered and inserted in bulk
   * every FLUSH_MS or when FLUSH_MAX is reached (previously one awaited INSERT per
   * message of every server). Other types are written directly.
   */
  private messageBuffer: Array<{ guildId: string; type: string; userId?: string; channelId?: string; data: any }> = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private static readonly FLUSH_MS = 5_000;
  private static readonly FLUSH_MAX = 500;

  async flushMessages(): Promise<void> {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.messageBuffer.length === 0) return;
    const batch = this.messageBuffer.splice(0, this.messageBuffer.length);
    try {
      await this.prisma.logEntry.createMany({ data: batch });
    } catch (error) {
      this.client.logger.error(`Error flushing ${batch.length} analytics messages:`, error);
    }
  }

  async trackActivity(guildId: string, type: 'join' | 'leave' | 'message' | 'voice' | 'levelup' | 'moderation', data?: any): Promise<void> {
    if (type === 'message') {
      this.messageBuffer.push({ guildId, type, userId: data?.userId, channelId: data?.channelId, data: data || {} });
      if (this.messageBuffer.length >= AnalyticsService.FLUSH_MAX) void this.flushMessages();
      else if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => { void this.flushMessages(); }, AnalyticsService.FLUSH_MS);
        this.flushTimer.unref?.();
      }
      return;
    }
    try {
      await this.prisma.logEntry.create({
        data: {
          guildId,
          type,
          userId: data?.userId,
          channelId: data?.channelId,
          data: data || {}
        }
      });
    } catch (error) {
      this.client.logger.error('Error tracking activity:', error);
    }
  }

  /**
   * Get guild stats for dashboard
   */
  async getGuildStats(guildId: string): Promise<{
    commandsUsed: number;
    messagesCount: number;
    levelUps: number;
    moderationActions: number;
  }> {
    const now = new Date();
    const last30Days = new Date(now);
    last30Days.setDate(now.getDate() - 30);

    try {
      const [commandsUsed, messagesCount, levelUps, moderationActions] = await Promise.all([
        // Commands used in the last 30 days
        this.prisma.commandUsage.count({
          where: { guildId, createdAt: { gte: last30Days } }
        }),
        // Messages in the last 30 days (from LogEntry)
        this.prisma.logEntry.count({
          where: { guildId, type: 'message', createdAt: { gte: last30Days } }
        }),
        // Level ups in the last 30 days
        this.prisma.logEntry.count({
          where: { guildId, type: 'levelup', createdAt: { gte: last30Days } }
        }),
        // Moderation actions in the last 30 days
        this.prisma.moderationCase.count({
          where: { guildId, createdAt: { gte: last30Days } }
        })
      ]);

      return { commandsUsed, messagesCount, levelUps, moderationActions };
    } catch (error) {
      this.client.logger.error('Error getting guild stats:', error);

      return { commandsUsed: 0, messagesCount: 0, levelUps: 0, moderationActions: 0 };
    }
  }

  /**
   * Get recent activity for feed
   */
  async getRecentActivity(guildId: string, limit: number = 10): Promise<any[]> {
    try {
      const activities = await this.prisma.logEntry.findMany({
        where: { guildId },
        orderBy: { createdAt: 'desc' },
        take: limit
      });

      return activities;
    } catch (error) {
      this.client.logger.error('Error getting recent activity:', error);

      return [];
    }
  }
}
