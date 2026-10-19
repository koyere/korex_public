import type { GuildMember } from 'discord.js';
import type Redis from 'ioredis';

/**
 * Coordination between Honeypot and the Moderation anti-raid: both react to
 * guildMemberAdd and, if both are active, they must not punish the same join
 * twice. The first one to claim the join (atomic SET NX in Redis,
 * shared by all shards) is the only one that applies an action.
 *
 * The key includes joinedTimestamp: if someone rejoins after a
 * kick it is a new join and can be sanctioned again.
 */
const CLAIM_TTL_SECONDS = 600;

export function joinClaimKey(member: GuildMember): string {
  return `joinclaim:${member.guild.id}:${member.id}:${member.joinedTimestamp ?? 0}`;
}

/** true if `owner` obtains (or already had) the action on this join. */
export async function claimJoinAction(redis: Redis, member: GuildMember, owner: 'honeypot' | 'antiraid'): Promise<boolean> {
  try {
    const key = joinClaimKey(member);
    const set = await redis.set(key, owner, 'EX', CLAIM_TTL_SECONDS, 'NX');
    if (set === 'OK') return true;
    return (await redis.get(key)) === owner;
  } catch {
    // Without Redis no coordination is possible: acting (possible double
    // action) is preferable to letting a raid through.
    return true;
  }
}
