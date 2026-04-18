import {
  Guild,
  GuildMember,
  Role,
  ColorResolvable,
  MessageReaction,
  PartialMessageReaction,
  User,
  PartialUser,
  TextChannel,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import { Prisma } from '@prisma/client';
import { logger } from '../utils/Logger';
import { DatabaseManager } from '../client/managers/DatabaseManager';
import { i18n } from '../utils/i18n';

export interface AutoRoleConfig {
  guildId: string;
  joinRoles: string[]; // Roles assigned on join
  levelRoles: LevelRole[]; // Roles assigned based on level
  reactionRoles: ReactionRole[]; // Roles assigned via reactions
  boostRoles: string[]; // Roles assigned to boosters
  enabled: boolean;
}

export interface LevelRole {
  level: number;
  roleId: string;
  removeOthers: boolean; // Remove other level roles when assigning this one
}

export interface ReactionRole {
  messageId: string;
  channelId: string;
  emoji: string;
  roleId: string;
  description?: string;
  requireRole?: string; // Role required to react
  maxUses?: number; // Max times this reaction role can be used
  currentUses?: number;
}

export interface ReactionRoleMessage {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string;
  title: string;
  description: string;
  color: string;
  roles: ReactionRole[];
  type: 'SINGLE' | 'MULTIPLE' | 'UNIQUE'; // SINGLE: one role only, MULTIPLE: multiple roles, UNIQUE: one per category
}

export class AutoRoleService {
  private static instance: AutoRoleService;
  private logger = logger;
  private db: DatabaseManager;

  private constructor(db: DatabaseManager) {
    this.db = db;
  }

  public static getInstance(db?: DatabaseManager): AutoRoleService {
    if (!AutoRoleService.instance) {
      if (!db) {
        throw new Error('DatabaseManager is required for first initialization');
      }
      AutoRoleService.instance = new AutoRoleService(db);
    }

    return AutoRoleService.instance;
  }

  /**
   * Handle member join - assign join roles
   */
  public async handleMemberJoin(member: GuildMember): Promise<void> {
    try {
      const config = await this.getAutoRoleConfig(member.guild.id);

      if (!config.enabled || config.joinRoles.length === 0) {
        return;
      }

      const rolesToAdd: Role[] = [];

      for (const roleId of config.joinRoles) {
        const role = member.guild.roles.cache.get(roleId);

        if (role && this.canAssignRole(member.guild, role)) {
          rolesToAdd.push(role);
        }
      }

      if (rolesToAdd.length > 0) {
        await member.roles.add(rolesToAdd, 'Auto-role on join');
        this.logger.info(
          `Assigned ${rolesToAdd.length} join roles to ${member.user.tag} in ${member.guild.name}`
        );
      }
    } catch (error) {
      this.logger.error('Error handling member join auto-roles:', error);
    }
  }

  /**
   * Handle level up - assign level roles
   */
  public async handleLevelUp(member: GuildMember, newLevel: number): Promise<void> {
    try {
      const config = await this.getAutoRoleConfig(member.guild.id);

      if (!config.enabled || config.levelRoles.length === 0) {
        return;
      }

      // Find applicable level roles
      const applicableRoles = config.levelRoles
        .filter((lr) => lr.level <= newLevel)
        .sort((a, b) => b.level - a.level); // Highest level first

      if (applicableRoles.length === 0) {
        return;
      }

      const highestLevelRole = applicableRoles[0];
      const role = member.guild.roles.cache.get(highestLevelRole.roleId);

      if (!role || !this.canAssignRole(member.guild, role)) {
        return;
      }

      // Remove other level roles if specified
      if (highestLevelRole.removeOthers) {
        const otherLevelRoles = config.levelRoles
          .filter((lr) => lr.roleId !== highestLevelRole.roleId)
          .map((lr) => lr.roleId)
          .filter((roleId) => member.roles.cache.has(roleId));

        if (otherLevelRoles.length > 0) {
          await member.roles.remove(otherLevelRoles, 'Level role update');
        }
      }

      // Add the new level role if not already present
      if (!member.roles.cache.has(role.id)) {
        await member.roles.add(role, `Level ${newLevel} role`);
        this.logger.info(`Assigned level ${newLevel} role ${role.name} to ${member.user.tag}`);
      }
    } catch (error) {
      this.logger.error('Error handling level up auto-roles:', error);
    }
  }

  /**
   * Handle boost - assign boost roles
   */
  public async handleMemberBoost(member: GuildMember): Promise<void> {
    try {
      const config = await this.getAutoRoleConfig(member.guild.id);

      if (!config.enabled || config.boostRoles.length === 0) {
        return;
      }

      const rolesToAdd: Role[] = [];

      for (const roleId of config.boostRoles) {
        const role = member.guild.roles.cache.get(roleId);

        if (role && this.canAssignRole(member.guild, role) && !member.roles.cache.has(role.id)) {
          rolesToAdd.push(role);
        }
      }

      if (rolesToAdd.length > 0) {
        await member.roles.add(rolesToAdd, 'Server boost role');
        this.logger.info(`Assigned ${rolesToAdd.length} boost roles to ${member.user.tag}`);
      }
    } catch (error) {
      this.logger.error('Error handling boost auto-roles:', error);
    }
  }

  /**
   * Handle reaction add - assign reaction roles
   */
  public async handleReactionAdd(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser
  ): Promise<void> {
    try {
      if (user.bot) return;

      const message = reaction.message;

      if (!message.guild) return;

      const member = await message.guild.members.fetch(user.id).catch(() => null);

      if (!member) return;

      const reactionRole = await this.getReactionRole(
        message.guild.id,
        message.id,
        reaction.emoji.name || reaction.emoji.id || ''
      );

      if (!reactionRole) return;

      // Check if user has required role
      if (reactionRole.requireRole && !member.roles.cache.has(reactionRole.requireRole)) {
        await reaction.users.remove(user.id);

        return;
      }

      // Check usage limits
      if (reactionRole.maxUses && (reactionRole.currentUses || 0) >= reactionRole.maxUses) {
        await reaction.users.remove(user.id);

        return;
      }

      const role = message.guild.roles.cache.get(reactionRole.roleId);

      if (!role || !this.canAssignRole(message.guild, role)) {
        return;
      }

      // Handle different reaction role types
      const rrMessage = await this.getReactionRoleMessage(message.guild.id, message.id);

      if (rrMessage) {
        await this.handleReactionRoleType(member, role, rrMessage, reactionRole);
      } else {
        // Simple reaction role
        if (!member.roles.cache.has(role.id)) {
          await member.roles.add(role, 'Reaction role');
          await this.incrementReactionRoleUsage(reactionRole);
          this.logger.info(`Assigned reaction role ${role.name} to ${member.user.tag}`);
        }
      }
    } catch (error) {
      this.logger.error('Error handling reaction add:', error);
    }
  }

  /**
   * Handle reaction remove - remove reaction roles
   */
  public async handleReactionRemove(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser
  ): Promise<void> {
    try {
      if (user.bot) return;

      const message = reaction.message;

      if (!message.guild) return;

      const member = await message.guild.members.fetch(user.id).catch(() => null);

      if (!member) return;

      const reactionRole = await this.getReactionRole(
        message.guild.id,
        message.id,
        reaction.emoji.name || reaction.emoji.id || ''
      );

      if (!reactionRole) return;

      const role = message.guild.roles.cache.get(reactionRole.roleId);

      if (!role) return;

      if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role, 'Reaction role removed');
        await this.decrementReactionRoleUsage(reactionRole);
        this.logger.info(`Removed reaction role ${role.name} from ${member.user.tag}`);
      }
    } catch (error) {
      this.logger.error('Error handling reaction remove:', error);
    }
  }

  /**
   * Handle different reaction role message types
   */
  private async handleReactionRoleType(
    member: GuildMember,
    role: Role,
    rrMessage: ReactionRoleMessage,
    reactionRole: ReactionRole
  ): Promise<void> {
    switch (rrMessage.type) {
      case 'SINGLE': {
        // Remove all other roles from this message first
        const otherRoles = rrMessage.roles
          .filter((rr) => rr.roleId !== reactionRole.roleId)
          .map((rr) => rr.roleId)
          .filter((roleId) => member.roles.cache.has(roleId));

        if (otherRoles.length > 0) {
          await member.roles.remove(otherRoles, 'Single reaction role selection');
        }

        if (!member.roles.cache.has(role.id)) {
          await member.roles.add(role, 'Single reaction role');
        }
        break;
      }

      case 'MULTIPLE':
        // Allow multiple roles
        if (!member.roles.cache.has(role.id)) {
          await member.roles.add(role, 'Multiple reaction role');
        }
        break;

      case 'UNIQUE':
        // One role per category (implement category logic if needed)
        if (!member.roles.cache.has(role.id)) {
          await member.roles.add(role, 'Unique reaction role');
        }
        break;
    }

    await this.incrementReactionRoleUsage(reactionRole);
  }

  /**
   * Create a reaction role message
   */
  public async createReactionRoleMessage(
    guild: Guild,
    channel: TextChannel,
    config: Omit<ReactionRoleMessage, 'id' | 'guildId' | 'messageId'>
  ): Promise<ReactionRoleMessage> {
    try {
      const embed = new EmbedBuilder()
        .setColor(this.parseEmbedColor(config.color))
        .setTitle(config.title)
        .setDescription(config.description);

      // Add role information to embed
      for (const roleConfig of config.roles) {
        const role = guild.roles.cache.get(roleConfig.roleId);

        if (role) {
          embed.addFields({
            name: `${roleConfig.emoji} ${role.name}`,
            value: roleConfig.description || i18n.t('autorole.react_for_role', guild.id),
            inline: true,
          });
        }
      }

      const message = await channel.send({ embeds: [embed] });

      // Add reactions
      for (const roleConfig of config.roles) {
        await message.react(roleConfig.emoji);
      }

      // Save to database - using a temporary approach until Prisma is regenerated
      try {
        await this.db.prisma.$executeRaw`
          INSERT INTO reaction_role_messages (id, guildId, channelId, messageId, title, description, color, type, roles, createdAt)
          VALUES (${this.generateId()}, ${guild.id}, ${channel.id}, ${message.id}, ${config.title}, ${config.description}, ${config.color}, ${config.type}, ${JSON.stringify(config.roles)}, ${new Date()})
        `;
      } catch (dbError) {
        this.logger.warn('Could not save reaction role message to database:', dbError);
      }

      this.logger.info(`Created reaction role message in ${guild.name}`);

      return {
        id: this.generateId(),
        guildId: guild.id,
        channelId: channel.id,
        messageId: message.id,
        title: config.title,
        description: config.description,
        color: config.color,
        type: config.type,
        roles: config.roles,
      };
    } catch (error) {
      this.logger.error('Error creating reaction role message:', error);
      throw new Error('Failed to create reaction role message');
    }
  }

  /**
   * Generate a simple ID
   */
  private generateId(): string {
    return (
      Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
    );
  }

  /**
   * Check if bot can assign a role
   */
  private canAssignRole(guild: Guild, role: Role): boolean {
    const botMember = guild.members.me;

    if (!botMember) return false;

    return role.position < botMember.roles.highest.position && !role.managed;
  }

  /**
   * Get auto-role configuration for a guild
   */
  public async getAutoRoleConfig(guildId: string): Promise<AutoRoleConfig> {
    try {
      const config = await this.db.prisma.guildConfig.findUnique({
        where: { guildId },
      });

      if (!config) {
        // Create default configuration
        const defaultConfig = await this.db.prisma.guildConfig.create({
          data: {
            guildId,
            autoRoleEnabled: false,
            autoRoleJoinRoles: [],
            autoRoleLevelRoles: [],
            autoRoleBoostRoles: [],
          },
        });

        return {
          guildId: defaultConfig.guildId,
          enabled: defaultConfig.autoRoleEnabled,
          joinRoles: this.asArray<string>(defaultConfig.autoRoleJoinRoles),
          levelRoles: this.asArray<LevelRole>(defaultConfig.autoRoleLevelRoles),
          reactionRoles: [],
          boostRoles: this.asArray<string>(defaultConfig.autoRoleBoostRoles),
        };
      }

      // Get reaction roles separately
      const reactionRoles = await this.db.prisma.reactionRole.findMany({
        where: { guildId },
      });

      return {
        guildId: config.guildId,
        enabled: config.autoRoleEnabled,
        joinRoles: this.asArray<string>(config.autoRoleJoinRoles),
        levelRoles: this.asArray<LevelRole>(config.autoRoleLevelRoles),
        reactionRoles: reactionRoles.map((rr) => ({
          messageId: rr.messageId,
          channelId: rr.channelId,
          emoji: rr.emoji,
          roleId: rr.roleId,
          description: rr.description || '',
          requireRole: rr.requireRole || '',
          maxUses: rr.maxUses || 0,
          currentUses: rr.currentUses || 0,
        })),
        boostRoles: this.asArray<string>(config.autoRoleBoostRoles),
      };
    } catch (error) {
      this.logger.error('Error getting auto-role config:', error);
      throw new Error('Failed to get auto-role config');
    }
  }

  /**
   * Update auto-role configuration
   */
  public async updateAutoRoleConfig(
    guildId: string,
    updates: Partial<AutoRoleConfig>
  ): Promise<void> {
    try {
      const updateData = {} as Parameters<typeof this.db.prisma.guildConfig.upsert>[0]['update'];
      const createData = { guildId } as Parameters<typeof this.db.prisma.guildConfig.upsert>[0]['create'];

      if (updates.enabled !== undefined) {
        updateData.autoRoleEnabled = updates.enabled;
        createData.autoRoleEnabled = updates.enabled;
      }
      if (updates.joinRoles !== undefined) {
        updateData.autoRoleJoinRoles = updates.joinRoles;
        createData.autoRoleJoinRoles = updates.joinRoles;
      }
      if (updates.levelRoles !== undefined) {
        updateData.autoRoleLevelRoles = updates.levelRoles as unknown as Prisma.InputJsonValue;
        createData.autoRoleLevelRoles = updates.levelRoles as unknown as Prisma.InputJsonValue;
      }
      if (updates.boostRoles !== undefined) {
        updateData.autoRoleBoostRoles = updates.boostRoles;
        createData.autoRoleBoostRoles = updates.boostRoles;
      }

      await this.db.prisma.guildConfig.upsert({
        where: { guildId },
        update: updateData,
        create: createData,
      });

      this.logger.info(`Updated auto-role config for guild ${guildId}`);
    } catch (error) {
      this.logger.error('Error updating auto-role config:', error);
      throw new Error('Failed to update auto-role config');
    }
  }

  /**
   * Get reaction role by message and emoji
   */
  private async getReactionRole(
    guildId: string,
    messageId: string,
    emoji: string
  ): Promise<ReactionRole | null> {
    try {
      const reactionRole = await this.db.prisma.reactionRole.findFirst({
        where: {
          guildId,
          messageId,
          emoji,
        },
      });

      if (!reactionRole) return null;

      return {
        messageId: reactionRole.messageId,
        channelId: reactionRole.channelId,
        emoji: reactionRole.emoji,
        roleId: reactionRole.roleId,
        description: reactionRole.description || '',
        requireRole: reactionRole.requireRole || '',
        maxUses: reactionRole.maxUses || 0,
        currentUses: reactionRole.currentUses || 0,
      };
    } catch (error) {
      this.logger.error('Error getting reaction role:', error);

      return null;
    }
  }

  /**
   * Get reaction role message
   */
  private async getReactionRoleMessage(
    _guildId: string,
    _messageId: string
  ): Promise<ReactionRoleMessage | null> {
    try {
      // Temporary implementation until Prisma is regenerated
      return null;
    } catch (error) {
      this.logger.error('Error getting reaction role message:', error);

      return null;
    }
  }

  /**
   * Increment reaction role usage
   */
  private async incrementReactionRoleUsage(reactionRole: ReactionRole): Promise<void> {
    try {
      // Temporary implementation until Prisma is regenerated
      this.logger.debug(`Reaction role usage incremented (temporary implementation): ${reactionRole.messageId}`);
    } catch (error) {
      this.logger.error('Error incrementing reaction role usage:', error);
    }
  }

  /**
   * Decrement reaction role usage
   */
  private async decrementReactionRoleUsage(reactionRole: ReactionRole): Promise<void> {
    try {
      // Temporary implementation until Prisma is regenerated
      this.logger.debug(`Reaction role usage decremented (temporary implementation): ${reactionRole.messageId}`);
    } catch (error) {
      this.logger.error('Error decrementing reaction role usage:', error);
    }
  }

  /**
   * Add a join role
   */
  public async addJoinRole(guildId: string, roleId: string, delay: number = 0): Promise<void> {
    try {
      const config = await this.getAutoRoleConfig(guildId);
      
      if (!config.joinRoles.includes(roleId)) {
        config.joinRoles.push(roleId);
        await this.updateAutoRoleConfig(guildId, { joinRoles: config.joinRoles });
      }
      
      this.logger.info(`Added join role ${roleId} to guild ${guildId} with delay ${delay}`);
    } catch (error) {
      this.logger.error('Error adding join role:', error);
      throw new Error('Failed to add join role');
    }
  }

  private asArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
  }

  private parseEmbedColor(color: string): ColorResolvable {
    if (/^#[0-9a-fA-F]{6}$/.test(color)) {
      return color as ColorResolvable;
    }

    return Colors.Blue;
  }

  /**
   * Remove a join role
   */
  public async removeJoinRole(guildId: string, roleId: string): Promise<void> {
    try {
      const config = await this.getAutoRoleConfig(guildId);
      
      config.joinRoles = config.joinRoles.filter(id => id !== roleId);
      await this.updateAutoRoleConfig(guildId, { joinRoles: config.joinRoles });
      
      this.logger.info(`Removed join role ${roleId} from guild ${guildId}`);
    } catch (error) {
      this.logger.error('Error removing join role:', error);
      throw new Error('Failed to remove join role');
    }
  }

  /**
   * Add a level role
   */
  public async addLevelRole(guildId: string, level: number, roleId: string, removeOthers: boolean = false): Promise<void> {
    try {
      const config = await this.getAutoRoleConfig(guildId);
      
      // Remove existing level role for this level if it exists
      config.levelRoles = config.levelRoles.filter(lr => lr.level !== level || lr.roleId !== roleId);
      
      // Add new level role
      config.levelRoles.push({
        level,
        roleId,
        removeOthers
      });
      
      await this.updateAutoRoleConfig(guildId, { levelRoles: config.levelRoles });
      
      this.logger.info(`Added level role ${roleId} for level ${level} to guild ${guildId}`);
    } catch (error) {
      this.logger.error('Error adding level role:', error);
      throw new Error('Failed to add level role');
    }
  }

  /**
   * Remove a level role
   */
  public async removeLevelRole(guildId: string, level: number, roleId: string): Promise<void> {
    try {
      const config = await this.getAutoRoleConfig(guildId);
      
      config.levelRoles = config.levelRoles.filter(lr => !(lr.level === level && lr.roleId === roleId));
      await this.updateAutoRoleConfig(guildId, { levelRoles: config.levelRoles });
      
      this.logger.info(`Removed level role ${roleId} for level ${level} from guild ${guildId}`);
    } catch (error) {
      this.logger.error('Error removing level role:', error);
      throw new Error('Failed to remove level role');
    }
  }

  /**
   * Add a booster role
   */
  public async addBoosterRole(guildId: string, roleId: string): Promise<void> {
    try {
      const config = await this.getAutoRoleConfig(guildId);
      
      if (!config.boostRoles.includes(roleId)) {
        config.boostRoles.push(roleId);
        await this.updateAutoRoleConfig(guildId, { boostRoles: config.boostRoles });
      }
      
      this.logger.info(`Added booster role ${roleId} to guild ${guildId}`);
    } catch (error) {
      this.logger.error('Error adding booster role:', error);
      throw new Error('Failed to add booster role');
    }
  }

  /**
   * Remove a booster role
   */
  public async removeBoosterRole(guildId: string, roleId: string): Promise<void> {
    try {
      const config = await this.getAutoRoleConfig(guildId);
      
      config.boostRoles = config.boostRoles.filter(id => id !== roleId);
      await this.updateAutoRoleConfig(guildId, { boostRoles: config.boostRoles });
      
      this.logger.info(`Removed booster role ${roleId} from guild ${guildId}`);
    } catch (error) {
      this.logger.error('Error removing booster role:', error);
      throw new Error('Failed to remove booster role');
    }
  }

  /**
   * Toggle auto-roles system
   */
  public async toggleAutoRoles(guildId: string): Promise<boolean> {
    try {
      const config = await this.getAutoRoleConfig(guildId);
      const newStatus = !config.enabled;
      
      await this.updateAutoRoleConfig(guildId, { enabled: newStatus });
      
      this.logger.info(`Toggled auto-roles for guild ${guildId} to ${newStatus}`);

      return newStatus;
    } catch (error) {
      this.logger.error('Error toggling auto-roles:', error);
      throw new Error('Failed to toggle auto-roles');
    }
  }

  /**
   * Get reaction role count for a guild
   */
  public async getReactionRoleCount(guildId: string): Promise<number> {
    try {
      const count = await this.db.prisma.reactionRole.count({
        where: { guildId }
      });

      return count;
    } catch (error) {
      this.logger.error('Error getting reaction role count:', error);

      return 0;
    }
  }

  /**
   * Handle member boost status change
   */
  public async handleMemberBoostChange(member: GuildMember, isBoosting: boolean): Promise<void> {
    try {
      if (isBoosting) {
        await this.handleMemberBoost(member);
      } else {
        // Remove boost roles when user stops boosting
        const config = await this.getAutoRoleConfig(member.guild.id);
        
        if (config.enabled && config.boostRoles.length > 0) {
          const rolesToRemove = config.boostRoles.filter(roleId => member.roles.cache.has(roleId));
          
          if (rolesToRemove.length > 0) {
            await member.roles.remove(rolesToRemove, 'No longer boosting server');
            this.logger.info(`Removed ${rolesToRemove.length} boost roles from ${member.user.tag}`);
          }
        }
      }
    } catch (error) {
      this.logger.error('Error handling member boost change:', error);
    }
  }

  /**
   * Handle invite-based role rewards
   */
  public async handleInviteRoleReward(member: GuildMember, inviteCount: number): Promise<void> {
    try {
      // This will be integrated with the invite system
      // For now, just log the event
      this.logger.info(`Member ${member.user.tag} has ${inviteCount} invites - checking for role rewards`);
    } catch (error) {
      this.logger.error('Error handling invite role reward:', error);
    }
  }
}
