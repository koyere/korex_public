import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { botConfig } from '../../config/bot.config';

export default class DogCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'dog',
      description: 'Get a random dog picture',
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
      // Try to fetch from dog API
      const response = await fetch('https://api.thedogapi.com/v1/images/search');
      
      if (!response.ok) {
        throw new Error('Failed to fetch dog');
      }

      const data = await response.json();
      
      // Type guard for dog API response
      if (!Array.isArray(data) || !data[0]?.url) {
        throw new Error('Invalid response format');
      }
      
      const dogUrl = data[0].url;

      if (!dogUrl) {
        throw new Error('No dog found');
      }

      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.primary)
        .setTitle(`🐶 ${i18n.t('fun.dog.title', guildId)}`)
        .setImage(dogUrl)
        .setFooter({
          text: i18n.t('fun.dog.footer', guildId)
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.error)
        .setTitle(`🐶 ${i18n.t('fun.dog.title', guildId)}`)
        .setDescription(i18n.t('fun.dog.error', guildId))
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  }
}