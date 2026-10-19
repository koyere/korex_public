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
 * Anti-raid de Moderación (Moderación → AutoMod → Anti-Raid).
 *
 * - Detección: ventana deslizante de entradas en Redis (script Lua atómico,
 *   válido con varios shards). N entradas en T segundos activan el modo raid;
 *   opcionalmente solo cuentan las cuentas más nuevas que X días.
 * - Acciones: aviso en el canal de logs de moderación y, si la config lo pide,
 *   aislar (timeout) / expulsar / banear a quienes entran durante el raid, y
 *   modo bloqueo (verificación máxima y/o @everyone sin enviar mensajes).
 * - Fin: automático tras la duración configurada (barrido periódico) o manual
 *   (/antiraid end o el panel). El estado previo se guarda en BD
 *   (moderation_raid_states) y se restaura exactamente aunque el bot se reinicie.
 * - Coordinación con Honeypot: una sola sanción por entrada (joinActionClaim).
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

/** Permisos que se deniegan a @everyone en el bloqueo de canales. */
const LOCK_BITS = ['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads'] as const;
type LockBit = typeof LOCK_BITS[number];

interface OverwriteSnapshot {
  id: string;
  existed: boolean;                            // ¿había overwrite antes?
  bits: Partial<Record<LockBit, boolean | null>>; // estado previo: true=allow, false=deny, null=heredado
}

/** Overwrite de @everyone del canal + overwrites (allow) añadidos a los roles de moderación. */
interface ChannelSnapshot extends OverwriteSnapshot {
  roles?: OverwriteSnapshot[];
}

type OverwriteLike = { allow: PermissionsBitField; deny: PermissionsBitField };

const LOCKABLE_TYPES = new Set<ChannelType>([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum]);
const LOCK_VERIFICATION = GuildVerificationLevel.VeryHigh;

const WINDOW_KEY = (g: string) => `modraid:joins:${g}`;
const ACTIVE_KEY = (g: string) => `modraid:active:${g}`; // valor = endsAt (ms)
const ENDING_KEY = (g: string) => `modraid:ending:${g}`;

const CONFIG_TTL_MS = 30_000;
const SWEEP_INTERVAL_MS = 30_000;
const MAX_RAID_MS = 24 * 3600_000;    // tope de extensión del modo raid
const EXTEND_STEP_MS = 30_000;        // no reescribir endsAt por menos de 30 s
const MAX_RETRO_TARGETS = 100;        // miembros de la ventana sancionados al detectar el raid
const MAX_TIMEOUT_MS = 28 * 24 * 3600_000;
const MAX_MOD_ROLES = 10;             // roles de moderación que siguen escribiendo en canales bloqueados

/**
 * KEYS[1]=ventana, KEYS[2]=activo · ARGV: now, windowMs, threshold, member, durationMs
 * Devuelve { count, started(0|1), endsAt|'' , miembros de la ventana si started }
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
  /** Arranques en curso (bloqueo de canales) para que un fin manual espere a que terminen. */
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
   * Cuenta la entrada y, si hay raid, aplica la acción configurada.
   * `alreadyRemoved`: Honeypot ya expulsó/baneó a este miembro (se cuenta pero no se actúa).
   * Devuelve true si este servicio expulsó o baneó al miembro.
   */
  async handleMemberJoin(member: GuildMember, alreadyRemoved = false): Promise<boolean> {
    if (member.user.bot) return false;
    const guildId = member.guild.id;

    try {
      const config = await this.getConfig(guildId);
      if (!config?.enabled) return false;

      // Filtro opcional de cuentas nuevas: las cuentas más antiguas no cuentan
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
      if (!res) return false; // sin Redis no se bloquea a nadie
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

  /** Mientras siga entrando gente al ritmo del raid, se aplaza el final (tope 24 h). */
  private async extendRaid(guildId: string, currentEndsAt: number, config: AntiRaidConfig): Promise<void> {
    const wanted = Date.now() + config.durationSecs * 1000;
    if (wanted - currentEndsAt < EXTEND_STEP_MS) return;
    const state = await this.client.db.moderationRaidState.findUnique({ where: { guildId }, select: { active: true, startedAt: true, endedBy: true } });
    // endedBy ya fijado = fin manual pendiente (otro shard): no se aplaza
    if (!state?.active || state.endedBy) return;
    const endsAt = Math.min(wanted, state.startedAt.getTime() + MAX_RAID_MS);
    if (endsAt <= currentEndsAt) return;
    const redis = this.client.redis.getClient();
    await redis.set(ACTIVE_KEY(guildId), String(endsAt), 'PX', endsAt - Date.now() + 60_000, 'XX');
    await this.client.db.moderationRaidState.updateMany({ where: { guildId, active: true, endedBy: null }, data: { endsAt: new Date(endsAt) } });
  }

  // ─── Inicio del modo raid ─────────────────────────────────────────────────

  private async startRaid(guild: Guild, config: AntiRaidConfig, endsAt: number, count: number, recentIds: string[]): Promise<void> {
    const guildId = guild.id;

    // Si la BD ya tiene un raid activo (p. ej. Redis se reinició), es una
    // continuación: no se vuelve a tomar la instantánea (capturaría el bloqueo).
    const existing = await this.client.db.moderationRaidState.findUnique({ where: { guildId } });
    if (existing?.active) {
      if (existing.endedBy) return; // fin manual ya solicitado
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

    // 1. Verificación máxima (se guarda el nivel previo ANTES de cambiarlo)
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

    // 2. Bloqueo de canales: instantánea persistida y después se aplica
    let lockedChannels = 0;
    const modRoles = lockChannels ? this.pickModRoles(guild) : [];
    if (lockChannels) {
      // Los canales con un /lockdown manual activo se dejan tal cual
      const manualLocked = await this.getManualLockdowns(guildId);
      const snapshot = this.buildChannelSnapshot(guild, modRoles, manualLocked);
      if (snapshot.length > 0) {
        await this.client.db.moderationRaidState.update({ where: { guildId }, data: { channelSnapshot: snapshot as any } });
        for (const snap of snapshot) {
          const channel = guild.channels.cache.get(snap.id);
          if (!channel || !('permissionOverwrites' in channel)) continue;
          const overwrites = (channel as any).permissionOverwrites;
          // Primero el permiso de los roles de moderación, para que nunca queden sin poder escribir
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

    // 3. Acción retroactiva sobre quienes entraron en la ventana que disparó el raid
    if (config.action !== 'alert') {
      for (const id of recentIds.slice(0, MAX_RETRO_TARGETS)) {
        const target = await guild.members.fetch(id).catch(() => null);
        if (target) await this.applyRaidAction(target, config);
      }
    }
  }

  /**
   * Roles de moderación que siguen pudiendo escribir durante el bloqueo. La config
   * de moderación no define roles de moderador, así que se usan los roles con
   * Gestionar mensajes o Aislar miembros (los de Administrador ya ignoran los
   * overwrites y no hace falta tocarlos). Máximo MAX_MOD_ROLES, los más altos primero.
   */
  private pickModRoles(guild: Guild) {
    return [...guild.roles.cache.values()]
      .filter((r) => r.id !== guild.id && !r.managed
        && !r.permissions.has(PermissionFlagsBits.Administrator)
        && r.permissions.any([PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ModerateMembers]))
      .sort((a, b) => b.position - a.position)
      .slice(0, MAX_MOD_ROLES);
  }

  /** Canales con un /lockdown manual activo (tabla channel_lockdowns del comando). */
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
      // Solo canales que @everyone ve (los privados ya no son alcanzables por quien acaba de entrar)
      if (!channel.permissionsFor(everyone)?.has(PermissionFlagsBits.ViewChannel)) continue;
      const myPerms = channel.permissionsFor(me);
      if (!myPerms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageRoles])) continue;

      const ow = (channel as any).permissionOverwrites.cache.get(everyone.id) as { allow: PermissionsBitField; deny: PermissionsBitField } | undefined;
      const bits: ChannelSnapshot['bits'] = {};
      for (const bit of LOCK_BITS) {
        const flag = PermissionsBitField.Flags[bit];
        // El bot solo puede denegar permisos que él mismo tiene en el canal
        if (!myPerms.has(flag)) continue;
        const prev = ow?.deny.has(flag) ? false : ow?.allow.has(flag) ? true : null;
        if (prev === false) continue; // ya denegado: nada que cambiar ni restaurar
        bits[bit] = prev;
      }
      if (Object.keys(bits).length === 0) continue;

      // Roles de moderación: allow solo donde hoy heredan (null). Un allow previo no
      // necesita cambio y un deny explícito del rol en ese canal se respeta.
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

  // ─── Acción sobre miembros ────────────────────────────────────────────────

  private isStaff(member: GuildMember): boolean {
    return member.permissions.any([
      PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ModerateMembers,
      PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers, PermissionFlagsBits.ManageMessages,
    ]);
  }

  /** Devuelve lo ocurrido: logged | skipped | timed_out | kicked | banned | failed. */
  private async applyRaidAction(member: GuildMember, config: AntiRaidConfig): Promise<string> {
    if (config.action === 'alert') return 'logged';
    if (member.user.bot || this.isStaff(member)) return 'skipped';
    // Honeypot ya actuó sobre esta entrada: no se sanciona dos veces
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

  // ─── Fin del modo raid ────────────────────────────────────────────────────

  /**
   * Termina el modo raid y restaura el estado previo.
   * - 'ended': restaurado en este proceso.
   * - 'scheduled': el servidor está en otro shard; se adelanta endsAt y su barrido lo termina.
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
      // Otro shard: que nadie más entre en modo raid y que su barrido restaure ya
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
    // Si alguien cambió el nivel durante el raid, se respeta su cambio
    if (guild.verificationLevel !== state.verificationSet) return;
    await guild.setVerificationLevel(state.verificationBefore as GuildVerificationLevel, reason).catch((err) =>
      this.client.logger.warn(`[AntiRaid] Could not restore verification level in ${guild.id}:`, err?.message ?? err));
  }

  /**
   * Restaura los canales bloqueados por el raid. Devuelve cuántos se dejan
   * bloqueados porque un admin les aplicó /lockdown durante el raid.
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

      // 1. Roles de moderación: se quita el allow añadido (solo si sigue en allow)
      for (const role of snap.roles ?? []) {
        await this.restoreOverwrite(overwrites, role, true, reason).catch((err: any) =>
          this.client.logger.warn(`[AntiRaid] Could not restore role ${role.id} in channel ${snap.id}:`, err?.message ?? err));
      }

      // 2. /lockdown manual activo: el canal sigue bloqueado; se corrige el estado
      //    original que guardó el comando para que su unlock no herede el bloqueo del raid
      if (manualLocked.has(snap.id)) {
        await this.fixManualLockdownOriginal(snap).catch(() => null);
        kept++;
        continue;
      }

      // 3. @everyone: solo los bits que siguen denegados por el bloqueo
      await this.restoreOverwrite(overwrites, { ...snap, id: everyoneId }, false, reason).catch((err: any) =>
        this.client.logger.warn(`[AntiRaid] Could not restore channel ${snap.id} in ${guild.id}:`, err?.message ?? err));
    }
    return kept;
  }

  /**
   * Devuelve un overwrite a su estado previo para los bits que aún tienen el valor
   * que puso el raid (`setValue`: true = allow, false = deny). Si antes no existía
   * y queda vacío, se elimina.
   */
  private async restoreOverwrite(overwrites: any, snap: OverwriteSnapshot, setValue: boolean, reason: string): Promise<void> {
    const ow = overwrites.cache.get(snap.id) as OverwriteLike | undefined;
    if (!ow) return; // alguien quitó el overwrite: nada que restaurar
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
   * /lockdown guardó como "original" el overwrite de @everyone que tenía el canal
   * en ese momento, que ya incluía el bloqueo del raid. Se sustituyen esos bits por
   * su estado previo al raid para que /lockdown unlock deje el canal como antes del raid.
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
      if ((deny & flag) !== flag) continue; // ya no era el deny del raid
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

  /** Barrido periódico: termina los raids vencidos de los servidores de este shard. */
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

  // ─── Estado (panel y comando) ─────────────────────────────────────────────

  async getStatus(guildId: string): Promise<ModerationRaidState | null> {
    const state = await this.client.db.moderationRaidState.findUnique({ where: { guildId } });
    return state?.active ? state : null;
  }

  // ─── Aviso en el canal de logs de moderación ─────────────────────────────

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
      // Silencioso: el aviso no debe interrumpir la protección
    }
  }
}
