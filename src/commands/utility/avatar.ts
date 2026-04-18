import {
  SlashCommandBuilder,
  EmbedBuilder,
  Colors,
  User,
  GuildMember,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class AvatarCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'avatar',
      description: 'Shows user avatar',
      category: 'utility',
      permissions: { user: [], bot: [] },
      cooldown: 3,
      ownerOnly: false,
      guildOnly: false,
    });
  }

  public data(): SlashCommandBuilder {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription(i18n.t('commands.avatar.description', 'global'))
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription(i18n.t('commands.avatar.user_option', 'global'))
          .setRequired(false)
      )
      .addBooleanOption((option) =>
        option
          .setName('server')
          .setDescription(i18n.t('commands.avatar.server_option', 'global'))
          .setRequired(false)
      ) as SlashCommandBuilder;
  }

  public async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const showServerAvatar = interaction.options.getBoolean('server') || false;
      const guildId = interaction.guild?.id || 'global';

      let member: GuildMember | null = null;

      if (interaction.guild && showServerAvatar) {
        member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      }

      // Get avatars
      const globalAvatar = targetUser.displayAvatarURL({ size: 4096, extension: 'png' });
      const serverAvatar = member?.avatarURL({ size: 4096, extension: 'png' });

      const embed = new EmbedBuilder()
        .setColor(Colors.Blue)
        .setTitle(i18n.t('commands.avatar.title', guildId, { user: targetUser.tag }))
        .setTimestamp()
        .setFooter({
          text: i18n.t('commands.avatar.requested_by', guildId, { user: interaction.user.tag }),
          iconURL: interaction.user.displayAvatarURL(),
        });

      // Show server avatar if available and requested
      if (serverAvatar && showServerAvatar) {
        embed
          .setImage(serverAvatar)
          .setDescription(i18n.t('commands.avatar.server_avatar', guildId));
      } else {
        embed
          .setImage(globalAvatar)
          .setDescription(i18n.t('commands.avatar.global_avatar', guildId));
      }

      // Create buttons for different avatar types
      const components: ActionRowBuilder<ButtonBuilder>[] = [];

      if (member && serverAvatar && serverAvatar !== globalAvatar) {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`avatar_global_${targetUser.id}`)
            .setLabel(i18n.t('commands.avatar.global_button', guildId))
            .setStyle(showServerAvatar ? ButtonStyle.Secondary : ButtonStyle.Primary)
            .setEmoji('🌐'),
          new ButtonBuilder()
            .setCustomId(`avatar_server_${targetUser.id}`)
            .setLabel(i18n.t('commands.avatar.server_button', guildId))
            .setStyle(showServerAvatar ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setEmoji('🏠'),
          new ButtonBuilder()
            .setURL(showServerAvatar ? serverAvatar : globalAvatar)
            .setLabel(i18n.t('commands.avatar.download', guildId))
            .setStyle(ButtonStyle.Link)
            .setEmoji('⬇️')
        );

        components.push(row);
      } else {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setURL(globalAvatar)
            .setLabel(i18n.t('commands.avatar.download', guildId))
            .setStyle(ButtonStyle.Link)
            .setEmoji('⬇️')
        );

        components.push(row);
      }

      const replyOptions: any = {
        embeds: [embed],
      };

      if (components.length > 0) {
        replyOptions.components = components;
      }

      await interaction.reply(replyOptions);
    } catch (error) {
      await interaction.reply({
        content: i18n.t('common.error', interaction.guild?.id || 'global'),
        ephemeral: true,
      });
    }
  }
}
