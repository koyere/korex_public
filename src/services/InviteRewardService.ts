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

/** Máximo de recompensas (umbral → rol) por servidor. */
export const MAX_INVITE_REWARD_TIERS = 25;
/** Umbral máximo configurable (coherente con /invites add, que admite hasta 1000). */
export const MAX_INVITE_REWARD_THRESHOLD = 100000;

/** Resincronización completa: lotes, pausa entre lotes y enfriamiento por servidor. */
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
 * Recompensas por invitaciones: entrega roles al alcanzar N invitaciones válidas
 * (válidas + bonus, que ya descuentan salidas y cuentas falsas/recientes).
 *
 * El estado deseado se recalcula siempre a partir de la BD (umbrales + estadísticas),
 * así que cada sincronización es idempotente y sobrevive a reinicios. Los roles que
 * entrega el bot se registran en invite_reward_grants: solo esos se retiran después,
 * nunca un rol que un administrador haya dado a mano.
 */
export class InviteRewardService {
  private client: KorexClient;
  private prisma: PrismaClient;
  /** Serializa las sincronizaciones de un mismo miembro (guild:user) en este proceso. */
  private memberLocks = new Map<string, Promise<unknown>>();
  /** Resincronizaciones completas en curso (respaldo si Redis no está disponible). */
  private runningGuildSyncs = new Set<string>();
  private localCooldowns = new Map<string, number>();

  constructor(client: KorexClient) {
    this.client = client;
    this.prisma = client.db;
  }

  // ─── Configuración ────────────────────────────────────────────────────────

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

  /** Valida que un canal sirva para los avisos (texto, del servidor, el bot puede escribir). */
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

  /** Roles que se pueden usar como recompensa (seguros y por debajo del bot y de quien configura). */
  getAssignableRoles(guild: Guild, actor: GuildMember | null): Array<{ id: string; name: string; color: string; position: number }> {
    return guild.roles.cache
      .filter((role) => checkSelfAssignableRole(guild, role.id, actor).ok)
      .sort((a, b) => b.position - a.position)
      .map((role) => ({ id: role.id, name: role.name, color: role.hexColor, position: role.position }));
  }

  /** Canales de texto/anuncios donde el bot puede publicar los avisos. */
  getAnnounceChannels(guild: Guild): Array<{ id: string; name: string; type: number }> {
    return guild.channels.cache
      .filter((channel) => this.isValidAnnounceChannel(guild, channel.id))
      .sort((a, b) => ('position' in a ? a.position : 0) - ('position' in b ? b.position : 0))
      .map((channel) => ({ id: channel.id, name: channel.name, type: channel.type }));
  }

  /**
   * Añade una recompensa. Valida el rol (jerarquía del bot y de quien configura,
   * permisos peligrosos, @everyone, gestionado) y el límite de recompensas.
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
      // Carrera con otra petición: las claves únicas (umbral / rol) deciden
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

  /** Elimina una recompensa por umbral o por rol. Devuelve cuántas se borraron. */
  async removeTier(guildId: string, filter: { id?: string; requiredInvites?: number; roleId?: string }): Promise<number> {
    if (!filter.id && filter.requiredInvites === undefined && !filter.roleId) return 0;
    const where: Prisma.InviteRewardTierWhereInput = { guildId };
    if (filter.id) where.id = filter.id;
    if (filter.requiredInvites !== undefined) where.requiredInvites = filter.requiredInvites;
    if (filter.roleId) where.roleId = filter.roleId;
    const res = await this.prisma.inviteRewardTier.deleteMany({ where });
    return res.count;
  }

  // ─── Sincronización ───────────────────────────────────────────────────────

  /**
   * Recalcula y aplica las recompensas de un miembro. Seguro de llamar tantas
   * veces como haga falta: solo añade lo que falta y quita lo que sobra.
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

      // Sin retirada por bajada: el nivel efectivo nunca baja de la mayor recompensa ya entregada
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

      // 1) Añadir lo que falta
      const newlyGranted: InviteRewardTierData[] = [];
      for (const tier of desired) {
        const check = checkSelfAssignableRole(guild, tier.roleId);
        if (!check.ok) {
          logger.warn(`[InviteRewards] Rol ${tier.roleId} omitido en ${guild.id}: ${check.problem}`);
          continue;
        }

        // Ya lo tiene: si no lo dio el bot es un rol manual y no se registra (nunca se retirará)
        if (member.roles.cache.has(tier.roleId)) continue;

        // Reclamo atómico del registro: solo quien lo crea anuncia la recompensa.
        // Si ya existía (p. ej. el miembro salió y volvió) se reasigna sin aviso.
        const claimed = await this.prisma.inviteRewardGrant.createMany({
          data: [{ guildId: guild.id, userId, roleId: tier.roleId }],
          skipDuplicates: true,
        });
        const isNew = claimed.count === 1;

        try {
          await member.roles.add(tier.roleId, i18n.t('invites.rewards.audit_add', guild.id, { invites: String(tier.requiredInvites) }));
          result.added.push(tier.roleId);
        } catch (error) {
          logger.warn(`[InviteRewards] No se pudo asignar ${tier.roleId} a ${userId} en ${guild.id}: ${error}`);
          if (isNew) {
            await this.prisma.inviteRewardGrant.deleteMany({ where: { guildId: guild.id, userId, roleId: tier.roleId } }).catch(() => {});
          }
          continue;
        }
        if (isNew) newlyGranted.push(tier);
      }

      // 2) Quitar lo que sobra (solo roles entregados por el bot)
      for (const roleId of grantedRoleIds) {
        if (desiredIds.has(roleId)) continue;

        const configured = tierByRole.has(roleId);
        // Recompensa eliminada de la configuración y sin retirada: el rol se queda, se olvida el registro
        const shouldRemoveRole = configured || settings.removeOnDrop;

        if (shouldRemoveRole && member.roles.cache.has(roleId)) {
          const role = guild.roles.cache.get(roleId);
          if (!role || role.comparePositionTo(me.roles.highest) >= 0) continue; // fuera del alcance del bot
          try {
            await member.roles.remove(roleId, i18n.t('invites.rewards.audit_remove', guild.id));
            result.removed.push(roleId);
          } catch (error) {
            logger.warn(`[InviteRewards] No se pudo retirar ${roleId} a ${userId} en ${guild.id}: ${error}`);
            continue;
          }
        }
        await this.prisma.inviteRewardGrant.deleteMany({ where: { guildId: guild.id, userId, roleId } });
      }

      if (announce && newlyGranted.length > 0 && settings.announceChannelId) {
        await this.announce(guild, member, newlyGranted, count, settings.announceChannelId);
      }
    } catch (error) {
      logger.error(`[InviteRewards] Error sincronizando ${userId} en ${guild.id}:`, error);
    }

    return result;
  }

  /** Aviso en el canal configurado. Solo menciona (y notifica) al invitador. */
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
      logger.warn(`[InviteRewards] No se pudo enviar el aviso en ${guild.id}: ${error}`);
    }
  }

  /**
   * Resincroniza todo el servidor por lotes. Un único proceso por servidor y
   * enfriamiento de SYNC_COOLDOWN_SECS (Redis, con respaldo en memoria).
   */
  async syncGuild(guild: Guild): Promise<GuildSyncResult> {
    const refused = await this.claimGuildSync(guild);
    if (refused) return refused;
    return this.runGuildSync(guild);
  }

  /**
   * Igual que syncGuild, pero no espera al resultado (panel web): aplica las mismas
   * comprobaciones y el mismo enfriamiento y lanza la sincronización en segundo plano.
   */
  async startGuildSync(guild: Guild): Promise<{ ok: true } | Extract<GuildSyncResult, { ok: false }>> {
    const refused = await this.claimGuildSync(guild);
    if (refused) return refused;
    this.runGuildSync(guild).catch((error) => logger.error(`[InviteRewards] Error en la resincronización de ${guild.id}:`, error));
    return { ok: true };
  }

  /** Estado de la resincronización para el panel (en curso / segundos de enfriamiento). */
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
    } catch { /* sin estado de enfriamiento */ }
    return { running: this.runningGuildSyncs.has(guildId), retryAfter };
  }

  /** Comprobaciones previas + enfriamiento. Devuelve el motivo del rechazo o null si se puede empezar. */
  private async claimGuildSync(guild: Guild): Promise<Extract<GuildSyncResult, { ok: false }> | null> {
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return { ok: false, reason: 'no_permission' };
    }
    if (this.runningGuildSyncs.has(guild.id)) return { ok: false, reason: 'running' };

    const cooldown = await this.acquireSyncCooldown(guild.id);
    if (cooldown > 0) return { ok: false, reason: 'cooldown', retryAfter: cooldown };

    // Se marca en curso antes de ceder el control: dos peticiones simultáneas no arrancan dos pasadas
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

  /** Devuelve 0 si se adquiere el enfriamiento, o los segundos restantes si no. */
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
    } catch { /* respaldo en memoria */ }

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
