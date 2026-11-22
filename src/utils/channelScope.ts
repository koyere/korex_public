/**
 * Effective channel of a message for per-channel rules: in threads and forum
 * posts, the configuration that matters is the parent channel's. ThreadChannel
 * has no `nsfw` property and its id never matches the channel an administrator
 * put on an ignore list.
 */

type ChannelLike = { id: string; parentId?: string | null; parent?: any; nsfw?: boolean; isThread?: () => boolean } | null | undefined;

/** Ids that identify the channel for rule purposes: its own and, for threads, the parent's. */
export function channelScopeIds(channel: ChannelLike): string[] {
  if (!channel) return [];
  const ids = [channel.id];
  if (channel.isThread?.() && channel.parentId) ids.push(channel.parentId);
  return ids;
}

/** Is the channel (or, for a thread, its parent channel) NSFW? */
export function isChannelNsfw(channel: ChannelLike): boolean {
  if (!channel) return false;
  if (channel.isThread?.()) return !!channel.parent?.nsfw;
  return !!channel.nsfw;
}

/**
 * Can @everyone see it? For threads the parent channel is checked, and a private
 * thread is never public.
 */
export function isVisibleToEveryone(channel: any, guild: any): boolean {
  if (!channel || !guild?.roles?.everyone) return false;
  if (channel.isThread?.()) {
    if (channel.type === 12 /* ChannelType.PrivateThread */) return false;
    channel = channel.parent;
    if (!channel) return false;
  }
  return !!channel.permissionsFor?.(guild.roles.everyone)?.has?.(1024n /* ViewChannel */);
}
