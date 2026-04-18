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
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now);

    startOfWeek.setDate(now.getDate() - 7);

    try {
      const [commandsUsed, messagesCount, levelUps, moderationActions] = await Promise.all([
        // Comandos usados este mes
        this.prisma.commandUsage.count({
          where: { guildId, createdAt: { gte: startOfMonth } }
        }),
        // Mensajes este mes (desde LogEntry)
        this.prisma.logEntry.count({
          where: { guildId, type: 'message', createdAt: { gte: startOfMonth } }
        }),
        // Level ups esta semana
        this.prisma.logEntry.count({
          where: { guildId, type: 'levelup', createdAt: { gte: startOfWeek } }
        }),
        // Acciones de moderación esta semana
        this.prisma.moderationCase.count({
          where: { guildId, createdAt: { gte: startOfWeek } }
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
