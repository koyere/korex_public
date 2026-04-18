import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  User
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { botConfig } from '../../config/bot.config';

export default class ComplimentCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'compliment',
      description: 'Give someone a nice compliment',
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
      .setDescription(i18n.t(`fun.${this.name}.description`, 'global'))
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription(i18n.t(`fun.${this.name}.user_option`, 'global'))
          .setRequired(false)
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const target = interaction.options.getUser('user');
    const author = interaction.user;

    const compliments = i18n.t('fun.compliment.list', guildId) as unknown as string[];
    const randomCompliment = compliments[Math.floor(Math.random() * compliments.length)];

    let description: string;
    let color: string = botConfig.colors.primary;

    if (!target) {
      // General compliment
      description = randomCompliment;
    } else if (target.id === author.id) {
      description = i18n.t('fun.compliment.self_compliment', guildId, { 
        user: author.toString(),
        compliment: randomCompliment
      });
      color = botConfig.colors.warning;
    } else if (target.bot) {
      description = i18n.t('fun.compliment.bot_compliment', guildId, { 
        user: author.toString(),
        target: target.toString(),
        compliment: randomCompliment
      });
      color = botConfig.colors.info;
    } else {
      description = i18n.t('fun.compliment.user_compliment', guildId, { 
        author: author.toString(), 
        target: target.toString(),
        compliment: randomCompliment
      });
    }

    const embed = new EmbedBuilder()
      .setColor(color as any)
      .setTitle(`✨ ${i18n.t('fun.compliment.title', guildId)}`)
      .setDescription(description)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
}