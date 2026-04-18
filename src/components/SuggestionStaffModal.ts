import { ModalSubmitInteraction, MessageFlags } from 'discord.js';
import { Component, ComponentInteraction } from '../client/structures/Component';
import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';

// Handles: suggestion_approve_modal_*, suggestion_reject_modal_*, suggestion_consider_modal_*
export default class SuggestionStaffModal extends Component {
  constructor(client: KorexClient) {
    super(client, {
      customId: 'suggestion_*_modal_*',
      type: 'modal',
      guildOnly: true,
    });
  }

  async execute(interaction: ComponentInteraction): Promise<void> {
    if (!interaction.isModalSubmit()) return;

    const modalInteraction = interaction as ModalSubmitInteraction;
    const guildId = modalInteraction.guildId!;
    const suggestionService = this.client.suggestionService;

    if (!suggestionService) {
      await modalInteraction.reply({ content: i18n.t('suggestions.errors.service_unavailable', guildId), flags: MessageFlags.Ephemeral });
      return;
    }

    await suggestionService.handleStaffModal(modalInteraction);
  }
}
