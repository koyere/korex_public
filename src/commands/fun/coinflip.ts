import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { botConfig } from '../../config/bot.config';

export default class CoinFlipCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'coinflip',
      description: 'Flip a coin',
      category: 'fun',
      aliases: ['flip', 'coin'],
      cooldown: 2,
      permissions: {
        user: [],
        bot: []
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
    
    const isHeads = Math.random() < 0.5;
    const result = isHeads ? 'heads' : 'tails';
    const emoji = isHeads ? '🪙' : '🥈';

    const embed = new EmbedBuilder()
      .setColor(isHeads ? botConfig.colors.success : botConfig.colors.warning)
      .setTitle(`${emoji} ${i18n.t('fun.coinflip.title', guildId)}`)
      .setDescription(i18n.t(`fun.coinflip.result.${result}`, guildId))
      .setFooter({
        text: i18n.t('fun.coinflip.footer', guildId, { user: interaction.user.tag }),
        iconURL: interaction.user.displayAvatarURL()
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
}