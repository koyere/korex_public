/**
 * TeamAccessGuard — dashboard collaborators whose inviter is no longer an admin.
 *
 * When the person who invited them loses Administrator or leaves the server:
 *  - their pending invites are cancelled (expire immediately);
 *  - the owner gets a notice (DM and log channel) listing the collaborators who
 *    joined through those invites and are still active, so they can review them.
 * Nobody is revoked automatically: a legitimate role change must not lock the
 * team out. The notice is sent once per inviter per week.
 *
 * Called from guildMemberUpdate / guildMemberRemove and from a periodic sweep
 * that also covers permission changes on roles.
 */

import { PermissionFlagsBits, type Guild } from 'discord.js';
import type { KorexClient } from '../client/KorexClient';
import { createLogger } from '../utils/Logger';

const logger = createLogger('team-access-guard');
const NOTICE_TTL_SECONDS = 7 * 24 * 60 * 60;

export type InviterLossReason = 'left' | 'demoted';

/** Is this user still an admin (or the owner) of the server? null if it can't be determined. */
async function isStillAdmin(guild: Guild, userId: string): Promise<boolean | null> {
  if (guild.ownerId === userId) return true;
  const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch((err: any) => (err?.code === 10007 ? null : undefined));
  if (member === undefined) return null;          // Discord error: don't decide
  if (member === null) return false;               // no longer a member
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

export async function reviewInviter(client: KorexClient, guild: Guild, inviterId: string, reason: InviterLossReason): Promise<void> {
  const db = (client as any).db;
  const now = new Date();

  const cancelled = await db.guildOperatorInvite.updateMany({
    where: { guildId: guild.id, invitedBy: inviterId, usedAt: null, expiresAt: { gt: now } },
    data: { expiresAt: now },
  });
  const operators = await db.guildOperator.findMany({
    where: { guildId: guild.id, invitedBy: inviterId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    select: { userId: true },
  });
  if (cancelled.count === 0 && operators.length === 0) return;

  await db.guildOperatorLog.create({
    data: {
      guildId: guild.id, operatorId: inviterId, username: inviterId,
      action: 'operator.inviter_lost_admin', section: 'system',
      details: { reason, invitesCancelled: cancelled.count, collaborators: operators.map((o: any) => o.userId) } as any,
    },
  }).catch(() => undefined);

  // One notice per inviter per week
  const redis = (client as any).redis.getClient();
  const fresh = await redis.set(`team:inviter_lost:${guild.id}:${inviterId}`, '1', 'EX', NOTICE_TTL_SECONDS, 'NX').catch(() => 'OK');
  if (fresh !== 'OK') return;

  const lang = client.i18n.getGuildLanguage(guild.id);
  const inviterTag = await client.users.fetch(inviterId).then(u => u.tag).catch(() => inviterId);
  const names = await Promise.all(operators.map(async (o: any) =>
    `• ${await client.users.fetch(o.userId).then(u => u.tag).catch(() => o.userId)} (${o.userId})`));
  const title = client.i18n.t('teamAccess.notify.inviter_lost.title', lang);
  const description = client.i18n.t('teamAccess.notify.inviter_lost.desc', lang, {
    inviter: inviterTag,
    server: guild.name,
    reason: client.i18n.t(`teamAccess.notify.inviter_lost.reason_${reason}`, lang),
    invites: String(cancelled.count),
    list: names.length ? names.join('\n').slice(0, 3000) : client.i18n.t('teamAccess.notify.inviter_lost.none', lang),
  });
  const embed = { color: 0xf39c12, title, description, timestamp: now.toISOString() };

  await client.users.fetch(guild.ownerId)
    .then(owner => owner.send({ embeds: [embed], allowedMentions: { parse: [] } }))
    .catch(() => undefined);
  try {
    const cfg = await db.loggingConfig.findUnique({ where: { guildId: guild.id }, select: { defaultChannelId: true } });
    const channel = cfg?.defaultChannelId ? await guild.channels.fetch(cfg.defaultChannelId).catch(() => null) as any : null;
    if (channel?.isTextBased?.()) await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch { /* best-effort */ }

  logger.info(`Inviter ${inviterId} lost admin in ${guild.id} (${reason}): ${cancelled.count} invites cancelled, ${operators.length} collaborators to review`);
}

/** Periodic sweep: inviters of active collaborators or pending invites who are no longer admins. */
export async function sweepInviters(client: KorexClient): Promise<void> {
  if (client.shard && client.shard.ids?.[0] !== 0) return;
  const db = (client as any).db;
  const now = new Date();
  const [ops, invites] = await Promise.all([
    db.guildOperator.findMany({
      where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      select: { guildId: true, invitedBy: true }, distinct: ['guildId', 'invitedBy'],
    }),
    db.guildOperatorInvite.findMany({
      where: { usedAt: null, expiresAt: { gt: now } },
      select: { guildId: true, invitedBy: true }, distinct: ['guildId', 'invitedBy'],
    }),
  ]);
  const pairs = new Map<string, { guildId: string; invitedBy: string }>();
  for (const p of [...ops, ...invites]) pairs.set(`${p.guildId}:${p.invitedBy}`, p);

  for (const { guildId, invitedBy } of pairs.values()) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild || !invitedBy) continue;
    const admin = await isStillAdmin(guild, invitedBy);
    if (admin === false) {
      const inGuild = guild.members.cache.has(invitedBy) || !!(await guild.members.fetch(invitedBy).catch(() => null));
      await reviewInviter(client, guild, invitedBy, inGuild ? 'demoted' : 'left').catch(err => logger.warn(`reviewInviter failed: ${err}`));
    }
  }
}
