import { Guild, EmbedBuilder } from 'discord.js';
import { Event } from '../../client/structures/Event';
import { KorexClient } from '../../client/KorexClient';
import { createSuccessEmbed } from '../../utils/helpers';
import { i18n } from '../../utils/i18n';

export default class GuildCreateEvent extends Event<'guildCreate'> {
  constructor(client: KorexClient) {
    super(client, {
      name: 'guildCreate',
      once: false,
    });
  }

  async execute(guild: Guild): Promise<void> {
    this.client.logger.info(`📥 Bot added to server: ${guild.name} (${guild.id})`);

    try {
      // 1. Create the server's initial configuration in the database
      // The initial language comes from the server's preferred locale (es/en)
      const record = await this.client.database.getOrCreateGuild(guild.id, this.detectLanguage(guild));
      i18n.setGuildLanguage(guild.id, record.language);

      // 2. Try to restore licenses in grace period (KICKOUT)
      const restored = await this.client.kickoutService.handleGuildRejoined(guild.id);

      if (restored) {
        // The server came back within the grace period — notify restoration
        await this.notifyKickoutRestored(guild);
        this.client.logger.info(`🔄 Licenses restored for server ${guild.id} after rejoin`);
      } else {
        // New server or rejoin outside the grace period
        await this.client.shop.seedDefaultItems(guild.id);
        await this.sendWelcomeMessage(guild);
      }

      // 3. Initialize invite tracking for the new guild
      await this.client.inviteService.cacheGuildInvites(guild);

      // 4. Update bot presence
      this.updateBotPresence();

      this.client.logger.info(`📊 Now serving ${this.client.guilds.cache.size} servers`);
    } catch (error) {
      this.client.logger.error(`Error setting up new server ${guild.id}:`, error);
    }
  }

  /**
   * Notifies the owner that their licenses were restored automatically.
   */
  private async notifyKickoutRestored(guild: Guild): Promise<void> {
    try {
      const owner = await this.client.users.fetch(guild.ownerId).catch(() => null);
      if (!owner) return;

      const lang = await i18n.getGuildLanguageAsync(this.client.db as any, guild.id);
      const embed = new EmbedBuilder()
        .setColor(0x22C55E) // green
        .setTitle(i18n.t('addons.billing.restored_title', lang))
        .setDescription(i18n.t('addons.billing.restored_desc', lang, { server: guild.name }))
        .setFooter({ text: i18n.t('addons.billing.restored_footer', lang) })
        .setTimestamp();

      await owner.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
    } catch (error) {
      this.client.logger.error(
        `Error notifying kickout restoration to the owner of ${guild.id}:`,
        error
      );
    }
  }

  /**
   * Detect bot language from Discord guild preferred locale
   */
  private detectLanguage(guild: Guild): string {
    const locale = guild.preferredLocale ?? 'en-US';
    const langCode = locale.split('-')[0].toLowerCase();
    return i18n.hasLanguage(langCode) ? langCode : 'en';
  }

  /**
   * Send welcome message
   */
  private async sendWelcomeMessage(guild: Guild): Promise<void> {
    try {
      // Try to DM the owner first
      const owner = await guild.fetchOwner();

      const lang = this.detectLanguage(guild);
      const dashboardUrl = process.env.DASHBOARD_URL || 'https://panel.korex.dev';
      const version = process.env.npm_package_version || '1.0.0';

      const t = (key: string, replacements?: Record<string, string>) =>
        i18n.t(`guildCreate.${key}`, lang, replacements);

      const description =
        `${t('description')}\n\n` +
        `${t('getting_started')}\n\n` +
        `${t('links', { dashboardUrl })}\n\n` +
        `${t('addons')}`;

      const welcomeEmbed = createSuccessEmbed(t('title'), description);

      welcomeEmbed.setThumbnail(this.client.user?.displayAvatarURL() || null);
      welcomeEmbed.setFooter({ text: t('footer', { version }) });

      try {
        await owner.send({ embeds: [welcomeEmbed] });
        this.client.logger.debug(`Welcome message sent to the owner of ${guild.name}`);
      } catch (dmError) {
        // If the DM fails, try a general channel
        await this.sendToGeneralChannel(guild, welcomeEmbed, lang);
      }
    } catch (error) {
      this.client.logger.error(`Error sending welcome message to ${guild.id}:`, error);
    }
  }

  /**
   * Send message to a general channel if the DM fails
   */
  private async sendToGeneralChannel(guild: Guild, embed: any, lang: string): Promise<void> {
    try {
      // Find a general channel, the system channel, or the first available text channel
      const channels = [
        guild.systemChannel,
        guild.channels.cache.find((c) => c.name.includes('general') && c.isTextBased()),
        guild.channels.cache.find(
          (c) => c.isTextBased() && c.permissionsFor(guild.members.me!)?.has('SendMessages')
        ),
      ].filter(Boolean);

      const targetChannel = channels[0];

      if (targetChannel && targetChannel.isTextBased()) {
        const greeting = i18n.t('guildCreate.greeting', lang, { ownerId: guild.ownerId });
        await targetChannel.send({
          content: greeting,
          embeds: [embed],
        });
        this.client.logger.debug(
          `Welcome message sent to channel ${targetChannel.name} in ${guild.name}`
        );
      }
    } catch (error) {
      this.client.logger.debug(`Could not send welcome message to a channel in ${guild.name}`);
    }
  }

  /**
   * Update bot presence
   */
  private updateBotPresence(): void {
    this.client.user?.setPresence({
      activities: [
        {
          name: `${this.client.guilds.cache.size} servidores | !help`,
          type: 3, // WATCHING
        },
      ],
      status: 'online',
    });
  }
}
