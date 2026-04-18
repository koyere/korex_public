import { Guild } from 'discord.js';
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
    this.client.logger.info(`📥 Bot añadido al servidor: ${guild.name} (${guild.id})`);

    try {
      // Crear configuración inicial del servidor en la base de datos
      await this.client.database.getOrCreateGuild(guild.id);

      // Initialize invite tracking for the new guild
      await this.client.inviteService.cacheGuildInvites(guild);

      // Enviar mensaje de bienvenida al owner o canal general
      await this.sendWelcomeMessage(guild);

      // Actualizar presencia del bot
      this.updateBotPresence();

      // Log estadísticas
      this.client.logger.info(`📊 Ahora sirviendo ${this.client.guilds.cache.size} servidores`);
    } catch (error) {
      this.client.logger.error(`Error configurando nuevo servidor ${guild.id}:`, error);
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
   * Enviar mensaje de bienvenida
   */
  private async sendWelcomeMessage(guild: Guild): Promise<void> {
    try {
      // Intentar enviar DM al owner primero
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
        this.client.logger.debug(`Mensaje de bienvenida enviado al owner de ${guild.name}`);
      } catch (dmError) {
        // Si no se puede enviar DM, intentar en canal general
        await this.sendToGeneralChannel(guild, welcomeEmbed, lang);
      }
    } catch (error) {
      this.client.logger.error(`Error enviando mensaje de bienvenida a ${guild.id}:`, error);
    }
  }

  /**
   * Enviar mensaje al canal general si no se puede enviar DM
   */
  private async sendToGeneralChannel(guild: Guild, embed: any, lang: string): Promise<void> {
    try {
      // Buscar canal general, system channel, o primer canal de texto disponible
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
          `Mensaje de bienvenida enviado al canal ${targetChannel.name} en ${guild.name}`
        );
      }
    } catch (error) {
      this.client.logger.debug(`No se pudo enviar mensaje de bienvenida en canal de ${guild.name}`);
    }
  }

  /**
   * Actualizar presencia del bot
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
