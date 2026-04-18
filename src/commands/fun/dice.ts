import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { botConfig } from '../../config/bot.config';

export default class DiceCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'dice',
      description: 'Roll dice',
      category: 'fun',
      aliases: ['roll'],
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
      .setDescription(i18n.t(`commands.${this.name}.description`, 'global'))
      .addIntegerOption(option =>
        option
          .setName('sides')
          .setDescription(i18n.t(`commands.${this.name}.options.sides`, 'global'))
          .setMinValue(2)
          .setMaxValue(100)
          .setRequired(false)
      )
      .addIntegerOption(option =>
        option
          .setName('count')
          .setDescription(i18n.t(`commands.${this.name}.options.count`, 'global'))
          .setMinValue(1)
          .setMaxValue(10)
          .setRequired(false)
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const sides = interaction.options.getInteger('sides') || 6;
    const count = interaction.options.getInteger('count') || 1;

    const rolls: number[] = [];

    for (let i = 0; i < count; i++) {
      rolls.push(Math.floor(Math.random() * sides) + 1);
    }

    const total = rolls.reduce((sum, roll) => sum + roll, 0);
    const average = (total / count).toFixed(1);

    const diceEmojis = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    const rollsDisplay = rolls.map(roll => {
      if (sides === 6 && roll <= 6) {
        return diceEmojis[roll - 1];
      }

      return `**${roll}**`;
    }).join(' ');

    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.primary)
      .setTitle(`🎲 ${i18n.t('fun.dice.title', guildId)}`)
      .addFields(
        {
          name: i18n.t('fun.dice.configuration', guildId),
          value: i18n.t('fun.dice.config_value', guildId, {
            count: count.toString(),
            sides: sides.toString()
          }),
          inline: true
        },
        {
          name: i18n.t('fun.dice.results', guildId),
          value: rollsDisplay,
          inline: true
        }
      )
      .setFooter({
        text: i18n.t('fun.dice.footer', guildId, { user: interaction.user.tag }),
        iconURL: interaction.user.displayAvatarURL()
      })
      .setTimestamp();

    if (count > 1) {
      embed.addFields({
        name: i18n.t('fun.dice.statistics', guildId),
        value: i18n.t('fun.dice.stats_value', guildId, {
          total: total.toString(),
          average
        }),
        inline: false
      });
    }

    await interaction.reply({ embeds: [embed] });
  }
}