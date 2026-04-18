import {
  StringSelectMenuInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from 'discord.js';
import { Component, ComponentInteraction } from '../client/structures/Component';
import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';

export default class SuggestionPrioritySelect extends Component {
  constructor(client: KorexClient) {
    super(client, {
      customId: 'suggestion_priority_select_*',
      type: 'selectMenu',
      guildOnly: true,
    });
  }

  async execute(interaction: ComponentInteraction): Promise<void> {
    if (!interaction.isStringSelectMenu()) return;

    const selectInteraction = interaction as StringSelectMenuInteraction;
    const guildId = selectInteraction.guildId!;

    // Extract category from customId: suggestion_priority_select_{category}
    const category = selectInteraction.customId.replace('suggestion_priority_select_', '');
    const priority = selectInteraction.values[0];

    const modal = new ModalBuilder()
      .setCustomId(`suggestion_form_${category}_${priority}`)
      .setTitle(i18n.t('suggestions.modal.title', guildId));

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel(i18n.t('suggestions.modal.title_label', guildId))
          .setPlaceholder(i18n.t('suggestions.modal.title_placeholder', guildId))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(100)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('description')
          .setLabel(i18n.t('suggestions.modal.description_label', guildId))
          .setPlaceholder(i18n.t('suggestions.modal.description_placeholder', guildId))
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setRequired(true)
      )
    );

    await selectInteraction.showModal(modal);
  }
}
