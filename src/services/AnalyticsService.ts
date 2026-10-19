import { PrismaClient } from '@prisma/client';
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
  async trackActivity(guildId: string, type: 'join' | 'leave' | 'message' | 'voice' | 'levelup' | 'moderation', data?: any): Promise<void> {
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
        // Comandos usados últimos 30 días
        this.prisma.commandUsage.count({
          where: { guildId, createdAt: { gte: last30Days } }
        }),
        // Mensajes últimos 30 días (desde LogEntry)
        this.prisma.logEntry.count({
          where: { guildId, type: 'message', createdAt: { gte: last30Days } }
        }),
        // Level ups últimos 30 días
        this.prisma.logEntry.count({
          where: { guildId, type: 'levelup', createdAt: { gte: last30Days } }
        }),
        // Acciones de moderación últimos 30 días
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
