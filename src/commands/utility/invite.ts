import {
  SlashCommandBuilder,
  EmbedBuilder,
  Colors,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChatInputCommandInteraction,
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class InviteCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'invite',
      description: 'Get bot invite link and useful links',
      category: 'utility',
      permissions: { user: [], bot: [] },
      cooldown: 5,
      ownerOnly: false,
      guildOnly: false,
    });
  }

  public data(): SlashCommandBuilder {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription(i18n.t('commands.invite.description', 'global'));
  }

  public async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const guildId = interaction.guild?.id || 'global';

      // Generate invite link with necessary permissions
      const permissions = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.SendMessagesInThreads,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.UseExternalEmojis,
        PermissionFlagsBits.AddReactions,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageRoles,
        PermissionFlagsBits.KickMembers,
        PermissionFlagsBits.BanMembers,
        PermissionFlagsBits.ModerateMembers,
        PermissionFlagsBits.ViewAuditLog,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.MoveMembers,
      ];

      const permissionValue = permissions.reduce((acc, perm) => acc | perm, 0n);
      const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${this.client.user?.id}&permissions=${permissionValue}&scope=bot%20applications.commands`;

      const embed = new EmbedBuilder()
        .setColor(Colors.Blue)
        .setTitle(i18n.t('commands.invite.title', guildId))
        .setDescription(i18n.t('commands.invite.description_text', guildId))
        .addFields(
          {
            name: i18n.t('commands.invite.features_title', guildId),
            value: i18n.t('commands.invite.features_list', guildId),
            inline: false,
          },
          {
            name: i18n.t('commands.invite.permissions_title', guildId),
            value: i18n.t('commands.invite.permissions_text', guildId),
            inline: false,
          }
        )
        .setTimestamp();

      if (this.client.user?.displayAvatarURL()) {
        embed.setThumbnail(this.client.user.displayAvatarURL());
        embed.setFooter({
          text: i18n.t('commands.invite.footer', guildId),
          iconURL: this.client.user.displayAvatarURL(),
        });
      }

      // Create action buttons
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setURL(inviteUrl)
          .setLabel(i18n.t('commands.invite.invite_button', guildId))
          .setStyle(ButtonStyle.Link)
          .setEmoji('🤖'),
        new ButtonBuilder()
          .setURL('https://discord.gg/korex') // Replace with actual support server
          .setLabel(i18n.t('commands.invite.support_button', guildId))
          .setStyle(ButtonStyle.Link)
          .setEmoji('🆘'),
        new ButtonBuilder()
          .setURL('https://korex.dev') // Replace with actual website
          .setLabel(i18n.t('commands.invite.website_button', guildId))
          .setStyle(ButtonStyle.Link)
          .setEmoji('🌐')
      );

      // Add vote button if available
      const voteRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setURL('https://top.gg/bot/korex') // Replace with actual top.gg link
          .setLabel(i18n.t('commands.invite.vote_button', guildId))
          .setStyle(ButtonStyle.Link)
          .setEmoji('⭐'),
        new ButtonBuilder()
          .setURL('https://github.com/korex-bot') // Replace with actual GitHub
          .setLabel(i18n.t('commands.invite.github_button', guildId))
          .setStyle(ButtonStyle.Link)
          .setEmoji('📚')
      );

      await interaction.reply({
        embeds: [embed],
        components: [row, voteRow],
      });
    } catch (error) {
      await interaction.reply({
        content: i18n.t('common.error', interaction.guild?.id || 'global'),
        ephemeral: true,
      });
    }
  }
}
