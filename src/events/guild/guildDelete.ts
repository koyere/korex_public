import { Guild, EmbedBuilder } from 'discord.js';
import { Event } from '../../client/structures/Event';
import { KorexClient } from '../../client/KorexClient';
import { KICKOUT_GRACE_DAYS } from '../../services/GuildKickoutService';
import { i18n } from '../../utils/i18n';

export default class GuildDeleteEvent extends Event<'guildDelete'> {
  constructor(client: KorexClient) {
    super(client, {
      name: 'guildDelete',
      once: false,
    });
  }

  async execute(guild: Guild): Promise<void> {
    this.client.logger.info(`📤 Bot removed from server: ${guild.name} (${guild.id})`);

    try {
      // 1. Suspend all premium access with KICKOUT status (grace period)
      await this.client.kickoutService.handleGuildLeft(guild.id);

      // 2. Invalidate the server configuration cache
      await this.client.cache.invalidateGuildConfig(guild.id);

      // 3. Notify the server owner if there are active licenses
      await this.notifyGuildOwner(guild);

      // 4. Update bot presence
      this.updateBotPresence();

      this.client.logger.info(
        `📊 Ahora sirviendo ${this.client.guilds.cache.size} servidores`
      );
    } catch (error) {
      this.client.logger.error(
        `Error processing departure from server ${guild.id}:`,
        error
      );
    }
  }

  /**
   * Notifies the owner that their licenses are in the grace period.
   * Only sends a DM if the server had at least one active license or premium.
   */
  private async notifyGuildOwner(guild: Guild): Promise<void> {
    try {
      const guildId = guild.id;

      // Check whether there were active licenses or premium before the kickout
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

      // Server language (the record stays in the DB during the grace period)
      const lang = await i18n.getGuildLanguageAsync(this.client.db as any, guildId);
      const vars = { server: guild.name, deadline: deadlineStr, days: String(KICKOUT_GRACE_DAYS) };

      const embed = new EmbedBuilder()
        .setColor(0xF59E0B) // amber
        .setTitle(i18n.t('addons.billing.kickout_title', lang))
        .setDescription(i18n.t('addons.billing.kickout_desc', lang, vars))
        .addFields(
          {
            name: i18n.t('addons.billing.kickout_restore_name', lang),
            value: i18n.t('addons.billing.kickout_restore_value', lang, vars),
          },
          {
            name: i18n.t('addons.billing.kickout_mistake_name', lang),
            value: i18n.t('addons.billing.kickout_mistake_value', lang),
          }
        )
        .setFooter({ text: i18n.t('addons.billing.kickout_footer', lang) })
        .setTimestamp();

      await owner.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {
        // Owner has DMs closed — nothing to do
        this.client.logger.debug(`Could not send DM to the owner of ${guild.id} (${guild.ownerId})`);
      });
    } catch (error) {
      this.client.logger.error(
        `Error notifying the owner of ${guild.id}:`,
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
