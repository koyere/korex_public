import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { botConfig } from '../../config/bot.config';

export default class EightBallCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: '8ball',
      description: 'Ask the magic 8-ball a question',
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
      .setDescription(i18n.t(`commands.${this.name}.description`, 'global'))
      .addStringOption(option =>
        option
          .setName('question')
          .setDescription(i18n.t(`commands.${this.name}.options.question`, 'global'))
          .setRequired(true)
          .setMaxLength(200)
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const question = interaction.options.getString('question', true);

    // 8-ball responses
    const responses = [
      i18n.t('fun.8ball.responses.positive.1', guildId),
      i18n.t('fun.8ball.responses.positive.2', guildId),
      i18n.t('fun.8ball.responses.positive.3', guildId),
      i18n.t('fun.8ball.responses.positive.4', guildId),
      i18n.t('fun.8ball.responses.positive.5', guildId),
      i18n.t('fun.8ball.responses.negative.1', guildId),
      i18n.t('fun.8ball.responses.negative.2', guildId),
      i18n.t('fun.8ball.responses.negative.3', guildId),
      i18n.t('fun.8ball.responses.negative.4', guildId),
      i18n.t('fun.8ball.responses.negative.5', guildId),
      i18n.t('fun.8ball.responses.neutral.1', guildId),
      i18n.t('fun.8ball.responses.neutral.2', guildId),
      i18n.t('fun.8ball.responses.neutral.3', guildId),
      i18n.t('fun.8ball.responses.neutral.4', guildId),
      i18n.t('fun.8ball.responses.neutral.5', guildId)
    ];

    const randomResponse = responses[Math.floor(Math.random() * responses.length)];

    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.primary)
      .setTitle(`🎱 ${i18n.t('fun.8ball.title', guildId)}`)
      .addFields(
        {
          name: i18n.t('fun.8ball.question', guildId),
          value: question,
          inline: false
        },
        {
          name: i18n.t('fun.8ball.answer', guildId),
          value: randomResponse,
          inline: false
        }
      )
      .setFooter({
        text: i18n.t('fun.8ball.footer', guildId),
        iconURL: interaction.user.displayAvatarURL()
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
}