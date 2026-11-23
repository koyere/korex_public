/**
 * Gateway shards in this process. DISCORD_SHARDS = 'auto' or a number;
 * ENABLE_SHARDING=true means 'auto'. Without either, a single shard.
 * Discord requires sharding from 2,500 servers.
 */
export function internalShardOptions(env: NodeJS.ProcessEnv = process.env): { shards?: 'auto' | number[]; shardCount?: number } {
  const raw = (env.DISCORD_SHARDS ?? (env.ENABLE_SHARDING === 'true' ? 'auto' : '')).trim();
  if (!raw) return {};
  if (raw === 'auto') return { shards: 'auto' };
  const count = parseInt(raw, 10);
  if (!Number.isInteger(count) || count < 1 || count > 256) return { shards: 'auto' };
  return { shards: Array.from({ length: count }, (_, i) => i), shardCount: count };
}
