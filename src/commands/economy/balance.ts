import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
  User,
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class BalanceCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'balance',
      description: "Shows your balance or another user's balance",
      category: 'economy',
      cooldown: 3,
      guildOnly: true,
      addon: 'economy',
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('balance')
      .setDescription("Shows your balance or another user's balance")
      .addUserOption((option) =>
        option.setName('user').setDescription('User to view balance for (optional)')
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const guildId = interaction.guild!.id;
      const lang = i18n.getGuildLanguage(guildId);

      const economyUser = await this.client.economy.getUser(guildId, targetUser.id);

      const embed = new EmbedBuilder()
        .setTitle(i18n.t('commands.balance.title', lang, { user: targetUser.username, currency: '🪙' }))
        .setColor(Colors.Gold)
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
          {
            name: i18n.t('commands.balance.wallet', lang),
            value: `${economyUser.balance} 🪙`,
            inline: true,
          },
          {
            name: i18n.t('commands.balance.bank', lang),
            value: `${economyUser.bank} 🪙`,
            inline: true,
          },
          {
            name: i18n.t('commands.balance.total', lang),
            value: `${economyUser.balance + economyUser.bank} 🪙`,
            inline: true,
          }
        );

      if (economyUser.dailyStreak > 0) {
        embed.addFields({
          name: i18n.t('commands.balance.daily_streak', lang),
          value: i18n.t('commands.balance.streak_value', lang, { count: String(economyUser.dailyStreak) }),
          inline: true,
        });
      }

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      await this.client.errorHandler.handleCommandError(error as Error, interaction, {
        command: 'balance',
      });
    }
  }
}
