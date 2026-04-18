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

export default class KickCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'kick',
      description: 'Kick a member from the server',
      category: 'admin',
      permissions: {
        user: [PermissionFlagsBits.KickMembers],
        bot: [PermissionFlagsBits.KickMembers],
      },
      cooldown: 5,
      guildOnly: true,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('kick')
      .setDescription('Kick a member from the server')
      .addUserOption((option) =>
        option.setName('user').setDescription('User to kick').setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName('reason')
          .setDescription('Reason for the kick')
          .setRequired(false)
          .setMaxLength(500)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers);
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const guild = interaction.guild!;
      const guildId = guild.id;
      const user = interaction.options.getUser('user', true);
      const reason =
        interaction.options.getString('reason') ||
        i18n.t('kick.no_reason', i18n.getGuildLanguage(guildId));
      const lang = i18n.getGuildLanguage(guildId);

      // Get member object
      const member = await guild.members.fetch(user.id).catch(() => null);

      if (!member) {
        await interaction.reply({
          content: i18n.t('kick.user_not_found', lang),
          ephemeral: true,
        });

        return;
      }

      // Validation checks
      if (user.id === interaction.user.id) {
        await interaction.reply({
          content: i18n.t('kick.cannot_kick_self', lang),
          ephemeral: true,
        });

        return;
      }

      if (user.id === this.client.user!.id) {
        await interaction.reply({
          content: i18n.t('kick.cannot_kick_bot', lang),
          ephemeral: true,
        });

        return;
      }

      if (user.id === guild.ownerId) {
        await interaction.reply({
          content: i18n.t('kick.cannot_kick_owner', lang),
          ephemeral: true,
        });

        return;
      }

      // Check role hierarchy
      const moderator = interaction.member as GuildMember;

      if ((member.roles as any).highest.position >= (moderator.roles as any).highest.position) {
        await interaction.reply({
          content: i18n.t('kick.insufficient_permissions', lang),
          ephemeral: true,
        });

        return;
      }

      // Check if member is kickable
      if (!member.kickable) {
        await interaction.reply({
          content: i18n.t('kick.cannot_kick_member', lang),
          ephemeral: true,
        });

        return;
      }

      // Perform the kick
      await this.client.moderation.kickUser(guild, member, interaction.user, reason);

      // Success response
      const embed = new EmbedBuilder()
        .setTitle(i18n.t('kick.success_title', lang))
        .setColor(Colors.Orange)
        .setDescription(
          i18n.t('kick.success_description', lang, {
            user: user.tag,
            reason,
          })
        )
        .addFields(
          {
            name: i18n.t('kick.kicked_user', lang),
            value: `${user.toString()} (${user.tag})`,
            inline: true,
          },
          {
            name: i18n.t('kick.moderator', lang),
            value: interaction.user.toString(),
            inline: true,
          },
          {
            name: i18n.t('kick.reason', lang),
            value: reason,
            inline: false,
          }
        )
        .setFooter({
          text: i18n.t('kick.footer', lang),
          iconURL: interaction.user.displayAvatarURL(),
        })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      await this.client.errorHandler.handleCommandError(error as Error, interaction, {
        command: 'kick',
      });
    }
  }
}
