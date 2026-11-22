/**
 * Replaces, in a server's configuration, references to a channel that was recreated
 * with a new ID (used by /nuke). Without this, the welcome, log, starboard and other
 * settings kept pointing at the deleted channel and silently stopped working.
 *
 * CHANNEL_FIELDS lists the configuration fields that hold channel IDs in this
 * schema (delegate, field, kind, row key). Keep it in sync when adding models.
 */

type FieldKind = 'string' | 'list' | 'json';

const CHANNEL_FIELDS: ReadonlyArray<[string, string, FieldKind, 'id' | 'guildId']> = [
  ['moderationConfig', 'ignoredChannels', 'list', 'id'],
  ['welcomeConfig', 'welcomeChannelId', 'string', 'id'],
  ['welcomeConfig', 'goodbyeChannelId', 'string', 'id'],
  ['welcomeConfig', 'verificationChannel', 'string', 'id'],
  ['levelConfig', 'bonusChannels', 'json', 'id'],
  ['levelConfig', 'ignoredChannels', 'list', 'id'],
  ['levelConfig', 'levelUpChannelId', 'string', 'id'],
  ['loggingConfig', 'messageLogChannel', 'string', 'id'],
  ['loggingConfig', 'memberLogChannel', 'string', 'id'],
  ['loggingConfig', 'moderationLogChannel', 'string', 'id'],
  ['loggingConfig', 'voiceLogChannel', 'string', 'id'],
  ['loggingConfig', 'serverLogChannel', 'string', 'id'],
  ['loggingConfig', 'ignoredChannels', 'list', 'id'],
  ['musicConfig', 'restrictedChannels', 'list', 'id'],
  ['reactionRole', 'channelId', 'string', 'id'],
  ['giveaway', 'channelId', 'string', 'id'],
  ['suggestion', 'channelId', 'string', 'id'],
  ['guildConfig', 'logChannelId', 'string', 'id'],
  ['guildConfig', 'loggingChannels', 'json', 'id'],
  ['guildConfig', 'welcomeChannelId', 'string', 'id'],
  ['guildConfig', 'goodbyeChannelId', 'string', 'id'],
  ['guildConfig', 'suggestionChannelId', 'string', 'id'],
  ['reactionRoleMessage', 'channelId', 'string', 'id'],
  ['poll', 'channelId', 'string', 'id'],
  ['starboardConfig', 'channelId', 'string', 'id'],
  ['starboardConfig', 'ignoredChannels', 'list', 'id'],
  ['honeypotConfig', 'channelId', 'string', 'id'],
  ['honeypotConfig', 'logChannelId', 'string', 'id'],
  ['channelLockdown', 'channelId', 'string', 'guildId'],
  ['stickyMessage', 'channelId', 'string', 'guildId'],
  ['inviteRewardConfig', 'announceChannelId', 'string', 'guildId'],
];

/** Recursively replaces strings equal to oldId inside a JSON value. */
function replaceInJson(value: any, oldId: string, newId: string): { value: any; changed: boolean } {
  if (value === oldId) return { value: newId, changed: true };
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map(v => { const r = replaceInJson(v, oldId, newId); changed ||= r.changed; return r.value; });
    return { value: out, changed };
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) { const r = replaceInJson(v, oldId, newId); changed ||= r.changed; out[k] = r.value; }
    return { value: out, changed };
  }
  return { value, changed: false };
}

export async function remapChannelReferences(db: any, guildId: string, oldId: string, newId: string): Promise<number> {
  let changed = 0;
  for (const [model, field, kind, key] of CHANNEL_FIELDS) {
    const delegate = db[model];
    if (!delegate?.updateMany) continue;
    try {
      if (kind === 'string') {
        const r = await delegate.updateMany({ where: { guildId, [field]: oldId }, data: { [field]: newId } });
        changed += r.count ?? 0;
      } else if (kind === 'list') {
        const rows = await delegate.findMany({ where: { guildId, [field]: { has: oldId } }, select: { [key]: true, [field]: true } });
        for (const row of rows) {
          await delegate.update({ where: { [key]: row[key] }, data: { [field]: (row[field] as string[]).map(id => (id === oldId ? newId : id)) } });
          changed++;
        }
      } else {
        const rows = await delegate.findMany({ where: { guildId }, select: { [key]: true, [field]: true } });
        for (const row of rows) {
          const r = replaceInJson(row[field], oldId, newId);
          if (r.changed) { await delegate.update({ where: { [key]: row[key] }, data: { [field]: r.value } }); changed++; }
        }
      }
    } catch {
      // A model with a different shape must not stop the rest from being updated
    }
  }
  return changed;
}
