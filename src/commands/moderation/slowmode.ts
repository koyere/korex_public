import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  TextChannel,
  NewsChannel,
  ThreadChannel
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { botConfig } from '../../config/bot.config';

export default class SlowmodeCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'slowmode',
      description: 'Set slowmode for a channel',
      category: 'moderation',
      cooldown: 3,
      permissions: {
        user: [PermissionFlagsBits.ManageChannels],
        bot: [PermissionFlagsBits.ManageChannels]
      }
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription(i18n.t(`commands.${this.name}.description`, 'global'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .addIntegerOption(option =>
        option
          .setName('seconds')
          .setDescription(i18n.t(`commands.${this.name}.seconds_option`, 'global'))
          .setMinValue(0)
          .setMaxValue(21600) // 6 hours max
          .setRequired(true)
      )
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription(i18n.t(`commands.${this.name}.channel_option`, 'global'))
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('reason')
          .setDescription(i18n.t(`commands.${this.name}.reason_option`, 'global'))
          .setRequired(false)
          .setMaxLength(500)
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const seconds = interaction.options.getInteger('seconds', true);
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
    const reason = interaction.options.getString('reason') || i18n.t('commands.slowmode.no_reason', guildId);

    // Validate channel type
    if (!targetChannel || !this.isTextBasedChannel(targetChannel)) {
      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.error)
        .setTitle(`❌ ${i18n.t('commands.slowmode.error_title', guildId)}`)
        .setDescription(i18n.t('commands.slowmode.invalid_channel', guildId))
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });

      return;
    }

    const channel = targetChannel as TextChannel | NewsChannel | ThreadChannel;

    try {
      // Set slowmode
      await channel.setRateLimitPerUser(seconds, reason);

      // Create success embed
      const embed = new EmbedBuilder()
        .setColor(seconds > 0 ? botConfig.colors.warning : botConfig.colors.success)
        .setTitle(seconds > 0 ? `🐌 ${i18n.t('commands.slowmode.enabled_title', guildId)}` : `⚡ ${i18n.t('commands.slowmode.disabled_title', guildId)}`)
        .setDescription(
          seconds > 0 
            ? i18n.t('commands.slowmode.enabled_desc', guildId, { 
                channel: channel.toString(), 
                seconds: seconds.toString(),
                duration: this.formatDuration(seconds, guildId)
              })
            : i18n.t('commands.slowmode.disabled_desc', guildId, { channel: channel.toString() })
        )
        .addFields(
          { name: i18n.t('commands.slowmode.moderator', guildId), value: interaction.user.toString(), inline: true },
          { name: i18n.t('commands.slowmode.channel', guildId), value: channel.toString(), inline: true },
          { name: i18n.t('commands.slowmode.reason', guildId), value: reason, inline: false }
        )
        .setTimestamp();

      if (seconds > 0) {
        embed.addFields({
          name: i18n.t('commands.slowmode.duration', guildId),
          value: this.formatDuration(seconds, guildId),
          inline: true
        });
      }

      await interaction.reply({ embeds: [embed] });

      // Log the action
      this.client.logger.info(`Slowmode set by ${interaction.user.tag} in ${channel.name}: ${seconds} seconds`);

    } catch (error) {
      this.client.logger.error('Error setting slowmode:', error);

      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.error)
        .setTitle(`❌ ${i18n.t('commands.slowmode.error_title', guildId)}`)
        .setDescription(i18n.t('commands.slowmode.error_desc', guildId))
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }

  private isTextBasedChannel(channel: any): boolean {
    return channel.isTextBased() && (
      channel.type === 0 || // GUILD_TEXT
      channel.type === 5 || // GUILD_ANNOUNCEMENT
      channel.type === 11 || // GUILD_PUBLIC_THREAD
      channel.type === 12    // GUILD_PRIVATE_THREAD
    );
  }

  private formatDuration(seconds: number, guildId: string): string {
    if (seconds < 60) {
      return i18n.t('commands.slowmode.duration_seconds', guildId, { seconds: seconds.toString() });
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;

      if (remainingSeconds === 0) {
        return i18n.t('commands.slowmode.duration_minutes', guildId, { minutes: minutes.toString() });
      } else {
        return i18n.t('commands.slowmode.duration_minutes_seconds', guildId, { 
          minutes: minutes.toString(), 
          seconds: remainingSeconds.toString() 
        });
      }
    } else {
      const hours = Math.floor(seconds / 3600);
      const remainingMinutes = Math.floor((seconds % 3600) / 60);

      if (remainingMinutes === 0) {
        return i18n.t('commands.slowmode.duration_hours', guildId, { hours: hours.toString() });
      } else {
        return i18n.t('commands.slowmode.duration_hours_minutes', guildId, { 
          hours: hours.toString(), 
          minutes: remainingMinutes.toString() 
        });
      }
    }
  }
}