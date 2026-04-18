import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { botConfig } from '../../config/bot.config';

export default class AdviceCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'advice',
      description: 'Get some wise advice',
      category: 'fun',
      cooldown: 5,
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
    const guildLanguage = i18n.getGuildLanguage(guildId);

    await interaction.deferReply();

    const buildEmbed = (advice: string) =>
      new EmbedBuilder()
        .setColor(botConfig.colors.primary)
        .setTitle(`💡 ${i18n.t('fun.advice.title', guildId)}`)
        .setDescription(`"${advice}"`)
        .setFooter({ text: i18n.t('fun.advice.footer', guildId) })
        .setTimestamp();

    // Non-English guilds use the local list directly — the external API is English-only
    if (guildLanguage !== 'en') {
      const adviceList = i18n.getList('fun.advice.list', guildId);
      const randomAdvice = adviceList[Math.floor(Math.random() * adviceList.length)];
      await interaction.editReply({ embeds: [buildEmbed(randomAdvice)] });
      return;
    }

    // English guilds: try external API, fall back to local list
    try {
      const response = await fetch('https://api.adviceslip.com/advice');

      if (!response.ok) throw new Error('API error');

      const data = await response.json();

      if (!data || typeof data !== 'object' || !(data as any).slip?.advice) {
        throw new Error('Invalid response format');
      }

      await interaction.editReply({ embeds: [buildEmbed((data as any).slip.advice)] });

    } catch {
      const adviceList = i18n.getList('fun.advice.list', guildId);
      const randomAdvice = adviceList[Math.floor(Math.random() * adviceList.length)];
      await interaction.editReply({ embeds: [buildEmbed(randomAdvice)] });
    }
  }
}