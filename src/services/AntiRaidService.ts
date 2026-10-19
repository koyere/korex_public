import {
  ChannelType,
  Colors,
  EmbedBuilder,
  Guild,
  GuildBasedChannel,
  GuildMember,
  GuildVerificationLevel,
  PermissionFlagsBits,
  PermissionsBitField,
} from 'discord.js';
import type { ModerationRaidState } from '@prisma/client';
import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';
import { isCoreModuleEnabled } from '../config/coreModules';
import { claimJoinAction } from '../utils/joinActionClaim';

/**
 * Moderation anti-raid (Moderation → AutoMod → Anti-Raid).
 *
 * - Detection: sliding window of joins in Redis (atomic Lua script,
 *   safe across multiple shards). N joins within T seconds trigger raid mode;
 *   optionally only accounts newer than X days are counted.
 * - Actions: alert in the moderation log channel and, if configured,
 *   timeout / kick / ban whoever joins during the raid, plus
 *   lockdown mode (maximum verification and/or @everyone unable to send messages).
 * - End: automatic after the configured duration (periodic sweep) or manual
 *   (/antiraid end or the dashboard). The previous state is stored in the DB
 *   (moderation_raid_states) and restored exactly even if the bot restarts.
 * - Coordination with Honeypot: a single sanction per join (joinActionClaim).
 */

export type RaidAction = 'alert' | 'timeout' | 'kick' | 'ban';
export type RaidLockdown = 'none' | 'verification' | 'channels' | 'both';

export const RAID_ACTIONS: readonly RaidAction[] = ['alert', 'timeout', 'kick', 'ban'];
export const RAID_LOCKDOWNS: readonly RaidLockdown[] = ['none', 'verification', 'channels', 'both'];

interface AntiRaidConfig {
  enabled: boolean;
  threshold: number;
  windowSecs: number;
  accountAgeDays: number;
  action: RaidAction;
  lockdown: RaidLockdown;
  durationSecs: number;
}

/** Permissions denied to @everyone during channel lockdown. */
const LOCK_BITS = ['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads'] as const;
type LockBit = typeof LOCK_BITS[number];

interface OverwriteSnapshot {
  id: string;
  existed: boolean;                            // was there an overwrite before?
  bits: Partial<Record<LockBit, boolean | null>>; // previous state: true=allow, false=deny, null=inherited
}

/** The channel's @everyone overwrite + overwrites (allow) added to moderation roles. */
interface ChannelSnapshot extends OverwriteSnapshot {
  roles?: OverwriteSnapshot[];
}

type OverwriteLike = { allow: PermissionsBitField; deny: PermissionsBitField };

const LOCKABLE_TYPES = new Set<ChannelType>([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum]);
const LOCK_VERIFICATION = GuildVerificationLevel.VeryHigh;

const WINDOW_KEY = (g: string) => `modraid:joins:${g}`;
const ACTIVE_KEY = (g: string) => `modraid:active:${g}`; // value = endsAt (ms)
const ENDING_KEY = (g: string) => `modraid:ending:${g}`;

const CONFIG_TTL_MS = 30_000;
const SWEEP_INTERVAL_MS = 30_000;
const MAX_RAID_MS = 24 * 3600_000;    // maximum extension of raid mode
const EXTEND_STEP_MS = 30_000;        // don't rewrite endsAt for less than 30 s
const MAX_RETRO_TARGETS = 100;        // window members sanctioned when the raid is detected
const MAX_TIMEOUT_MS = 28 * 24 * 3600_000;
const MAX_MOD_ROLES = 10;             // moderation roles that can still write in locked channels

/**
 * KEYS[1]=window, KEYS[2]=active · ARGV: now, windowMs, threshold, member, durationMs
 * Returns { count, started(0|1), endsAt|'' , window members if started }
 */
const JOIN_SCRIPT = `
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local threshold = tonumber(ARGV[3])
local durationMs = tonumber(ARGV[5])
redis.call('ZADD', KEYS[1], now, ARGV[4])
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - windowMs)
redis.call('PEXPIRE', KEYS[1], windowMs * 2)
local count = redis.call('ZCARD', KEYS[1])
local active = redis.call('GET', KEYS[2])
local started = 0
local members = {}
if (not active) and count >= threshold then
  local endsAt = now + durationMs
  redis.call('SET', KEYS[2], tostring(endsAt), 'PX', durationMs + 60000)
  active = tostring(endsAt)
  started = 1
  members = redis.call('ZRANGE', KEYS[1], 0, -1)
end
return { count, started, active or '', members }
`;

export class AntiRaidService {
  private client: KorexClient;
  private configCache = new Map<string, { data: AntiRaidConfig | null; exp: number }>();
  /** Starts in progress (channel lockdown) so a manual end waits for them to finish. */
  private starting = new Map<string, Promise<void>>();

  constructor(client: KorexClient) {
    this.client = client;
    setInterval(() => { this.sweep().catch(() => null); }, SWEEP_INTERVAL_MS).unref();
  }

  // ─── Config ───────────────────────────────────────────────────────────────

  private async getConfig(guildId: string): Promise<AntiRaidConfig | null> {
    const cached = this.configCache.get(guildId);
    if (cached && cached.exp > Date.now()) return cached.data;

    let data: AntiRaidConfig | null = null;
    try {
      const [cfg, guild] = await Promise.all([
        this.client.db.moderationConfig.findUnique({ where: { guildId } }),
        this.client.db.guild.findUnique({ where: { id: guildId }, select: { enabledAddons: true } }),
      ]);
      if (cfg) {
        data = {
          enabled: isCoreModuleEnabled(guild?.enabledAddons, 'moderation') && cfg.autoModEnabled && cfg.antiRaid,
          threshold: Math.max(2, cfg.antiRaidThreshold),
          windowSecs: Math.max(5, cfg.antiRaidWindow),
          accountAgeDays: Math.max(0, cfg.antiRaidAccountAgeDays),
          action: (RAID_ACTIONS as readonly string[]).includes(cfg.antiRaidAction) ? cfg.antiRaidAction as RaidAction : 'alert',
          lockdown: (RAID_LOCKDOWNS as readonly string[]).includes(cfg.antiRaidLockdown) ? cfg.antiRaidLockdown as RaidLockdown : 'none',
          durationSecs: Math.max(60, cfg.antiRaidDuration),
        };
      }
    } catch (err) {
      this.client.logger.debug('[AntiRaid] config fetch error:', err);
    }
    this.configCache.set(guildId, { data, exp: Date.now() + CONFIG_TTL_MS });
    return data;
  }

  clearCache(guildId: string): void {
    this.configCache.delete(guildId);
  }

  // ─── guildMemberAdd ───────────────────────────────────────────────────────

  /**
   * Counts the join and, if there is a raid, applies the configured action.
   * `alreadyRemoved`: Honeypot already kicked/banned this member (counted but no action taken).
   * Returns true if this service kicked or banned the member.
   */
  async handleMemberJoin(member: GuildMember, alreadyRemoved = false): Promise<boolean> {
    if (member.user.bot) return false;
    const guildId = member.guild.id;

    try {
      const config = await this.getConfig(guildId);
      if (!config?.enabled) return false;

      // Optional new-account filter: older accounts are not counted
      if (config.accountAgeDays > 0) {
        const ageDays = (Date.now() - member.user.createdTimestamp) / 86_400_000;
        if (ageDays >= config.accountAgeDays) return false;
      }

      const now = Date.now();
      const redis = this.client.redis.getClient();
      const res = await redis.eval(
        JOIN_SCRIPT, 2, WINDOW_KEY(guildId), ACTIVE_KEY(guildId),
        now, config.windowSecs * 1000, config.threshold, `${member.id}:${member.joinedTimestamp ?? now}`, config.durationSecs * 1000,
      ).catch(() => null) as [number, number, string, string[]] | null;
      if (!res) return false; // without Redis nobody is blocked
      const [count, started, activeRaw, members] = res;
      if (!activeRaw) return false;

      if (started === 1) {
        const recentIds = [...new Set((members ?? []).map((m) => String(m).split(':')[0]))].filter((id) => id !== member.id);
        const job = this.startRaid(member.guild, config, Number(activeRaw), Number(count), recentIds)
          .catch((err) => { this.client.logger.error('[AntiRaid] startRaid error:', err); })
          .finally(() => this.starting.delete(guildId));
        this.starting.set(guildId, job);
      } else {
        await this.client.db.moderationRaidState.updateMany({
          where: { guildId, active: true },
          data: { joinCount: { increment: 1 } },
        }).catch(() => null);
        if (count >= config.threshold) await this.extendRaid(guildId, Number(activeRaw), config).catch(() => null);
      }

      if (alreadyRemoved) return false;
      const applied = await this.applyRaidAction(member, config);
      return applied === 'kicked' || applied === 'banned';
    } catch (err) {
      this.client.logger.error('[AntiRaid] handleMemberJoin error:', err);
      return false;
    }
  }

  /** While people keep joining at raid pace, the end is postponed (24 h cap). */
  private async extendRaid(guildId: string, currentEndsAt: number, config: AntiRaidConfig): Promise<void> {
    const wanted = Date.now() + config.durationSecs * 1000;
    if (wanted - currentEndsAt < EXTEND_STEP_MS) return;
    const state = await this.client.db.moderationRaidState.findUnique({ where: { guildId }, select: { active: true, startedAt: true, endedBy: true } });
    // endedBy already set = pending manual end (another shard): not postponed
    if (!state?.active || state.endedBy) return;
    const endsAt = Math.min(wanted, state.startedAt.getTime() + MAX_RAID_MS);
    if (endsAt <= currentEndsAt) return;
    const redis = this.client.redis.getClient();
    await redis.set(ACTIVE_KEY(guildId), String(endsAt), 'PX', endsAt - Date.now() + 60_000, 'XX');
    await this.client.db.moderationRaidState.updateMany({ where: { guildId, active: true, endedBy: null }, data: { endsAt: new Date(endsAt) } });
  }

  // ─── Raid mode start ──────────────────────────────────────────────────────

  private async startRaid(guild: Guild, config: AntiRaidConfig, endsAt: number, count: number, recentIds: string[]): Promise<void> {
    const guildId = guild.id;

    // If the DB already has an active raid (e.g. Redis restarted), this is a
    // continuation: the snapshot is not taken again (it would capture the lockdown).
    const existing = await this.client.db.moderationRaidState.findUnique({ where: { guildId } });
    if (existing?.active) {
      if (existing.endedBy) return; // manual end already requested
      await this.client.db.moderationRaidState.update({
        where: { guildId },
        data: { endsAt: new Date(Math.max(endsAt, existing.endsAt.getTime())), joinCount: { increment: 1 } },
      });
      return;
    }

    const base = {
      active: true, startedAt: new Date(), endsAt: new Date(endsAt), endedAt: null, endedBy: null,
      joinCount: count, actionCount: 0, action: config.action,
      verificationBefore: null, verificationSet: null, channelSnapshot: [] as any,
    };
    await this.client.db.moderationRaidState.upsert({ where: { guildId }, update: base, create: { guildId, ...base } });

    const reason = i18n.t('moderation.antiraid.audit_reason', guildId);
    const lockVerification = config.lockdown === 'verification' || config.lockdown === 'both';
    const lockChannels = config.lockdown === 'channels' || config.lockdown === 'both';

    // 1. Maximum verification (the previous level is saved BEFORE changing it)
    let verificationLocked = false;
    if (lockVerification && guild.verificationLevel < LOCK_VERIFICATION) {
      const me = guild.members.me;
      if (me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
        const before = guild.verificationLevel;
        await this.client.db.moderationRaidState.update({
          where: { guildId }, data: { verificationBefore: before, verificationSet: LOCK_VERIFICATION },
        });
        verificationLocked = await guild.setVerificationLevel(LOCK_VERIFICATION, reason).then(() => true).catch(() => false);
        if (!verificationLocked) {
          await this.client.db.moderationRaidState.update({ where: { guildId }, data: { verificationBefore: null, verificationSet: null } });
        }
      }
    }

    // 2. Channel lockdown: snapshot persisted, then applied
    let lockedChannels = 0;
    const modRoles = lockChannels ? this.pickModRoles(guild) : [];
    if (lockChannels) {
      // Channels with an active manual /lockdown are left as they are
      const manualLocked = await this.getManualLockdowns(guildId);
      const snapshot = this.buildChannelSnapshot(guild, modRoles, manualLocked);
      if (snapshot.length > 0) {
        await this.client.db.moderationRaidState.update({ where: { guildId }, data: { channelSnapshot: snapshot as any } });
        for (const snap of snapshot) {
          const channel = guild.channels.cache.get(snap.id);
          if (!channel || !('permissionOverwrites' in channel)) continue;
          const overwrites = (channel as any).permissionOverwrites;
          // Moderation roles' permission first, so they are never left unable to write
          for (const role of snap.roles ?? []) {
            const allow: Partial<Record<LockBit, boolean>> = {};
            for (const bit of Object.keys(role.bits) as LockBit[]) allow[bit] = true;
            await overwrites.edit(role.id, allow, { reason }).catch(() => null);
          }
          const patch: Partial<Record<LockBit, boolean>> = {};
          for (const bit of Object.keys(snap.bits) as LockBit[]) patch[bit] = false;
          const ok = await overwrites.edit(guild.roles.everyone.id, patch, { reason })
            .then(() => true).catch(() => false);
          if (ok) lockedChannels++;
        }
      }
    }

    await this.sendAlert(guild, 'start', {
      threshold: String(config.threshold),
      window: String(config.windowSecs),
      count: String(count),
      action: i18n.t(`moderation.antiraid.actions.${config.action}`, guildId),
      lockdown: this.describeLockdown(guildId, verificationLocked, lockedChannels, config.lockdown, lockedChannels > 0 ? modRoles.map((r) => r.id) : []),
      ends: `<t:${Math.floor(endsAt / 1000)}:R>`,
    });

    // 3. Retroactive action on those who joined in the window that triggered the raid
    if (config.action !== 'alert') {
      for (const id of recentIds.slice(0, MAX_RETRO_TARGETS)) {
        const target = await guild.members.fetch(id).catch(() => null);
        if (target) await this.applyRaidAction(target, config);
      }
    }
  }

  /**
   * Moderation roles that can still write during the lockdown. The moderation
   * config does not define moderator roles, so roles with
   * Manage Messages or Timeout Members are used (Administrator roles already ignore
   * overwrites and need no changes). At most MAX_MOD_ROLES, highest first.
   */
  private pickModRoles(guild: Guild) {
    return [...guild.roles.cache.values()]
      .filter((r) => r.id !== guild.id && !r.managed
        && !r.permissions.has(PermissionFlagsBits.Administrator)
        && r.permissions.any([PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ModerateMembers]))
      .sort((a, b) => b.position - a.position)
      .slice(0, MAX_MOD_ROLES);
  }

  /** Channels with an active manual /lockdown (the command's channel_lockdowns table). */
  private async getManualLockdowns(guildId: string): Promise<Set<string>> {
    const rows = await this.client.db.channelLockdown.findMany({ where: { guildId }, select: { channelId: true } }).catch(() => []);
    return new Set(rows.map((r) => r.channelId));
  }

  private buildChannelSnapshot(guild: Guild, modRoles: { id: string }[], manualLocked: Set<string>): ChannelSnapshot[] {
    const me = guild.members.me;
    if (!me) return [];
    const everyone = guild.roles.everyone;
    const out: ChannelSnapshot[] = [];

    for (const channel of guild.channels.cache.values()) {
      if (!LOCKABLE_TYPES.has(channel.type) || !('permissionOverwrites' in channel)) continue;
      if (manualLocked.has(channel.id)) continue;
      // Only channels @everyone can see (private ones are already unreachable for newcomers)
      if (!channel.permissionsFor(everyone)?.has(PermissionFlagsBits.ViewChannel)) continue;
      const myPerms = channel.permissionsFor(me);
      if (!myPerms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageRoles])) continue;

      const ow = (channel as any).permissionOverwrites.cache.get(everyone.id) as { allow: PermissionsBitField; deny: PermissionsBitField } | undefined;
      const bits: ChannelSnapshot['bits'] = {};
      for (const bit of LOCK_BITS) {
        const flag = PermissionsBitField.Flags[bit];
        // The bot can only deny permissions it has itself in the channel
        if (!myPerms.has(flag)) continue;
        const prev = ow?.deny.has(flag) ? false : ow?.allow.has(flag) ? true : null;
        if (prev === false) continue; // already denied: nothing to change or restore
        bits[bit] = prev;
      }
      if (Object.keys(bits).length === 0) continue;

      // Moderation roles: allow only where they currently inherit (null). A previous allow
      // needs no change and an explicit deny for the role in that channel is respected.
      const roles: OverwriteSnapshot[] = [];
      for (const role of modRoles) {
        const row = (channel as any).permissionOverwrites.cache.get(role.id) as OverwriteLike | undefined;
        const roleBits: OverwriteSnapshot['bits'] = {};
        for (const bit of Object.keys(bits) as LockBit[]) {
          const flag = PermissionsBitField.Flags[bit];
          if (!row?.allow.has(flag) && !row?.deny.has(flag)) roleBits[bit] = null;
        }
        if (Object.keys(roleBits).length > 0) roles.push({ id: role.id, existed: !!row, bits: roleBits });
      }
      out.push({ id: channel.id, existed: !!ow, bits, roles });
    }
    return out;
  }

  // ─── Member action ────────────────────────────────────────────────────────

  private isStaff(member: GuildMember): boolean {
    return member.permissions.any([
      PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ModerateMembers,
      PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers, PermissionFlagsBits.ManageMessages,
    ]);
  }

  /** Returns what happened: logged | skipped | timed_out | kicked | banned | failed. */
  private async applyRaidAction(member: GuildMember, config: AntiRaidConfig): Promise<string> {
    if (config.action === 'alert') return 'logged';
    if (member.user.bot || this.isStaff(member)) return 'skipped';
    // Honeypot already acted on this join: no double sanction
    if (!(await claimJoinAction(this.client.redis.getClient(), member, 'antiraid'))) return 'skipped';

    const guild = member.guild;
    const reason = i18n.t('moderation.antiraid.audit_reason', guild.id);
    let applied = 'failed';
    let caseAction: 'TIMEOUT' | 'KICK' | 'BAN' | null = null;
    let durationMin: number | null = null;

    try {
      switch (config.action) {
        case 'timeout': {
          const ms = Math.min(config.durationSecs * 1000, MAX_TIMEOUT_MS);
          if (member.moderatable && await member.timeout(ms, reason).then(() => true).catch(() => false)) {
            applied = 'timed_out'; caseAction = 'TIMEOUT'; durationMin = Math.round(ms / 60_000);
          }
          break;
        }
        case 'kick':
          if (member.kickable && await member.kick(reason).then(() => true).catch(() => false)) {
            applied = 'kicked'; caseAction = 'KICK';
          }
          break;
        case 'ban':
          if (member.bannable && await guild.bans.create(member.id, { reason, deleteMessageSeconds: 86400 }).then(() => true).catch(() => false)) {
            applied = 'banned'; caseAction = 'BAN';
          }
          break;
      }
    } catch (err) {
      this.client.logger.error('[AntiRaid] applyRaidAction error:', err);
    }

    if (caseAction) {
      await this.client.db.moderationRaidState.updateMany({
        where: { guildId: guild.id, active: true }, data: { actionCount: { increment: 1 } },
      }).catch(() => null);
      await this.client.moderation.createCase({
        guildId: guild.id,
        action: caseAction,
        targetId: member.id,
        moderatorId: this.client.user?.id ?? guild.members.me?.id ?? '0',
        reason,
        duration: durationMin,
        expiresAt: caseAction === 'TIMEOUT' && durationMin ? new Date(Date.now() + durationMin * 60_000) : null,
        active: caseAction !== 'KICK',
      }).catch(() => null);
    }
    return applied;
  }

  // ─── Raid mode end ────────────────────────────────────────────────────────

  /**
   * Ends raid mode and restores the previous state.
   * - 'ended': restored in this process.
   * - 'scheduled': the server is on another shard; endsAt is moved forward and its sweep ends it.
   * - 'not_active' | 'busy'
   */
  async endRaid(guildId: string, endedBy: string): Promise<'ended' | 'scheduled' | 'not_active' | 'busy'> {
    const redis = this.client.redis.getClient();
    const state = await this.client.db.moderationRaidState.findUnique({ where: { guildId } });
    if (!state?.active) {
      await redis.del(ACTIVE_KEY(guildId), WINDOW_KEY(guildId)).catch(() => null);
      return 'not_active';
    }

    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) {
      // Another shard: prevent anyone else from entering raid mode and let its sweep restore now
      await redis.del(ACTIVE_KEY(guildId), WINDOW_KEY(guildId)).catch(() => null);
      await this.client.db.moderationRaidState.updateMany({
        where: { guildId, active: true }, data: { endsAt: new Date(), endedBy },
      });
      return 'scheduled';
    }

    const lock = await redis.set(ENDING_KEY(guildId), '1', 'EX', 120, 'NX').catch(() => 'OK');
    if (lock !== 'OK') return 'busy';

    try {
      await this.starting.get(guildId);
      const fresh = await this.client.db.moderationRaidState.findUnique({ where: { guildId } });
      if (!fresh?.active) return 'not_active';

      const reason = i18n.t('moderation.antiraid.audit_reason_end', guildId);
      await this.restoreVerification(guild, fresh, reason);
      const keptLocked = await this.restoreChannels(guild, fresh, reason);

      const done = await this.client.db.moderationRaidState.updateMany({
        where: { guildId, active: true },
        data: { active: false, endedAt: new Date(), endedBy: fresh.endedBy && endedBy === 'auto' ? fresh.endedBy : endedBy },
      });
      await redis.del(ACTIVE_KEY(guildId), WINDOW_KEY(guildId)).catch(() => null);
      if (done.count === 0) return 'not_active';

      const by = fresh.endedBy && endedBy === 'auto' ? fresh.endedBy : endedBy;
      await this.sendAlert(guild, 'end', {
        joins: String(fresh.joinCount),
        actions: String(fresh.actionCount),
        started: `<t:${Math.floor(fresh.startedAt.getTime() / 1000)}:R>`,
        by: by === 'auto' ? i18n.t('moderation.antiraid.ended_auto', guildId) : `<@${by.replace(/^dashboard:/, '')}>`,
        kept: String(keptLocked),
      });
      return 'ended';
    } finally {
      await redis.del(ENDING_KEY(guildId)).catch(() => null);
    }
  }

  private async restoreVerification(guild: Guild, state: ModerationRaidState, reason: string): Promise<void> {
    if (state.verificationBefore === null || state.verificationSet === null) return;
    // If someone changed the level during the raid, their change is respected
    if (guild.verificationLevel !== state.verificationSet) return;
    await guild.setVerificationLevel(state.verificationBefore as GuildVerificationLevel, reason).catch((err) =>
      this.client.logger.warn(`[AntiRaid] Could not restore verification level in ${guild.id}:`, err?.message ?? err));
  }

  /**
   * Restores the channels locked by the raid. Returns how many are left
   * locked because an admin applied /lockdown to them during the raid.
   */
  private async restoreChannels(guild: Guild, state: ModerationRaidState, reason: string): Promise<number> {
    const snapshot = (Array.isArray(state.channelSnapshot) ? state.channelSnapshot : []) as unknown as ChannelSnapshot[];
    const everyoneId = guild.roles.everyone.id;
    const manualLocked = await this.getManualLockdowns(guild.id);
    let kept = 0;

    for (const snap of snapshot) {
      const channel = guild.channels.cache.get(snap?.id) as GuildBasedChannel | undefined;
      if (!channel || !('permissionOverwrites' in channel)) continue;
      const overwrites = (channel as any).permissionOverwrites;

      // 1. Moderation roles: remove the added allow (only if still allow)
      for (const role of snap.roles ?? []) {
        await this.restoreOverwrite(overwrites, role, true, reason).catch((err: any) =>
          this.client.logger.warn(`[AntiRaid] Could not restore role ${role.id} in channel ${snap.id}:`, err?.message ?? err));
      }

      // 2. Active manual /lockdown: the channel stays locked; fix the original state
      //    saved by the command so its unlock doesn't inherit the raid lockdown
      if (manualLocked.has(snap.id)) {
        await this.fixManualLockdownOriginal(snap).catch(() => null);
        kept++;
        continue;
      }

      // 3. @everyone: only the bits still denied by the lockdown
      await this.restoreOverwrite(overwrites, { ...snap, id: everyoneId }, false, reason).catch((err: any) =>
        this.client.logger.warn(`[AntiRaid] Could not restore channel ${snap.id} in ${guild.id}:`, err?.message ?? err));
    }
    return kept;
  }

  /**
   * Returns an overwrite to its previous state for the bits that still have the value
   * set by the raid (`setValue`: true = allow, false = deny). If it did not exist before
   * and ends up empty, it is deleted.
   */
  private async restoreOverwrite(overwrites: any, snap: OverwriteSnapshot, setValue: boolean, reason: string): Promise<void> {
    const ow = overwrites.cache.get(snap.id) as OverwriteLike | undefined;
    if (!ow) return; // someone removed the overwrite: nothing to restore
    const patch: Partial<Record<LockBit, boolean | null>> = {};
    for (const bit of LOCK_BITS) {
      if (!(bit in (snap.bits ?? {}))) continue;
      const flag = PermissionsBitField.Flags[bit];
      if (setValue ? ow.allow.has(flag) : ow.deny.has(flag)) patch[bit] = snap.bits[bit] ?? null;
    }
    if (Object.keys(patch).length === 0) return;
    await overwrites.edit(snap.id, patch, { reason });
    const after = overwrites.cache.get(snap.id) as OverwriteLike | undefined;
    if (!snap.existed && after && after.allow.bitfield === BigInt(0) && after.deny.bitfield === BigInt(0)) {
      await overwrites.delete(snap.id, reason);
    }
  }

  /**
   * /lockdown saved as "original" the channel's @everyone overwrite at that
   * moment, which already included the raid lockdown. Those bits are replaced with
   * their pre-raid state so /lockdown unlock leaves the channel as it was before the raid.
   */
  private async fixManualLockdownOriginal(snap: ChannelSnapshot): Promise<void> {
    const row = await this.client.db.channelLockdown.findUnique({ where: { channelId: snap.id } });
    if (!row || row.everyoneAllow === null || row.everyoneDeny === null) return;
    let allow = BigInt(row.everyoneAllow);
    let deny = BigInt(row.everyoneDeny);
    let changed = false;
    for (const bit of Object.keys(snap.bits ?? {}) as LockBit[]) {
      if (!LOCK_BITS.includes(bit)) continue;
      const flag = PermissionsBitField.Flags[bit];
      if ((deny & flag) !== flag) continue; // no longer the raid's deny
      deny &= ~flag;
      if (snap.bits[bit] === true) allow |= flag;
      changed = true;
    }
    if (!changed) return;
    const empty = allow === BigInt(0) && deny === BigInt(0) && !snap.existed;
    await this.client.db.channelLockdown.update({
      where: { channelId: snap.id },
      data: { everyoneAllow: empty ? null : allow.toString(), everyoneDeny: empty ? null : deny.toString() },
    });
  }

  /** Periodic sweep: ends expired raids for this shard's servers. */
  private async sweep(): Promise<void> {
    if (!this.client.isReady()) return;
    const due = await this.client.db.moderationRaidState.findMany({
      where: { active: true, endsAt: { lte: new Date() } },
      select: { guildId: true },
      take: 100,
    });
    for (const { guildId } of due) {
      if (!this.client.guilds.cache.has(guildId)) continue;
      await this.endRaid(guildId, 'auto').catch((err) => this.client.logger.error('[AntiRaid] sweep error:', err));
    }
  }

  // ─── Status (dashboard and command)────────────────────────────────────────

  async getStatus(guildId: string): Promise<ModerationRaidState | null> {
    const state = await this.client.db.moderationRaidState.findUnique({ where: { guildId } });
    return state?.active ? state : null;
  }

  // ─── Alert in the moderation log channel ─────────────────────────────────

  private describeLockdown(guildId: string, verification: boolean, channels: number, mode: RaidLockdown, modRoleIds: string[] = []): string {
    const parts: string[] = [];
    if (verification) parts.push(i18n.t('moderation.antiraid.lockdown_verification', guildId));
    if (channels > 0) parts.push(i18n.t('moderation.antiraid.lockdown_channels', guildId, { count: String(channels) }));
    if (channels > 0 && modRoleIds.length > 0) {
      parts.push(i18n.t('moderation.antiraid.lockdown_mod_roles', guildId, { roles: modRoleIds.map((id) => `<@&${id}>`).join(', ') }));
    }
    if (parts.length > 0) return parts.join('\n');
    return i18n.t(mode === 'none' ? 'moderation.antiraid.lockdown_none' : 'moderation.antiraid.lockdown_failed', guildId);
  }

  private async sendAlert(guild: Guild, kind: 'start' | 'end', vars: Record<string, string>): Promise<void> {
    try {
      const channel = await this.client.moderation.getModerationLogChannel(guild);
      if (!channel) return;
      const t = (key: string, v?: Record<string, string>) => i18n.t(key, guild.id, v);

      const embed = new EmbedBuilder().setTimestamp();
      if (kind === 'start') {
        embed
          .setColor(Colors.Red)
          .setTitle(t('moderation.antiraid.start_title'))
          .setDescription(t('moderation.antiraid.start_desc', vars))
          .addFields(
            { name: t('moderation.antiraid.field_action'), value: vars.action, inline: true },
            { name: t('moderation.antiraid.field_ends'), value: vars.ends, inline: true },
            { name: t('moderation.antiraid.field_lockdown'), value: vars.lockdown.slice(0, 1024) },
          )
          .setFooter({ text: t('moderation.antiraid.start_footer') });
      } else {
        const kept = Number(vars.kept ?? 0) > 0 ? `\n${t('moderation.antiraid.end_kept_locked', { count: vars.kept })}` : '';
        embed
          .setColor(Colors.Green)
          .setTitle(t('moderation.antiraid.end_title'))
          .setDescription(t('moderation.antiraid.end_desc', vars) + kept);
      }
      await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    } catch {
      // Silent: the alert must not interrupt protection
    }
  }
}
