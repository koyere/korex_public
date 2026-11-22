import { GuildMember, PermissionsBitField } from 'discord.js';
import type { Guild, GuildBasedChannel } from 'discord.js';

/**
 * User permission checks for commands (audit 2026-11-21, G·BOT-02).
 *
 * The permissions that come with an interaction (`interaction.memberPermissions`)
 * are the member's IN THE CHANNEL where they type, including channel overrides.
 * Someone who can only manage their own channel must not be able to act on
 * another channel or on the whole server through the bot. Therefore:
 *  - by default server-level permissions are required (the member's roles);
 *  - commands that act on a channel check them in THAT channel.
 */

interface InteractionLike {
  guild: Guild | null;
  user: { id: string };
  member?: unknown;
}

/** The invoking server member (from the cache or fetched from Discord). */
export async function resolveInvoker(interaction: InteractionLike): Promise<GuildMember | null> {
  if (!interaction.guild) return null;
  if (interaction.member instanceof GuildMember) return interaction.member;
  return interaction.guild.members.fetch(interaction.user.id).catch(() => null);
}

/** The invoker's server-level permissions; undefined if they cannot be obtained. */
export async function getGuildPermissions(interaction: InteractionLike): Promise<bigint | undefined> {
  const member = await resolveInvoker(interaction);
  return member?.permissions.bitfield;
}

/** true if the invoker has all the permissions at server level. */
export async function memberHasGuildPermissions(interaction: InteractionLike, perms: bigint[]): Promise<boolean> {
  const bits = await getGuildPermissions(interaction);
  if (bits === undefined) return false;
  return new PermissionsBitField(bits).has(perms);
}

/** true if the invoker has all the permissions in the given channel. */
export async function memberCanInChannel(interaction: InteractionLike, channel: GuildBasedChannel | null | undefined, perms: bigint[]): Promise<boolean> {
  if (!channel || !interaction.guild || channel.guild.id !== interaction.guild.id) return false;
  const member = await resolveInvoker(interaction);
  if (!member) return false;
  return channel.permissionsFor(member)?.has(perms) ?? false;
}
