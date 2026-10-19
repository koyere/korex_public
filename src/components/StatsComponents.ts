import { ButtonInteraction, MessageFlags } from 'discord.js';
import { Component, ComponentInteraction } from '../client/structures/Component';
import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';
import {
  buildActivityEmbed,
  buildCompareEmbed,
  buildServerChannelsEmbed,
  buildServerDetailedEmbed,
  buildServerGrowthEmbed,
  buildUserChannelsEmbed
} from '../utils/statsEmbeds';

/**
 * Buttons of /stats user (stats_activity_<id>, stats_channels_<id>, stats_compare_<id>)
 * and /stats server (stats_server_detailed | channels | growth).
 * They reply ephemerally with real data from UserStatsService.
 */
export default class StatsComponents extends Component {
  constructor(client: KorexClient) {
    super(client, {
      customId: 'stats_*',
      type: 'button',
      guildOnly: true
    });
  }

  async execute(interaction: ComponentInteraction): Promise<void> {
    if (!interaction.isButton() || !interaction.guild) return;

    const btn = interaction as ButtonInteraction;
    const guild = interaction.guild;
    const guildId = guild.id;
    const id = btn.customId;

    await btn.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      if (id.startsWith('stats_server_')) {
        const view = id.slice('stats_server_'.length);
        const embed = view === 'detailed'
          ? await buildServerDetailedEmbed(this.client, guild)
          : view === 'channels'
            ? await buildServerChannelsEmbed(this.client, guild)
            : view === 'growth'
              ? await buildServerGrowthEmbed(this.client, guild)
              : null;

        if (!embed) {
          await btn.editReply({ content: i18n.t('stats.server.error', guildId) });
          return;
        }
        await btn.editReply({ embeds: [embed] });
        return;
      }

      const match = id.match(/^stats_(activity|channels|compare)_(\d{17,20})$/);
      if (!match) {
        await btn.editReply({ content: i18n.t('stats.user.error', guildId) });
        return;
      }

      const [, view, userId] = match;
      const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        await btn.editReply({ content: i18n.t('stats.user.not_found', guildId) });
        return;
      }

      const embed = view === 'activity'
        ? await buildActivityEmbed(this.client, member, '30d')
        : view === 'channels'
          ? await buildUserChannelsEmbed(this.client, member)
          : await buildCompareEmbed(this.client, member);

      await btn.editReply({ embeds: [embed] });
    } catch (error) {
      this.client.logger.error('Error handling stats button:', error);
      await btn.editReply({ content: i18n.t('stats.user.error', guildId) }).catch(() => {});
    }
  }
}
