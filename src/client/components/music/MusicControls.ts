import { ButtonInteraction, GuildMember, EmbedBuilder, Colors, TextChannel } from 'discord.js';
import { Component } from '../../structures/Component';
import { KorexClient } from '../../KorexClient';
import { i18n } from '../../../utils/i18n';

export default class MusicControlsComponent extends Component {
  constructor(client: KorexClient) {
    super(client, {
      customId: 'music_',
      type: 'button',
    });
  }

  async execute(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild || !interaction.member) {
      await interaction.reply({
        content: i18n.t('common.guild_only', interaction.guildId!),
        ephemeral: true,
      });

      return;
    }

    const member = interaction.member as GuildMember;
    const action = interaction.customId.split('_')[1];

    // Check if user is in voice channel
    if (!member.voice.channel) {
      await interaction.reply({
        content: i18n.t('music.not_in_voice', interaction.guildId!),
        ephemeral: true,
      });

      return;
    }

    const queue = this.client.music.getQueue(interaction.guildId!);

    if (!queue) {
      await interaction.reply({
        content: i18n.t('music.nothing_playing', interaction.guildId!),
        ephemeral: true,
      });

      return;
    }

    // Check if user is in the same voice channel as bot
    if (!queue.voiceChannel || member.voice.channelId !== queue.voiceChannel.id) {
      await interaction.reply({
        content: i18n.t('music.different_voice_channel', interaction.guildId!),
        ephemeral: true,
      });

      return;
    }

    try {
      switch (action) {
        case 'pause':
          await this.handlePause(interaction, member);
          break;
        case 'skip':
          await this.handleSkip(interaction, member);
          break;
        case 'stop':
          await this.handleStop(interaction, member);
          break;
        case 'queue':
          await this.handleQueue(interaction);
          break;
        default:
          await interaction.reply({
            content: i18n.t('common.error', interaction.guildId!),
            ephemeral: true,
          });
      }
    } catch (error) {
      this.client.logger.error('Error in music controls:', error);
      await interaction.reply({
        content: i18n.t('common.error', interaction.guildId!),
        ephemeral: true,
      });
    }
  }

  private async handlePause(interaction: ButtonInteraction, member: GuildMember): Promise<void> {
    const queue = this.client.music.getQueue(interaction.guildId!);

    if (!queue || !queue.currentTrack) return;

    const success = await this.client.music.togglePause(interaction.guildId!);

    if (!success) {
      await interaction.reply({
        content: i18n.t('common.error', interaction.guildId!),
        ephemeral: true,
      });

      return;
    }

    const newQueue = this.client.music.getQueue(interaction.guildId!);
    const isPaused = newQueue?.paused || false;

    await interaction.reply({
      content: isPaused
        ? `⏸️ ${i18n.t('music.paused', interaction.guildId!)} - ${member.displayName}`
        : `▶️ ${i18n.t('music.playing', interaction.guildId!)} - ${member.displayName}`,
      ephemeral: false,
    });
  }

  private async handleSkip(interaction: ButtonInteraction, member: GuildMember): Promise<void> {
    const queue = this.client.music.getQueue(interaction.guildId!);

    if (!queue || !queue.currentTrack) return;

    // Check DJ permissions
    if (!(await this.client.music.hasDJPermissions(member))) {
      await interaction.reply({
        content: i18n.t('music.dj_only', interaction.guildId!),
        ephemeral: true,
      });

      return;
    }

    const currentTrack = queue.currentTrack;
    const success = await this.client.music.skip(interaction.member as GuildMember, interaction.channel as TextChannel);

    if (!success) {
      await interaction.reply({
        content: i18n.t('music.skip_failed', interaction.guildId!),
        ephemeral: true,
      });

      return;
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.Yellow)
      .setDescription(
        `⏭️ **${currentTrack.title}** ${i18n.t('music.skipped_by', interaction.guildId!, { user: member.displayName })}`
      );

    await interaction.reply({ embeds: [embed] });
  }

  private async handleStop(interaction: ButtonInteraction, member: GuildMember): Promise<void> {
    // Check DJ permissions
    if (!(await this.client.music.hasDJPermissions(member))) {
      await interaction.reply({
        content: i18n.t('music.dj_only', interaction.guildId!),
        ephemeral: true,
      });

      return;
    }

    const success = await this.client.music.stop(interaction.member as GuildMember, interaction.channel as TextChannel);

    if (!success) {
      await interaction.reply({
        content: i18n.t('music.stop_failed', interaction.guildId!),
        ephemeral: true,
      });

      return;
    }

    // Disconnect from voice channel
    this.client.music.disconnect(interaction.guildId!);

    const embed = new EmbedBuilder()
      .setColor(Colors.Red)
      .setDescription(
        `⏹️ ${i18n.t('music.stopped_description', interaction.guildId!)} - ${member.displayName}`
      );

    await interaction.reply({ embeds: [embed] });
  }

  private async handleQueue(interaction: ButtonInteraction): Promise<void> {
    const queueData = this.client.music.getQueueDisplay(interaction.guildId!);

    if (!queueData) {
      await interaction.reply({
        content: i18n.t('music.no_queue', interaction.guildId!),
        ephemeral: true,
      });

      return;
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.Blue)
      .setTitle(`📋 ${i18n.t('music.queue_title', interaction.guildId!)}`);

    // Current track
    if (queueData.currentTrack) {
      const current = queueData.currentTrack;

      embed.addFields({
        name: `🎵 ${i18n.t('music.now_playing', interaction.guildId!)}`,
        value: `**${current.title}**\n${current.artist} • ${this.formatDuration(current.duration)}`,
        inline: false,
      });
    }

    // Queue tracks (first 5)
    if (queueData.tracks.length > 0) {
      const queueList = queueData.tracks
        .slice(0, 5)
        .map((track, index: number) => {
          return `**${index + 1}.** ${track.title}\n${track.artist} • ${this.formatDuration(track.duration)}`;
        })
        .join('\n\n');

      embed.addFields({
        name: `📋 ${i18n.t('music.up_next', interaction.guildId!)}`,
        value: queueList,
        inline: false,
      });

      if (queueData.tracks.length > 5) {
        embed.setFooter({
          text: i18n.t('music.queue_footer', interaction.guildId!, {
            page: '1',
            totalPages: Math.ceil(queueData.totalTracks / 10).toString(),
            total: queueData.totalTracks.toString(),
          }),
        });
      }
    } else if (!queueData.currentTrack) {
      embed.setDescription(i18n.t('music.queue_empty', interaction.guildId!));
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  private formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;

    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
}
