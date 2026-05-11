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

export default class MuteCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'mute',
      description: 'Mute a user',
      category: 'admin',
      permissions: {
        user: [PermissionFlagsBits.ModerateMembers],
        bot: [PermissionFlagsBits.ManageRoles],
      },
      cooldown: 3,
      guildOnly: true,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('mute')
      .setDescription('Mute a user')
      .addUserOption((option) =>
        option.setName('user').setDescription('User to mute').setRequired(true)
      )
      .addStringOption((option) =>
        option.setName('reason').setDescription('Reason for mute').setRequired(true)
      )
      .addIntegerOption(
        (option) =>
          option
            .setName('duration')
            .setDescription('Duration in minutes (optional)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(40320) // 28 days
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason', true);
      const duration = interaction.options.getInteger('duration');
      const guildId = interaction.guild!.id;
      const lang = i18n.getGuildLanguage(guildId);

      const member = await interaction.guild!.members.fetch(user.id).catch(() => null);

      if (!member) {
        await interaction.reply({
          content: i18n.t('mute.user_not_found', lang),
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
          content: i18n.t('mute.cannot_moderate', lang),
          ephemeral: true,
        });

        return;
      }

      if (!member.moderatable) {
        await interaction.reply({
          content: i18n.t('mute.bot_cannot_moderate', lang),
          ephemeral: true,
        });

        return;
      }

      const action = await this.client.moderation.muteUser(
        interaction.guild!,
        member,
        interaction.user,
        reason,
        duration || undefined
      );

      const embed = new EmbedBuilder()
        .setTitle(i18n.t('mute.success_title', lang))
        .setColor(Colors.Orange)
        .setDescription(
          i18n.t('mute.success_description', lang, {
            user: user.tag,
            reason,
          })
        )
        .addFields({
          name: i18n.t('mute.moderator', lang),
          value: interaction.user.tag,
          inline: true,
        })
        .setTimestamp();

      if (duration) {
        embed.addFields({
          name: i18n.t('mute.duration', lang),
          value: i18n.t('mute.duration_value', lang, { minutes: duration.toString() }),
          inline: true,
        });
      }

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      await this.client.errorHandler.handleCommandError(error as Error, interaction, {
        command: 'mute',
      });
    }
  }
}
