import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { botConfig } from '../../config/bot.config';

export default class CatCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'cat',
      description: 'Get a random cat picture',
      category: 'fun',
      cooldown: 3,
      permissions: {
        user: [],
        bot: []
      }
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription(i18n.t(`fun.${this.name}.description`, 'global'));
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;

    await interaction.deferReply();

    try {
      // Try to fetch from cat API
      const response = await fetch('https://api.thecatapi.com/v1/images/search');
      
      if (!response.ok) {
        throw new Error('Failed to fetch cat');
      }

      const data = await response.json();
      
      // Type guard for cat API response
      if (!Array.isArray(data) || !data[0]?.url) {
        throw new Error('Invalid response format');
      }
      
      const catUrl = data[0].url;

      if (!catUrl) {
        throw new Error('No cat found');
      }

      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.primary)
        .setTitle(`🐱 ${i18n.t('fun.cat.title', guildId)}`)
        .setImage(catUrl)
        .setFooter({
          text: i18n.t('fun.cat.footer', guildId)
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.error)
        .setTitle(`🐱 ${i18n.t('fun.cat.title', guildId)}`)
        .setDescription(i18n.t('fun.cat.error', guildId))
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  }
}