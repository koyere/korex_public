import {
  GuildMember,
  Message,
  TextChannel,
  EmbedBuilder,
  Colors,
  PermissionsBitField,
  ChannelType,
  GuildVerificationLevel,
} from 'discord.js';
import { KorexClient } from '../client/KorexClient';
import { HoneypotConfig } from '@prisma/client';
import { i18n } from '../utils/i18n';
import { claimJoinAction } from '../utils/joinActionClaim';

const CACHE_TTL = 300; // 5 min
const RAID_KEY  = (guildId: string) => `honeypot:raid:${guildId}`;

export class HoneypotService {
  private client: KorexClient;
  private configCache = new Map<string, { data: HoneypotConfig | null; exp: number }>();

  constructor(client: KorexClient) {
    this.client = client;
  }

  // ─── Config ───────────────────────────────────────────────────────────────

  async getConfig(guildId: string): Promise<HoneypotConfig | null> {
    const now = Date.now();
    const cached = this.configCache.get(guildId);
    if (cached && cached.exp > now) return cached.data;

    const config = await this.client.db.honeypotConfig.findUnique({ where: { guildId } });
    this.configCache.set(guildId, { data: config, exp: now + CACHE_TTL * 1000 });
    return config;
  }

  invalidateCache(guildId: string) {
    this.configCache.delete(guildId);
  }

  // ─── Trap channel ─────────────────────────────────────────────────────────

  /** Returns true if the message fell into the trap (the rest of the pipeline must ignore it). */
  async handleMessage(message: Message): Promise<boolean> {
    if (!message.guild || message.author.bot) return false;

    try {
      const config = await this.getConfig(message.guild.id);
      if (!config?.enabled || !config.channelEnabled || !config.channelId) return false;
      if (message.channel.id !== config.channelId) return false;

      const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
      if (!member) return false;

      // Staff (admins and moderators) can write in the channel without consequences
      if (this.isStaff(member)) return false;

      // Delete the message so as not to reveal that it is a trap
      await message.delete().catch(() => null);

      await this.applyAction(
        member,
        config.channelAction,
        config.logChannelId,
        'channel_message',
        i18n.t('honeypot.reasons.channel_message', message.guild.id, { channel: `<#${config.channelId}>` }),
      );
      return true;
    } catch (err) {
      this.client.logger.error('[HoneypotService] handleMessage error:', err);
      return false;
    }
  }

  private isStaff(member: GuildMember): boolean {
    const p = member.permissions;
    return p.has(PermissionsBitField.Flags.Administrator)
      || p.has(PermissionsBitField.Flags.ManageGuild)
      || p.has(PermissionsBitField.Flags.ModerateMembers)
      || p.has(PermissionsBitField.Flags.KickMembers)
      || p.has(PermissionsBitField.Flags.BanMembers)
      || p.has(PermissionsBitField.Flags.ManageMessages);
  }

  // ─── guildMemberAdd ───────────────────────────────────────────────────────

  /** Returns true if the member was kicked/banned (don't welcome them). */
  async handleMemberJoin(member: GuildMember): Promise<boolean> {
    // Bots are added by an administrator with permissions: they are not a raid
    if (member.user.bot) return false;

    try {
      const config = await this.getConfig(member.guild.id);
      if (!config?.enabled) return false;
      const guildId = member.guild.id;

      // 1. New-account filter
      if (config.newAccountEnabled) {
        const ageDays = (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
        if (ageDays < config.newAccountDays) {
          // Coordination with the Moderation anti-raid: a single sanction per join
          const action = config.newAccountAction !== 'log' && !(await this.claimJoin(member)) ? 'log' : config.newAccountAction;
          const applied = await this.applyAction(
            member,
            action,
            config.logChannelId,
            'new_account',
            i18n.t('honeypot.reasons.new_account', guildId, { days: String(Math.floor(ageDays)), min: String(config.newAccountDays) }),
          );
          return applied === 'kicked' || applied === 'banned';
        }
      }

      // 2. Anti-raid (sliding window in Redis)
      if (config.raidEnabled) {
        const raid = await this.trackRaidJoin(guildId, member.id, config.raidThreshold, config.raidWindow);
        if (raid.isRaid) {
          return await this.handleRaid(member, config, raid.recentIds, raid.firstTrigger);
        }
      }
    } catch (err) {
      this.client.logger.error('[HoneypotService] handleMemberJoin error:', err);
    }
    return false;
  }

  private claimJoin(member: GuildMember): Promise<boolean> {
    return claimJoinAction(this.client.redis.getClient(), member, 'honeypot');
  }

  // ─── Anti-raid sliding window with Redis ──────────────────────────────────

  private async trackRaidJoin(
    guildId: string,
    userId: string,
    threshold: number,
    windowSecs: number
  ): Promise<{ isRaid: boolean; recentIds: string[]; firstTrigger: boolean }> {
    try {
      const key = RAID_KEY(guildId);
      const activeKey = `${key}:active`;
      const redis = this.client.redis.getClient();
      const now = Date.now();

      await redis.zadd(key, now, userId);
      await redis.zremrangebyscore(key, 0, now - windowSecs * 1000);
      await redis.expire(key, windowSecs * 2);
      const recentIds: string[] = await redis.zrange(key, 0, -1);

      // While the raid is active, every new join also counts as raid
      const alreadyActive = (await redis.exists(activeKey)) === 1;
      if (recentIds.length >= threshold || alreadyActive) {
        const set = await redis.set(activeKey, '1', 'EX', Math.max(windowSecs * 2, 60), 'NX');
        return { isRaid: true, recentIds, firstTrigger: set === 'OK' };
      }
      return { isRaid: false, recentIds, firstTrigger: false };
    } catch {
      return { isRaid: false, recentIds: [], firstTrigger: false }; // if Redis fails, don't block
    }
  }

  private async handleRaid(member: GuildMember, config: HoneypotConfig, recentIds: string[], firstTrigger: boolean): Promise<boolean> {
    const guild = member.guild;
    const reason = i18n.t('honeypot.reasons.mass_join', guild.id, {
      threshold: String(config.raidThreshold), window: String(config.raidWindow),
    });

    if (config.raidAction === 'lockdown') {
      if (firstTrigger) await this.startLockdown(guild, config);
      await this.log(guild.id, member.id, 'mass_join', 'lockdown', reason, config.logChannelId, member);
      return false;
    }

    if (config.raidAction === 'kick' || config.raidAction === 'ban') {
      // When the raid is detected, act on everyone who joined in the window
      const targets = firstTrigger ? recentIds : [member.id];
      let removedCurrent = false;
      for (const id of targets) {
        const target = id === member.id ? member : await guild.members.fetch(id).catch(() => null);
        if (!target || target.user.bot || this.isStaff(target)) continue;
        // If the Moderation anti-raid already acted on this join, don't repeat
        if (!(await this.claimJoin(target))) continue;
        const applied = await this.applyAction(target, config.raidAction, config.logChannelId, 'mass_join', reason);
        if (id === member.id && (applied === 'kicked' || applied === 'banned')) removedCurrent = true;
      }
      return removedCurrent;
    }

    await this.log(guild.id, member.id, 'mass_join', 'logged', reason, config.logChannelId, member);
    return false;
  }

  /** Raises verification to the maximum and restores it after 10 minutes. */
  private async startLockdown(guild: GuildMember['guild'], config: HoneypotConfig): Promise<void> {
    const previous = guild.verificationLevel;
    try {
      await guild.setVerificationLevel(GuildVerificationLevel.VeryHigh, 'Honeypot anti-raid');
    } catch {
      this.client.logger.warn(`[HoneypotService] Missing permission to raise verification level in ${guild.id}`);
      return;
    }
    setTimeout(() => {
      guild.setVerificationLevel(previous, 'Honeypot anti-raid finished').catch(() => null);
    }, 10 * 60_000).unref();
  }

  // ─── Action and log ───────────────────────────────────────────────────────

  /** Applies the action and returns what actually happened (kicked/banned/timed_out/logged/failed). */
  async applyAction(
    member: GuildMember,
    action: string,
    logChannelId: string | null,
    type: string,
    details: string,
  ): Promise<string> {
    const guild = member.guild;
    const auditReason = i18n.t('honeypot.audit_reason', guild.id);
    let applied = 'logged';

    try {
      switch (action) {
        case 'kick':
          applied = member.kickable && await member.kick(auditReason).then(() => true).catch(() => false) ? 'kicked' : 'failed';
          break;
        case 'ban':
          applied = member.bannable && await guild.bans.create(member.id, { reason: auditReason, deleteMessageSeconds: 86400 }).then(() => true).catch(() => false) ? 'banned' : 'failed';
          break;
        case 'timeout':
          applied = member.moderatable && await member.timeout(3600 * 1000, auditReason).then(() => true).catch(() => false) ? 'timed_out' : 'failed';
          break;
        case 'log':
        default:
          applied = 'logged';
      }
    } catch (err) {
      this.client.logger.error('[HoneypotService] applyAction error:', err);
      applied = 'failed';
    }

    await this.log(guild.id, member.id, type, applied, details, logChannelId, member);
    return applied;
  }

  private async log(
    guildId: string,
    userId: string,
    type: string,
    action: string,
    details: string,
    logChannelId: string | null,
    member: GuildMember,
  ): Promise<void> {
    // Save to DB
    await this.client.db.honeypotLog.create({
      data: { guildId, userId, type, action, details },
    }).catch(() => null);

    // Send to the log channel if configured
    if (!logChannelId) return;
    const guild = member.guild;
    try {
      const channel = guild.channels.cache.get(logChannelId) as TextChannel | undefined;
      if (!channel || channel.type !== ChannelType.GuildText) return;

      const t = (key: string) => i18n.t(key, guildId);
      const embed = new EmbedBuilder()
        .setTitle(`Honeypot — ${t(`honeypot.types.${type}`)}`)
        .setColor(action === 'logged' ? Colors.Yellow : Colors.Red)
        .addFields(
          { name: t('honeypot.log.user'), value: `<@${userId}> (${member.user.tag})`, inline: true },
          { name: t('honeypot.log.action'), value: t(`honeypot.actions.${action}`), inline: true },
          { name: t('honeypot.log.reason'), value: details.slice(0, 1024) },
        )
        .setFooter({ text: `ID: ${userId}` })
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    } catch {
      // Silent — do not interrupt the main flow
    }
  }

  // ─── Dashboard stats ───────────────────────────────────────────────────────

  async getStats(guildId: string) {
    const [total, byType] = await Promise.all([
      this.client.db.honeypotLog.count({ where: { guildId } }),
      this.client.db.honeypotLog.groupBy({
        by: ['type'],
        where: { guildId },
        _count: true,
      }),
    ]);
    return { total, byType };
  }
}
