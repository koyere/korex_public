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

