import type { Guild, GuildMember, PermissionResolvable, Role } from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';

/**
 * Permissions that a "self-assignable" role (panels, verification, shop) must
 * never have: any of them turns the panel into a privilege escalation.
 */
export const DANGEROUS_ROLE_PERMISSIONS: PermissionResolvable[] = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageNicknames,
  PermissionFlagsBits.ManageGuildExpressions,
  PermissionFlagsBits.ManageEvents,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.MentionEveryone,
  PermissionFlagsBits.ViewAuditLog,
  PermissionFlagsBits.MoveMembers,
  PermissionFlagsBits.MuteMembers,
  PermissionFlagsBits.DeafenMembers,
];

export type SelfAssignableRoleProblem = 'not_found' | 'everyone' | 'managed' | 'dangerous' | 'above_bot' | 'above_actor';

/**
 * Validates that a role can be given to any member safely:
 * it exists, is not @everyone nor managed by an integration, has no dangerous
 * permissions and the bot can assign it (it is below the bot's highest role).
 */
export interface SelfAssignableRoleCheck {
  ok: boolean;
  role?: Role;
  problem?: SelfAssignableRoleProblem;
}

export function checkSelfAssignableRole(guild: Guild, roleId: string, actor?: GuildMember | null): SelfAssignableRoleCheck {
  const role = guild.roles.cache.get(roleId);
  if (!role) return { ok: false, problem: 'not_found' };
  if (role.id === guild.id) return { ok: false, problem: 'everyone' };
  if (role.managed) return { ok: false, problem: 'managed' };
  if (DANGEROUS_ROLE_PERMISSIONS.some((p) => role.permissions.has(p, false))) {
    return { ok: false, problem: 'dangerous' };
  }
  const botTop = guild.members.me?.roles.highest;
  if (botTop && role.comparePositionTo(botTop) >= 0) return { ok: false, problem: 'above_bot' };
  // The configuring user cannot hand out a role equal to or higher than their own
  if (actor && actor.id !== guild.ownerId && role.comparePositionTo(actor.roles.highest) >= 0) {
    return { ok: false, problem: 'above_actor' };
  }
  return { ok: true, role };
}


/** true if the member may configure roles with permissions (owner or Discord Administrator). */
export function isGuildAdministrator(member: GuildMember | null | undefined): boolean {
  if (!member) return false;
  return member.id === member.guild.ownerId || member.permissions.has(PermissionFlagsBits.Administrator);
}

/**
 * Roles the bot hands out automatically: on join, by level, by boost, by
 * invites (audit 2026-11-21, G·BOT-01 and C·API-05).
 *
 * - A role with the Administrator permission is never handed out automatically.
 * - A Discord Administrator (or the owner) may configure roles with moderation
 *   permissions: they can already do so natively.
 * - Anyone else (moderator with "Manage Roles", dashboard collaborator) only
 *   roles without dangerous permissions and below their highest role, the same
 *   rule Discord applies. No identifiable member: rejected.
 */
export function checkAutoRole(
  guild: Guild,
  roleId: string,
  actor: GuildMember | null | undefined,
  actorIsAdmin: boolean,
): SelfAssignableRoleCheck {
  const role = guild.roles.cache.get(roleId);
  if (role && role.permissions.has(PermissionFlagsBits.Administrator, false)) {
    return { ok: false, role, problem: 'dangerous' };
  }
  if (!actorIsAdmin && !actor) return { ok: false, role, problem: 'above_actor' };
  const base = checkSelfAssignableRole(guild, roleId, actorIsAdmin ? null : actor);
  if (base.ok) return base;
  if (base.problem === 'dangerous' && actorIsAdmin) return { ok: true, role: base.role ?? role };
  return base;
}

/**
 * Check performed when HANDING OUT an automatic role (defense in depth: the
 * role's permissions may have changed since it was configured). Never hands
 * out a role with Administrator.
 */
export function canAutoAssignRole(guild: Guild, role: Role | null | undefined): boolean {
  if (!role || role.id === guild.id || role.managed) return false;
  if (role.permissions.has(PermissionFlagsBits.Administrator, false)) return false;
  const botTop = guild.members.me?.roles.highest;
  return !!botTop && role.comparePositionTo(botTop) < 0;
}
