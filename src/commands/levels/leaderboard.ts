import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class LeaderboardCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'leaderboard',
      description: 'Shows server leaderboard',
      category: 'levels',
      cooldown: 5,
      guildOnly: true,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName(i18n.t('levels.leaderboard.name', 'global'))
      .setDescription(i18n.t('levels.leaderboard.description', 'global'))
      .addStringOption((option) =>
        option
          .setName('type')
          .setDescription(i18n.t('levels.leaderboard.type_option', 'global'))
          .addChoices({ name: 'Levels', value: 'levels' }, { name: 'Economy', value: 'economy' })
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const type = interaction.options.getString('type') || 'levels';
      const guildId = interaction.guild!.id;
      const lang = i18n.getGuildLanguage(guildId);

      const currentPage = 0;
      const itemsPerPage = 10;

      const showPage = async (page: number) => {
        let users: any[] = [];
        let title = '';

        if (type === 'levels') {
          users = await this.client.levels.getLeaderboard(guildId, itemsPerPage);
          title = i18n.t('levels.leaderboard.title', lang);
        } else {
          users = await this.client.economy.getLeaderboard(guildId, itemsPerPage);
          title = i18n.t('leaderboard.economy_title', lang);
        }

        const embed = new EmbedBuilder()
          .setTitle(title)
          .setColor(Colors.Gold)
          .setDescription(
            i18n.t('leaderboard.description', lang, {
              guild: interaction.guild!.name,
              page: (page + 1).toString(),
            })
          );

        if (users.length === 0) {
          embed.setDescription(i18n.t('levels.leaderboard.no_data', lang));
        } else {
          let description = '';

          for (let i = 0; i < users.length; i++) {
            const user = users[i];
            const position = page * itemsPerPage + i + 1;
            const member = await interaction.guild!.members.fetch(user.userId).catch(() => null);
            const username = member?.user.username || 'Unknown User';

            if (type === 'levels') {
              description += `**${position}.** ${username} - Level ${user.level} (${user.xp.toLocaleString()} XP)\n`;
            } else {
              const total = user.balance + user.bank;

              description += `**${position}.** ${username} - ${total.toLocaleString()} coins\n`;
            }
          }
          embed.setDescription(description);
        }

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`leaderboard_prev_${page}_${type}`)
            .setLabel('Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId(`leaderboard_next_${page}_${type}`)
            .setLabel('Next')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(users.length < itemsPerPage)
        );

        return { embeds: [embed], components: [row] };
      };

      const response = await showPage(currentPage);

      await interaction.reply(response);
    } catch (error) {
      await this.client.errorHandler.handleCommandError(error as Error, interaction, {
        command: 'leaderboard',
      });
    }
  }
}
