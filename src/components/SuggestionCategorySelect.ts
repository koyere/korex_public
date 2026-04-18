import { StringSelectMenuInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { Component, ComponentInteraction } from '../client/structures/Component';
import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';
import { botConfig } from '../config/bot.config';
import { buildPrioritySelectRow } from '../utils/suggestionHelpers';

export default class SuggestionCategorySelect extends Component {
  constructor(client: KorexClient) {
    super(client, {
      customId: 'suggestion_category_select',
      type: 'selectMenu',
      guildOnly: true,
    });
  }

  async execute(interaction: ComponentInteraction): Promise<void> {
    if (!interaction.isStringSelectMenu()) return;

    const selectInteraction = interaction as StringSelectMenuInteraction;
    const guildId = selectInteraction.guildId!;
    const category = selectInteraction.values[0];

    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.primary)
      .setTitle(i18n.t('suggestions.select.step2_title', guildId))
      .setDescription(i18n.t('suggestions.select.step2_description', guildId))
      .addFields({
        name: i18n.t('suggestions.embed.category', guildId),
        value: i18n.t(`suggestions.categories.${category}`, guildId),
        inline: true
      });

    await selectInteraction.update({
      embeds: [embed],
      components: [buildPrioritySelectRow(guildId, category)],
    });
  }
}
