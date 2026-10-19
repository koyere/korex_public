import { logger } from '../utils/Logger';
import { DatabaseManager } from '../client/managers/DatabaseManager';
import { Guild, GuildMember, TextChannel, EmbedBuilder, Colors, VoiceState } from 'discord.js';
import { isCoreModuleEnabled } from '../config/coreModules';
import { i18n } from '../utils/i18n';
import { AutoRoleService } from './AutoRoleService';
import { STARTING_BALANCE } from '../services/EconomyService';

export interface LevelUser {
  guildId: string;
  userId: string;
  xp: number;
  level: number;
  totalXp: number;
  messages: number;
  voiceMinutes: number;
  lastXpGain: Date | null;
}

export interface LevelConfig {
  guildId: string;
  enabled: boolean;
  xpPerMessage: number;
  xpPerVoiceMinute: number;
  xpCooldown: number;
  xpMultiplier: number;
  bonusChannels: Record<string, number>;
  bonusRoles: Record<string, number>;
  ignoredChannels: string[];
  ignoredRoles: string[];
  levelUpEnabled: boolean;
  levelUpChannelId: string | null;
  levelUpMessage: string;
  levelRoles: Record<number, string>;
  stackRoles: boolean;
}

export interface LevelUpResult {
  leveledUp: boolean;
  oldLevel: number;
  newLevel: number;
  xpGained: number;
  roleRewards?: string[];
}

export class LevelService {
  private static instance: LevelService;
  private logger = logger;
  private db: DatabaseManager | null = null;

  // AutoRoleService is initialized in KorexClient before any messages arrive
  private get autoRoleService(): AutoRoleService | null {
    try { return AutoRoleService.getInstance(); } catch { return null; }
  }
  private userCache = new Map<string, LevelUser>();
  private cooldowns = new Map<string, number>();

  private constructor() {}

  public static getInstance(): LevelService {
    if (!LevelService.instance) {
      LevelService.instance = new LevelService();
    }

    return LevelService.instance;
  }

  /**
   * Initializes the database connection
   */
  public setDatabase(db: DatabaseManager): void {
    this.db = db;
  }

  /**
   * Gets a user's level data
   */
  public async getUser(guildId: string, userId: string): Promise<LevelUser> {
    const cacheKey = `${guildId}:${userId}`;

    // Check cache first
    let user = this.userCache.get(cacheKey);

    if (!user && this.db) {
      // Look up in the database
      const dbUser = await this.db.prisma.guildUser.findUnique({
        where: {
          guildId_userId: {
            guildId,
            userId,
          },
        },
      });

      if (dbUser) {
        user = {
          guildId: dbUser.guildId,
          userId: dbUser.userId,
          xp: dbUser.xp,
          level: dbUser.level,
          totalXp: dbUser.totalXp,
          messages: dbUser.messages,
          voiceMinutes: dbUser.voiceMinutes,
          lastXpGain: dbUser.lastXpGain || null,
        };
      } else {
        // Create new user
        user = await this.createUser(guildId, userId);
      }

      // Cache for 5 minutes
      this.userCache.set(cacheKey, user);
      setTimeout(() => this.userCache.delete(cacheKey), 5 * 60 * 1000);
    }

    return (
      user || {
        guildId,
        userId,
        xp: 0,
        level: 0,
        totalXp: 0,
        messages: 0,
        voiceMinutes: 0,
        lastXpGain: null,
      }
    );
  }

  /**
   * Creates a new user in the leveling system
   */
  private async createUser(guildId: string, userId: string): Promise<LevelUser> {
    if (!this.db) {
      throw new Error('Database not available');
    }

    // Ensure global User record exists before creating GuildUser (FK constraint)
    await this.db.prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId },
    });

    const dbUser = await this.db.prisma.guildUser.upsert({
      where: {
        guildId_userId: {
          guildId,
          userId,
        },
      },
      update: {},
      create: {
        guildId,
        userId,
        xp: 0,
        level: 0,
        totalXp: 0,
        messages: 0,
        voiceMinutes: 0,
        balance: STARTING_BALANCE,
      },
    });

    return {
      guildId: dbUser.guildId,
      userId: dbUser.userId,
      xp: dbUser.xp,
      level: dbUser.level,
      totalXp: dbUser.totalXp,
      messages: dbUser.messages,
      voiceMinutes: dbUser.voiceMinutes,
      lastXpGain: dbUser.lastXpGain || null,
    };
  }

  /**
   * Updates a user's data
   */
  private async updateUser(user: LevelUser): Promise<void> {
    if (!this.db) {
      throw new Error('Database not available');
    }

    await this.db.prisma.guildUser.update({
      where: {
        guildId_userId: {
          guildId: user.guildId,
          userId: user.userId,
        },
      },
      data: {
        xp: user.xp,
        level: user.level,
        totalXp: user.totalXp,
        messages: user.messages,
        voiceMinutes: user.voiceMinutes,
        lastXpGain: user.lastXpGain || null,
      },
    });

    // Update cache
    const cacheKey = `${user.guildId}:${user.userId}`;

    this.userCache.set(cacheKey, user);
  }

  /**
   * Returns whether the 'levels' module is enabled at the guild level.
   * An empty enabledAddons array (legacy guilds) is treated as "all enabled".
   */
  private async isGuildModuleEnabled(guildId: string, moduleName: string): Promise<boolean> {
    if (!this.db) return true;
    const guild = await this.db.prisma.guild.findUnique({
      where: { id: guildId },
      select: { enabledAddons: true },
    });
    return isCoreModuleEnabled(guild?.enabledAddons, moduleName);
  }

  /**
   * Gets a server's leveling configuration
   */
  public async getConfig(guildId: string): Promise<LevelConfig> {
    if (!this.db) {
      return this.getDefaultConfig(guildId);
    }

    try {
      // Parallel: fetch module toggle and config at the same time
      const [moduleEnabled, config] = await Promise.all([
        this.isGuildModuleEnabled(guildId, 'levels'),
        this.db.prisma.levelConfig.findUnique({ where: { guildId } }),
      ]);

      if (!config) {
        const defaults = this.getDefaultConfig(guildId);
        return { ...defaults, enabled: moduleEnabled ? defaults.enabled : false };
      }

      return {
        guildId: config.guildId,
        // Module toggle takes precedence over the per-guild granular setting
        enabled: moduleEnabled ? config.enabled : false,
        xpPerMessage: config.xpPerMessage,
        xpPerVoiceMinute: config.xpPerVoiceMinute,
        xpCooldown: config.xpCooldown,
        xpMultiplier: config.xpMultiplier,
        bonusChannels: (config.bonusChannels as Record<string, number>) || undefined,
        bonusRoles: (config.bonusRoles as Record<string, number>) || undefined,
        ignoredChannels: config.ignoredChannels,
        ignoredRoles: config.ignoredRoles,
        levelUpEnabled: config.levelUpEnabled,
        levelUpChannelId: config.levelUpChannelId || null,
        levelUpMessage: config.levelUpMessage,
        levelRoles: (config.levelRoles as Record<number, string>) || {},
        stackRoles: config.stackRoles,
      };
    } catch (error) {
      this.logger.error('Error getting level config:', error);

      return this.getDefaultConfig(guildId);
    }
  }

  private getDefaultConfig(guildId: string): LevelConfig {
    return {
      guildId,
      enabled: true,
      xpPerMessage: 15,
      xpPerVoiceMinute: 5,
      xpCooldown: 60, // 1 minute in seconds
      xpMultiplier: 1.0,
      bonusChannels: {},
      bonusRoles: {},
      ignoredChannels: [],
      ignoredRoles: [],
      levelUpEnabled: true,
      levelUpChannelId: null,
      levelUpMessage: '',
      levelRoles: {},
      stackRoles: false,
    };
  }

  /**
   * Adds XP for a message
   */
  public async addMessageXp(
    guild: Guild,
    member: GuildMember,
    channelId: string,
    currentChannel?: TextChannel
  ): Promise<LevelUpResult> {
    const config = await this.getConfig(guild.id);

    if (!config.enabled) {
      return {
        leveledUp: false,
        oldLevel: 0,
        newLevel: 0,
        xpGained: 0,
      };
    }

    // Check whether the channel is ignored
    if (config.ignoredChannels.includes(channelId)) {
      return {
        leveledUp: false,
        oldLevel: 0,
        newLevel: 0,
        xpGained: 0,
      };
    }

    // Check whether the user has ignored roles
    const hasIgnoredRole = member.roles.cache.some((role) => config.ignoredRoles.includes(role.id));

    if (hasIgnoredRole) {
      return {
        leveledUp: false,
        oldLevel: 0,
        newLevel: 0,
        xpGained: 0,
      };
    }

    // Check cooldown
    const cooldownKey = `${guild.id}:${member.id}`;
    const now = Date.now();
    const lastXp = this.cooldowns.get(cooldownKey) || 0;

    if (now - lastXp < config.xpCooldown * 1000) {
      return {
        leveledUp: false,
        oldLevel: 0,
        newLevel: 0,
        xpGained: 0,
      };
    }

    this.cooldowns.set(cooldownKey, now);

    const user = await this.getUser(guild.id, member.id);
    const oldLevel = user.level;

    // Calculate base XP
    let xpGain = config.xpPerMessage;

    // Apply global multiplier
    xpGain *= config.xpMultiplier;

    // Apply channel bonus
    if (config.bonusChannels && config.bonusChannels[channelId]) {
      xpGain *= config.bonusChannels[channelId];
    }

    // Apply role bonus
    if (config.bonusRoles) {
      for (const role of member.roles.cache.values()) {
        if (config.bonusRoles[role.id]) {
          xpGain *= config.bonusRoles[role.id];
          break; // Only apply the first bonus found
        }
      }
    }

    // Round XP
    xpGain = Math.round(xpGain);

    // Add XP
    user.xp += xpGain;
    user.totalXp += xpGain;
    user.messages += 1;
    user.lastXpGain = new Date();

    // Check whether the user leveled up
    const newLevel = this.calculateLevel(user.totalXp);
    const leveledUp = newLevel > oldLevel;

    if (leveledUp) {
      user.level = newLevel;
      user.xp = user.totalXp - this.getXpForLevel(newLevel);
    }

    await this.updateUser(user);

    const result: LevelUpResult = {
      leveledUp,
      oldLevel,
      newLevel,
      xpGained: xpGain,
    };

    // Handle level-up
    if (leveledUp) {
      result.roleRewards = await this.handleLevelUp(guild, member, newLevel, config);

      if (config.levelUpEnabled) {
        await this.sendLevelUpMessage(guild, member, newLevel, config, currentChannel);
      }
    }

    return result;
  }

  // Ongoing voice sessions: guildId:userId → start (ms)
  private voiceSessions = new Map<string, number>();

  /**
   * Voice time tracking for per-minute XP (voiceStateUpdate).
   * Ignores the AFK channel and bots; minutes are credited on leave/switch.
   */
  public async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
    const member = newState.member ?? oldState.member;
    if (!member || member.user.bot) return;

    const key = `${member.guild.id}:${member.id}`;
    const afkId = member.guild.afkChannelId;
    const wasCounting = !!oldState.channelId && oldState.channelId !== afkId;
    const isCounting = !!newState.channelId && newState.channelId !== afkId;

    if (wasCounting && (!isCounting || oldState.channelId !== newState.channelId)) {
      const started = this.voiceSessions.get(key);
      this.voiceSessions.delete(key);
      if (started) {
        const minutes = Math.floor((Date.now() - started) / 60_000);
        if (minutes >= 1) {
          // Voice activity for Analytics (minutes per day)
          await this.db?.prisma.logEntry.create({
            data: { guildId: member.guild.id, type: 'voice', userId: member.id, channelId: oldState.channelId, data: { minutes } },
          }).catch(() => null);
          await this.addVoiceXp(member.guild, member, Math.min(minutes, 24 * 60), oldState.channelId!);
        }
      }
    }
    if (isCounting && !this.voiceSessions.has(key)) {
      this.voiceSessions.set(key, Date.now());
    }
  }

  /**
   * Adds XP for time spent in a voice channel
   */
  public async addVoiceXp(
    guild: Guild,
    member: GuildMember,
    minutes: number,
    channelId?: string
  ): Promise<LevelUpResult> {
    const config = await this.getConfig(guild.id);
    const moduleEnabled = await this.isGuildModuleEnabled(guild.id, 'levels');
    const ignored =
      (channelId && config.ignoredChannels.includes(channelId)) ||
      member.roles.cache.some((r) => config.ignoredRoles.includes(r.id));

    if (!config.enabled || !moduleEnabled || ignored || config.xpPerVoiceMinute <= 0) {
      return {
        leveledUp: false,
        oldLevel: 0,
        newLevel: 0,
        xpGained: 0,
      };
    }

    const user = await this.getUser(guild.id, member.id);
    const oldLevel = user.level;

    // Calculate voice XP
    let xpGain = config.xpPerVoiceMinute * minutes;

    xpGain *= config.xpMultiplier;
    xpGain = Math.round(xpGain);

    // Add XP
    user.xp += xpGain;
    user.totalXp += xpGain;
    user.voiceMinutes += minutes;

    // Check whether the user leveled up
    const newLevel = this.calculateLevel(user.totalXp);
    const leveledUp = newLevel > oldLevel;

    if (leveledUp) {
      user.level = newLevel;
      user.xp = user.totalXp - this.getXpForLevel(newLevel);
    }

    await this.updateUser(user);

    const result: LevelUpResult = {
      leveledUp,
      oldLevel,
      newLevel,
      xpGained: xpGain,
    };

    // Handle level-up
    if (leveledUp) {
      result.roleRewards = await this.handleLevelUp(guild, member, newLevel, config);

      if (config.levelUpEnabled) {
        await this.sendLevelUpMessage(guild, member, newLevel, config);
      }
    }

    return result;
  }

  /**
   * Calculates the level based on total XP
   */
  public calculateLevel(totalXp: number): number {
    // Formula: level = floor(sqrt(totalXp / 100))
    return Math.floor(Math.sqrt(totalXp / 100));
  }

  /**
   * Calculates the XP required for a specific level
   */
  public getXpForLevel(level: number): number {
    // Formula: xp = (level^2) * 100
    return level * level * 100;
  }

  /**
   * Calculates the XP required for the next level
   */
  public getXpForNextLevel(currentLevel: number): number {
    return this.getXpForLevel(currentLevel + 1);
  }

  /**
   * Handles level-ups (roles, etc.)
   */
  private async handleLevelUp(
    guild: Guild,
    member: GuildMember,
    newLevel: number,
    config: LevelConfig
  ): Promise<string[]> {
    const roleRewards: string[] = [];

    // Level roles from Levels (dashboard → Levels → Rewards)
    if (config.levelRoles && Object.keys(config.levelRoles).length > 0) {
      try {
        const botTop = guild.members.me?.roles.highest;
        // All levels reached (covers jumping several levels at once)
        const earned = Object.entries(config.levelRoles)
          .map(([level, roleId]) => ({ level: parseInt(level, 10), roleId: String(roleId) }))
          .filter((r) => Number.isFinite(r.level) && r.level <= newLevel)
          .sort((a, b) => b.level - a.level);

        const toGrant = config.stackRoles ? earned : earned.slice(0, 1);
        for (const { roleId } of toGrant) {
          const role = guild.roles.cache.get(roleId);
          if (!role || role.managed || (botTop && role.comparePositionTo(botTop) >= 0)) continue;
          if (!member.roles.cache.has(role.id)) {
            await member.roles.add(role, `Level up reward - Level ${newLevel}`);
            roleRewards.push(role.name);
          }
        }

        // If roles are not stacked, remove those from lower levels
        if (!config.stackRoles && toGrant.length > 0) {
          const keep = toGrant[0].roleId;
          const remove = Object.values(config.levelRoles)
            .map(String)
            .filter((id) => id !== keep && member.roles.cache.has(id));
          if (remove.length > 0) await member.roles.remove(remove, 'Level up - removing old level roles');
        }
      } catch (error) {
        this.logger.error('Error handling level up roles:', error);
      }
    }

    // Level roles configured with /autoroles level
    await this.autoRoleService?.handleLevelUp(member, newLevel);

    // Level-up for Analytics
    await this.db?.prisma.logEntry.create({
      data: { guildId: guild.id, type: 'levelup', userId: member.id, data: { level: newLevel } },
    }).catch(() => null);

    return roleRewards;
  }


  /**
   * Sends the level-up message
   */
  private async sendLevelUpMessage(
    guild: Guild,
    member: GuildMember,
    newLevel: number,
    config: LevelConfig,
    currentChannel?: TextChannel
  ): Promise<void> {
    try {
      let channel: TextChannel | null = null;

      // 1. Use the specifically configured channel
      if (config.levelUpChannelId) {
        channel = guild.channels.cache.get(config.levelUpChannelId) as TextChannel;
      }

      // 2. Use the message's current channel (if provided)
      if (!channel && currentChannel) {
        channel = currentChannel;
      }

      if (!channel) {
        this.logger.warn(`No suitable channel found for level up message in guild ${guild.id}`);

        return;
      }

      // Check bot permissions
      const permissions = channel.permissionsFor(guild.members.me!);

      if (!permissions?.has(['SendMessages', 'EmbedLinks'])) {
        this.logger.warn(`Missing permissions in channel ${channel.id} for level up message`);

        return;
      }

      // Format message (every occurrence of each variable)
      const t = (key: string, vars?: Record<string, string>) => i18n.t(key, guild.id, vars);
      // The schema default value is in Spanish: it is treated as "not customized"
      const SCHEMA_DEFAULT = '🎉 ¡{user} subió al nivel {level}!';
      const custom = config.levelUpMessage?.trim();
      const template = custom && custom !== SCHEMA_DEFAULT ? custom : t('levels.levelup.default_message');
      const message = template
        .replaceAll('{user}', member.toString())
        .replaceAll('{level}', newLevel.toString())
        .replaceAll('{username}', member.user.username)
        .replaceAll('{displayName}', member.displayName)
        .slice(0, 4096);

      const embed = new EmbedBuilder()
        .setColor(Colors.Gold)
        .setTitle(t('levels.levelup.title'))
        .setDescription(message)
        .addFields({
          name: t('levels.levelup.progress'),
          value: t('levels.levelup.progress_value', {
            level: String(newLevel),
            xp: String((await this.getUser(guild.id, member.id)).totalXp),
          }),
          inline: true,
        })
        .setThumbnail(member.user.displayAvatarURL())
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    } catch (error) {
      this.logger.error('Error sending level up message:', error);
    }
  }

  /**
   * Gets the level leaderboard
   */
  public async getLeaderboard(guildId: string, limit: number = 10, offset: number = 0): Promise<LevelUser[]> {
    try {
      if (!this.db) {
        return [];
      }

      const users = await this.db.prisma.guildUser.findMany({
        where: { guildId, totalXp: { gt: 0 } },
        orderBy: [{ level: 'desc' }, { totalXp: 'desc' }],
        skip: offset,
        take: limit,
      });

      return users.map((user) => ({
        guildId: user.guildId,
        userId: user.userId,
        xp: user.xp,
        level: user.level,
        totalXp: user.totalXp,
        messages: user.messages,
        voiceMinutes: user.voiceMinutes,
        lastXpGain: user.lastXpGain || null,
      }));
    } catch (error) {
      this.logger.error('Error getting leaderboard:', error);

      return [];
    }
  }

  /**
   * Gets a user's position on the leaderboard
   */
  public async getUserRank(guildId: string, userId: string): Promise<number> {
    try {
      if (!this.db) {
        return 0;
      }

      const user = await this.getUser(guildId, userId);

      const rank = await this.db.prisma.guildUser.count({
        where: {
          guildId,
          OR: [
            { level: { gt: user.level } },
            {
              level: user.level,
              totalXp: { gt: user.totalXp },
            },
          ],
        },
      });

      return rank + 1;
    } catch (error) {
      this.logger.error('Error getting user rank:', error);

      return 0;
    }
  }

  /**
   * Manually adds XP to a user
   */
  public async addXp(
    guild: Guild,
    userId: string,
    amount: number,
    reason: string = 'Manual addition'
  ): Promise<LevelUpResult> {
    try {
      // Respects the leveling system (config and module toggle), e.g. XP for invites
      const levelConfig = await this.getConfig(guild.id);
      if (!levelConfig.enabled || !(await this.isGuildModuleEnabled(guild.id, 'levels'))) {
        return { leveledUp: false, oldLevel: 0, newLevel: 0, xpGained: 0 };
      }

      const user = await this.getUser(guild.id, userId);
      const oldLevel = user.level;

      user.xp += amount;
      user.totalXp += amount;

      // Check whether the user leveled up
      const newLevel = this.calculateLevel(user.totalXp);
      const leveledUp = newLevel > oldLevel;

      if (leveledUp) {
        user.level = newLevel;
        user.xp = user.totalXp - this.getXpForLevel(newLevel);
      }

      await this.updateUser(user);

      this.logger.info(
        `Added ${amount} XP to user ${userId} in guild ${guild.id}. Reason: ${reason}`
      );

      const result: LevelUpResult = {
        leveledUp,
        oldLevel,
        newLevel,
        xpGained: amount,
      };

      // Handle level-up if needed
      if (leveledUp) {
        const member = await guild.members.fetch(userId).catch(() => null);

        if (member) {
          const config = await this.getConfig(guild.id);

          result.roleRewards = await this.handleLevelUp(guild, member, newLevel, config);

          if (config.levelUpEnabled) {
            await this.sendLevelUpMessage(guild, member, newLevel, config);
          }
        }
      }

      return result;
    } catch (error) {
      this.logger.error('Error adding XP:', error);

      return {
        leveledUp: false,
        oldLevel: 0,
        newLevel: 0,
        xpGained: 0,
      };
    }
  }

  /**
   * Removes XP from a user
   */
  public async removeXp(
    guild: Guild,
    userId: string,
    amount: number,
    reason: string = 'Manual removal'
  ): Promise<LevelUpResult> {
    try {
      const user = await this.getUser(guild.id, userId);
      const oldLevel = user.level;

      user.totalXp = Math.max(0, user.totalXp - amount);

      // Recalculate level and current XP
      const newLevel = this.calculateLevel(user.totalXp);

      user.level = newLevel;
      user.xp = user.totalXp - this.getXpForLevel(newLevel);

      await this.updateUser(user);

      this.logger.info(
        `Removed ${amount} XP from user ${userId} in guild ${guild.id}. Reason: ${reason}`
      );

      return {
        leveledUp: false,
        oldLevel,
        newLevel,
        xpGained: -amount,
      };
    } catch (error) {
      this.logger.error('Error removing XP:', error);

      return {
        leveledUp: false,
        oldLevel: 0,
        newLevel: 0,
        xpGained: 0,
      };
    }
  }

  /**
   * Gets the server's leveling statistics
   */
  public async getServerStats(guildId: string): Promise<{
    totalUsers: number;
    totalXp: number;
    averageLevel: number;
    highestLevel: number;
    totalMessages: number;
    totalVoiceMinutes: number;
  }> {
    try {
      if (!this.db) {
        return {
          totalUsers: 0,
          totalXp: 0,
          averageLevel: 0,
          highestLevel: 0,
          totalMessages: 0,
          totalVoiceMinutes: 0,
        };
      }

      const stats = await this.db.prisma.guildUser.aggregate({
        where: { guildId },
        _count: { userId: true },
        _sum: {
          totalXp: true,
          messages: true,
          voiceMinutes: true,
        },
        _avg: { level: true },
        _max: { level: true },
      });

      return {
        totalUsers: stats._count.userId,
        totalXp: stats._sum.totalXp || 0,
        averageLevel: Math.round(stats._avg.level || 0),
        highestLevel: stats._max.level || 0,
        totalMessages: stats._sum.messages || 0,
        totalVoiceMinutes: stats._sum.voiceMinutes || 0,
      };
    } catch (error) {
      this.logger.error('Error getting server stats:', error);

      return {
        totalUsers: 0,
        totalXp: 0,
        averageLevel: 0,
        highestLevel: 0,
        totalMessages: 0,
        totalVoiceMinutes: 0,
      };
    }
  }
}
