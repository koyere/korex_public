import { ModalSubmitInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { Component, ComponentInteraction } from '../client/structures/Component';
import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';
import { botConfig } from '../config/bot.config';

export default class SuggestionFormModal extends Component {
  constructor(client: KorexClient) {
    super(client, {
      customId: 'suggestion_form_*',
      type: 'modal',
      guildOnly: true,
    });
  }

  async execute(interaction: ComponentInteraction): Promise<void> {
    if (!interaction.isModalSubmit()) return;

    const modalInteraction = interaction as ModalSubmitInteraction;
    const guildId = modalInteraction.guildId!;

    // Defer immediately — postSuggestion + thread creation can exceed the 3s modal token timeout
    await modalInteraction.deferReply({ ephemeral: true });

    // Extract category and priority from customId: suggestion_form_{category}_{priority}
    const parts = modalInteraction.customId.replace('suggestion_form_', '').split('_');
    const category = parts[0] as 'feature' | 'improvement' | 'bug' | 'other';
    const priority = parts[1] as 'low' | 'medium' | 'high';

    const title = modalInteraction.fields.getTextInputValue('title');
    const description = modalInteraction.fields.getTextInputValue('description');

    const suggestionService = this.client.suggestionService;

    if (!suggestionService) {
      await modalInteraction.editReply({ content: i18n.t('suggestions.errors.service_unavailable', guildId) });
      return;
    }

    try {
      const suggestion = await suggestionService.createSuggestion(
        modalInteraction.guild!,
        modalInteraction.user,
        title,
        description,
        category,
        priority
      );

      if (!suggestion) {
        await modalInteraction.editReply({ content: i18n.t('suggestions.errors.creation_failed', guildId) });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.success)
        .setTitle(i18n.t('suggestions.success.title', guildId))
        .setDescription(i18n.t('suggestions.success.description', guildId, {
          title: suggestion.title,
          id: suggestion.id
        }))
        .addFields(
          { name: i18n.t('suggestions.embed.category', guildId), value: i18n.t(`suggestions.categories.${suggestion.category}`, guildId), inline: true },
          { name: i18n.t('suggestions.embed.priority', guildId), value: i18n.t(`suggestions.priorities.${suggestion.priority}`, guildId), inline: true },
          { name: i18n.t('suggestions.embed.status', guildId), value: i18n.t(`suggestions.statuses.${suggestion.status}`, guildId), inline: true }
        )
        .setTimestamp();

      await modalInteraction.editReply({ embeds: [embed] });

    } catch (error) {
      this.client.logger.error('Error creating suggestion:', error);
      await modalInteraction.editReply({ content: i18n.t('suggestions.errors.internal_error', guildId) });
    }
  }
}
