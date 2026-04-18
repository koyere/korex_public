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

export default class UnmuteCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'unmute',
      description: 'Unmute a member',
      category: 'admin',
      permissions: {
        user: [PermissionFlagsBits.ModerateMembers],
        bot: [PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.ManageRoles],
      },
      cooldown: 5,
      guildOnly: true,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('unmute')
      .setDescription('Unmute a member')
      .addUserOption((option) =>
        option.setName('user').setDescription('User to unmute').setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName('reason')
          .setDescription('Reason for the unmute')
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
      const reason =
        interaction.options.getString('reason') ||
        i18n.t('unmute.no_reason', i18n.getGuildLanguage(guildId));
      const lang = i18n.getGuildLanguage(guildId);

      // Get member object
      const member = await guild.members.fetch(user.id).catch(() => null);

      if (!member) {
        await interaction.reply({
          content: i18n.t('unmute.user_not_found', lang),
          ephemeral: true,
        });

        return;
      }

      // Get moderation config to find mute role
      const config = await this.client.moderation.getModerationConfig(guildId);

      if (!config.muteRoleId) {
        await interaction.reply({
          content: i18n.t('unmute.no_mute_role', lang),
          ephemeral: true,
        });

        return;
      }

      const muteRole = guild.roles.cache.get(config.muteRoleId);

      if (!muteRole) {
        await interaction.reply({
          content: i18n.t('unmute.mute_role_not_found', lang),
          ephemeral: true,
        });

        return;
      }

      // Check if user is actually muted
      if (!member.roles.cache.has(muteRole.id)) {
        await interaction.reply({
          content: i18n.t('unmute.user_not_muted', lang),
          ephemeral: true,
        });

        return;
      }

      // Validation checks
      if (user.id === interaction.user.id) {
        await interaction.reply({
          content: i18n.t('unmute.cannot_unmute_self', lang),
          ephemeral: true,
        });

        return;
      }

      if (user.id === this.client.user!.id) {
        await interaction.reply({
          content: i18n.t('unmute.cannot_unmute_bot', lang),
          ephemeral: true,
        });

        return;
      }

      // Check role hierarchy
      const moderator = interaction.member as GuildMember;

      if ((member.roles as any).highest.position >= (moderator.roles as any).highest.position) {
        await interaction.reply({
          content: i18n.t('unmute.insufficient_permissions', lang),
          ephemeral: true,
        });

        return;
      }

      // Perform the unmute
      await this.client.moderation.unmuteUser(guild, member, interaction.user, reason);

      // Success response
      const embed = new EmbedBuilder()
        .setTitle(i18n.t('unmute.success_title', lang))
        .setColor(Colors.Green)
        .setDescription(
          i18n.t('unmute.success_description', lang, {
            user: user.tag,
            reason,
          })
        )
        .addFields(
          {
            name: i18n.t('unmute.unmuted_user', lang),
            value: `${user.toString()} (${user.tag})`,
            inline: true,
          },
          {
            name: i18n.t('unmute.moderator', lang),
            value: interaction.user.toString(),
            inline: true,
          },
          {
            name: i18n.t('unmute.reason', lang),
            value: reason,
            inline: false,
          }
        )
        .setFooter({
          text: i18n.t('unmute.footer', lang),
          iconURL: interaction.user.displayAvatarURL(),
        })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      await this.client.errorHandler.handleCommandError(error as Error, interaction, {
        command: 'unmute',
      });
    }
  }
}
