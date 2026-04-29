import { Guild, EmbedBuilder } from 'discord.js';
import { Event } from '../../client/structures/Event';
import { KorexClient } from '../../client/KorexClient';
import { KICKOUT_GRACE_DAYS } from '../../services/GuildKickoutService';

export default class GuildDeleteEvent extends Event<'guildDelete'> {
  constructor(client: KorexClient) {
    super(client, {
      name: 'guildDelete',
      once: false,
    });
  }

  async execute(guild: Guild): Promise<void> {
    this.client.logger.info(`📤 Bot removido del servidor: ${guild.name} (${guild.id})`);

    try {
      // 1. Suspender todo acceso premium con estado KICKOUT (periodo de gracia)
      await this.client.kickoutService.handleGuildLeft(guild.id);

      // 2. Invalidar caché de configuración del servidor
      await this.client.cache.invalidateGuildConfig(guild.id);

      // 3. Notificar al owner del servidor si hay licencias activas
      await this.notifyGuildOwner(guild);

      // 4. Actualizar presencia del bot
      this.updateBotPresence();

      this.client.logger.info(
        `📊 Ahora sirviendo ${this.client.guilds.cache.size} servidores`
      );
    } catch (error) {
      this.client.logger.error(
        `Error procesando salida del servidor ${guild.id}:`,
        error
      );
    }
  }

  /**
   * Notifica al owner que sus licencias están en periodo de gracia.
   * Solo envía DM si el servidor tenía al menos una licencia o premium activo.
   */
  private async notifyGuildOwner(guild: Guild): Promise<void> {
    try {
      const guildId = guild.id;

      // Verificar si había licencias o premium activos antes del kickout
      const [licenseCount, premiumCount] = await Promise.all([
        this.client.db.addonLicense.count({
          where: { guildId, status: 'KICKOUT' },
        }),
        this.client.db.guildPremium.count({
          where: { guildId, status: 'KICKOUT' },
        }),
      ]);

      if (licenseCount === 0 && premiumCount === 0) return;

      const owner = await this.client.users.fetch(guild.ownerId).catch(() => null);
      if (!owner) return;

      const graceDeadline = new Date(
        Date.now() + KICKOUT_GRACE_DAYS * 24 * 60 * 60 * 1_000
      );
      const deadlineStr = `<t:${Math.floor(graceDeadline.getTime() / 1000)}:F>`;

      const embed = new EmbedBuilder()
        .setColor(0xF59E0B) // amber
        .setTitle('⚠️ Bot removido de tu servidor')
        .setDescription(
          `Hemos detectado que **Korex** fue removido de **${guild.name}**.\n\n` +
          `Tienes **${KICKOUT_GRACE_DAYS} días** (hasta ${deadlineStr}) para volver a añadir el bot y restaurar automáticamente todos tus addons y suscripciones.\n\n` +
          `Si no añades el bot antes de esa fecha, tus suscripciones de PayPal serán canceladas.`
        )
        .addFields(
          {
            name: '🔄 ¿Cómo restaurar?',
            value: `Añade el bot nuevamente a **${guild.name}** antes de ${deadlineStr} y todo se restaurará automáticamente.`,
          },
          {
            name: '❓ ¿Fue un error?',
            value: 'Si el bot fue removido por error o sin tu autorización, añádelo de vuelta lo antes posible.',
          }
        )
        .setFooter({ text: 'Korex Premium · Si necesitas ayuda, abre un ticket en nuestro servidor de soporte.' })
        .setTimestamp();

      await owner.send({ embeds: [embed] }).catch(() => {
        // Owner tiene DMs cerrados — no hay nada que hacer
        this.client.logger.debug(`No se pudo enviar DM al owner de ${guild.id} (${guild.ownerId})`);
      });
    } catch (error) {
      this.client.logger.error(
        `Error notificando al owner de ${guild.id}:`,
        error
      );
    }
  }

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
