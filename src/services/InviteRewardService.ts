import {
  Guild,
  GuildMember,
  EmbedBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import { Prisma, PrismaClient } from '@prisma/client';
import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';
import { logger } from '../utils/Logger';
import { botConfig } from '../config/bot.config';
import { checkSelfAssignableRole, SelfAssignableRoleProblem } from '../utils/roleSafety';

/** Maximum rewards (threshold → role) per server. */
export const MAX_INVITE_REWARD_TIERS = 25;
/** Maximum configurable threshold (consistent with /invites add, which allows up to 1000). */
export const MAX_INVITE_REWARD_THRESHOLD = 100000;

/** Full resync: batches, pause between batches and per-server cooldown. */
const SYNC_BATCH_SIZE = 10;
const SYNC_BATCH_DELAY_MS = 1000;
const SYNC_COOLDOWN_SECS = 10 * 60;
const SYNC_MAX_MEMBERS = 5000;

export interface InviteRewardSettings {
  enabled: boolean;
  stackRoles: boolean;
  removeOnDrop: boolean;
  announceChannelId: string | null;
}

export interface InviteRewardTierData {
  id: string;
  requiredInvites: number;
  roleId: string;
}

export interface InviteRewardSetup {
  settings: InviteRewardSettings;
  tiers: InviteRewardTierData[];
}

export type AddTierResult =
  | { ok: true }
  | { ok: false; reason: 'limit' | 'duplicate_count' | 'duplicate_role' | 'invalid_count' }
  | { ok: false; reason: 'role'; problem: SelfAssignableRoleProblem };

export interface MemberSyncResult {
  added: string[];
  removed: string[];
}

export type GuildSyncResult =
  | { ok: true; processed: number; added: number; removed: number; failed: number; truncated: boolean }
  | { ok: false; reason: 'cooldown' | 'running' | 'no_permission'; retryAfter?: number };

const DEFAULT_SETTINGS: InviteRewardSettings = {
  enabled: true,
  stackRoles: true,
  removeOnDrop: true,
  announceChannelId: null,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Invite rewards: grants roles upon reaching N valid invites
 * (valid + bonus, which already subtract leaves and fake/recent accounts).
 *
 * The desired state is always recalculated from the DB (thresholds + statistics),
 * so every sync is idempotent and survives restarts. The roles
 * granted by the bot are recorded in invite_reward_grants: only those are removed later,
 * never a role an administrator assigned manually.
 */
export class InviteRewardService {
  private client: KorexClient;
  private prisma: PrismaClient;
  /** Serializes syncs of the same member (guild:user) within this process. */
  private memberLocks = new Map<string, Promise<unknown>>();
  /** Full resyncs in progress (fallback if Redis is unavailable). */
  private runningGuildSyncs = new Set<string>();
  private localCooldowns = new Map<string, number>();

  constructor(client: KorexClient) {
    this.client = client;
    this.prisma = client.db;
  }

  // ─── Configuration ────────────────────────────────────────────────────────

  async getSetup(guildId: string): Promise<InviteRewardSetup> {
    const [config, tiers] = await Promise.all([
      this.prisma.inviteRewardConfig.findUnique({ where: { guildId } }),
      this.prisma.inviteRewardTier.findMany({
        where: { guildId },
        orderBy: { requiredInvites: 'asc' },
        select: { id: true, requiredInvites: true, roleId: true },
      }),
    ]);

    const settings: InviteRewardSettings = config
      ? {
          enabled: config.enabled,
          stackRoles: config.stackRoles,
          removeOnDrop: config.removeOnDrop,
          announceChannelId: config.announceChannelId,
        }
      : { ...DEFAULT_SETTINGS };

    return { settings, tiers };
  }

  async updateSettings(guildId: string, patch: Partial<InviteRewardSettings>): Promise<InviteRewardSettings> {
    const data: Partial<InviteRewardSettings> = {};
    if (typeof patch.enabled === 'boolean') data.enabled = patch.enabled;
    if (typeof patch.stackRoles === 'boolean') data.stackRoles = patch.stackRoles;
    if (typeof patch.removeOnDrop === 'boolean') data.removeOnDrop = patch.removeOnDrop;
    if (patch.announceChannelId !== undefined) data.announceChannelId = patch.announceChannelId;

    await this.ensureGuildRow(guildId);
    const row = await this.prisma.inviteRewardConfig.upsert({
      where: { guildId },
      update: data,
      create: { guildId, ...DEFAULT_SETTINGS, ...data },
    });

    return {
      enabled: row.enabled,
      stackRoles: row.stackRoles,
      removeOnDrop: row.removeOnDrop,
      announceChannelId: row.announceChannelId,
    };
  }

  /** Validates that a channel is suitable for announcements (text, in the server, the bot can write). */
  isValidAnnounceChannel(guild: Guild, channelId: string): boolean {
    const channel = guild.channels.cache.get(channelId);
    const me = guild.members.me;
    if (!channel || !me || !channel.isTextBased() || channel.isThread()) return false;
    return !!channel.permissionsFor(me)?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
    ]);
  }

  /** Roles that can be used as a reward (safe and below the bot and the configuring user). */
  getAssignableRoles(guild: Guild, actor: GuildMember | null): Array<{ id: string; name: string; color: string; position: number }> {
    return guild.roles.cache
      .filter((role) => checkSelfAssignableRole(guild, role.id, actor).ok)
      .sort((a, b) => b.position - a.position)
      .map((role) => ({ id: role.id, name: role.name, color: role.hexColor, position: role.position }));
  }

  /** Text/announcement channels where the bot can post announcements. */
  getAnnounceChannels(guild: Guild): Array<{ id: string; name: string; type: number }> {
    return guild.channels.cache
      .filter((channel) => this.isValidAnnounceChannel(guild, channel.id))
      .sort((a, b) => ('position' in a ? a.position : 0) - ('position' in b ? b.position : 0))
      .map((channel) => ({ id: channel.id, name: channel.name, type: channel.type }));
  }

  /**
   * Adds a reward. Validates the role (hierarchy of the bot and the configuring user,
   * dangerous permissions, @everyone, managed) and the reward limit.
   */
  async addTier(guild: Guild, requiredInvites: number, roleId: string, actor: GuildMember | null): Promise<AddTierResult> {
    if (!Number.isInteger(requiredInvites) || requiredInvites < 1 || requiredInvites > MAX_INVITE_REWARD_THRESHOLD) {
      return { ok: false, reason: 'invalid_count' };
    }

    const check = checkSelfAssignableRole(guild, roleId, actor);
    if (!check.ok) return { ok: false, reason: 'role', problem: check.problem! };

    await this.ensureGuildRow(guild.id);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.inviteRewardTier.findMany({
          where: { guildId: guild.id },
          select: { requiredInvites: true, roleId: true },
        });
        if (existing.some((t) => t.requiredInvites === requiredInvites)) return { ok: false, reason: 'duplicate_count' } as const;
        if (existing.some((t) => t.roleId === roleId)) return { ok: false, reason: 'duplicate_role' } as const;
        if (existing.length >= MAX_INVITE_REWARD_TIERS) return { ok: false, reason: 'limit' } as const;

        await tx.inviteRewardTier.create({ data: { guildId: guild.id, requiredInvites, roleId } });
        return { ok: true } as const;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      // Race with another request: the unique keys (threshold / role) decide
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = String((error.meta as any)?.target ?? '');
        return { ok: false, reason: target.includes('roleId') ? 'duplicate_role' : 'duplicate_count' };
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        return { ok: false, reason: 'limit' };
      }
      throw error;
    }
  }

  /** Removes a reward by threshold or by role. Returns how many were deleted. */
  async removeTier(guildId: string, filter: { id?: string; requiredInvites?: number; roleId?: string }): Promise<number> {
    if (!filter.id && filter.requiredInvites === undefined && !filter.roleId) return 0;
    const where: Prisma.InviteRewardTierWhereInput = { guildId };
    if (filter.id) where.id = filter.id;
    if (filter.requiredInvites !== undefined) where.requiredInvites = filter.requiredInvites;
    if (filter.roleId) where.roleId = filter.roleId;
    const res = await this.prisma.inviteRewardTier.deleteMany({ where });
    return res.count;
  }

  // ─── Synchronization ───────────────────────────────────────────────────────

  /**
   * Recalculates and applies the rewards of a member. Safe to call as many
   * times as needed: it only adds what is missing and removes what is extra.
   */
  async syncMember(guild: Guild, userId: string, options: { announce?: boolean } = {}): Promise<MemberSyncResult> {
    const key = `${guild.id}:${userId}`;
    const previous = this.memberLocks.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => this.doSyncMember(guild, userId, options.announce !== false));
    this.memberLocks.set(key, run);
    try {
      return await run;
    } finally {
      if (this.memberLocks.get(key) === run) this.memberLocks.delete(key);
    }
  }

  private async doSyncMember(guild: Guild, userId: string, announce: boolean): Promise<MemberSyncResult> {
    const result: MemberSyncResult = { added: [], removed: [] };

    try {
      const me = guild.members.me;
      if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return result;

      const { settings, tiers } = await this.getSetup(guild.id);
      if (!settings.enabled) return result;

      const grants = await this.prisma.inviteRewardGrant.findMany({
        where: { guildId: guild.id, userId },
        select: { roleId: true },
      });
      if (tiers.length === 0 && grants.length === 0) return result;

      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member || member.user.bot) return result;

      const stats = await this.prisma.inviteStats.findUnique({
        where: { guildId_userId: { guildId: guild.id, userId } },
        select: { validInvites: true, bonusInvites: true },
      });
      const count = Math.max(0, (stats?.validInvites ?? 0) + (stats?.bonusInvites ?? 0));

      const grantedRoleIds = new Set(grants.map((g) => g.roleId));
      const tierByRole = new Map(tiers.map((t) => [t.roleId, t]));

      // No removal on drop: the effective level never goes below the highest reward already granted
      let effective = count;
      if (!settings.removeOnDrop) {
        for (const roleId of grantedRoleIds) {
          const tier = tierByRole.get(roleId);
          if (tier && tier.requiredInvites > effective) effective = tier.requiredInvites;
        }
      }

      const reached = tiers.filter((t) => t.requiredInvites <= effective);
      const desired = settings.stackRoles ? reached : reached.slice(-1);
      const desiredIds = new Set(desired.map((t) => t.roleId));

      // 1) Add what is missing
      const newlyGranted: InviteRewardTierData[] = [];
      for (const tier of desired) {
        const check = checkSelfAssignableRole(guild, tier.roleId);
        if (!check.ok) {
          logger.warn(`[InviteRewards] Role ${tier.roleId} skipped in ${guild.id}: ${check.problem}`);
          continue;
        }

        // Already has it: if the bot did not grant it, it is a manual role and is not recorded (it will never be removed)
        if (member.roles.cache.has(tier.roleId)) continue;

        // Atomic claim of the record: only whoever creates it announces the reward.
        // If it already existed (e.g. the member left and came back) it is reassigned silently.
        const claimed = await this.prisma.inviteRewardGrant.createMany({
          data: [{ guildId: guild.id, userId, roleId: tier.roleId }],
          skipDuplicates: true,
        });
        const isNew = claimed.count === 1;

        try {
          await member.roles.add(tier.roleId, i18n.t('invites.rewards.audit_add', guild.id, { invites: String(tier.requiredInvites) }));
          result.added.push(tier.roleId);
        } catch (error) {
          logger.warn(`[InviteRewards] Could not assign ${tier.roleId} to ${userId} in ${guild.id}: ${error}`);
          if (isNew) {
            await this.prisma.inviteRewardGrant.deleteMany({ where: { guildId: guild.id, userId, roleId: tier.roleId } }).catch(() => {});
          }
          continue;
        }
        if (isNew) newlyGranted.push(tier);
      }

      // 2) Remove what is extra (only roles granted by the bot)
      for (const roleId of grantedRoleIds) {
        if (desiredIds.has(roleId)) continue;

        const configured = tierByRole.has(roleId);
        // Reward removed from the configuration and no removal: the role stays, the record is forgotten
        const shouldRemoveRole = configured || settings.removeOnDrop;

        if (shouldRemoveRole && member.roles.cache.has(roleId)) {
          const role = guild.roles.cache.get(roleId);
          if (!role || role.comparePositionTo(me.roles.highest) >= 0) continue; // out of the bot's reach
          try {
            await member.roles.remove(roleId, i18n.t('invites.rewards.audit_remove', guild.id));
            result.removed.push(roleId);
          } catch (error) {
            logger.warn(`[InviteRewards] Could not remove ${roleId} from ${userId} in ${guild.id}: ${error}`);
            continue;
          }
        }
        await this.prisma.inviteRewardGrant.deleteMany({ where: { guildId: guild.id, userId, roleId } });
      }

      if (announce && newlyGranted.length > 0 && settings.announceChannelId) {
        await this.announce(guild, member, newlyGranted, count, settings.announceChannelId);
      }
    } catch (error) {
      logger.error(`[InviteRewards] Error syncing ${userId} in ${guild.id}:`, error);
    }

    return result;
  }

  /** Announcement in the configured channel. Only mentions (and notifies) the inviter. */
  private async announce(
    guild: Guild,
    member: GuildMember,
    tiers: InviteRewardTierData[],
    count: number,
    channelId: string,
  ): Promise<void> {
    try {
      if (!this.isValidAnnounceChannel(guild, channelId)) return;
      const channel = guild.channels.cache.get(channelId);
      if (!channel || !channel.isTextBased()) return;

      const roles = tiers.map((t) => `<@&${t.roleId}>`).join(', ');
      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.success)
        .setTitle(i18n.t('invites.reward.title', guild.id))
        .setDescription(i18n.t('invites.rewards.announce', guild.id, {
          user: member.toString(),
          invites: String(count),
          roles,
        }))
        .setThumbnail(member.user.displayAvatarURL())
        .setTimestamp();

      await channel.send({
        content: member.toString(),
        embeds: [embed],
        allowedMentions: { parse: [], users: [member.id], roles: [], repliedUser: false },
      });
    } catch (error) {
      logger.warn(`[InviteRewards] Could not send the announcement in ${guild.id}: ${error}`);
    }
  }

  /**
   * Resyncs the whole server in batches. A single process per server and
   * a SYNC_COOLDOWN_SECS cooldown (Redis, with in-memory fallback).
   */
  async syncGuild(guild: Guild): Promise<GuildSyncResult> {
    const refused = await this.claimGuildSync(guild);
    if (refused) return refused;
    return this.runGuildSync(guild);
  }

  /**
   * Same as syncGuild, but does not wait for the result (web panel): applies the same
   * checks and the same cooldown and runs the sync in the background.
   */
  async startGuildSync(guild: Guild): Promise<{ ok: true } | Extract<GuildSyncResult, { ok: false }>> {
    const refused = await this.claimGuildSync(guild);
    if (refused) return refused;
    this.runGuildSync(guild).catch((error) => logger.error(`[InviteRewards] Error resyncing ${guild.id}:`, error));
    return { ok: true };
  }

  /** Resync status for the panel (in progress / cooldown seconds). */
  async getSyncStatus(guildId: string): Promise<{ running: boolean; retryAfter: number }> {
    let retryAfter = 0;
    try {
      if (this.client.redis?.isConnected?.()) {
        const ttl = await this.client.redis.getClient().ttl(`invites:rewards:sync:${guildId}`);
        retryAfter = ttl > 0 ? ttl : 0;
      } else {
        const until = this.localCooldowns.get(guildId) ?? 0;
        retryAfter = until > Date.now() ? Math.ceil((until - Date.now()) / 1000) : 0;
      }
    } catch { /* no cooldown state */ }
    return { running: this.runningGuildSyncs.has(guildId), retryAfter };
  }

  /** Pre-checks + cooldown. Returns the rejection reason, or null if it can start. */
  private async claimGuildSync(guild: Guild): Promise<Extract<GuildSyncResult, { ok: false }> | null> {
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return { ok: false, reason: 'no_permission' };
    }
    if (this.runningGuildSyncs.has(guild.id)) return { ok: false, reason: 'running' };

    const cooldown = await this.acquireSyncCooldown(guild.id);
    if (cooldown > 0) return { ok: false, reason: 'cooldown', retryAfter: cooldown };

    // Marked as in progress before yielding control: two simultaneous requests do not start two passes
    this.runningGuildSyncs.add(guild.id);
    return null;
  }

  private async runGuildSync(guild: Guild): Promise<GuildSyncResult> {
    try {
      const [statsRows, grantRows] = await Promise.all([
        this.prisma.$queryRaw<{ userId: string }[]>`
          SELECT "userId" FROM invite_stats
          WHERE "guildId" = ${guild.id} AND ("validInvites" + "bonusInvites") > 0
          ORDER BY ("validInvites" + "bonusInvites") DESC
          LIMIT ${SYNC_MAX_MEMBERS + 1}
        `,
        this.prisma.inviteRewardGrant.findMany({
          where: { guildId: guild.id },
          distinct: ['userId'],
          select: { userId: true },
          take: SYNC_MAX_MEMBERS + 1,
        }),
      ]);

      const ids = [...new Set([...statsRows.map((r) => r.userId), ...grantRows.map((r) => r.userId)])];
      const truncated = ids.length > SYNC_MAX_MEMBERS;
      const targets = ids.slice(0, SYNC_MAX_MEMBERS);

      let added = 0;
      let removed = 0;
      let failed = 0;

      for (let i = 0; i < targets.length; i += SYNC_BATCH_SIZE) {
        const batch = targets.slice(i, i + SYNC_BATCH_SIZE);
        for (const userId of batch) {
          try {
            const res = await this.syncMember(guild, userId, { announce: false });
            added += res.added.length;
            removed += res.removed.length;
          } catch {
            failed++;
          }
        }
        if (i + SYNC_BATCH_SIZE < targets.length) await sleep(SYNC_BATCH_DELAY_MS);
      }

      return { ok: true, processed: targets.length, added, removed, failed, truncated };
    } finally {
      this.runningGuildSyncs.delete(guild.id);
    }
  }

  /** Returns 0 if the cooldown is acquired, or the remaining seconds otherwise. */
  private async acquireSyncCooldown(guildId: string): Promise<number> {
    const key = `invites:rewards:sync:${guildId}`;
    try {
      if (this.client.redis?.isConnected?.()) {
        const redis = this.client.redis.getClient();
        const set = await redis.set(key, '1', 'EX', SYNC_COOLDOWN_SECS, 'NX');
        if (set === 'OK') return 0;
        const ttl = await redis.ttl(key);
        return ttl > 0 ? ttl : SYNC_COOLDOWN_SECS;
      }
    } catch { /* in-memory fallback */ }

    const now = Date.now();
    const until = this.localCooldowns.get(guildId) ?? 0;
    if (until > now) return Math.ceil((until - now) / 1000);
    this.localCooldowns.set(guildId, now + SYNC_COOLDOWN_SECS * 1000);
    return 0;
  }

  private async ensureGuildRow(guildId: string): Promise<void> {
    await this.prisma.guild.upsert({ where: { id: guildId }, update: {}, create: { id: guildId } });
  }
}
