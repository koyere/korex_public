import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  User,
  GuildMember
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { botConfig } from '../../config/bot.config';

export default class TempBanCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'tempban',
      description: 'Temporarily ban a user with automatic unban',
      category: 'moderation',
      cooldown: 5,
      permissions: {
        user: [PermissionFlagsBits.BanMembers],
        bot: [PermissionFlagsBits.BanMembers]
      }
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription(i18n.t(`commands.${this.name}.description`, 'global'))
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription(i18n.t(`commands.${this.name}.user_option`, 'global'))
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('duration')
          .setDescription(i18n.t(`commands.${this.name}.duration_option`, 'global'))
          .setRequired(true)
          .addChoices(
            { name: '1 hour', value: '1h' },
            { name: '6 hours', value: '6h' },
            { name: '12 hours', value: '12h' },
            { name: '1 day', value: '1d' },
            { name: '3 days', value: '3d' },
            { name: '7 days', value: '7d' },
            { name: '14 days', value: '14d' },
            { name: '30 days', value: '30d' }
          )
      )
      .addStringOption(option =>
        option
          .setName('reason')
          .setDescription(i18n.t(`commands.${this.name}.reason_option`, 'global'))
          .setRequired(false)
          .setMaxLength(500)
      )
      .addIntegerOption(option =>
        option
          .setName('delete_days')
          .setDescription(i18n.t(`commands.${this.name}.delete_days_option`, 'global'))
          .setMinValue(0)
          .setMaxValue(7)
          .setRequired(false)
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const targetUser = interaction.options.getUser('user', true);
    const duration = interaction.options.getString('duration', true);
    const reason = interaction.options.getString('reason') || i18n.t('commands.tempban.no_reason', guildId);
    const deleteDays = interaction.options.getInteger('delete_days') || 0;

    // Parse duration
    const durationMs = this.parseDuration(duration);

    if (!durationMs) {
      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.error)
        .setTitle(`❌ ${i18n.t('commands.tempban.error_title', guildId)}`)
        .setDescription(i18n.t('commands.tempban.invalid_duration', guildId))
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });

      return;
    }

    // Check if user is bannable
    const member = await interaction.guild!.members.fetch(targetUser.id).catch(() => null);

    if (member) {
      // Check hierarchy
      const moderatorMember = interaction.member as GuildMember;

      if (member.roles.highest.position >= moderatorMember.roles.highest.position) {
        const embed = new EmbedBuilder()
          .setColor(botConfig.colors.error)
          .setTitle(`❌ ${i18n.t('commands.tempban.error_title', guildId)}`)
          .setDescription(i18n.t('commands.tempban.hierarchy_error', guildId))
          .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });

        return;
      }

      // Can't ban guild owner
      if (member.id === interaction.guild!.ownerId) {
        const embed = new EmbedBuilder()
          .setColor(botConfig.colors.error)
          .setTitle(`❌ ${i18n.t('commands.tempban.error_title', guildId)}`)
          .setDescription(i18n.t('commands.tempban.owner_error', guildId))
          .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });

        return;
      }

      // Can't ban bots with higher permissions
      if (targetUser.bot && !member.manageable) {
        const embed = new EmbedBuilder()
          .setColor(botConfig.colors.error)
          .setTitle(`❌ ${i18n.t('commands.tempban.error_title', guildId)}`)
          .setDescription(i18n.t('commands.tempban.bot_error', guildId))
          .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });

        return;
      }
    }

    // Check if user is already banned
    const existingBan = await interaction.guild!.bans.fetch(targetUser.id).catch(() => null);

    if (existingBan) {
      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.error)
        .setTitle(`❌ ${i18n.t('commands.tempban.error_title', guildId)}`)
        .setDescription(i18n.t('commands.tempban.already_banned', guildId, { user: targetUser.tag }))
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });

      return;
    }

    try {
      // Send DM to user before banning
      try {
        const dmEmbed = new EmbedBuilder()
          .setColor(botConfig.colors.warning)
          .setTitle(`⚠️ ${i18n.t('commands.tempban.dm_title', guildId)}`)
          .setDescription(i18n.t('commands.tempban.dm_desc', guildId, {
            server: interaction.guild!.name,
            duration: this.formatDuration(durationMs, guildId),
            reason
          }))
          .addFields(
            { name: i18n.t('commands.tempban.moderator', guildId), value: interaction.user.tag, inline: true },
            { name: i18n.t('commands.tempban.duration', guildId), value: this.formatDuration(durationMs, guildId), inline: true },
            { name: i18n.t('commands.tempban.reason', guildId), value: reason, inline: false }
          )
          .setTimestamp();

        await targetUser.send({ embeds: [dmEmbed] });
      } catch (error) {
        // User has DMs disabled, continue with ban
      }

      // Ban the user
      await interaction.guild!.members.ban(targetUser, {
        reason: `Temporary ban by ${interaction.user.tag}: ${reason} (Duration: ${this.formatDuration(durationMs, guildId)})`,
        deleteMessageDays: deleteDays
      });

      // Schedule unban
      setTimeout(async () => {
        try {
          await interaction.guild!.members.unban(targetUser.id, `Automatic unban after ${this.formatDuration(durationMs, guildId)}`);
          
          // Log automatic unban
          this.client.logger.info(`Automatic unban executed for ${targetUser.tag} in ${interaction.guild!.name}`);
        } catch (error) {
          this.client.logger.error(`Failed to automatically unban ${targetUser.tag}:`, error);
        }
      }, durationMs);

      // Create success embed
      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.warning)
        .setTitle(`🔨 ${i18n.t('commands.tempban.success_title', guildId)}`)
        .setDescription(i18n.t('commands.tempban.success_desc', guildId, {
          user: targetUser.tag,
          duration: this.formatDuration(durationMs, guildId)
        }))
        .addFields(
          { name: i18n.t('commands.tempban.user', guildId), value: `${targetUser.tag} (${targetUser.id})`, inline: true },
          { name: i18n.t('commands.tempban.moderator', guildId), value: interaction.user.toString(), inline: true },
          { name: i18n.t('commands.tempban.duration', guildId), value: this.formatDuration(durationMs, guildId), inline: true },
          { name: i18n.t('commands.tempban.unban_time', guildId), value: `<t:${Math.floor((Date.now() + durationMs) / 1000)}:F>`, inline: true },
          { name: i18n.t('commands.tempban.reason', guildId), value: reason, inline: false }
        )
        .setThumbnail(targetUser.displayAvatarURL())
        .setTimestamp();

      if (deleteDays > 0) {
        embed.addFields({
          name: i18n.t('commands.tempban.deleted_messages', guildId),
          value: i18n.t('commands.tempban.deleted_days', guildId, { days: deleteDays.toString() }),
          inline: true
        });
      }

      await interaction.reply({ embeds: [embed] });

      // Log the action
      this.client.logger.info(`Temporary ban executed by ${interaction.user.tag} in ${interaction.guild!.name}: ${targetUser.tag} for ${this.formatDuration(durationMs, guildId)}`);

    } catch (error) {
      this.client.logger.error('Error executing temporary ban:', error);

      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.error)
        .setTitle(`❌ ${i18n.t('commands.tempban.error_title', guildId)}`)
        .setDescription(i18n.t('commands.tempban.error_desc', guildId))
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }

  private parseDuration(duration: string): number | null {
    const durations: { [key: string]: number } = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '12h': 12 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '3d': 3 * 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '14d': 14 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    };

    return durations[duration] || null;
  }

  private formatDuration(ms: number, guildId: string): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return i18n.t('commands.tempban.format_days', guildId, { days: days.toString() });
    } else if (hours > 0) {
      return i18n.t('commands.tempban.format_hours', guildId, { hours: hours.toString() });
    } else if (minutes > 0) {
      return i18n.t('commands.tempban.format_minutes', guildId, { minutes: minutes.toString() });
    } else {
      return i18n.t('commands.tempban.format_seconds', guildId, { seconds: seconds.toString() });
    }
  }
}