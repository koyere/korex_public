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

export default class PayCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'pay',
      description: 'Transfer money to another user',
      category: 'economy',
      cooldown: 5,
      guildOnly: true,
      addon: 'economy',
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('pay')
      .setDescription('Transfer money to another user')
      .addUserOption((option) =>
        option.setName('user').setDescription('User to transfer money to').setRequired(true)
      )
      .addIntegerOption((option) =>
        option
          .setName('amount')
          .setDescription('Amount to transfer')
          .setRequired(true)
          .setMinValue(1)
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const guildId = interaction.guild!.id;
      const fromUserId = interaction.user.id;
      const toUser = interaction.options.getUser('user', true);
      const amount = interaction.options.getInteger('amount', true);
      const lang = i18n.getGuildLanguage(guildId);

      // Validations
      if (toUser.bot) {
        await interaction.reply({
          content: i18n.t('pay.cannot_pay_bot', lang),
          ephemeral: true,
        });

        return;
      }

      if (toUser.id === fromUserId) {
        await interaction.reply({
          content: i18n.t('pay.cannot_pay_self', lang),
          ephemeral: true,
        });

        return;
      }

      if (amount <= 0) {
        await interaction.reply({
          content: i18n.t('pay.invalid_amount', lang),
          ephemeral: true,
        });

        return;
      }

      const result = await this.client.economy.transferMoney(
        guildId,
        fromUserId,
        toUser.id,
        amount
      );

      if (!result.success) {
        await interaction.reply({
          content: result.message,
          ephemeral: true,
        });

        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(i18n.t('pay.success_title', lang))
        .setColor(Colors.Green)
        .setDescription(
          i18n.t('pay.success_description', lang, {
            amount: amount.toString(),
            user: toUser.toString(),
          })
        )
        .addFields({
          name: i18n.t('pay.your_new_balance', lang),
          value: i18n.t('balance.amount', lang, { amount: result.newBalance!.toString() }),
          inline: true,
        })
        .setFooter({
          text: i18n.t('pay.footer', lang),
          iconURL: interaction.user.displayAvatarURL(),
        })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      // Try to notify the recipient
      try {
        const recipientEmbed = new EmbedBuilder()
          .setTitle(i18n.t('pay.received_title', lang))
          .setColor(Colors.Gold)
          .setDescription(
            i18n.t('pay.received_description', lang, {
              amount: amount.toString(),
              user: interaction.user.toString(),
              server: interaction.guild!.name,
            })
          )
          .setTimestamp();

        await toUser.send({ embeds: [recipientEmbed] });
      } catch (error) {
        // User has DMs disabled, ignore
      }
    } catch (error) {
      await this.client.errorHandler.handleCommandError(error as Error, interaction, {
        command: 'pay',
      });
    }
  }
}
