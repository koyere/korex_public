import { 
  Guild, 
  GuildMember, 
  Invite, 
  User,
  EmbedBuilder,
  Collection
} from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';
import { logger } from '../utils/Logger';
import { botConfig } from '../config/bot.config';

export interface InviteData {
  code: string;
  guildId: string;
  inviterId: string;
  channelId: string;
  uses: number;
  maxUses: number;
  maxAge: number;
  temporary: boolean;
  createdAt: Date;
  expiresAt?: Date;
}

export interface InviteStats {
  userId: string;
  guildId: string;
  totalInvites: number;
  validInvites: number;
  fakeInvites: number;
  leftInvites: number;
  bonusInvites: number;
  invitedUsers: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface InviteReward {
  id: string;
  guildId: string;
  requiredInvites: number;
  type: 'role' | 'coins' | 'xp' | 'custom';
  value: string | number;
  description: string;
  oneTime: boolean;
  enabled: boolean;
}

export class InviteService {
  private client: KorexClient;
  private prisma: PrismaClient;
  private inviteCache: Map<string, Collection<string, Invite>> = new Map();

  constructor(client: KorexClient) {
    this.client = client;
    this.prisma = client.db;
    this.initializeInviteTracking();
  }

  /**
   * Initialize invite tracking for all guilds
   */
  private async initializeInviteTracking(): Promise<void> {
    try {
      for (const guild of this.client.guilds.cache.values()) {
        await this.cacheGuildInvites(guild);
      }
      logger.info(`Initialized invite tracking for ${this.client.guilds.cache.size} guilds`);
    } catch (error) {
      logger.error('Failed to initialize invite tracking:', error);
    }
  }

  /**
   * Cache all invites for a guild
   */
  async cacheGuildInvites(guild: Guild): Promise<void> {
    try {
      if (!guild.members.me?.permissions.has('ManageGuild')) {
        return;
      }

      const invites = await guild.invites.fetch();

      this.inviteCache.set(guild.id, invites);
      
      logger.debug(`Cached ${invites.size} invites for guild ${guild.id}`);
    } catch (error) {
      logger.error(`Failed to cache invites for guild ${guild.id}:`, error);
    }
  }

  /**
   * Track when a member joins and determine who invited them
   */
  async trackMemberJoin(member: GuildMember): Promise<{ inviter: User | null; invite: Invite | null }> {
    try {
      const guild = member.guild;
      const oldInvites = this.inviteCache.get(guild.id);
      
      if (!oldInvites) {
        await this.cacheGuildInvites(guild);

        return { inviter: null, invite: null };
      }

      // Fetch current invites
      const newInvites = await guild.invites.fetch();

      this.inviteCache.set(guild.id, newInvites);

      // Find the invite that was used
      let usedInvite: Invite | null = null;
      
      for (const [code, newInvite] of newInvites) {
        const oldInvite = oldInvites.get(code);
        
        if (oldInvite && newInvite.uses! > oldInvite.uses!) {
          usedInvite = newInvite;
          break;
        }
      }

      // Check for deleted invites (single use invites)
      if (!usedInvite) {
        for (const [code, oldInvite] of oldInvites) {
          if (!newInvites.has(code) && oldInvite.maxUses === 1) {
            usedInvite = oldInvite;
            break;
          }
        }
      }

      if (usedInvite && usedInvite.inviter) {
        // Update invite statistics
        await this.updateInviteStats(usedInvite.inviter, member, usedInvite, 'join');
        
        // Check for rewards
        await this.checkInviteRewards(usedInvite.inviter, guild);
        
        return { inviter: usedInvite.inviter, invite: usedInvite };
      }

      return { inviter: null, invite: null };

    } catch (error) {
      logger.error('Failed to track member join:', error);

      return { inviter: null, invite: null };
    }
  }

  /**
   * Track when a member leaves and update statistics
   */
  async trackMemberLeave(member: GuildMember): Promise<void> {
    try {
      // Find who invited this user
      const inviteStats = await this.getInviteStatsForInvitedUser(member.id, member.guild.id);
      
      if (inviteStats) {
        // Update statistics - mark as left
        await this.updateInviteStatsOnLeave(inviteStats.userId, member);
      }

    } catch (error) {
      logger.error('Failed to track member leave:', error);
    }
  }

  /**
   * Update invite statistics
   */
  private async updateInviteStats(
    inviter: User, 
    invitedMember: GuildMember, 
    invite: Invite, 
    action: 'join' | 'leave'
  ): Promise<void> {
    try {
      // Get or create invite stats
      let stats = await this.getInviteStats(inviter.id, invitedMember.guild.id);
      
      if (!stats) {
        stats = await this.createInviteStats(inviter.id, invitedMember.guild.id);
      }

      if (action === 'join') {
        // Check if it's a potential fake invite
        const isFake = await this.detectFakeInvite(inviter, invitedMember);
        
        stats.totalInvites++;
        
        if (isFake) {
          stats.fakeInvites++;
        } else {
          stats.validInvites++;
        }
        
        stats.invitedUsers.push(invitedMember.id);
      }

      stats.updatedAt = new Date();
      await this.saveInviteStats(stats);

      // Log the invite
      await this.logInviteAction(inviter, invitedMember, invite, action);

    } catch (error) {
      logger.error('Failed to update invite stats:', error);
    }
  }

  /**
   * Update statistics when a member leaves
   */
  private async updateInviteStatsOnLeave(inviterId: string, leftMember: GuildMember): Promise<void> {
    try {
      const stats = await this.getInviteStats(inviterId, leftMember.guild.id);
      
      if (stats) {
        stats.leftInvites++;
        stats.validInvites = Math.max(0, stats.validInvites - 1);
        
        // Remove from invited users list
        const userIndex = stats.invitedUsers.indexOf(leftMember.id);

        if (userIndex !== -1) {
          stats.invitedUsers.splice(userIndex, 1);
        }
        
        stats.updatedAt = new Date();
        await this.saveInviteStats(stats);
      }

    } catch (error) {
      logger.error('Failed to update stats on leave:', error);
    }
  }

  /**
   * Detect potential fake invites
   */
  private async detectFakeInvite(inviter: User, invitedMember: GuildMember): Promise<boolean> {
    try {
      // Check account age (less than 7 days = suspicious)
      const accountAge = Date.now() - invitedMember.user.createdTimestamp;
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      
      if (accountAge < sevenDays) {
        return true;
      }

      // Check if inviter and invited have similar usernames
      const inviterName = inviter.username.toLowerCase();
      const invitedName = invitedMember.user.username.toLowerCase();
      
      if (this.calculateSimilarity(inviterName, invitedName) > 0.8) {
        return true;
      }

      // Check if they joined very quickly after invite creation
      const recentInvites = await this.getRecentInvites(inviter.id, invitedMember.guild.id);
      const quickJoin = recentInvites.some(invite => {
        const timeDiff = Date.now() - invite.createdAt.getTime();

        return timeDiff < 60000; // Less than 1 minute
      });

      if (quickJoin) {
        return true;
      }

      return false;

    } catch (error) {
      logger.error('Failed to detect fake invite:', error);

      return false;
    }
  }

  /**
   * Calculate string similarity (Levenshtein distance)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;

        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator
        );
      }
    }

    const maxLength = Math.max(str1.length, str2.length);

    return maxLength === 0 ? 1 : 1 - matrix[str2.length][str1.length] / maxLength;
  }

  /**
   * Check and apply invite rewards
   */
  private async checkInviteRewards(inviter: User, guild: Guild): Promise<void> {
    try {
      const stats = await this.getInviteStats(inviter.id, guild.id);

      if (!stats) return;

      const rewards = await this.getInviteRewards(guild.id);
      const member = guild.members.cache.get(inviter.id);

      if (!member) return;

      for (const reward of rewards) {
        if (!reward.enabled) continue;
        
        const totalInvites = stats.validInvites + stats.bonusInvites;
        
        if (totalInvites >= reward.requiredInvites) {
          const hasReward = await this.hasReceivedReward(inviter.id, reward.id);
          
          if (!hasReward || !reward.oneTime) {
            await this.applyReward(member, reward);
            await this.markRewardReceived(inviter.id, reward.id);
          }
        }
      }

    } catch (error) {
      logger.error('Failed to check invite rewards:', error);
    }
  }

  /**
   * Apply reward to member
   */
  private async applyReward(member: GuildMember, reward: InviteReward): Promise<void> {
    try {
      switch (reward.type) {
        case 'role': {
          const role = member.guild.roles.cache.get(reward.value as string);

          if (role && !member.roles.cache.has(role.id)) {
            await member.roles.add(role);
          }
          break;
        }

        case 'coins':
          // Integrate with economy service
          if (this.client.economy) {
            await this.client.economy.addMoney(member.guild.id, member.id, reward.value as number);
          }
          break;

        case 'xp':
          // Integrate with level service
          if (this.client.levels) {
            await this.client.levels.addXp(member.guild, member.id, reward.value as number);
          }
          break;

        case 'custom':
          // Custom reward handling
          logger.info(`Applied custom reward to ${member.user.tag}: ${reward.description}`);
          break;
      }

      // Send notification
      await this.sendRewardNotification(member, reward);

    } catch (error) {
      logger.error('Failed to apply reward:', error);
    }
  }

  /**
   * Send reward notification
   */
  private async sendRewardNotification(member: GuildMember, reward: InviteReward): Promise<void> {
    try {
      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.success)
        .setTitle(i18n.t('invites.reward.title', member.guild.id))
        .setDescription(i18n.t('invites.reward.description', member.guild.id, {
          user: member.toString(),
          reward: reward.description,
          invites: reward.requiredInvites.toString()
        }))
        .setThumbnail(member.user.displayAvatarURL())
        .setTimestamp();

      // Try to send DM first, then fallback to system channel
      try {
        await member.send({ embeds: [embed] });
      } catch {
        const systemChannel = member.guild.systemChannel;

        if (systemChannel) {
          await systemChannel.send({ embeds: [embed] });
        }
      }

    } catch (error) {
      logger.error('Failed to send reward notification:', error);
    }
  }

  /**
   * Get invite leaderboard
   */
  async getInviteLeaderboard(guildId: string, _limit: number = 10): Promise<InviteStats[]> {
    try {
      // Placeholder - would fetch from database and sort by total valid invites
      return [];
    } catch (error) {
      logger.error('Failed to get invite leaderboard:', error);

      return [];
    }
  }

  /**
   * Add bonus invites to a user
   */
  async addBonusInvites(userId: string, guildId: string, amount: number, reason?: string): Promise<boolean> {
    try {
      let stats = await this.getInviteStats(userId, guildId);
      
      if (!stats) {
        stats = await this.createInviteStats(userId, guildId);
      }

      stats.bonusInvites += amount;
      stats.updatedAt = new Date();
      
      await this.saveInviteStats(stats);

      // Log the bonus
      logger.info(`Added ${amount} bonus invites to ${userId} in guild ${guildId}. Reason: ${reason || 'No reason'}`);

      // Check for new rewards
      const guild = this.client.guilds.cache.get(guildId);
      const user = this.client.users.cache.get(userId);
      
      if (guild && user) {
        await this.checkInviteRewards(user, guild);
      }

      return true;

    } catch (error) {
      logger.error('Failed to add bonus invites:', error);

      return false;
    }
  }

  /**
   * Remove invites from a user
   */
  async removeInvites(userId: string, guildId: string, amount: number, reason?: string): Promise<boolean> {
    try {
      const stats = await this.getInviteStats(userId, guildId);
      
      if (!stats) return false;

      // Remove from valid invites first, then bonus
      const validToRemove = Math.min(amount, stats.validInvites);
      const bonusToRemove = Math.min(amount - validToRemove, stats.bonusInvites);

      stats.validInvites -= validToRemove;
      stats.bonusInvites -= bonusToRemove;
      stats.updatedAt = new Date();

      await this.saveInviteStats(stats);

      // Log the removal
      logger.info(`Removed ${validToRemove + bonusToRemove} invites from ${userId} in guild ${guildId}. Reason: ${reason || 'No reason'}`);

      return true;

    } catch (error) {
      logger.error('Failed to remove invites:', error);

      return false;
    }
  }

  /**
   * Get detailed invite information for a user
   */
  async getUserInviteInfo(userId: string, guildId: string): Promise<{
    stats: InviteStats | null;
    rank: number;
    nextReward: InviteReward | null;
  }> {
    try {
      const stats = await this.getInviteStats(userId, guildId);
      const leaderboard = await this.getInviteLeaderboard(guildId, 100);
      const rank = leaderboard.findIndex(s => s.userId === userId) + 1;
      
      const rewards = await this.getInviteRewards(guildId);
      const totalInvites = stats ? stats.validInvites + stats.bonusInvites : 0;
      
      const nextReward = rewards
        .filter(r => r.enabled && r.requiredInvites > totalInvites)
        .sort((a, b) => a.requiredInvites - b.requiredInvites)[0] || null;

      return { stats, rank, nextReward };

    } catch (error) {
      logger.error('Failed to get user invite info:', error);

      return { stats: null, rank: 0, nextReward: null };
    }
  }

  // Helper methods (placeholder implementations)
  private async getInviteStats(_userId: string, _guildId: string): Promise<InviteStats | null> {
    // Placeholder - would fetch from database
    return null;
  }

  private async createInviteStats(userId: string, guildId: string): Promise<InviteStats> {
    // Placeholder - would create in database
    return {
      userId,
      guildId,
      totalInvites: 0,
      validInvites: 0,
      fakeInvites: 0,
      leftInvites: 0,
      bonusInvites: 0,
      invitedUsers: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  private async saveInviteStats(_stats: InviteStats): Promise<void> {
    // Placeholder - would save to database
  }

  private async getInviteStatsForInvitedUser(_invitedUserId: string, _guildId: string): Promise<InviteStats | null> {
    // Placeholder - would find who invited this user
    return null;
  }

  private async getRecentInvites(_inviterId: string, _guildId: string): Promise<InviteData[]> {
    // Placeholder - would fetch recent invites from database
    return [];
  }

  private async getInviteRewards(_guildId: string): Promise<InviteReward[]> {
    // Placeholder - would fetch from database
    return [];
  }

  private async hasReceivedReward(_userId: string, _rewardId: string): Promise<boolean> {
    // Placeholder - would check database
    return false;
  }

  private async markRewardReceived(_userId: string, _rewardId: string): Promise<void> {
    // Placeholder - would save to database
  }

  private async logInviteAction(
    inviter: User, 
    invitedMember: GuildMember, 
    invite: Invite, 
    action: 'join' | 'leave'
  ): Promise<void> {
    // Placeholder - would log to database or logging service
    logger.info(`Invite ${action}: ${invitedMember.user.tag} ${action === 'join' ? 'joined' : 'left'} via invite by ${inviter.tag}`);
  }
}
