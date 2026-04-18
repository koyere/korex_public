import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
  PermissionFlagsBits
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { botConfig } from '../../config/bot.config';
import { buildCategorySelectRow } from '../../utils/suggestionHelpers';

export default class SuggestCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'suggest',
      description: 'Submit a suggestion to improve the server',
      category: 'utility',
      cooldown: 300, // 5 minutes
      permissions: {
        user: [],
        bot: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]
      }
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription(i18n.t(`commands.${this.name}.description`, 'global'));
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
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

    if (!config.channelId) {
      await interaction.reply({ content: i18n.t('suggestions.errors.no_channel', guildId), flags: MessageFlags.Ephemeral });
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