import {
  Guild,
  GuildMember,
  TextChannel,
  VoiceChannel,
  Message,
  VoiceState,
  EmbedBuilder,
  Colors,
  AttachmentBuilder
} from 'discord.js';
import { logger } from '../utils/Logger';
import { DatabaseManager } from '../client/managers/DatabaseManager';
import { i18n } from '../utils/i18n';

export interface UserStats {
  userId: string;
  guildId: string;
  totalMessages: number;
  messagesPerChannel: Record<string, number>;
  totalVoiceTime: number; // in minutes
  voiceTimePerChannel: Record<string, number>;
  dailyActivity: Record<string, number>; // date -> message count
  weeklyActivity: Record<string, number>; // week -> message count
  monthlyActivity: Record<string, number>; // month -> message count
  longestStreak: number; // days
  currentStreak: number; // days
  lastActiveDate: Date;
  firstMessageDate: Date;
  averageMessagesPerDay: number;
  peakActivityHour: number; // 0-23
  activityByHour: Record<number, number>; // hour -> message count
  activityByDay: Record<number, number>; // day of week -> message count
  createdAt: Date;
  updatedAt: Date;
}

export interface VoiceSession {
  userId: string;
  guildId: string;
  channelId: string;
  startTime: Date;
  endTime?: Date;
  duration?: number; // in minutes
}

export interface ChannelStats {
  channelId: string;
  guildId: string;
  totalMessages: number;
  uniqueUsers: number;
  averageMessagesPerDay: number;
  peakActivityHour: number;
  mostActiveUsers: Array<{ userId: string; messageCount: number }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface GuildStatsOverview {
  guildId: string;
  totalMessages: number;
  totalVoiceTime: number;
  activeUsers: number;
  averageMessagesPerUser: number;
  averageVoiceTimePerUser: number;
  mostActiveChannel: string;
  mostActiveVoiceChannel: string;
  peakActivityHour: number;
  growthRate: number; // percentage
  updatedAt: Date;
}

export interface ActivityComparison {
  userRank: number;
  totalUsers: number;
  percentile: number;
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
  private voiceSessions: Map<string, VoiceSession> = new Map();
  private messageBuffer: Map<string, number> = new Map();
  private bufferFlushInterval!: NodeJS.Timeout;

  private constructor(db: DatabaseManager) {
    this.db = db;
    this.startBufferFlush();
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

  /**
   * Start periodic buffer flush to database
   */
  private startBufferFlush(): void {
    this.bufferFlushInterval = setInterval(async () => {
      await this.flushMessageBuffer();
    }, 60000); // Flush every minute
  }

  /**
   * Handle message for stats tracking
   */
  public async handleMessage(message: Message): Promise<void> {
    try {
      if (message.author.bot || !message.guild) return;

      const key = `${message.author.id}-${message.guild.id}-${message.channel.id}`;

      this.messageBuffer.set(key, (this.messageBuffer.get(key) || 0) + 1);

      // Update daily activity immediately for streak calculation
      await this.updateDailyActivity(message.author.id, message.guild.id);

    } catch (error) {
      this.logger.error('Error handling message for stats:', error);
    }
  }

  /**
   * Handle voice state update for voice time tracking
   */
  public async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
    try {
      if (!newState.member || newState.member.user.bot) return;

      const userId = newState.member.id;
      const guildId = newState.guild.id;
      const sessionKey = `${userId}-${guildId}`;

      // User joined a voice channel
      if (!oldState.channel && newState.channel) {
        const session: VoiceSession = {
          userId,
          guildId,
          channelId: newState.channel.id,
          startTime: new Date()
        };

        this.voiceSessions.set(sessionKey, session);
        this.logger.debug(`Voice session started for ${userId} in ${newState.channel.name}`);
      }

      // User left a voice channel
      if (oldState.channel && !newState.channel) {
        const session = this.voiceSessions.get(sessionKey);

        if (session) {
          session.endTime = new Date();
          session.duration = Math.floor((session.endTime.getTime() - session.startTime.getTime()) / 60000);
          
          await this.recordVoiceSession(session);
          this.voiceSessions.delete(sessionKey);
          this.logger.debug(`Voice session ended for ${userId}, duration: ${session.duration} minutes`);
        }
      }

      // User switched voice channels
      if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
        const session = this.voiceSessions.get(sessionKey);

        if (session) {
          // End current session
          session.endTime = new Date();
          session.duration = Math.floor((session.endTime.getTime() - session.startTime.getTime()) / 60000);
          await this.recordVoiceSession(session);

          // Start new session
          const newSession: VoiceSession = {
            userId,
            guildId,
            channelId: newState.channel.id,
            startTime: new Date()
          };

          this.voiceSessions.set(sessionKey, newSession);
          this.logger.debug(`Voice session switched for ${userId} to ${newState.channel.name}`);
        }
      }

    } catch (error) {
      this.logger.error('Error handling voice state update for stats:', error);
    }
  }

  /**
   * Flush message buffer to database
   */
  private async flushMessageBuffer(): Promise<void> {
    if (this.messageBuffer.size === 0) return;

    try {
      const updates: Array<{ userId: string; guildId: string; channelId: string; count: number }> = [];
      
      for (const [key, count] of this.messageBuffer.entries()) {
        const [userId, guildId, channelId] = key.split('-');

        updates.push({ userId, guildId, channelId, count });
      }

      // Batch update user stats
      for (const update of updates) {
        await this.updateUserMessageStats(update.userId, update.guildId, update.channelId, update.count);
      }

      this.messageBuffer.clear();
      this.logger.debug(`Flushed ${updates.length} message stat updates to database`);

    } catch (error) {
      this.logger.error('Error flushing message buffer:', error);
    }
  }

  /**
   * Update user message statistics
   */
  private async updateUserMessageStats(userId: string, guildId: string, channelId: string, messageCount: number): Promise<void> {
    try {
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const hour = now.getHours();
      const dayOfWeek = now.getDay();

      // Get or create user stats
      let stats = await this.getUserStats(userId, guildId);

      if (!stats) {
        stats = await this.createUserStats(userId, guildId);
      }

      // Update message counts
      stats.totalMessages += messageCount;
      stats.messagesPerChannel[channelId] = (stats.messagesPerChannel[channelId] || 0) + messageCount;
      stats.dailyActivity[today] = (stats.dailyActivity[today] || 0) + messageCount;
      stats.activityByHour[hour] = (stats.activityByHour[hour] || 0) + messageCount;
      stats.activityByDay[dayOfWeek] = (stats.activityByDay[dayOfWeek] || 0) + messageCount;

      // Update peak activity hour
      const maxHourActivity = Math.max(...Object.values(stats.activityByHour));

      stats.peakActivityHour = Object.keys(stats.activityByHour).find(
        h => stats.activityByHour[parseInt(h)] === maxHourActivity
      ) ? parseInt(Object.keys(stats.activityByHour).find(
        h => stats.activityByHour[parseInt(h)] === maxHourActivity
      )!) : hour;

      // Calculate average messages per day
      const daysSinceFirst = Math.max(1, Math.floor((now.getTime() - stats.firstMessageDate.getTime()) / (1000 * 60 * 60 * 24)));

      stats.averageMessagesPerDay = stats.totalMessages / daysSinceFirst;

      stats.lastActiveDate = now;
      stats.updatedAt = now;

      await this.saveUserStats(stats);

    } catch (error) {
      this.logger.error('Error updating user message stats:', error);
    }
  }

  /**
   * Record voice session
   */
  private async recordVoiceSession(session: VoiceSession): Promise<void> {
    try {
      if (!session.duration || session.duration < 1) return; // Ignore very short sessions

      // Get or create user stats
      let stats = await this.getUserStats(session.userId, session.guildId);

      if (!stats) {
        stats = await this.createUserStats(session.userId, session.guildId);
      }

      // Update voice time
      stats.totalVoiceTime += session.duration;
      stats.voiceTimePerChannel[session.channelId] = (stats.voiceTimePerChannel[session.channelId] || 0) + session.duration;
      stats.updatedAt = new Date();

      await this.saveUserStats(stats);

      // Save voice session record
      await this.saveVoiceSession(session);

    } catch (error) {
      this.logger.error('Error recording voice session:', error);
    }
  }

  /**
   * Update daily activity and calculate streaks
   */
  private async updateDailyActivity(userId: string, guildId: string): Promise<void> {
    try {
      const stats = await this.getUserStats(userId, guildId);

      if (!stats) return;

      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Check if user was active yesterday to maintain streak
      if (stats.dailyActivity[yesterday] && stats.dailyActivity[yesterday] > 0) {
        if (!stats.dailyActivity[today] || stats.dailyActivity[today] === 0) {
          stats.currentStreak += 1;
        }
      } else {
        // Reset streak if not active yesterday
        if (stats.lastActiveDate.toISOString().split('T')[0] !== today) {
          stats.currentStreak = 1;
        }
      }

      // Update longest streak
      if (stats.currentStreak > stats.longestStreak) {
        stats.longestStreak = stats.currentStreak;
      }

      await this.saveUserStats(stats);

    } catch (error) {
      this.logger.error('Error updating daily activity:', error);
    }
  }

  /**
   * Get user statistics
   */
  public async getUserStats(userId: string, guildId: string): Promise<UserStats | null> {
    try {
      // In a real implementation, this would query the database
      // For now, using a temporary approach until Prisma is regenerated
      return null;
    } catch (error) {
      this.logger.error('Error getting user stats:', error);

      return null;
    }
  }

  /**
   * Create new user stats record
   */
  private async createUserStats(userId: string, guildId: string): Promise<UserStats> {
    const now = new Date();
    const stats: UserStats = {
      userId,
      guildId,
      totalMessages: 0,
      messagesPerChannel: {},
      totalVoiceTime: 0,
      voiceTimePerChannel: {},
      dailyActivity: {},
      weeklyActivity: {},
      monthlyActivity: {},
      longestStreak: 0,
      currentStreak: 0,
      lastActiveDate: now,
      firstMessageDate: now,
      averageMessagesPerDay: 0,
      peakActivityHour: new Date().getHours(),
      activityByHour: {},
      activityByDay: {},
      createdAt: now,
      updatedAt: now
    };

    await this.saveUserStats(stats);

    return stats;
  }

  /**
   * Save user statistics
   */
  private async saveUserStats(stats: UserStats): Promise<void> {
    try {
      // Temporary implementation until Prisma is regenerated
      this.logger.debug(`Saving user stats for ${stats.userId} in guild ${stats.guildId}`);
    } catch (error) {
      this.logger.error('Error saving user stats:', error);
    }
  }

  /**
   * Save voice session
   */
  private async saveVoiceSession(session: VoiceSession): Promise<void> {
    try {
      // Temporary implementation until Prisma is regenerated
      this.logger.debug(`Saving voice session for ${session.userId}: ${session.duration} minutes`);
    } catch (error) {
      this.logger.error('Error saving voice session:', error);
    }
  }

  /**
   * Get user activity comparison
   */
  public async getUserActivityComparison(userId: string, guildId: string): Promise<ActivityComparison | null> {
    try {
      const userStats = await this.getUserStats(userId, guildId);

      if (!userStats) return null;

      // Get guild averages (mock data for now)
      const guildStats = await this.getGuildStatsOverview(guildId);

      if (!guildStats) return null;

      // Calculate user rank (mock calculation)
      const userRank = Math.floor(Math.random() * 100) + 1;
      const totalUsers = 150;
      const percentile = Math.round(((totalUsers - userRank) / totalUsers) * 100);

      return {
        userRank,
        totalUsers,
        percentile,
        aboveAverage: userStats.totalMessages > guildStats.averageMessagesPerUser,
        comparisonData: {
          userMessages: userStats.totalMessages,
          averageMessages: guildStats.averageMessagesPerUser,
          userVoiceTime: userStats.totalVoiceTime,
          averageVoiceTime: guildStats.averageVoiceTimePerUser,
          userStreak: userStats.currentStreak,
          averageStreak: 5 // Mock average
        }
      };

    } catch (error) {
      this.logger.error('Error getting user activity comparison:', error);

      return null;
    }
  }

  /**
   * Get guild statistics overview
   */
  public async getGuildStatsOverview(guildId: string): Promise<GuildStatsOverview | null> {
    try {
      // Mock implementation until database is ready
      return {
        guildId,
        totalMessages: 50000,
        totalVoiceTime: 15000,
        activeUsers: 150,
        averageMessagesPerUser: 333,
        averageVoiceTimePerUser: 100,
        mostActiveChannel: 'general',
        mostActiveVoiceChannel: 'General Voice',
        peakActivityHour: 20,
        growthRate: 15.5,
        updatedAt: new Date()
      };
    } catch (error) {
      this.logger.error('Error getting guild stats overview:', error);

      return null;
    }
  }

  /**
   * Get channel statistics
   */
  public async getChannelStats(channelId: string, guildId: string): Promise<ChannelStats | null> {
    try {
      // Mock implementation until database is ready
      return {
        channelId,
        guildId,
        totalMessages: 5000,
        uniqueUsers: 45,
        averageMessagesPerDay: 150,
        peakActivityHour: 20,
        mostActiveUsers: [
          { userId: '123456789', messageCount: 500 },
          { userId: '987654321', messageCount: 450 },
          { userId: '456789123', messageCount: 400 }
        ],
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        updatedAt: new Date()
      };
    } catch (error) {
      this.logger.error('Error getting channel stats:', error);

      return null;
    }
  }

  /**
   * Get top users by messages
   */
  public async getTopUsersByMessages(guildId: string, limit: number = 10): Promise<Array<{ userId: string; totalMessages: number; rank: number }>> {
    try {
      // Mock implementation until database is ready
      const mockUsers = [];

      for (let i = 1; i <= limit; i++) {
        mockUsers.push({
          userId: `user${i}`,
          totalMessages: Math.floor(Math.random() * 1000) + 100,
          rank: i
        });
      }

      return mockUsers.sort((a, b) => b.totalMessages - a.totalMessages);
    } catch (error) {
      this.logger.error('Error getting top users by messages:', error);

      return [];
    }
  }

  /**
   * Get top users by voice time
   */
  public async getTopUsersByVoiceTime(guildId: string, limit: number = 10): Promise<Array<{ userId: string; totalVoiceTime: number; rank: number }>> {
    try {
      // Mock implementation until database is ready
      const mockUsers = [];

      for (let i = 1; i <= limit; i++) {
        mockUsers.push({
          userId: `user${i}`,
          totalVoiceTime: Math.floor(Math.random() * 500) + 50,
          rank: i
        });
      }

      return mockUsers.sort((a, b) => b.totalVoiceTime - a.totalVoiceTime);
    } catch (error) {
      this.logger.error('Error getting top users by voice time:', error);

      return [];
    }
  }

  /**
   * Generate user stats report
   */
  public async generateUserStatsReport(member: GuildMember): Promise<EmbedBuilder> {
    try {
      const stats = await this.getUserStats(member.id, member.guild.id);
      const comparison = await this.getUserActivityComparison(member.id, member.guild.id);

      const embed = new EmbedBuilder()
        .setColor(Colors.Blue)
        .setTitle(i18n.t('user_stats.report.title', member.guild.id, { user: member.displayName }))
        .setThumbnail(member.user.displayAvatarURL())
        .setTimestamp();

      if (stats) {
        embed.addFields(
          {
            name: i18n.t('user_stats.report.messages.title', member.guild.id),
            value: i18n.t('user_stats.report.messages.value', member.guild.id, {
              total: stats.totalMessages.toString(),
              average: stats.averageMessagesPerDay.toFixed(1),
              peak: stats.peakActivityHour.toString()
            }),
            inline: true
          },
          {
            name: i18n.t('user_stats.report.voice.title', member.guild.id),
            value: i18n.t('user_stats.report.voice.value', member.guild.id, {
              total: this.formatDuration(stats.totalVoiceTime),
              channels: Object.keys(stats.voiceTimePerChannel).length.toString()
            }),
            inline: true
          },
          {
            name: i18n.t('user_stats.report.activity.title', member.guild.id),
            value: i18n.t('user_stats.report.activity.value', member.guild.id, {
              current: stats.currentStreak.toString(),
              longest: stats.longestStreak.toString(),
              days: Math.floor((Date.now() - stats.firstMessageDate.getTime()) / (1000 * 60 * 60 * 24)).toString()
            }),
            inline: true
          }
        );

        if (comparison) {
          embed.addFields({
            name: i18n.t('user_stats.report.comparison.title', member.guild.id),
            value: i18n.t('user_stats.report.comparison.value', member.guild.id, {
              rank: comparison.userRank.toString(),
              total: comparison.totalUsers.toString(),
              percentile: comparison.percentile.toString(),
              status: comparison.aboveAverage ? 
                i18n.t('user_stats.report.above_average', member.guild.id) : 
                i18n.t('user_stats.report.below_average', member.guild.id)
            }),
            inline: false
          });
        }
      } else {
        embed.setDescription(i18n.t('user_stats.report.no_data', member.guild.id));
      }

      return embed;

    } catch (error) {
      this.logger.error('Error generating user stats report:', error);

      return new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle(i18n.t('common.error', member.guild.id))
        .setDescription(i18n.t('user_stats.report.error', member.guild.id));
    }
  }

  /**
   * Generate guild stats report
   */
  public async generateGuildStatsReport(guild: Guild): Promise<EmbedBuilder> {
    try {
      const guildStats = await this.getGuildStatsOverview(guild.id);
      const topMessageUsers = await this.getTopUsersByMessages(guild.id, 5);
      const topVoiceUsers = await this.getTopUsersByVoiceTime(guild.id, 5);

      const embed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle(i18n.t('user_stats.guild_report.title', guild.id, { server: guild.name }))
        .setThumbnail(guild.iconURL())
        .setTimestamp();

      if (guildStats) {
        embed.addFields(
          {
            name: i18n.t('user_stats.guild_report.overview.title', guild.id),
            value: i18n.t('user_stats.guild_report.overview.value', guild.id, {
              messages: guildStats.totalMessages.toLocaleString(),
              voice: this.formatDuration(guildStats.totalVoiceTime),
              users: guildStats.activeUsers.toString(),
              growth: guildStats.growthRate.toFixed(1)
            }),
            inline: false
          },
          {
            name: i18n.t('user_stats.guild_report.averages.title', guild.id),
            value: i18n.t('user_stats.guild_report.averages.value', guild.id, {
              messages: guildStats.averageMessagesPerUser.toString(),
              voice: this.formatDuration(guildStats.averageVoiceTimePerUser),
              peak: guildStats.peakActivityHour.toString()
            }),
            inline: true
          }
        );

        // Add top users if available
        if (topMessageUsers.length > 0) {
          const topMessagesText = topMessageUsers
            .map((user, index) => `${index + 1}. <@${user.userId}>: ${user.totalMessages} mensajes`)
            .join('\n');
          
          embed.addFields({
            name: i18n.t('user_stats.guild_report.top_messages.title', guild.id),
            value: topMessagesText,
            inline: true
          });
        }
      } else {
        embed.setDescription(i18n.t('user_stats.guild_report.no_data', guild.id));
      }

      return embed;

    } catch (error) {
      this.logger.error('Error generating guild stats report:', error);

      return new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle(i18n.t('common.error', guild.id))
        .setDescription(i18n.t('user_stats.guild_report.error', guild.id));
    }
  }

  /**
   * Format duration in minutes to human readable format
   */
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

  /**
   * Cleanup method for graceful shutdown
   */
  public async cleanup(): Promise<void> {
    try {
      if (this.bufferFlushInterval) {
        clearInterval(this.bufferFlushInterval);
      }
      
      // Flush any remaining data
      await this.flushMessageBuffer();
      
      // End any active voice sessions
      for (const [key, session] of this.voiceSessions.entries()) {
        session.endTime = new Date();
        session.duration = Math.floor((session.endTime.getTime() - session.startTime.getTime()) / 60000);
        await this.recordVoiceSession(session);
      }
      
      this.voiceSessions.clear();
      this.logger.info('UserStatsService cleanup completed');
      
    } catch (error) {
      this.logger.error('Error during UserStatsService cleanup:', error);
    }
  }
}