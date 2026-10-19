import { ApplicationCommandPermissionType, Guild, PermissionFlagsBits } from 'discord.js';
import { KorexClient } from '../KorexClient';

/**
 * Permisos por comando configurados por el servidor en Discord
 * (Ajustes del servidor → Integraciones → Korex).
 *
 * En slash los aplica Discord; con prefijo hay que aplicarlos a mano con la
 * misma semántica oficial:
 *
 *  1. Canal: override del canal (o del canal padre si es un hilo) > override
 *     "todos los canales" (id = guildId - 1). Primero a nivel de comando y, si
 *     el comando no dice nada, a nivel de aplicación (id = applicationId).
 *     Un canal denegado bloquea a todos salvo al propietario del servidor.
 *  2. Miembro (comando y, si no hay nada, aplicación): override de usuario >
 *     overrides de sus roles (basta un rol permitido; si no, uno denegado
 *     deniega) > @everyone (id = guildId).
 *  3. Sin overrides de miembro: `default_member_permissions` del comando.
 *  Propietario y Administrador siempre pueden (como en Discord).
 */
export interface CommandPermissionOverride {
  id: string;
  type: ApplicationCommandPermissionType | number;
  permission: boolean;
}

export interface CommandPermissionContext {
  guildId: string;
  channelId: string;
  /** Canal padre si el canal es un hilo */
  parentChannelId?: string | null;
  userId: string;
  roleIds: string[];
  isOwner: boolean;
  /** Permisos efectivos del miembro en el canal */
  memberPermissions: bigint;
  /** `default_member_permissions` del comando (null = sin restricción) */
  defaultMemberPermissions: string | null | undefined;
  /** Overrides del comando (null/[] = ninguno) */
  commandOverrides: CommandPermissionOverride[] | null | undefined;
  /** Overrides de la aplicación (valor por defecto de todos los comandos) */
  appOverrides: CommandPermissionOverride[] | null | undefined;
}

const ROLE = ApplicationCommandPermissionType.Role as number;
const USER = ApplicationCommandPermissionType.User as number;
const CHANNEL = ApplicationCommandPermissionType.Channel as number;

export function allChannelsId(guildId: string): string {
  return (BigInt(guildId) - 1n).toString();
}

function channelDecision(list: CommandPermissionOverride[] | null | undefined, ctx: CommandPermissionContext): boolean | undefined {
  if (!list?.length) return undefined;
  const channels = list.filter(o => o.type === CHANNEL);
  if (!channels.length) return undefined;
  const direct = channels.find(o => o.id === ctx.channelId);
  if (direct) return direct.permission;
  if (ctx.parentChannelId) {
    const parent = channels.find(o => o.id === ctx.parentChannelId);
    if (parent) return parent.permission;
  }
  const all = channels.find(o => o.id === allChannelsId(ctx.guildId));
  return all ? all.permission : undefined;
}

function memberDecision(list: CommandPermissionOverride[] | null | undefined, ctx: CommandPermissionContext): boolean | undefined {
  if (!list?.length) return undefined;
  const user = list.find(o => o.type === USER && o.id === ctx.userId);
  if (user) return user.permission;

  const roles = list.filter(o => o.type === ROLE && o.id !== ctx.guildId && ctx.roleIds.includes(o.id));
  if (roles.some(o => o.permission)) return true;
  if (roles.length) return false;

  const everyone = list.find(o => o.type === ROLE && o.id === ctx.guildId);
  return everyone ? everyone.permission : undefined;
}

/** Comprobación de `default_member_permissions` (como Discord: "0" = solo administradores) */
export function hasDefaultMemberPermissions(defaultPerms: string | null | undefined, memberPermissions: bigint): boolean {
  if (defaultPerms === null || defaultPerms === undefined) return true;
  if ((memberPermissions & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator) return true;
  const required = BigInt(defaultPerms);
  if (required === 0n) return false;
  return (memberPermissions & required) === required;
}

export function evaluateCommandPermission(ctx: CommandPermissionContext): boolean {
  if (ctx.isOwner) return true;

  const channel = channelDecision(ctx.commandOverrides, ctx) ?? channelDecision(ctx.appOverrides, ctx);
  if (channel === false) return false;

  const isAdmin = (ctx.memberPermissions & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator;
  if (isAdmin) return true;

  const member = memberDecision(ctx.commandOverrides, ctx) ?? memberDecision(ctx.appOverrides, ctx);
  if (member !== undefined) return member;

  return hasDefaultMemberPermissions(ctx.defaultMemberPermissions, ctx.memberPermissions);
}

/** Overrides de un servidor: por nombre de comando + los de la aplicación */
export interface GuildCommandPermissions {
  fetchedAt: number;
  app: CommandPermissionOverride[];
  byName: Record<string, CommandPermissionOverride[]>;
}

const FRESH_TTL_S = 300;
const STALE_TTL_S = 86_400;
const LOCAL_TTL_MS = 60_000;

/**
 * Obtiene (con caché) los overrides del servidor:
 * memoria 60 s → Redis 5 min → API de Discord. Guarda además una copia
 * "última conocida" (24 h) para fallar cerrado si Discord no responde.
 */
export class CommandPermissionService {
  private readonly local = new Map<string, { data: GuildCommandPermissions; expires: number }>();
  private readonly inflight = new Map<string, Promise<GuildCommandPermissions | null>>();
  private readonly warned = new Set<string>();
  /** Tras un fallo no se reintenta durante un rato (evita martillear la API) */
  private readonly failedUntil = new Map<string, number>();

  constructor(private readonly client: KorexClient) {}

  private freshKey(guildId: string) { return `guild:${guildId}:cmdperms`; }
  private staleKey(guildId: string) { return `guild:${guildId}:cmdperms:last`; }

  async invalidate(guildId: string): Promise<void> {
    this.local.delete(guildId);
    this.failedUntil.delete(guildId);
    await this.client.redis.del(this.freshKey(guildId)).catch(() => false);
  }

  /**
   * Overrides actuales. `stale: true` = no se pudo consultar Discord y se
   * devuelve la última copia conocida (o null si nunca se obtuvo).
   */
  async get(guild: Guild): Promise<{ data: GuildCommandPermissions | null; stale: boolean }> {
    const now = Date.now();
    const local = this.local.get(guild.id);
    if (local && local.expires > now) return { data: local.data, stale: false };

    const cached = await this.client.redis.get<GuildCommandPermissions>(this.freshKey(guild.id)).catch(() => null);
    if (cached) {
      this.remember(guild.id, cached);
      return { data: cached, stale: false };
    }

    const blocked = this.failedUntil.get(guild.id);
    if (blocked && blocked > now) {
      const last = local?.data ?? await this.client.redis.get<GuildCommandPermissions>(this.staleKey(guild.id)).catch(() => null);
      return { data: last ?? null, stale: true };
    }

    let pending = this.inflight.get(guild.id);
    if (!pending) {
      pending = this.fetch(guild).finally(() => this.inflight.delete(guild.id));
      this.inflight.set(guild.id, pending);
    }
    const fresh = await pending;
    if (fresh) return { data: fresh, stale: false };

    const last = local?.data ?? await this.client.redis.get<GuildCommandPermissions>(this.staleKey(guild.id)).catch(() => null);
    return { data: last ?? null, stale: true };
  }

  private remember(guildId: string, data: GuildCommandPermissions): void {
    if (this.local.size > 20_000) {
      const oldest = this.local.keys().next().value;
      if (oldest !== undefined) this.local.delete(oldest);
    }
    this.local.set(guildId, { data, expires: Date.now() + LOCAL_TTL_MS });
  }

  private async fetch(guild: Guild): Promise<GuildCommandPermissions | null> {
    const appId = this.client.application?.id ?? this.client.user?.id;
    if (!appId) return null;
    try {
      const all = await guild.commands.permissions.fetch({});
      const data: GuildCommandPermissions = { fetchedAt: Date.now(), app: [], byName: {} };
      if (all.size) {
        // Nombres de los comandos: globales + del servidor (addons)
        const names = new Map<string, string>();
        const globals = this.client.application?.commands.cache.size
          ? this.client.application.commands.cache
          : await this.client.application?.commands.fetch().catch(() => null);
        globals?.forEach(c => names.set(c.id, c.name));
        const unknown = [...all.keys()].some(id => id !== appId && !names.has(id));
        if (unknown) {
          const local = await guild.commands.fetch().catch(() => null);
          local?.forEach(c => names.set(c.id, c.name));
        }
        for (const [id, perms] of all) {
          const list = perms.map(p => ({ id: p.id, type: p.type, permission: p.permission }));
          if (id === appId) data.app = list;
          else {
            const name = names.get(id);
            if (name) data.byName[name] = list;
          }
        }
      }
      this.failedUntil.delete(guild.id);
      this.warned.delete(guild.id);
      this.remember(guild.id, data);
      await this.client.redis.set(this.freshKey(guild.id), data, FRESH_TTL_S).catch(() => false);
      await this.client.redis.set(this.staleKey(guild.id), data, STALE_TTL_S).catch(() => false);
      return data;
    } catch (error) {
      if (this.failedUntil.size > 10_000) this.failedUntil.clear();
      this.failedUntil.set(guild.id, Date.now() + 30_000);
      if (!this.warned.has(guild.id)) {
        this.warned.add(guild.id);
        if (this.warned.size > 10_000) this.warned.clear();
        this.client.logger.warn(`[Prefix] No se pudieron obtener los permisos de comandos de ${guild.id}:`, error);
      }
      return null;
    }
  }

  /**
   * ¿Puede este miembro usar el comando aquí? Si Discord no responde:
   * falla cerrado para los comandos con overrides conocidos y aplica
   * `default_member_permissions` al resto.
   */
  async canUse(
    guild: Guild,
    params: Omit<CommandPermissionContext, 'commandOverrides' | 'appOverrides' | 'guildId'> & { commandName: string }
  ): Promise<boolean> {
    const { data, stale } = await this.get(guild);
    const commandOverrides = data?.byName[params.commandName] ?? null;
    const appOverrides = data?.app ?? null;

    // Sin respuesta de Discord y con overrides conocidos para este comando: cerrado
    if (stale && (commandOverrides?.length ?? 0) > 0) return params.isOwner;

    return evaluateCommandPermission({ ...params, guildId: guild.id, commandOverrides, appOverrides });
  }
}
