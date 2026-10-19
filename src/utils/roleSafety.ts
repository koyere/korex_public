import type { Guild, GuildMember, PermissionResolvable, Role } from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';

/**
 * Permisos que un rol "autoasignable" (paneles, verificación, tienda) nunca
 * debe tener: cualquiera de ellos convierte el panel en una escalada.
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
 * Valida que un rol se pueda entregar a cualquier miembro sin riesgo:
 * existe, no es @everyone ni gestionado por una integración, no tiene permisos
 * peligrosos y el bot lo puede asignar (está por debajo de su rol más alto).
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
  // Quien configura no puede repartir un rol igual o superior al suyo
  if (actor && actor.id !== guild.ownerId && role.comparePositionTo(actor.roles.highest) >= 0) {
    return { ok: false, problem: 'above_actor' };
  }
  return { ok: true, role };
}

