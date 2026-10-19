import {
  Client,
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
import { checkSelfAssignableRole } from '../utils/roleSafety';
import { setLongTimeout } from '../utils/longTimeout';

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
  // Standalone reaction roles (no panel): toggle | add | remove | unique
  type?: string;
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
  type: 'SINGLE' | 'MULTIPLE' | 'UNIQUE'; // SINGLE: one role at a time, MULTIPLE: several, UNIQUE: permanent choice
}

export class AutoRoleService {
  private static instance: AutoRoleService;
  // Key in addon_configs where extra module settings are stored (join delays)
  private static readonly CORE_AUTOROLES_KEY = 'core-autoroles';
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
      const delays = await this.getJoinRoleDelays(member.guild.id);

      for (const roleId of config.joinRoles) {
        const role = member.guild.roles.cache.get(roleId);

        if (role && this.canAssignRole(member.guild, role)) {
          const minutes = delays[roleId] ?? 0;
          if (minutes > 0) {
            this.scheduleDelayedJoinRole(member, roleId, minutes);
          } else {
            rolesToAdd.push(role);
          }
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

      const reactionRole = await this.getReactionRole(message.guild.id, message.id, reaction.emoji);

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

      // Revalidate on every reaction: a role with moderation permissions is never handed out
      if (!role || !this.canAssignRole(message.guild, role) || !checkSelfAssignableRole(message.guild, role.id).ok) {
        return;
      }

      // Handle different reaction role types
      const rrMessage = await this.getReactionRoleMessage(message.guild.id, message.id);

      if (rrMessage) {
        await this.handleReactionRoleType(member, role, rrMessage, reactionRole, reaction);
      } else {
        // Standalone reaction role (Welcome > Reaction roles tab)
        switch (reactionRole.type) {
          case 'remove':
            if (member.roles.cache.has(role.id)) await member.roles.remove(role, 'Reaction role (remove)');
            break;
          case 'unique': {
            // Only one role among this message's reaction roles
            const siblings = await this.db.prisma.reactionRole.findMany({
              where: { guildId: message.guild.id, messageId: message.id, roleId: { not: role.id } },
              select: { roleId: true, emoji: true },
            });
            const toRemove = siblings.map((r) => r.roleId).filter((id) => member.roles.cache.has(id));
            if (toRemove.length > 0) await member.roles.remove(toRemove, 'Unique reaction role');
            const msg = message.partial ? await message.fetch().catch(() => null) : message;
            for (const other of msg?.reactions.cache.values() ?? []) {
              if (other.emoji.identifier !== reaction.emoji.identifier) await other.users.remove(member.id).catch(() => {});
            }
            if (!member.roles.cache.has(role.id)) await member.roles.add(role, 'Unique reaction role');
            break;
          }
          default: // toggle, add
            if (!member.roles.cache.has(role.id)) await member.roles.add(role, 'Reaction role');
        }
        await this.incrementReactionRoleUsage(reactionRole);
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

      const reactionRole = await this.getReactionRole(message.guild.id, message.id, reaction.emoji);

      if (!reactionRole) return;

      const role = message.guild.roles.cache.get(reactionRole.roleId);

      if (!role) return;

      // UNIQUE = permanent choice: removing the reaction does not remove the role.
      const rrMessage = await this.getReactionRoleMessage(message.guild.id, message.id);
      if (rrMessage?.type === 'UNIQUE') return;
      // Standalone reaction roles: 'add' and 'remove' are not undone when the reaction is removed
      if (!rrMessage && (reactionRole.type === 'add' || reactionRole.type === 'remove')) return;

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
    reactionRole: ReactionRole,
    reaction?: MessageReaction | PartialMessageReaction
  ): Promise<void> {
    const otherRoleIds = rrMessage.roles
      .map((rr) => rr.roleId)
      .filter((roleId) => roleId !== reactionRole.roleId);

    switch (rrMessage.type) {
      case 'SINGLE': {
        // Only one role at a time: remove the panel's other roles and their reactions
        const toRemove = otherRoleIds.filter((roleId) => member.roles.cache.has(roleId));
        if (toRemove.length > 0) {
          await member.roles.remove(toRemove, 'Single reaction role selection');
        }
        if (reaction) {
          const msg = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
          for (const other of msg?.reactions.cache.values() ?? []) {
            if (other.emoji.identifier === reaction.emoji.identifier) continue;
            if (other.users.cache.has(member.id) || other.count > 1) {
              await other.users.remove(member.id).catch(() => {});
            }
          }
        }
        if (!member.roles.cache.has(role.id)) {
          await member.roles.add(role, 'Single reaction role');
        }
        break;
      }

      case 'UNIQUE': {
        // Permanent choice: if they already have a role from the panel, they cannot change it
        if (otherRoleIds.some((roleId) => member.roles.cache.has(roleId))) {
          await reaction?.users.remove(member.id).catch(() => {});
          return;
        }
        if (!member.roles.cache.has(role.id)) {
          await member.roles.add(role, 'Unique reaction role');
        }
        break;
      }

      case 'MULTIPLE':
      default:
        if (!member.roles.cache.has(role.id)) {
          await member.roles.add(role, 'Multiple reaction role');
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

      // Add reactions and persist each emoji → role mapping (needed by handleReactionAdd)
      for (const roleConfig of config.roles) {
        await message.react(roleConfig.emoji);
        await this.db.prisma.reactionRole.create({
          data: {
            guildId: guild.id,
            channelId: channel.id,
            messageId: message.id,
            emoji: roleConfig.emoji,
            roleId: roleConfig.roleId,
            type: 'toggle',
            description: roleConfig.description || null,
          },
        });
      }

      const saved = await this.db.prisma.reactionRoleMessage.create({
        data: {
          guildId: guild.id,
          channelId: channel.id,
          messageId: message.id,
          title: config.title,
          description: config.description,
          color: config.color,
          type: config.type,
          roles: config.roles as any,
        },
      });

      this.logger.info(`Created reaction role message in ${guild.name}`);

      return {
        id: saved.id,
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
    emoji: { name: string | null; id: string | null; animated?: boolean | null }
  ): Promise<ReactionRole | null> {
    try {
      // Emojis are stored exactly as pasted: unicode ("🎮") or custom
      // ("<:name:id>" / "<a:name:id>"); all possible forms are looked up.
      const candidates = [emoji.name, emoji.id].filter(Boolean) as string[];
      if (emoji.id) {
        candidates.push(`<:${emoji.name}:${emoji.id}>`, `<a:${emoji.name}:${emoji.id}>`);
      }
      if (candidates.length === 0) return null;

      const reactionRole = await this.db.prisma.reactionRole.findFirst({
        where: {
          guildId,
          messageId,
          emoji: { in: candidates },
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
        type: reactionRole.type,
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
    guildId: string,
    messageId: string
  ): Promise<ReactionRoleMessage | null> {
    try {
      const row = await this.db.prisma.reactionRoleMessage.findUnique({
        where: { guildId_messageId: { guildId, messageId } },
      });
      if (!row) return null;

      return {
        id: row.id,
        guildId: row.guildId,
        channelId: row.channelId,
        messageId: row.messageId,
        title: row.title,
        description: row.description,
        color: row.color,
        type: row.type as ReactionRoleMessage['type'],
        roles: (Array.isArray(row.roles) ? row.roles : []) as unknown as ReactionRole[],
      };
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
      await this.db.prisma.reactionRole.updateMany({
        where: { messageId: reactionRole.messageId, emoji: reactionRole.emoji },
        data: { currentUses: { increment: 1 } },
      });
    } catch (error) {
      this.logger.error('Error updating reaction role usage:', error);
    }
  }


  /**
   * Decrement reaction role usage
   */
  private async decrementReactionRoleUsage(reactionRole: ReactionRole): Promise<void> {
    try {
      await this.db.prisma.reactionRole.updateMany({
        where: { messageId: reactionRole.messageId, emoji: reactionRole.emoji, currentUses: { gt: 0 } },
        data: { currentUses: { decrement: 1 } },
      });
    } catch (error) {
      this.logger.error('Error updating reaction role usage:', error);
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
      await this.setJoinRoleDelay(guildId, roleId, delay);

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
   * Delays (minutes) of the join roles: { roleId: minutes }.
   * Stored in addon_configs (addonName CORE_AUTOROLES_KEY) so as not to change the
   * format of guild_configs.autoRoleJoinRoles (array of IDs used by the web dashboard).
   */
  public async getJoinRoleDelays(guildId: string): Promise<Record<string, number>> {
    try {
      const row = await this.db.prisma.addonConfig.findUnique({
        where: { guildId_addonName: { guildId, addonName: AutoRoleService.CORE_AUTOROLES_KEY } },
      });
      const raw = (row?.config as any)?.joinRoleDelays;
      if (!raw || typeof raw !== 'object') return {};
      const out: Record<string, number> = {};
      for (const [roleId, minutes] of Object.entries(raw)) {
        const n = Number(minutes);
        if (/^\d{17,20}$/.test(roleId) && Number.isFinite(n) && n > 0) out[roleId] = Math.min(n, 10080);
      }
      return out;
    } catch (error) {
      this.logger.error('Error getting join role delays:', error);
      return {};
    }
  }

  private async setJoinRoleDelay(guildId: string, roleId: string, minutes: number): Promise<void> {
    const delay = Math.max(0, Math.min(10080, Math.floor(Number(minutes) || 0)));
    const delays = await this.getJoinRoleDelays(guildId);
    if (delay > 0) delays[roleId] = delay;
    else if (roleId in delays) delete delays[roleId];
    else return; // nothing to change

    const row = await this.db.prisma.addonConfig.findUnique({
      where: { guildId_addonName: { guildId, addonName: AutoRoleService.CORE_AUTOROLES_KEY } },
    });
    const config = { ...((row?.config as any) ?? {}), joinRoleDelays: delays };
    await this.db.prisma.addonConfig.upsert({
      where: { guildId_addonName: { guildId, addonName: AutoRoleService.CORE_AUTOROLES_KEY } },
      update: { config },
      create: { guildId, addonName: AutoRoleService.CORE_AUTOROLES_KEY, config },
    });
  }

  /**
   * Schedules the delayed assignment of a join role. The pending assignment is
   * stored in `pending_join_roles` (survives restarts) and an in-memory timer
   * runs it on time; if the bot restarts, `processDuePendingJoinRoles` picks it up.
   * Without the table (migration not applied) only the in-memory timer is kept.
   */
  private scheduleDelayedJoinRole(member: GuildMember, roleId: string, minutes: number): void {
    const guild = member.guild;
    const userId = member.id;
    const dueAt = new Date(Date.now() + minutes * 60_000);
    const pending = (this.db.prisma as any).pendingJoinRole;

    const persisted: Promise<boolean> = pending
      ? pending.upsert({
        where: { guildId_userId_roleId: { guildId: guild.id, userId, roleId } },
        create: { guildId: guild.id, userId, roleId, dueAt },
        update: { dueAt },
      }).then(() => true).catch((error: unknown) => {
        this.logger.warn('Delayed join role not persisted (in-memory timer only):', error);
        return false;
      })
      : Promise.resolve(false);

    setLongTimeout(async () => {
      const isPersisted = await persisted;
      // Claim the row before assigning: the timer and the periodic sweep do not duplicate
      if (isPersisted && !(await this.claimPendingJoinRole(guild.id, userId, roleId))) return;
      await this.assignDelayedJoinRole(guild, userId, roleId, minutes);
    }, minutes * 60_000);
  }

  /** Deletes the pending row; true if this process claimed it. */
  private async claimPendingJoinRole(guildId: string, userId: string, roleId: string): Promise<boolean> {
    try {
      const res = await (this.db.prisma as any).pendingJoinRole.deleteMany({ where: { guildId, userId, roleId } });
      return res.count > 0;
    } catch {
      return true; // no table: the in-memory timer is the only source
    }
  }

  private async assignDelayedJoinRole(guild: Guild, userId: string, roleId: string, minutes: number): Promise<void> {
    try {
      // Revalidate when due: the member is still there, the module is still enabled and the role is still configured
      const config = await this.getAutoRoleConfig(guild.id);
      if (!config.enabled || !config.joinRoles.includes(roleId)) return;
      const fresh = await guild.members.fetch(userId).catch(() => null);
      const role = guild.roles.cache.get(roleId);
      if (!fresh || !role || !this.canAssignRole(guild, role) || fresh.roles.cache.has(roleId)) return;
      await fresh.roles.add(role, `Auto-role on join (delay ${minutes}m)`);
      this.logger.info(`Assigned delayed join role ${role.name} to ${fresh.user.tag} in ${guild.name}`);
    } catch (error) {
      this.logger.error('Error assigning delayed join role:', error);
    }
  }

  /**
   * Periodic sweep of overdue delayed assignments (e.g. after a restart).
   * Only handles this shard's servers. Those for servers no longer in the
   * cache that are more than 7 days overdue are discarded.
   */
  public async processDuePendingJoinRoles(client: Client): Promise<number> {
    const pending = (this.db.prisma as any).pendingJoinRole;
    if (!pending) return 0;
    const guildIds = [...client.guilds.cache.keys()];
    if (guildIds.length === 0) return 0;
    let done = 0;
    try {
      const due = await pending.findMany({
        where: { dueAt: { lte: new Date() }, guildId: { in: guildIds } },
        orderBy: { dueAt: 'asc' },
        take: 200,
      });
      for (const row of due) {
        const guild = client.guilds.cache.get(row.guildId);
        if (!guild) continue;
        if (!(await this.claimPendingJoinRole(row.guildId, row.userId, row.roleId))) continue;
        const minutes = Math.round((new Date(row.dueAt).getTime() - new Date(row.createdAt).getTime()) / 60_000);
        await this.assignDelayedJoinRole(guild, row.userId, row.roleId, minutes);
        done++;
      }
      // Cleanup of very old orphaned rows (server left)
      await pending.deleteMany({ where: { dueAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }).catch(() => {});
    } catch (error) {
      // Table not created yet or another transient failure: retried on the next cycle
      this.logger.debug?.('Pending join roles sweep skipped:', error);
    }
    return done;
  }

  private pendingWorker: NodeJS.Timeout | null = null;

  /** Starts the delayed-assignment sweep (every 60 s). Idempotent. */
  public startDelayedJoinRoleWorker(client: Client): void {
    if (this.pendingWorker) return;
    const run = () => {
      this.processDuePendingJoinRoles(client)
        .then(n => { if (n > 0) this.logger.info(`Assigned ${n} overdue delayed join role(s)`); })
        .catch(() => {});
    };
    run();
    this.pendingWorker = setInterval(run, 60_000);
  }

  /**
   * Remove a join role
   */
  public async removeJoinRole(guildId: string, roleId: string): Promise<void> {
    try {
      const config = await this.getAutoRoleConfig(guildId);
      
      config.joinRoles = config.joinRoles.filter(id => id !== roleId);
      await this.updateAutoRoleConfig(guildId, { joinRoles: config.joinRoles });
      await this.setJoinRoleDelay(guildId, roleId, 0);

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
