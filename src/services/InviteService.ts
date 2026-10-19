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
import { InviteRewardService } from './InviteRewardService';

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
  /** Invitees whose join was counted as fake (so they are not subtracted from valid ones when leaving) */
  fakeInvitedUsers: string[];
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
  /** Invite rewards (threshold → role). */
  public rewards: InviteRewardService;

  constructor(client: KorexClient) {
    this.client = client;
    this.prisma = client.db;
    this.rewards = new InviteRewardService(client);
  }

  /** Caches the invites of all servers (call when the client is ready). */
  async init(): Promise<void> {
    await this.initializeInviteTracking();
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

      // If the member already had rewards (left and came back), they are restored silently
      this.rewards.syncMember(guild, member.id, { announce: false }).catch(() => {});

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

        // Recalculate the inviter's rewards (may drop below a threshold)
        await this.rewards.syncMember(member.guild, inviteStats.userId);
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
      if (action === 'join') {
        // Check if it's a potential fake invite (before the lock: may query Discord)
        const isFake = await this.detectFakeInvite(inviter, invitedMember);

        await this.mutateInviteStats(inviter.id, invitedMember.guild.id, (stats) => {
          stats.totalInvites++;

          if (isFake) {
            stats.fakeInvites++;
            stats.fakeInvitedUsers.push(invitedMember.id);
          } else {
            stats.validInvites++;
            stats.fakeInvitedUsers = stats.fakeInvitedUsers.filter(id => id !== invitedMember.id);
          }

          stats.invitedUsers.push(invitedMember.id);
        });
      }

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
      await this.mutateInviteStats(inviterId, leftMember.guild.id, (stats) => {
        // Only count the leave if the user was still on the list (prevents double subtraction)
        const userIndex = stats.invitedUsers.indexOf(leftMember.id);

        if (userIndex === -1) return false;

        stats.invitedUsers.splice(userIndex, 1);
        stats.leftInvites++;

        // A join counted as fake did not add to the valid ones: it is not subtracted from them
        const fakeIndex = stats.fakeInvitedUsers.indexOf(leftMember.id);

        if (fakeIndex !== -1) {
          stats.fakeInvitedUsers.splice(fakeIndex, 1);
        } else {
          stats.validInvites = Math.max(0, stats.validInvites - 1);
        }
      }, false);

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
   * Check and apply invite rewards (roles by valid invite threshold)
   */
  private async checkInviteRewards(inviter: User, guild: Guild): Promise<void> {
    try {
      await this.rewards.syncMember(guild, inviter.id);
    } catch (error) {
      logger.error('Failed to check invite rewards:', error);
    }
  }

  /**
   * Get invite leaderboard
   */
  async getInviteLeaderboard(guildId: string, limit: number = 10, offset: number = 0): Promise<InviteStats[]> {
    try {
      // Sorted by effective invites (valid + bonus)
      const rows = await this.prisma.$queryRaw<any[]>`
        SELECT * FROM invite_stats
        WHERE "guildId" = ${guildId} AND ("validInvites" + "bonusInvites") > 0
        ORDER BY ("validInvites" + "bonusInvites") DESC, "totalInvites" DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      return rows.map((r) => this.rowToStats(r));
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
      await this.mutateInviteStats(userId, guildId, (stats) => {
        stats.bonusInvites += amount;
      });

      // Log the bonus
      logger.info(`Added ${amount} bonus invites to ${userId} in guild ${guildId}. Reason: ${reason || 'No reason'}`);

      // Check for new rewards
      const guild = this.client.guilds.cache.get(guildId);

      if (guild) {
        // By id: the user may not be in the user cache
        await this.rewards.syncMember(guild, userId);
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
      let validToRemove = 0;
      let bonusToRemove = 0;

      const found = await this.mutateInviteStats(userId, guildId, (stats) => {
        // Remove from valid invites first, then bonus
        validToRemove = Math.min(amount, stats.validInvites);
        bonusToRemove = Math.min(amount - validToRemove, stats.bonusInvites);

        stats.validInvites -= validToRemove;
        stats.bonusInvites -= bonusToRemove;
      }, false);

      if (!found) return false;

      // Log the removal
      logger.info(`Removed ${validToRemove + bonusToRemove} invites from ${userId} in guild ${guildId}. Reason: ${reason || 'No reason'}`);

      // Recalculate rewards (may drop below a threshold)
      const guild = this.client.guilds.cache.get(guildId);

      if (guild) {
        await this.rewards.syncMember(guild, userId);
      }

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

  // ─── Persistence (invite_stats table) ────────────────────────────────────
  private rowToStats(row: any): InviteStats {
    return {
      userId: row.userId,
      guildId: row.guildId,
      totalInvites: row.totalInvites,
      validInvites: row.validInvites,
      fakeInvites: row.fakeInvites,
      leftInvites: row.leftInvites,
      bonusInvites: row.bonusInvites,
      invitedUsers: row.invitedUsers ?? [],
      fakeInvitedUsers: row.fakeInvitedUsers ?? [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async getInviteStats(userId: string, guildId: string): Promise<InviteStats | null> {
    const row = await this.prisma.inviteStats.findUnique({ where: { guildId_userId: { guildId, userId } } });
    return row ? this.rowToStats(row) : null;
  }

  private async createInviteStats(userId: string, guildId: string): Promise<InviteStats> {
    return {
      userId,
      guildId,
      totalInvites: 0,
      validInvites: 0,
      fakeInvites: 0,
      leftInvites: 0,
      bonusInvites: 0,
      invitedUsers: [],
      fakeInvitedUsers: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  private async saveInviteStats(stats: InviteStats): Promise<void> {
    const data = {
      totalInvites: stats.totalInvites,
      validInvites: stats.validInvites,
      fakeInvites: stats.fakeInvites,
      leftInvites: stats.leftInvites,
      bonusInvites: stats.bonusInvites,
      invitedUsers: [...new Set(stats.invitedUsers)].slice(-1000),
      fakeInvitedUsers: [...new Set(stats.fakeInvitedUsers)].slice(-1000),
    };
    await this.prisma.inviteStats.upsert({
      where: { guildId_userId: { guildId: stats.guildId, userId: stats.userId } },
      update: data,
      create: { guildId: stats.guildId, userId: stats.userId, ...data },
    });
  }

  /**
   * Atomically modifies an inviter's statistics: locks the row
   * (SELECT ... FOR UPDATE) inside a transaction so that two simultaneous joins or
   * leaves do not overwrite each other. If `fn` returns false, nothing is saved.
   * Returns false if the row did not exist and `create` is false.
   */
  private async mutateInviteStats(
    userId: string,
    guildId: string,
    fn: (stats: InviteStats) => void | boolean,
    create = true,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      if (create) {
        await tx.inviteStats.upsert({
          where: { guildId_userId: { guildId, userId } },
          update: {},
          create: { guildId, userId },
        });
      }

      const rows = await tx.$queryRaw<any[]>`
        SELECT * FROM "invite_stats" WHERE "guildId" = ${guildId} AND "userId" = ${userId} FOR UPDATE`;

      if (!rows.length) return false;

      const stats = this.rowToStats(rows[0]);

      if (fn(stats) === false) return true;

      await tx.inviteStats.update({
        where: { guildId_userId: { guildId, userId } },
        data: {
          totalInvites: stats.totalInvites,
          validInvites: stats.validInvites,
          fakeInvites: stats.fakeInvites,
          leftInvites: stats.leftInvites,
          bonusInvites: stats.bonusInvites,
          invitedUsers: [...new Set(stats.invitedUsers)].slice(-1000),
          fakeInvitedUsers: [...new Set(stats.fakeInvitedUsers)].slice(-1000),
        },
      });

      return true;
    });
  }

  private async getInviteStatsForInvitedUser(invitedUserId: string, guildId: string): Promise<InviteStats | null> {
    const row = await this.prisma.inviteStats.findFirst({ where: { guildId, invitedUsers: { has: invitedUserId } } });
    return row ? this.rowToStats(row) : null;
  }

  private async getRecentInvites(_inviterId: string, _guildId: string): Promise<InviteData[]> {
    // Placeholder - would fetch recent invites from database
    return [];
  }

  private async getInviteRewards(guildId: string): Promise<InviteReward[]> {
    const { settings, tiers } = await this.rewards.getSetup(guildId);

    return tiers.map((tier) => ({
      id: tier.id,
      guildId,
      requiredInvites: tier.requiredInvites,
      type: 'role' as const,
      value: tier.roleId,
      description: `<@&${tier.roleId}>`,
      oneTime: false,
      enabled: settings.enabled,
    }));
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
