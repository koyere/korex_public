import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class UnbanCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'unban',
      description: 'Unban a user from the server',
      category: 'admin',
      permissions: {
        user: [PermissionFlagsBits.BanMembers],
        bot: [PermissionFlagsBits.BanMembers],
      },
      cooldown: 5,
      guildOnly: true,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('unban')
      .setDescription('Unban a user from the server')
      .addStringOption((option) =>
        option.setName('user_id').setDescription('User ID to unban').setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName('reason')
          .setDescription('Reason for the unban')
          .setRequired(false)
          .setMaxLength(500)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const guild = interaction.guild!;
      const guildId = guild.id;
      const userId = interaction.options.getString('user_id', true);
      const reason =
        interaction.options.getString('reason') ||
        i18n.t('unban.no_reason', i18n.getGuildLanguage(guildId));
      const lang = i18n.getGuildLanguage(guildId);

      // Validate user ID format
      if (!/^\d{17,19}$/.test(userId)) {
        await interaction.reply({
          content: i18n.t('unban.invalid_user_id', lang),
          ephemeral: true,
        });

        return;
      }

      // Try to get user object
      const user = await this.client.users.fetch(userId).catch(() => null);

      if (!user) {
        await interaction.reply({
          content: i18n.t('unban.user_not_found', lang),
          ephemeral: true,
        });

        return;
      }

      // Check if user is actually banned
      const ban = await guild.bans.fetch(userId).catch(() => null);

      if (!ban) {
        await interaction.reply({
          content: i18n.t('unban.user_not_banned', lang, { user: user.tag }),
          ephemeral: true,
        });

        return;
      }

      // Perform the unban
      await this.client.moderation.unbanUser(guild, user, interaction.user, reason);

      // Success response
      const embed = new EmbedBuilder()
        .setTitle(i18n.t('unban.success_title', lang))
        .setColor(Colors.Green)
        .setDescription(
          i18n.t('unban.success_description', lang, {
            user: user.tag,
            reason,
          })
        )
        .addFields(
          {
            name: i18n.t('unban.unbanned_user', lang),
            value: `${user.toString()} (${user.tag})`,
            inline: true,
          },
          {
            name: i18n.t('unban.moderator', lang),
            value: interaction.user.toString(),
            inline: true,
          },
          {
            name: i18n.t('unban.reason', lang),
            value: reason,
            inline: false,
          },
          {
            name: i18n.t('unban.original_ban_reason', lang),
            value: ban.reason || i18n.t('unban.no_original_reason', lang),
            inline: false,
          }
        )
        .setFooter({
          text: i18n.t('unban.footer', lang),
          iconURL: interaction.user.displayAvatarURL(),
        })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      await this.client.errorHandler.handleCommandError(error as Error, interaction, {
        command: 'unban',
      });
    }
  }
}
