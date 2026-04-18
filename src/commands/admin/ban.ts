import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  Colors,
  GuildMember,
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class BanCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'ban',
      description: 'Ban a user from the server',
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
      .setName('ban')
      .setDescription('Ban a user from the server')
      .addUserOption((option) =>
        option.setName('user').setDescription('User to ban').setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName('reason')
          .setDescription('Reason for the ban')
          .setRequired(false)
          .setMaxLength(500)
      )
      .addIntegerOption(
        (option) =>
          option
            .setName('duration')
            .setDescription('Ban duration in minutes (leave empty for permanent)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(525600) // 1 year
      )
      .addIntegerOption((option) =>
        option
          .setName('delete_messages')
          .setDescription('Delete messages from the last X days (0-7)')
          .setRequired(false)
          .setMinValue(0)
          .setMaxValue(7)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const guild = interaction.guild!;
      const guildId = guild.id;
      const user = interaction.options.getUser('user', true);
      const reason =
        interaction.options.getString('reason') ||
        i18n.t('ban.no_reason', i18n.getGuildLanguage(guildId));
      const duration = interaction.options.getInteger('duration');
      const deleteMessageDays = interaction.options.getInteger('delete_messages') || 0;
      const lang = i18n.getGuildLanguage(guildId);

      // Check if user is already banned
      const existingBan = await guild.bans.fetch(user.id).catch(() => null);

      if (existingBan) {
        await interaction.reply({
          content: i18n.t('ban.already_banned', lang),
          ephemeral: true,
        });

        return;
      }

      // Get member object (if still in server)
      const member = await guild.members.fetch(user.id).catch(() => null);

      // Validation checks
      if (user.id === interaction.user.id) {
        await interaction.reply({
          content: i18n.t('ban.cannot_ban_self', lang),
          ephemeral: true,
        });

        return;
      }

      if (user.id === this.client.user!.id) {
        await interaction.reply({
          content: i18n.t('ban.cannot_ban_bot', lang),
          ephemeral: true,
        });

        return;
      }

      if (user.id === guild.ownerId) {
        await interaction.reply({
          content: i18n.t('ban.cannot_ban_owner', lang),
          ephemeral: true,
        });

        return;
      }

      // Check role hierarchy (if member is still in server)
      if (member) {
        const moderator = interaction.member as GuildMember;

        if ((member.roles as any).highest.position >= (moderator.roles as any).highest.position) {
          await interaction.reply({
            content: i18n.t('ban.insufficient_permissions', lang),
            ephemeral: true,
          });

          return;
        }

        // Check if member is bannable
        if (!member.bannable) {
          await interaction.reply({
            content: i18n.t('ban.cannot_ban_member', lang),
            ephemeral: true,
          });

          return;
        }
      }

      // Perform the ban
      await this.client.moderation.banUser(
        guild,
        user,
        interaction.user,
        reason,
        duration || undefined,
        deleteMessageDays
      );

      // Success response
      const embed = new EmbedBuilder()
        .setTitle(i18n.t('ban.success_title', lang))
        .setColor(Colors.Red)
        .setDescription(
          i18n.t('ban.success_description', lang, {
            user: user.tag,
            reason,
          })
        )
        .addFields(
          {
            name: i18n.t('ban.banned_user', lang),
            value: `${user.toString()} (${user.tag})`,
            inline: true,
          },
          {
            name: i18n.t('ban.moderator', lang),
            value: interaction.user.toString(),
            inline: true,
          },
          {
            name: i18n.t('ban.reason', lang),
            value: reason,
            inline: false,
          }
        )
        .setFooter({
          text: i18n.t('ban.footer', lang),
          iconURL: interaction.user.displayAvatarURL(),
        })
        .setTimestamp();

      if (duration) {
        embed.addFields({
          name: i18n.t('ban.duration', lang),
          value: i18n.t('ban.duration_value', lang, { minutes: duration.toString() }),
          inline: true,
        });
      } else {
        embed.addFields({
          name: i18n.t('ban.duration', lang),
          value: i18n.t('ban.permanent', lang),
          inline: true,
        });
      }

      if (deleteMessageDays > 0) {
        embed.addFields({
          name: i18n.t('ban.deleted_messages', lang),
          value: i18n.t('ban.deleted_messages_value', lang, { days: deleteMessageDays.toString() }),
          inline: true,
        });
      }

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      await this.client.errorHandler.handleCommandError(error as Error, interaction, {
        command: 'ban',
      });
    }
  }
}
