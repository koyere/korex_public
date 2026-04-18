import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
  GuildMember,
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class UserInfoCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'userinfo',
      description: 'Shows user information',
      category: 'utility',
      cooldown: 3,
      guildOnly: true,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('userinfo')
      .setDescription('Shows user information')
      .addUserOption((option) =>
        option.setName('user').setDescription('User to view information for (optional)')
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const guildId = interaction.guild!.id;
      const lang = i18n.getGuildLanguage(guildId);

      const member = await interaction.guild!.members.fetch(targetUser.id).catch(() => null);

      if (!member) {
        await interaction.reply({
          content: i18n.t('userinfo.not_found', lang),
          ephemeral: true,
        });

        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(i18n.t('userinfo.title', lang, { user: targetUser.tag }))
        .setColor(member.displayHexColor || Colors.Blue)
        .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
        .addFields(
          {
            name: i18n.t('userinfo.id', lang),
            value: targetUser.id,
            inline: true,
          },
          {
            name: i18n.t('userinfo.created', lang),
            value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:R>`,
            inline: true,
          },
          {
            name: i18n.t('userinfo.joined', lang),
            value: member.joinedTimestamp
              ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
              : 'Unknown',
            inline: true,
          }
        );

      // Roles
      const roles = member.roles.cache
        .filter((role) => role.id !== interaction.guild!.id)
        .sort((a, b) => b.position - a.position)
        .map((role) => role.toString())
        .slice(0, 10);

      if (roles.length > 0) {
        embed.addFields({
          name: i18n.t('userinfo.roles', lang, { count: (member.roles.cache.size - 1).toString() }),
          value: roles.join(', ') + (member.roles.cache.size > 11 ? '...' : ''),
          inline: false,
        });
      }

      // Permissions
      if (member.permissions.has('Administrator')) {
        embed.addFields({
          name: i18n.t('userinfo.permissions', lang),
          value: i18n.t('userinfo.administrator', lang),
          inline: true,
        });
      }

      // Status and activities
      const presence = member.presence;

      if (presence) {
        embed.addFields({
          name: i18n.t('userinfo.status', lang),
          value: `${this.getStatusEmoji(presence.status)} ${this.capitalizeFirst(presence.status)}`,
          inline: true,
        });

        if (presence.activities.length > 0) {
          const activity = presence.activities[0];

          embed.addFields({
            name: i18n.t('userinfo.activity', lang),
            value: `${activity.type === 0 ? 'Playing' : activity.type === 1 ? 'Streaming' : activity.type === 2 ? 'Listening to' : activity.type === 3 ? 'Watching' : 'Custom'} ${activity.name}`,
            inline: true,
          });
        }
      }

      // Fetch full user for banner
      try {
        const fetchedUser = await this.client.users.fetch(targetUser.id, { force: true });

        if (fetchedUser.bannerURL({ size: 1024 })) {
          embed.setImage(fetchedUser.bannerURL({ size: 1024 })!);
        }
      } catch (error) {
        // Ignore banner fetch errors
      }

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      await this.client.errorHandler.handleCommandError(error as Error, interaction, {
        command: 'userinfo',
      });
    }
  }

  private getStatusEmoji(status: string): string {
    const emojis: Record<string, string> = {
      online: '🟢',
      idle: '🟡',
      dnd: '🔴',
      offline: '⚫',
    };

    return emojis[status] || '⚫';
  }

  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
