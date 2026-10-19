import type { GuildMember } from 'discord.js';
import type Redis from 'ioredis';

/**
 * Coordinación entre Honeypot y el anti-raid de Moderación: ambos reaccionan a
 * guildMemberAdd y, si los dos están activos, no deben castigar dos veces la
 * misma entrada. El primero que reclama la entrada (SET NX atómico en Redis,
 * compartido por todos los shards) es el único que aplica una acción.
 *
 * La clave incluye joinedTimestamp: si alguien vuelve a entrar tras una
 * expulsión es una entrada nueva y puede volver a sancionarse.
 */
const CLAIM_TTL_SECONDS = 600;

export function joinClaimKey(member: GuildMember): string {
  return `joinclaim:${member.guild.id}:${member.id}:${member.joinedTimestamp ?? 0}`;
}

/** true si `owner` obtiene (o ya tenía) la acción sobre esta entrada. */
export async function claimJoinAction(redis: Redis, member: GuildMember, owner: 'honeypot' | 'antiraid'): Promise<boolean> {
  try {
    const key = joinClaimKey(member);
    const set = await redis.set(key, owner, 'EX', CLAIM_TTL_SECONDS, 'NX');
    if (set === 'OK') return true;
    return (await redis.get(key)) === owner;
  } catch {
    // Sin Redis no se puede coordinar: es preferible actuar (posible doble
    // acción) a dejar pasar un raid.
    return true;
  }
}
