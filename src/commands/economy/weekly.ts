import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, Colors } from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class WeeklyCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'weekly',
      description: 'Claim your weekly reward',
      category: 'economy',
      cooldown: 5,
      guildOnly: true,
      addon: 'economy',
    });
  }

  data() {
    return new SlashCommandBuilder().setName('weekly').setDescription('Claim your weekly reward');
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const guildId = interaction.guild!.id;
      const userId = interaction.user.id;
      const lang = i18n.getGuildLanguage(guildId);

      const result = await this.client.economy.claimWeekly(guildId, userId);

      if (!result.success) {
        await interaction.reply({
          content: result.message,
          ephemeral: true,
        });

        return;
      }

      // Get economy config for currency symbol
      const config = await this.client.economy.getConfig(guildId);

      const embed = new EmbedBuilder()
        .setTitle(i18n.t('weekly.success_title', lang))
        .setColor(Colors.Gold)
        .setDescription(
          i18n.t('weekly.success_description', lang, {
            amount: config.weeklyReward.toString(),
            symbol: config.currencySymbol,
          })
        )
        .addFields(
          {
            name: i18n.t('weekly.new_balance', lang),
            value: i18n.t('balance.amount', lang, { amount: result.newBalance!.toString() }),
            inline: true,
          },
          {
            name: i18n.t('weekly.next_claim', lang),
            value: i18n.t('weekly.next_claim_time', lang),
            inline: true,
          }
        )
        .setFooter({
          text: i18n.t('weekly.footer', lang),
          iconURL: interaction.user.displayAvatarURL(),
        })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      await this.client.errorHandler.handleCommandError(error as Error, interaction, {
        command: 'weekly',
      });
    }
  }
}
