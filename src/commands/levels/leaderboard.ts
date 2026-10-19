import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
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
          .addChoices({ name: 'Levels', value: 'levels' }, { name: 'Economy', value: 'economy' }) // nombres localizados en el registro
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const type = interaction.options.getString('type') || 'levels';
      const guildId = interaction.guild!.id;
      const lang = i18n.getGuildLanguage(guildId);
      const t = (key: string, vars?: Record<string, string>) => i18n.t(key, lang, vars);

      // Cada ranking respeta el toggle de su módulo
      const moduleName = type === 'levels' ? 'levels' : 'economy';
      if (!(await this.client.addons.isEnabled(guildId, moduleName))) {
        await interaction.reply({ content: t('common.module_disabled'), ephemeral: true });
        return;
      }

      const itemsPerPage = 10;
      const maxPages = 10;
      const symbol = type === 'economy' ? (await this.client.economy.getConfig(guildId)).currencySymbol : '';

      const showPage = async (page: number) => {
        const offset = page * itemsPerPage;
        const users: any[] = type === 'levels'
          ? await this.client.levels.getLeaderboard(guildId, itemsPerPage, offset)
          : await this.client.economy.getLeaderboard(guildId, itemsPerPage, offset);

        const embed = new EmbedBuilder()
          .setTitle(type === 'levels' ? t('levels.leaderboard.title') : t('leaderboard.economy_title'))
          .setColor(Colors.Gold)
          .setFooter({ text: t('leaderboard.page', { page: String(page + 1) }) });

        if (users.length === 0) {
          embed.setDescription(t('levels.leaderboard.no_data'));
        } else {
          const lines: string[] = [];
          for (let i = 0; i < users.length; i++) {
            const user = users[i];
            const position = offset + i + 1;
            const member = await interaction.guild!.members.fetch(user.userId).catch(() => null);
            const username = member?.user.username || t('leaderboard.unknown_user');

            lines.push(type === 'levels'
              ? t('leaderboard.line_levels', { position: String(position), user: username, level: String(user.level), xp: user.totalXp.toLocaleString() })
              : t('leaderboard.line_economy', { position: String(position), user: username, amount: `${(user.balance + user.bank).toLocaleString()} ${symbol}` }));
          }
          embed.setDescription(lines.join('\n'));
        }

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId('lb_prev')
            .setLabel(t('leaderboard.previous'))
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId('lb_next')
            .setLabel(t('leaderboard.next'))
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(users.length < itemsPerPage || page + 1 >= maxPages)
        );

        return { embeds: [embed], components: [row] };
      };

      let page = 0;
      const message = await interaction.reply({ ...(await showPage(page)), fetchReply: true });

      // Paginación: solo quien ejecutó el comando, 2 minutos
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 120_000,
        filter: (i) => i.user.id === interaction.user.id,
      });
      collector.on('collect', async (i) => {
        page = i.customId === 'lb_next' ? page + 1 : Math.max(0, page - 1);
        await i.update(await showPage(page)).catch(() => {});
      });
      collector.on('end', () => {
        interaction.editReply({ components: [] }).catch(() => {});
      });
    } catch (error) {
      await this.client.errorHandler.handleCommandError(error as Error, interaction, {
        command: 'leaderboard',
      });
    }
  }
}
