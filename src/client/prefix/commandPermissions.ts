import { ApplicationCommandPermissionType, Guild, PermissionFlagsBits } from 'discord.js';
import { KorexClient } from '../KorexClient';

/**
 * Per-command permissions configured by the server in Discord
 * (Server Settings → Integrations → Korex).
 *
 * For slash commands Discord applies them; with prefix they must be applied by hand with the
 * same official semantics:
 *
 *  1. Channel: channel override (or parent channel's if it is a thread) > override
 *     "all channels" (id = guildId - 1). First at command level and, if
 *     the command says nothing, at application level (id = applicationId).
 *     A denied channel blocks everyone except the server owner.
 *  2. Member (command and, if nothing, application): user override >
 *     overrides of their roles (one allowed role is enough; otherwise a denied one
 *     denies) > @everyone (id = guildId).
 *  3. No member overrides: the command's `default_member_permissions`.
 *  Owner and Administrator are always allowed (as in Discord).
 */
export interface CommandPermissionOverride {
  id: string;
  type: ApplicationCommandPermissionType | number;
  permission: boolean;
}

export interface CommandPermissionContext {
  guildId: string;
  channelId: string;
  /** Parent channel if the channel is a thread */
  parentChannelId?: string | null;
  userId: string;
  roleIds: string[];
  isOwner: boolean;
  /** Member's effective permissions in the channel */
  memberPermissions: bigint;
  /** The command's `default_member_permissions` (null = no restriction) */
  defaultMemberPermissions: string | null | undefined;
  /** Command overrides (null/[] = none) */
  commandOverrides: CommandPermissionOverride[] | null | undefined;
  /** Application overrides (default value for all commands) */
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

/** `default_member_permissions` check (like Discord: "0" = administrators only) */
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

/** A server's overrides: by command name + the application's */
export interface GuildCommandPermissions {
  fetchedAt: number;
  app: CommandPermissionOverride[];
  byName: Record<string, CommandPermissionOverride[]>;
}

const FRESH_TTL_S = 300;
const STALE_TTL_S = 86_400;
const LOCAL_TTL_MS = 60_000;

/**
 * Gets (with caching) the server's overrides:
 * memory 60 s → Redis 5 min → Discord API. Also stores a
 * "last known" copy (24 h) to fail closed if Discord does not respond.
 */
export class CommandPermissionService {
  private readonly local = new Map<string, { data: GuildCommandPermissions; expires: number }>();
  private readonly inflight = new Map<string, Promise<GuildCommandPermissions | null>>();
  private readonly warned = new Set<string>();
  /** After a failure, do not retry for a while (avoids hammering the API) */
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
   * Current overrides. `stale: true` = Discord could not be queried and the
   * last known copy is returned (or null if it was never fetched).
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
        // Command names: global + server-specific (addons)
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
        this.client.logger.warn(`[Prefix] Could not fetch command permissions for ${guild.id}:`, error);
      }
      return null;
    }
  }

  /**
   * Can this member use the command here? If Discord does not respond:
   * fails closed for commands with known overrides and applies
   * `default_member_permissions` to the rest.
   */
  async canUse(
    guild: Guild,
    params: Omit<CommandPermissionContext, 'commandOverrides' | 'appOverrides' | 'guildId'> & { commandName: string }
  ): Promise<boolean> {
    const { data, stale } = await this.get(guild);
    const commandOverrides = data?.byName[params.commandName] ?? null;
    const appOverrides = data?.app ?? null;

    // No response from Discord and known overrides for this command: closed
    if (stale && (commandOverrides?.length ?? 0) > 0) return params.isOwner;

    return evaluateCommandPermission({ ...params, guildId: guild.id, commandOverrides, appOverrides });
  }
}
