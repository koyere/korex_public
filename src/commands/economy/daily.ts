import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, Colors } from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class DailyCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'daily',
      description: 'Claim your daily reward',
      category: 'economy',
      cooldown: 5,
      guildOnly: true,
      addon: 'economy',
    });
  }

  data() {
    return new SlashCommandBuilder().setName('daily').setDescription('Claim your daily reward');
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const guildId = interaction.guild!.id;
      const userId = interaction.user.id;
      const lang = i18n.getGuildLanguage(guildId);

      const result = await this.client.economy.claimDaily(guildId, userId);

      if (!result.success) {
        await interaction.reply({
          content: result.message,
          ephemeral: true,
        });

        return;
      }

      // Obtener datos del usuario para mostrar información adicional
      const economyUser = await this.client.economy.getUser(guildId, userId);

      const embed = new EmbedBuilder()
        .setTitle(i18n.t('commands.daily.title', lang))
        .setColor(Colors.Green)
        .setDescription(result.message)
        .addFields({
          name: i18n.t('commands.daily.new_balance', lang),
          value: `${result.newBalance} 🪙`,
          inline: true,
        });

      if (economyUser.dailyStreak > 1) {
        embed.addFields({
          name: i18n.t('commands.daily.daily_streak', lang),
          value: i18n.t('commands.daily.consecutive_days', lang, { days: String(economyUser.dailyStreak) }),
          inline: true,
        });
      }

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      await this.client.errorHandler.handleCommandError(error as Error, interaction, {
        command: 'daily',
      });
    }
  }
}
