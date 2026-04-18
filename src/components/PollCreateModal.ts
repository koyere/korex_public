import {
  ModalSubmitInteraction,
  MessageFlags
} from 'discord.js';
import { Component } from '../client/structures/Component';
import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';
import { parseOptions, buildTypeSelectRow, PollSetupData } from '../utils/pollHelpers';

export default class PollCreateModal extends Component {
  constructor(client: KorexClient) {
    super(client, {
      customId: 'poll_create_modal_*',
      type: 'modal'
    });
  }

  async execute(interaction: ModalSubmitInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;

    const title = interaction.fields.getTextInputValue('title').trim();
    const description = interaction.fields.getTextInputValue('description').trim();
    const optionsText = interaction.fields.getTextInputValue('options');

    const options = parseOptions(optionsText);

    if (options.length < 2) {
      await interaction.reply({
        content: i18n.t('polls.wizard.errors.min_options', guildId),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (options.length > 25) {
      await interaction.reply({
        content: i18n.t('polls.wizard.errors.max_options', guildId),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    // Read initial data (channelId stored by /poll create)
    const initData = await this.client.cache.getTempData(`poll_setup_init_${userId}`) as { channelId: string } | null;

    if (!initData) {
      await interaction.reply({
        content: i18n.t('polls.wizard.errors.session_expired', guildId),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    // Build and store full setup data with defaults
    const setupData: PollSetupData = {
      channelId: initData.channelId,
      title,
      description: description || undefined,
      options,
      type: 'simple',
      durationHours: 24,
      anonymous: false,
      allowChange: false,
      hostId: userId
    };

    await this.client.cache.setTempData(`poll_setup_${userId}`, setupData, 300);

    // Step 2: show type select
    const typeRow = buildTypeSelectRow(guildId, userId);

    await interaction.reply({
      content: `**${i18n.t('polls.wizard.step2_title', guildId)}**`,
      components: [typeRow],
      flags: MessageFlags.Ephemeral
    });
  }
}
