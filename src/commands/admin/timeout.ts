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

export default class TimeoutCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'timeout',
      description: "Timeout a member using Discord's built-in timeout feature",
      category: 'admin',
      permissions: {
        user: [PermissionFlagsBits.ModerateMembers],
        bot: [PermissionFlagsBits.ModerateMembers],
      },
      cooldown: 5,
      guildOnly: true,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('timeout')
      .setDescription("Timeout a member using Discord's built-in timeout feature")
      .addUserOption((option) =>
        option.setName('user').setDescription('User to timeout').setRequired(true)
      )
      .addIntegerOption(
        (option) =>
          option
            .setName('duration')
            .setDescription('Timeout duration in minutes')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(40320) // 28 days max
      )
      .addStringOption((option) =>
        option
          .setName('reason')
          .setDescription('Reason for the timeout')
          .setRequired(false)
          .setMaxLength(500)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const guild = interaction.guild!;
      const guildId = guild.id;
      const user = interaction.options.getUser('user', true);
      const duration = interaction.options.getInteger('duration', true);
      const reason =
        interaction.options.getString('reason') ||
        i18n.t('timeout.no_reason', i18n.getGuildLanguage(guildId));
      const lang = i18n.getGuildLanguage(guildId);

      // Get member object
      const member = await guild.members.fetch(user.id).catch(() => null);

      if (!member) {
        await interaction.reply({
          content: i18n.t('timeout.user_not_found', lang),
          ephemeral: true,
        });

        return;
      }

      // Validation checks
      if (user.id === interaction.user.id) {
        await interaction.reply({
          content: i18n.t('timeout.cannot_timeout_self', lang),
          ephemeral: true,
        });

        return;
      }

      if (user.id === this.client.user!.id) {
        await interaction.reply({
          content: i18n.t('timeout.cannot_timeout_bot', lang),
          ephemeral: true,
        });

        return;
      }

      if (user.id === guild.ownerId) {
        await interaction.reply({
          content: i18n.t('timeout.cannot_timeout_owner', lang),
          ephemeral: true,
        });

        return;
      }

      // Check role hierarchy
      const moderator = interaction.member as GuildMember;

      if ((member.roles as any).highest.position >= (moderator.roles as any).highest.position) {
        await interaction.reply({
          content: i18n.t('timeout.insufficient_permissions', lang),
          ephemeral: true,
        });

        return;
      }

      // Check if member is moderatable
      if (!member.moderatable) {
        await interaction.reply({
          content: i18n.t('timeout.cannot_timeout_member', lang),
          ephemeral: true,
        });

        return;
      }

      // Check if user is already timed out
      if (member.communicationDisabledUntil && member.communicationDisabledUntil > new Date()) {
        await interaction.reply({
          content: i18n.t('timeout.already_timed_out', lang),
          ephemeral: true,
        });

        return;
      }

      // Calculate timeout end time
      const timeoutEnd = new Date(Date.now() + duration * 60 * 1000);

      // Perform the timeout
      await member.timeout(duration * 60 * 1000, reason);

      // The timeout is logged automatically by Discord, no need for manual logging

      // Success response
      const embed = new EmbedBuilder()
        .setTitle(i18n.t('timeout.success_title', lang))
        .setColor(Colors.Orange)
        .setDescription(
          i18n.t('timeout.success_description', lang, {
            user: user.tag,
            duration: duration.toString(),
            reason,
          })
        )
        .addFields(
          {
            name: i18n.t('timeout.timed_out_user', lang),
            value: `${user.toString()} (${user.tag})`,
            inline: true,
          },
          {
            name: i18n.t('timeout.moderator', lang),
            value: interaction.user.toString(),
            inline: true,
          },
          {
            name: i18n.t('timeout.duration', lang),
            value: i18n.t('timeout.duration_value', lang, { minutes: duration.toString() }),
            inline: true,
          },
          {
            name: i18n.t('timeout.ends_at', lang),
            value: `<t:${Math.floor(timeoutEnd.getTime() / 1000)}:F>`,
            inline: true,
          },
          {
            name: i18n.t('timeout.reason', lang),
            value: reason,
            inline: false,
          }
        )
        .setFooter({
          text: i18n.t('timeout.footer', lang),
          iconURL: interaction.user.displayAvatarURL(),
        })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      // Try to send DM to user
      try {
        const dmEmbed = new EmbedBuilder()
          .setTitle(i18n.t('timeout.dm_title', lang))
          .setColor(Colors.Orange)
          .setDescription(
            i18n.t('timeout.dm_description', lang, {
              server: guild.name,
              duration: duration.toString(),
              reason,
            })
          )
          .addFields({
            name: i18n.t('timeout.dm_ends_at', lang),
            value: `<t:${Math.floor(timeoutEnd.getTime() / 1000)}:F>`,
            inline: false,
          })
          .setTimestamp();

        await user.send({ embeds: [dmEmbed] });
      } catch (error) {
        // User has DMs disabled, ignore
      }
    } catch (error) {
      await this.client.errorHandler.handleCommandError(error as Error, interaction, {
        command: 'timeout',
      });
    }
  }
}
