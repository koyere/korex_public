import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { botConfig } from '../../config/bot.config';

export default class GuessCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'guess',
      description: 'Play a number guessing game',
      category: 'fun',
      cooldown: 10,
      permissions: {
        user: [],
        bot: []
      }
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription(i18n.t(`fun.${this.name}.description`, 'global'))
      .addIntegerOption(option =>
        option
          .setName('guess')
          .setDescription(i18n.t(`fun.${this.name}.guess_option`, 'global'))
          .setMinValue(1)
          .setMaxValue(100)
          .setRequired(true)
      )
      .addIntegerOption(option =>
        option
          .setName('max')
          .setDescription(i18n.t(`fun.${this.name}.max_option`, 'global'))
          .setMinValue(10)
          .setMaxValue(1000)
          .setRequired(false)
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const maxNumber = interaction.options.getInteger('max') || 100;
    const userGuess = interaction.options.getInteger('guess', true);
    const secretNumber = Math.floor(Math.random() * maxNumber) + 1;

    let embed: EmbedBuilder;

    if (userGuess === secretNumber) {
      // Win
      embed = new EmbedBuilder()
        .setColor(botConfig.colors.success)
        .setTitle(`🎉 ${i18n.t('fun.guess.win_title', guildId)}`)
        .setDescription(i18n.t('fun.guess.win_message', guildId, {
          number: secretNumber.toString(),
          guess: userGuess.toString()
        }))
        .setTimestamp();
    } else {
      // Lose with hint
      const hint = userGuess < secretNumber ? 
        i18n.t('fun.guess.too_low', guildId) : 
        i18n.t('fun.guess.too_high', guildId);

      embed = new EmbedBuilder()
        .setColor(botConfig.colors.error)
        .setTitle(`❌ ${i18n.t('fun.guess.lose_title', guildId)}`)
        .setDescription(i18n.t('fun.guess.lose_message', guildId, {
          guess: userGuess.toString(),
          number: secretNumber.toString(),
          hint,
          max: maxNumber.toString()
        }))
        .setTimestamp();
    }

    await interaction.reply({ embeds: [embed] });
  }
}