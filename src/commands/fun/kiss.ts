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

export default class KissCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'kiss',
      description: 'Give someone a sweet kiss',
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
          .setRequired(true)
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const target = interaction.options.getUser('user', true);
    const author = interaction.user;

    let description: string;
    let color: string = botConfig.colors.primary;

    if (target.id === author.id) {
      description = i18n.t('fun.kiss.self_kiss', guildId, { user: author.toString() });
      color = botConfig.colors.warning;
    } else if (target.bot) {
      description = i18n.t('fun.kiss.bot_kiss', guildId, { user: author.toString() });
      color = botConfig.colors.info;
    } else {
      const messages = i18n.t('fun.kiss.messages', guildId) as unknown as string[];
      const randomMessage = messages[Math.floor(Math.random() * messages.length)];

      description = `${i18n.t('fun.kiss.user_kiss', guildId, { 
        author: author.toString(), 
        target: target.toString() 
      })}\n${randomMessage}`;
    }

    const embed = new EmbedBuilder()
      .setColor(color as any)
      .setTitle(`💋 ${i18n.t('fun.kiss.title', guildId)}`)
      .setDescription(description)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
}