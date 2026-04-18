import {
  StringSelectMenuInteraction,
  MessageFlags
} from 'discord.js';
import { Component } from '../client/structures/Component';
import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';
import { buildConfirmPanel, PollSetupData } from '../utils/pollHelpers';

export default class PollDurationSelect extends Component {
  constructor(client: KorexClient) {
    super(client, {
      customId: 'poll_duration_select_*',
      type: 'selectMenu'
    });
  }

  async execute(interaction: StringSelectMenuInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;
    const selectedDuration = parseInt(interaction.values[0], 10);

    const setupData = await this.client.cache.getTempData(`poll_setup_${userId}`) as PollSetupData | null;

    if (!setupData) {
      await interaction.reply({
        content: i18n.t('polls.wizard.errors.session_expired', guildId),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    setupData.durationHours = selectedDuration;
    await this.client.cache.setTempData(`poll_setup_${userId}`, setupData, 300);

    // Step 4: show confirm panel
    const panel = buildConfirmPanel(setupData, guildId);

    await interaction.update({
      content: null,
      ...panel
    });
  }
}
