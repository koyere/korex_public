import {
  StringSelectMenuInteraction,
  MessageFlags
} from 'discord.js';
import { Component } from '../client/structures/Component';
import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';
import { buildDurationSelectRow, PollSetupData } from '../utils/pollHelpers';

export default class PollTypeSelect extends Component {
  constructor(client: KorexClient) {
    super(client, {
      customId: 'poll_type_select_*',
      type: 'selectMenu'
    });
  }

  async execute(interaction: StringSelectMenuInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;
    const selectedType = interaction.values[0];

    const setupData = await this.client.cache.getTempData(`poll_setup_${userId}`) as PollSetupData | null;

    if (!setupData) {
      await interaction.reply({
        content: i18n.t('polls.wizard.errors.session_expired', guildId),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    setupData.type = selectedType;
    await this.client.cache.setTempData(`poll_setup_${userId}`, setupData, 300);

    // Step 3: show duration select
    const durationRow = buildDurationSelectRow(guildId, userId);

    await interaction.update({
      content: `**${i18n.t('polls.wizard.step3_title', guildId)}**`,
      components: [durationRow]
    });
  }
}
