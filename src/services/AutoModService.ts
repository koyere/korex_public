import { Message, EmbedBuilder, TextChannel, Colors } from 'discord.js';
import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';
import { logger } from '../utils/Logger';
import { isCoreModuleEnabled } from '../config/coreModules';

interface SpamTracker {
  messages: number[];
  lastContent: string;
  duplicateCount: number;
}

interface AttachmentTracker {
  messages: number[];         // timestamps of messages that had attachments
  seenFingerprints: string[]; // "name:size" per-user duplicate detection
}

interface ModerationConfigData {
  autoModEnabled: boolean;
  antiSpam: boolean;
  antiSpamThreshold: number;
  antiSpamInterval: number;
  antiGhostPing: boolean;
  wordFilterEnabled: boolean;
  filteredWords: string[];
  linkFilterEnabled: boolean;
  allowedLinks: string[];
  capsFilterEnabled: boolean;
  capsThreshold: number;
  applyToModerators: boolean;
  ignoredChannels: string[];
  ignoredRoles: string[];
  // Attachment spam
  antiAttachmentSpam: boolean;
  antiAttachmentThreshold: number;
  antiAttachmentInterval: number;
  maxAttachmentsPerMessage: number;
  blockAllAttachments: boolean;
}

export class AutoModService {
  private client: KorexClient;
  private spamTracker      = new Map<string, SpamTracker>();
  private attachmentTracker = new Map<string, AttachmentTracker>();
  private configCache      = new Map<string, { config: ModerationConfigData; expires: number }>();

  // Max fingerprints kept per user to bound memory
  private static readonly MAX_FINGERPRINTS = 20;

  // IDs de mensajes que borró el AutoMod (para no tratarlos como ghost ping)
  private selfDeleted = new Set<string>();

  constructor(client: KorexClient) {
    this.client = client;

    // Purga periódica de rastreadores inactivos (evita crecimiento sin límite)
    setInterval(() => {
      const cutoff = Date.now() - 10 * 60_000;
      for (const [key, tr] of this.spamTracker) {
        if ((tr.messages[tr.messages.length - 1] ?? 0) < cutoff) this.spamTracker.delete(key);
      }
      for (const [key, tr] of this.attachmentTracker) {
        if ((tr.messages[tr.messages.length - 1] ?? 0) < cutoff) this.attachmentTracker.delete(key);
      }
    }, 10 * 60_000).unref();
  }

  async processMessage(message: Message): Promise<boolean> {
    if (!message.guild || message.author.bot) return false;

    const config = await this.getConfig(message.guild.id);
    if (!config?.autoModEnabled) return false;

    // Skip ignored channels / roles
    if (config.ignoredChannels?.includes(message.channel.id)) return false;
    if (message.member?.roles.cache.some(r => config.ignoredRoles?.includes(r.id))) return false;

    // Skip staff (admins y moderadores) unless configured otherwise
    const perms = message.member?.permissions;
    const isStaff = !!perms && (perms.has('Administrator') || perms.has('ModerateMembers') || perms.has('ManageMessages'));
    if (isStaff && !config.applyToModerators) return false;

    // ── 1. Anti-Spam (text frequency + duplicate content) ─────────────────
    if (config.antiSpam && this.checkSpam(message, config)) {
      await this.handleViolation(message, 'spam', config);
      return true;
    }

    // ── 2. Attachment checks ───────────────────────────────────────────────
    if (message.attachments.size > 0) {
      // 2a. Block all attachments (nuclear option during active attack)
      if (config.blockAllAttachments) {
        await this.handleViolation(message, 'attachment_spam', config);
        return true;
      }

      // 2b. Too many attachments in a single message
      if (config.maxAttachmentsPerMessage > 0 &&
          message.attachments.size > config.maxAttachmentsPerMessage) {
        await this.handleViolation(message, 'attachment_spam', config);
        return true;
      }

      // 2c. Frequency spam or duplicate file re-upload
      if (config.antiAttachmentSpam && this.checkAttachmentSpam(message, config)) {
        await this.handleViolation(message, 'attachment_spam', config);
        return true;
      }
    }

    // ── 3. Word Filter ─────────────────────────────────────────────────────
    if (config.wordFilterEnabled && config.filteredWords?.length > 0) {
      if (this.checkWords(message.content, config.filteredWords)) {
        await this.handleViolation(message, 'word', config);
        return true;
      }
    }

    // ── 4. Link Filter ─────────────────────────────────────────────────────
    if (config.linkFilterEnabled) {
      if (this.checkLinks(message.content, config.allowedLinks || [])) {
        await this.handleViolation(message, 'link', config);
        return true;
      }
    }

    // ── 5. Caps Filter ─────────────────────────────────────────────────────
    if (config.capsFilterEnabled && message.content.length > 10) {
      if (this.checkCaps(message.content, config.capsThreshold || 70)) {
        await this.handleViolation(message, 'caps', config);
        return true;
      }
    }

    return false;
  }

  async processGhostPing(message: Message): Promise<void> {
    if (!message.guild || message.author.bot) return;
    if (message.mentions.users.size === 0 && message.mentions.roles.size === 0) return;

    // Mensajes borrados por el propio AutoMod no son ghost pings
    if (this.selfDeleted.has(message.id)) return;
    // Un ghost ping es una mención borrada poco después de enviarla
    if (message.createdTimestamp && Date.now() - message.createdTimestamp > 5 * 60_000) return;

    const config = await this.getConfig(message.guild.id);
    if (!config?.autoModEnabled || !config.antiGhostPing) return;

    const mentioned = message.mentions.users.first() || message.mentions.roles.first();
    if (!mentioned) return;

    const mentionedName = 'username' in mentioned ? mentioned.username : mentioned.name;
    const t = (key: string, params?: Record<string, string>) => i18n.t(key, message.guild!.id, params);
    const channel = message.channel as TextChannel;

    await channel
      .send(t('moderation.automod.ghost_ping', {
        user: message.author.toString(),
        mentioned: mentionedName,
      }))
      .then(m => setTimeout(() => m.delete().catch(() => {}), 10000))
      .catch(() => {});

    await this.logAction(message, 'ghost_ping');
  }

  // ── Private: spam checks ─────────────────────────────────────────────────

  private checkSpam(message: Message, config: ModerationConfigData): boolean {
    const key      = `${message.guild!.id}-${message.author.id}`;
    const now      = Date.now();
    const interval = (config.antiSpamInterval || 5) * 1000;
    const threshold = config.antiSpamThreshold || 5;

    let tracker = this.spamTracker.get(key);
    if (!tracker) {
      tracker = { messages: [], lastContent: '', duplicateCount: 0 };
      this.spamTracker.set(key, tracker);
    }

    tracker.messages = tracker.messages.filter(t => now - t < interval);
    tracker.messages.push(now);

    if (message.content === tracker.lastContent) {
      tracker.duplicateCount++;
    } else {
      tracker.duplicateCount = 0;
      tracker.lastContent    = message.content;
    }

    return tracker.messages.length >= threshold || tracker.duplicateCount >= 3;
  }

  private checkAttachmentSpam(message: Message, config: ModerationConfigData): boolean {
    const key      = `${message.guild!.id}-${message.author.id}`;
    const now      = Date.now();
    const interval  = (config.antiAttachmentInterval || 10) * 1000;
    const threshold = config.antiAttachmentThreshold || 3;

    let tracker = this.attachmentTracker.get(key);
    if (!tracker) {
      tracker = { messages: [], seenFingerprints: [] };
      this.attachmentTracker.set(key, tracker);
    }

    // Clean timestamps outside the sliding window
    tracker.messages = tracker.messages.filter(t => now - t < interval);
    tracker.messages.push(now);

    // Build fingerprints for this batch of attachments: "name:size"
    const incoming = message.attachments.map(a => `${a.name}:${a.size}`);

    // Detect duplicate file re-upload (same file the user already sent)
    const hasDuplicate = incoming.some(fp => tracker!.seenFingerprints.includes(fp));

    // Update rolling fingerprint list (bounded to avoid unbounded memory growth)
    tracker.seenFingerprints = [
      ...tracker.seenFingerprints,
      ...incoming,
    ].slice(-AutoModService.MAX_FINGERPRINTS);

    // Triggered if: frequency threshold exceeded OR exact duplicate re-uploaded
    return tracker.messages.length >= threshold || hasDuplicate;
  }

  private checkWords(content: string, filteredWords: string[]): boolean {
    const lower = content.toLowerCase();
    return filteredWords.some(word => lower.includes(word.toLowerCase()));
  }

  private checkLinks(content: string, allowedLinks: string[]): boolean {
    const urlRegex = /https?:\/\/[^\s]+/gi;
    const links    = content.match(urlRegex);
    if (!links) return false;

    return links.some(link => {
      if (allowedLinks.length === 0) return true;
      return !allowedLinks.some(allowed => link.includes(allowed));
    });
  }

  private checkCaps(content: string, threshold: number): boolean {
    const letters = content.replace(/[^a-zA-Z]/g, '');
    if (letters.length < 8) return false;
    const caps = letters.replace(/[^A-Z]/g, '').length;
    return (caps / letters.length) * 100 >= threshold;
  }

  // ── Private: violation handling ──────────────────────────────────────────

  private async handleViolation(
    message: Message,
    type: string,
    _config: ModerationConfigData,
  ): Promise<void> {
    const t = (key: string, params?: Record<string, string>) =>
      i18n.t(key, message.guild!.id, params);

    // Delete the offending message first, before sending any warning
    this.selfDeleted.add(message.id);
    setTimeout(() => this.selfDeleted.delete(message.id), 60_000);
    await message.delete().catch(() => {});

    const warningKey = this.getWarningKey(type);
    const channel    = message.channel as TextChannel;

    await channel
      .send(t(warningKey, { user: message.author.toString() }))
      .then(m => setTimeout(() => m.delete().catch(() => {}), 8000))
      .catch(() => {});

    await this.logAction(message, type);

    // Clear per-type trackers on violation
    const trackerKey = `${message.guild!.id}-${message.author.id}`;
    if (type === 'spam') {
      this.spamTracker.delete(trackerKey);
    } else if (type === 'attachment_spam') {
      this.attachmentTracker.delete(trackerKey);
    }
  }

  private getWarningKey(type: string): string {
    switch (type) {
      case 'word':            return 'moderation.automod.word_filtered';
      case 'link':            return 'moderation.automod.link_blocked';
      case 'caps':            return 'moderation.automod.caps_detected';
      case 'attachment_spam': return 'moderation.automod.attachment_spam_detected';
      default:                return 'moderation.automod.spam_detected';
    }
  }

  private getViolationReason(type: string, guildId: string): string {
    const key = type === 'ghost_ping' ? 'ghost_ping' : type;
    return i18n.t(`moderation.automod.reasons.${key}`, guildId);
  }


  // ── Private: logging ─────────────────────────────────────────────────────

  private async logAction(message: Message, type: string): Promise<void> {
    try {
      await this.client.moderation.createCase({
        guildId:     message.guild!.id,
        action:      'WARN',
        targetId:    message.author.id,
        moderatorId: this.client.user!.id,
        reason:      `AutoMod: ${this.getViolationReason(type, message.guild!.id)}`,
        active:      false,
      });

      const loggingConfig = await this.client.database.prisma.loggingConfig.findUnique({
        where: { guildId: message.guild!.id },
      });
      if (!loggingConfig?.moderationLogChannel) return;

      const logChannel = message.guild!.channels.cache.get(
        loggingConfig.moderationLogChannel,
      ) as TextChannel | undefined;
      if (!logChannel) return;

      const t = (key: string) => i18n.t(key, message.guild!.id);

      const reasonKey = type === 'ghost_ping' ? 'ghost_ping' : type;
      const embed = new EmbedBuilder()
        .setColor(Colors.Orange)
        .setTitle(t('moderation.automod.log_title'))
        .addFields(
          {
            name:   t('moderation.automod.log_user'),
            value:  `${message.author.tag} (${message.author.id})`,
            inline: true,
          },
          {
            name:   t('moderation.automod.log_channel'),
            value:  `<#${message.channel.id}>`,
            inline: true,
          },
          {
            name:   t('moderation.automod.log_reason'),
            value:  t(`moderation.automod.reasons.${reasonKey}`),
            inline: true,
          },
        )
        .setTimestamp();

      // Log text content (truncated) for non-ghost-ping violations
      if (message.content && type !== 'ghost_ping') {
        const content =
          message.content.length > 200
            ? `${message.content.slice(0, 200)}…`
            : message.content;
        embed.addFields({
          name:   t('moderation.automod.log_content'),
          value:  `\`\`\`${content}\`\`\``,
          inline: false,
        });
      }

      // Log attachment details for attachment violations
      if (type === 'attachment_spam' && message.attachments.size > 0) {
        const list = message.attachments
          .map(a => `\`${a.name}\` (${(a.size / 1024).toFixed(1)} KB)`)
          .join('\n')
          .slice(0, 1024);
        embed.addFields({
          name:   t('moderation.automod.log_attachments'),
          value:  list,
          inline: false,
        });
      }

      await logChannel.send({ embeds: [embed] });
    } catch (error) {
      logger.debug('AutoMod log error:', error);
    }
  }

  // ── Config ───────────────────────────────────────────────────────────────

  private async isModuleEnabled(guildId: string): Promise<boolean> {
    const guild = await this.client.database.prisma.guild.findUnique({
      where:  { id: guildId },
      select: { enabledAddons: true },
    });
    return isCoreModuleEnabled(guild?.enabledAddons, 'moderation');
  }

  private async getConfig(guildId: string): Promise<ModerationConfigData | null> {
    const cached = this.configCache.get(guildId);
    if (cached && cached.expires > Date.now()) return cached.config;

    try {
      const [config, moduleEnabled] = await Promise.all([
        this.client.database.prisma.moderationConfig.findUnique({ where: { guildId } }),
        this.isModuleEnabled(guildId),
      ]);

      if (config) {
        const data: ModerationConfigData = {
          autoModEnabled:           moduleEnabled ? config.autoModEnabled : false,
          antiSpam:                 config.antiSpam,
          antiSpamThreshold:        config.antiSpamThreshold,
          antiSpamInterval:         config.antiSpamInterval,
          antiGhostPing:            config.antiGhostPing,
          wordFilterEnabled:        config.wordFilterEnabled,
          filteredWords:            config.filteredWords,
          linkFilterEnabled:        config.linkFilterEnabled,
          allowedLinks:             config.allowedLinks,
          capsFilterEnabled:        config.capsFilterEnabled,
          capsThreshold:            config.capsThreshold,
          applyToModerators:        config.applyToModerators,
          ignoredChannels:          config.ignoredChannels,
          ignoredRoles:             config.ignoredRoles,
          antiAttachmentSpam:       config.antiAttachmentSpam,
          antiAttachmentThreshold:  config.antiAttachmentThreshold,
          antiAttachmentInterval:   config.antiAttachmentInterval,
          maxAttachmentsPerMessage: config.maxAttachmentsPerMessage,
          blockAllAttachments:      config.blockAllAttachments,
        };

        this.configCache.set(guildId, { config: data, expires: Date.now() + 60_000 });
        return data;
      }
    } catch (error) {
      logger.debug('AutoMod config fetch error:', error);
    }

    return null;
  }

  clearCache(guildId: string): void {
    this.configCache.delete(guildId);
  }
}
