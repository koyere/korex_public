import { Message, EmbedBuilder, TextChannel, Colors } from 'discord.js';
import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';
import { logger } from '../utils/Logger';

interface SpamTracker {
  messages: number[];
  lastContent: string;
  duplicateCount: number;
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
}

export class AutoModService {
  private client: KorexClient;
  private spamTracker = new Map<string, SpamTracker>();
  private configCache = new Map<string, { config: ModerationConfigData; expires: number }>();

  constructor(client: KorexClient) {
    this.client = client;
  }

  async processMessage(message: Message): Promise<boolean> {
    console.log(`[AutoMod] Processing message from ${message.author.tag} in ${message.guild?.name}`);
    
    if (!message.guild || message.author.bot) {
      console.log(`[AutoMod] Skipping: ${!message.guild ? 'No guild' : 'Bot message'}`);

      return false;
    }

    const config = await this.getConfig(message.guild.id);

    console.log(`[AutoMod] Config loaded:`, { 
      enabled: config?.autoModEnabled,
      antiSpam: config?.antiSpam,
      caps: config?.capsFilterEnabled,
      links: config?.linkFilterEnabled 
    });
    
    if (!config?.autoModEnabled) {
      console.log(`[AutoMod] AutoMod disabled for guild ${message.guild.id}`);

      return false;
    }

    // Check ignored channels/roles
    if (config.ignoredChannels?.includes(message.channel.id)) {
      console.log(`[AutoMod] Channel ${message.channel.id} is ignored`);

      return false;
    }
    if (message.member?.roles.cache.some(r => config.ignoredRoles?.includes(r.id))) {
      console.log(`[AutoMod] User has ignored role`);

      return false;
    }

    // Check if user has mod permissions (skip automod unless configured otherwise)
    if (message.member?.permissions.has('Administrator') && !config.applyToModerators) {
      console.log(`[AutoMod] User ${message.author.tag} has Administrator permissions - bypassing`);

      return false;
    }

    console.log(`[AutoMod] Running filters for message: "${message.content.substring(0, 50)}..."`);
    const guildId = message.guild.id;

    // Anti-Spam
    if (config.antiSpam && await this.checkSpam(message, config)) {
      await this.handleViolation(message, 'spam', config);

      return true;
    }

    // Word Filter
    if (config.wordFilterEnabled && config.filteredWords?.length > 0) {
      if (this.checkWords(message.content, config.filteredWords)) {
        await this.handleViolation(message, 'word', config);

        return true;
      }
    }

    // Link Filter
    if (config.linkFilterEnabled) {
      if (this.checkLinks(message.content, config.allowedLinks || [])) {
        await this.handleViolation(message, 'link', config);

        return true;
      }
    }

    // Caps Filter
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

    const config = await this.getConfig(message.guild.id);

    if (!config?.autoModEnabled || !config.antiGhostPing) return;

    const mentioned = message.mentions.users.first() || message.mentions.roles.first();

    if (!mentioned) return;

    const mentionedName = 'username' in mentioned ? mentioned.username : mentioned.name;
    const t = (key: string, params?: Record<string, string>) => i18n.t(key, message.guild!.id, params);

    const channel = message.channel as TextChannel;

    await channel.send(t('moderation.automod.ghost_ping', { 
      user: message.author.toString(), 
      mentioned: mentionedName 
    })).then(m => setTimeout(() => m.delete().catch(() => {}), 10000));

    await this.logAction(message, 'ghost_ping');
  }

  private async checkSpam(message: Message, config: ModerationConfigData): Promise<boolean> {
    const key = `${message.guild!.id}-${message.author.id}`;
    const now = Date.now();
    const interval = (config.antiSpamInterval || 5) * 1000;
    const threshold = config.antiSpamThreshold || 5;

    let tracker = this.spamTracker.get(key);

    if (!tracker) {
      tracker = { messages: [], lastContent: '', duplicateCount: 0 };
      this.spamTracker.set(key, tracker);
    }

    // Clean old messages
    tracker.messages = tracker.messages.filter(t => now - t < interval);
    tracker.messages.push(now);

    // Check duplicate content
    if (message.content === tracker.lastContent) {
      tracker.duplicateCount++;
    } else {
      tracker.duplicateCount = 0;
      tracker.lastContent = message.content;
    }

    // Spam if too many messages or duplicates
    return tracker.messages.length >= threshold || tracker.duplicateCount >= 3;
  }

  private checkWords(content: string, filteredWords: string[]): boolean {
    const lower = content.toLowerCase();

    return filteredWords.some(word => lower.includes(word.toLowerCase()));
  }

  private checkLinks(content: string, allowedLinks: string[]): boolean {
    const urlRegex = /https?:\/\/[^\s]+/gi;
    const links = content.match(urlRegex);

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

  private async handleViolation(message: Message, type: string, config: ModerationConfigData): Promise<void> {
    const t = (key: string, params?: Record<string, string>) => i18n.t(key, message.guild!.id, params);

    // Delete message
    await message.delete().catch(() => {});

    // Send warning
    const warningKey = `moderation.automod.${type === 'word' ? 'word_filtered' : type === 'link' ? 'link_blocked' : type === 'caps' ? 'caps_detected' : 'spam_detected'}`;
    const channel = message.channel as TextChannel;

    await channel.send(t(warningKey, { user: message.author.toString() }))
      .then(m => setTimeout(() => m.delete().catch(() => {}), 8000));

    // Log action
    await this.logAction(message, type);

    // Clear spam tracker on violation
    if (type === 'spam') {
      this.spamTracker.delete(`${message.guild!.id}-${message.author.id}`);
    }
  }

  private async logAction(message: Message, type: string): Promise<void> {
    try {
      // Get next case number
      const lastCase = await this.client.database.prisma.moderationCase.findFirst({
        where: { guildId: message.guild!.id },
        orderBy: { caseNumber: 'desc' }
      });
      const nextCaseNumber = (lastCase?.caseNumber || 0) + 1;

      // Save moderation case to database
      await this.client.database.prisma.moderationCase.create({
        data: {
          guildId: message.guild!.id,
          caseNumber: nextCaseNumber,
          action: 'WARN',
          targetId: message.author.id,
          moderatorId: this.client.user!.id,
          reason: `AutoMod: ${type === 'spam' ? 'Spam detectado' : type === 'word' ? 'Palabra filtrada' : type === 'link' ? 'Enlace bloqueado' : type === 'caps' ? 'Exceso de mayúsculas' : 'Violación detectada'}`,
          active: false
        }
      });

      const loggingConfig = await this.client.database.prisma.loggingConfig.findUnique({
        where: { guildId: message.guild!.id }
      });

      if (!loggingConfig?.moderationLogChannel) return;

      const logChannel = message.guild!.channels.cache.get(loggingConfig.moderationLogChannel) as TextChannel;

      if (!logChannel) return;

      const t = (key: string) => i18n.t(key, message.guild!.id);

      const embed = new EmbedBuilder()
        .setColor(Colors.Orange)
        .setTitle(t('moderation.automod.log_title'))
        .addFields(
          { name: t('moderation.automod.log_user'), value: `${message.author.tag} (${message.author.id})`, inline: true },
          { name: t('moderation.automod.log_channel'), value: `<#${message.channel.id}>`, inline: true },
          { name: t('moderation.automod.log_reason'), value: t(`moderation.automod.reasons.${type === 'ghost_ping' ? 'ghost_ping' : type}`), inline: true }
        )
        .setTimestamp();

      if (message.content && type !== 'ghost_ping') {
        const content = message.content.length > 200 ? `${message.content.slice(0, 200)}...` : message.content;

        embed.addFields({ name: t('moderation.automod.log_content'), value: `\`\`\`${content}\`\`\``, inline: false });
      }

      await logChannel.send({ embeds: [embed] });
    } catch (error) {
      logger.debug('AutoMod log error:', error);
    }
  }

  /**
   * Returns whether the 'moderation' module is enabled at the guild level.
   * An empty enabledAddons array (legacy guilds) is treated as "all enabled".
   */
  private async isModuleEnabled(guildId: string): Promise<boolean> {
    const guild = await this.client.database.prisma.guild.findUnique({
      where: { id: guildId },
      select: { enabledAddons: true },
    });
    if (!guild || guild.enabledAddons.length === 0) return true;
    return guild.enabledAddons.includes('moderation');
  }

  private async getConfig(guildId: string): Promise<ModerationConfigData | null> {
    const cached = this.configCache.get(guildId);

    if (cached && cached.expires > Date.now()) {
      return cached.config;
    }

    try {
      // Check guild-level module toggle first (parallel query for performance)
      const [config, moduleEnabled] = await Promise.all([
        this.client.database.prisma.moderationConfig.findUnique({ where: { guildId } }),
        this.isModuleEnabled(guildId),
      ]);

      if (config) {
        const data: ModerationConfigData = {
          // If the module is disabled in Guild.enabledAddons, force autoModEnabled off
          // regardless of the granular ModerationConfig setting.
          autoModEnabled: moduleEnabled ? config.autoModEnabled : false,
          antiSpam: config.antiSpam,
          antiSpamThreshold: config.antiSpamThreshold,
          antiSpamInterval: config.antiSpamInterval,
          antiGhostPing: config.antiGhostPing,
          wordFilterEnabled: config.wordFilterEnabled,
          filteredWords: config.filteredWords,
          linkFilterEnabled: config.linkFilterEnabled,
          allowedLinks: config.allowedLinks,
          capsFilterEnabled: config.capsFilterEnabled,
          capsThreshold: config.capsThreshold,
          applyToModerators: config.applyToModerators,
          ignoredChannels: config.ignoredChannels,
          ignoredRoles: config.ignoredRoles
        };

        this.configCache.set(guildId, { config: data, expires: Date.now() + 60000 });

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
