import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, Colors } from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class WithdrawCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'withdraw',
      description: 'Withdraw money from your bank account',
      category: 'economy',
      cooldown: 3,
      guildOnly: true,
      addon: 'economy',
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('withdraw')
      .setDescription('Withdraw money from your bank account')
      .addStringOption((option) =>
        option
          .setName('amount')
          .setDescription('Amount to withdraw (use "all" to withdraw everything)')
          .setRequired(true)
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const guildId = interaction.guild!.id;
      const userId = interaction.user.id;
      const amountInput = interaction.options.getString('amount', true);
      const lang = i18n.getGuildLanguage(guildId);

      // Get user's current bank balance
      const economyUser = await this.client.economy.getUser(guildId, userId);

      let amount: number;

      if (amountInput.toLowerCase() === 'all') {
        amount = economyUser.bank;
        if (amount === 0) {
          await interaction.reply({
            content: i18n.t('withdraw.no_money_in_bank', lang),
            ephemeral: true,
          });

          return;
        }
      } else {
        amount = parseInt(amountInput);
        if (isNaN(amount) || amount <= 0) {
          await interaction.reply({
            content: i18n.t('withdraw.invalid_amount', lang),
            ephemeral: true,
          });

          return;
        }
      }

      const result = await this.client.economy.withdraw(guildId, userId, amount);

      if (!result.success) {
        await interaction.reply({
          content: result.message,
          ephemeral: true,
        });

        return;
      }

      // Get updated user data
      const updatedUser = await this.client.economy.getUser(guildId, userId);

      const embed = new EmbedBuilder()
        .setTitle(i18n.t('withdraw.success_title', lang))
        .setColor(Colors.Green)
        .setDescription(
          i18n.t('withdraw.success_description', lang, {
            amount: amount.toString(),
          })
        )
        .addFields(
          {
            name: i18n.t('withdraw.wallet_balance', lang),
            value: i18n.t('balance.amount', lang, { amount: updatedUser.balance.toString() }),
            inline: true,
          },
          {
            name: i18n.t('withdraw.bank_balance', lang),
            value: i18n.t('balance.amount', lang, { amount: updatedUser.bank.toString() }),
            inline: true,
          },
          {
            name: i18n.t('withdraw.total_balance', lang),
            value: i18n.t('balance.amount', lang, {
              amount: (updatedUser.balance + updatedUser.bank).toString(),
            }),
            inline: true,
          }
        )
        .setFooter({
          text: i18n.t('withdraw.footer', lang),
          iconURL: interaction.user.displayAvatarURL(),
        })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      await this.client.errorHandler.handleCommandError(error as Error, interaction, {
        command: 'withdraw',
      });
    }
  }
}
