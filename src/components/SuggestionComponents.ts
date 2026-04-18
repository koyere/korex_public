import { ButtonInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { Component, ComponentInteraction } from '../client/structures/Component';
import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';
import { botConfig } from '../config/bot.config';
import { buildCategorySelectRow } from '../utils/suggestionHelpers';

export default class SuggestionComponents extends Component {
  constructor(client: KorexClient) {
    super(client, {
      customId: 'suggestion_*',
      type: 'button'
    });
  }

  async execute(interaction: ComponentInteraction): Promise<void> {
    if (!interaction.isButton()) return;

    const btn = interaction as ButtonInteraction;

    if (btn.customId === 'suggestion_open_form') {
      await this.handleOpenForm(btn);
      return;
    }

    if (btn.customId.startsWith('suggestion_approve_') ||
        btn.customId.startsWith('suggestion_reject_') ||
        btn.customId.startsWith('suggestion_consider_')) {
      await this.client.suggestionService.handleStaffAction(btn);
      return;
    }

    await this.client.suggestionService.handleVote(btn);
  }

  private async handleOpenForm(interaction: ButtonInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const suggestionService = this.client.suggestionService;

    if (!suggestionService) {
      await interaction.reply({ content: i18n.t('suggestions.errors.service_unavailable', guildId), flags: MessageFlags.Ephemeral });
      return;
    }

    const config = await suggestionService.getConfig(guildId);

    if (!config.enabled) {
      await interaction.reply({ content: i18n.t('suggestions.errors.disabled', guildId), flags: MessageFlags.Ephemeral });
      return;
    }

    const cooldownKey = `${guildId}-${interaction.user.id}`;
    const lastSuggestion = suggestionService.getCooldown(cooldownKey);

    if (lastSuggestion && Date.now() - lastSuggestion < config.cooldown * 1000) {
      const timeLeft = Math.ceil((config.cooldown * 1000 - (Date.now() - lastSuggestion)) / 1000);
      await interaction.reply({ content: i18n.t('suggestions.errors.cooldown', guildId, { time: timeLeft.toString() }), flags: MessageFlags.Ephemeral });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.primary)
      .setTitle(i18n.t('suggestions.select.step1_title', guildId))
      .setDescription(i18n.t('suggestions.select.step1_description', guildId));

    await interaction.reply({
      embeds: [embed],
      components: [buildCategorySelectRow(guildId)],
      flags: MessageFlags.Ephemeral
    });
  }
}
