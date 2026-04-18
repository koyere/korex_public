import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  Colors,
  User,
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class ModLogsCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'modlogs',
      description: 'View user moderation history',
      category: 'admin',
      permissions: {
        user: [PermissionFlagsBits.ModerateMembers],
      },
      cooldown: 5,
      guildOnly: true,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('modlogs')
      .setDescription('View user moderation history')
      .addUserOption((option) =>
        option.setName('user').setDescription('User to view history for').setRequired(true)
      )
      .addIntegerOption((option) =>
        option
          .setName('limit')
          .setDescription('Number of entries to show (default: 10)')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(25)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const user = interaction.options.getUser('user', true);
      const limit = interaction.options.getInteger('limit') || 10;
      const guildId = interaction.guild!.id;
      const lang = i18n.getGuildLanguage(guildId);

      const actions = await this.client.moderation.getUserModerationHistory(
        guildId,
        user.id,
        limit
      );

      if (actions.length === 0) {
        await interaction.reply({
          content: i18n.t('modlogs.no_history', lang, { user: user.tag }),
          ephemeral: true,
        });

        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(i18n.t('modlogs.title', lang, { user: user.tag }))
        .setColor(Colors.Orange)
        .setThumbnail(user.displayAvatarURL())
        .setDescription(i18n.t('modlogs.description', lang, { count: actions.length.toString() }));

      for (const action of actions) {
        const moderator = await this.client.users.fetch(action.moderatorId).catch(() => null);
        const timestamp = `<t:${Math.floor(action.createdAt.getTime() / 1000)}:R>`;

        let value = `**Moderator:** ${moderator?.tag || 'Unknown'}\n`;

        value += `**Reason:** ${action.reason}\n`;
        value += `**Time:** ${timestamp}`;

        if (action.duration) {
          value += `\n**Duration:** ${action.duration} minutes`;
        }

        embed.addFields({
          name: `${this.getActionEmoji(action.type)} ${action.type}`,
          value,
          inline: false,
        });
      }

      embed.setFooter({
        text: i18n.t('modlogs.footer', lang, {
          requested_by: interaction.user.tag,
        }),
        iconURL: interaction.user.displayAvatarURL(),
      });

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      await this.client.errorHandler.handleCommandError(error as Error, interaction, {
        command: 'modlogs',
      });
    }
  }

  private getActionEmoji(action: string): string {
    const emojis: Record<string, string> = {
      WARN: '⚠️',
      MUTE: '🔇',
      KICK: '👢',
      BAN: '🔨',
      UNBAN: '🔓',
      UNMUTE: '🔊',
    };

    return emojis[action] || '📝';
  }
}
