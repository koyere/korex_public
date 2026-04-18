import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { botConfig } from '../../config/bot.config';

type RPSChoice = 'rock' | 'paper' | 'scissors';

export default class RPSCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'rps',
      description: 'Play Rock, Paper, Scissors',
      category: 'fun',
      aliases: ['rockpaperscissors'],
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
      .setDescription(i18n.t(`commands.${this.name}.description`, 'global'))
      .addStringOption(option =>
        option
          .setName('choice')
          .setDescription(i18n.t(`commands.${this.name}.options.choice`, 'global'))
          .setRequired(true)
          .addChoices(
            { name: '🪨 Rock', value: 'rock' },
            { name: '📄 Paper', value: 'paper' },
            { name: '✂️ Scissors', value: 'scissors' }
          )
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const userChoice = interaction.options.getString('choice', true) as RPSChoice;
    
    const choices: RPSChoice[] = ['rock', 'paper', 'scissors'];
    const botChoice = choices[Math.floor(Math.random() * choices.length)];

    const result = this.determineWinner(userChoice, botChoice);
    
    const choiceEmojis = {
      rock: '🪨',
      paper: '📄',
      scissors: '✂️'
    };

    const resultColors = {
      win: botConfig.colors.success,
      lose: botConfig.colors.error,
      tie: botConfig.colors.warning
    };

    const embed = new EmbedBuilder()
      .setColor(resultColors[result])
      .setTitle(`✂️📄🪨 ${i18n.t('fun.rps.title', guildId)}`)
      .addFields(
        {
          name: i18n.t('fun.rps.your_choice', guildId),
          value: `${choiceEmojis[userChoice]} ${i18n.t(`fun.rps.choices.${userChoice}`, guildId)}`,
          inline: true
        },
        {
          name: i18n.t('fun.rps.bot_choice', guildId),
          value: `${choiceEmojis[botChoice]} ${i18n.t(`fun.rps.choices.${botChoice}`, guildId)}`,
          inline: true
        },
        {
          name: i18n.t('fun.rps.result', guildId),
          value: i18n.t(`fun.rps.results.${result}`, guildId),
          inline: false
        }
      )
      .setFooter({
        text: i18n.t('fun.rps.footer', guildId, { user: interaction.user.tag }),
        iconURL: interaction.user.displayAvatarURL()
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  private determineWinner(userChoice: RPSChoice, botChoice: RPSChoice): 'win' | 'lose' | 'tie' {
    if (userChoice === botChoice) {
      return 'tie';
    }

    const winConditions = {
      rock: 'scissors',
      paper: 'rock',
      scissors: 'paper'
    };

    return winConditions[userChoice] === botChoice ? 'win' : 'lose';
  }
}