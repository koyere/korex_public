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

export default class HugCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'hug',
      description: 'Give someone a hug',
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
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription(i18n.t(`commands.${this.name}.options.user`, 'global'))
          .setRequired(true)
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const targetUser = interaction.options.getUser('user', true);
    const author = interaction.user;

    // Check if user is trying to hug themselves
    if (targetUser.id === author.id) {
      await interaction.reply({
        content: i18n.t('fun.hug.self_hug', guildId),
        ephemeral: true
      });

      return;
    }

    // Check if user is trying to hug a bot
    if (targetUser.bot) {
      await interaction.reply({
        content: i18n.t('fun.hug.bot_hug', guildId, { bot: targetUser.toString() }),
        ephemeral: true
      });

      return;
    }

    const hugGifs = [
      'https://tenor.com/view/hug-bear-hug-tight-hug-love-gif-12535134',
      'https://tenor.com/view/hug-anime-cute-love-gif-9200932',
      'https://tenor.com/view/hug-virtual-hug-gif-18284742',
      'https://tenor.com/view/hug-anime-gif-14634326',
      'https://tenor.com/view/hug-cute-anime-gif-17191088'
    ];

    const randomGif = hugGifs[Math.floor(Math.random() * hugGifs.length)];

    const messages = [
      i18n.t('fun.hug.messages.1', guildId, { author: author.toString(), target: targetUser.toString() }),
      i18n.t('fun.hug.messages.2', guildId, { author: author.toString(), target: targetUser.toString() }),
      i18n.t('fun.hug.messages.3', guildId, { author: author.toString(), target: targetUser.toString() }),
      i18n.t('fun.hug.messages.4', guildId, { author: author.toString(), target: targetUser.toString() }),
      i18n.t('fun.hug.messages.5', guildId, { author: author.toString(), target: targetUser.toString() })
    ];

    const randomMessage = messages[Math.floor(Math.random() * messages.length)];

    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.primary)
      .setTitle(`🤗 ${i18n.t('fun.hug.title', guildId)}`)
      .setDescription(randomMessage)
      .setImage(randomGif)
      .setFooter({
        text: i18n.t('fun.hug.footer', guildId),
        iconURL: author.displayAvatarURL()
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
}