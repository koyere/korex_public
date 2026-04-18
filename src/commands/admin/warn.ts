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

export default class WarnCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'warn',
      description: 'Warn a user',
      category: 'admin',
      permissions: {
        user: [PermissionFlagsBits.ModerateMembers],
      },
      cooldown: 3,
      guildOnly: true,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('warn')
      .setDescription('Warn a user')
      .addUserOption((option) =>
        option.setName('user').setDescription('User to warn').setRequired(true)
      )
      .addStringOption((option) =>
        option.setName('reason').setDescription('Reason for warning').setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason', true);
      const guildId = interaction.guild!.id;
      const lang = i18n.getGuildLanguage(guildId);

      const member = await interaction.guild!.members.fetch(user.id).catch(() => null);

      if (!member) {
        await interaction.reply({
          content: i18n.t('warn.user_not_found', lang),
          ephemeral: true,
        });

        return;
      }

      // Check if user can be moderated
      if (
        (member.roles as any).highest.position >=
        (interaction.member!.roles as any).highest.position
      ) {
        await interaction.reply({
          content: i18n.t('warn.cannot_moderate', lang),
          ephemeral: true,
        });

        return;
      }

      const action = await this.client.moderation.warnUser(
        interaction.guild!,
        user,
        interaction.user,
        reason
      );

      const embed = new EmbedBuilder()
        .setTitle(i18n.t('warn.success_title', lang))
        .setColor(Colors.Yellow)
        .setDescription(
          i18n.t('warn.success_description', lang, {
            user: user.tag,
            reason,
          })
        )
        .addFields(
          {
            name: i18n.t('warn.moderator', lang),
            value: interaction.user.tag,
            inline: true,
          },
          {
            name: i18n.t('warn.case_id', lang),
            value: action.id,
            inline: true,
          }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      await this.client.errorHandler.handleCommandError(error as Error, interaction, {
        command: 'warn',
      });
    }
  }
}
