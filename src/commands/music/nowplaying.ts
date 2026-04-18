import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class NowPlayingCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'nowplaying',
      description: 'Show information about the currently playing song',
      category: 'music',
      addon: 'music',
      permissions: {},
      cooldown: 3,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('nowplaying')
      .setDescription('Show information about the currently playing song')
      .setNameLocalizations({
        'es-ES': 'reproduciendo',
      })
      .setDescriptionLocalizations({
        'es-ES': 'Mostrar información sobre la canción que se está reproduciendo',
      });
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    return this.execute(interaction);
  }

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guild) {
      await interaction.editReply({
        content: i18n.t('common.guild_only', interaction.guildId!),
      });

      return;
    }

    const queue = this.client.music.getQueue(interaction.guildId!);

    if (!queue || !queue.currentTrack) {
      await interaction.editReply({
        content: i18n.t('music.nothing_playing', interaction.guildId!),
      });

      return;
    }

    const track = queue.currentTrack;

    // Current position from Lavalink (milliseconds)
    const progress = this.client.music.getCurrentPosition(interaction.guildId!);
    const progressBar = this.createProgressBar(progress, track.duration);

    const embed = new EmbedBuilder()
      .setColor(Colors.Blue)
      .setTitle(`🎵 ${i18n.t('music.now_playing', interaction.guildId!)}`)
      .setDescription(`**${track.title}**\n${track.artist}`);

    if (track.thumbnail) {
      embed.setThumbnail(track.thumbnail);
    }

    embed
      .addFields(
        {
          name: i18n.t('music.duration', interaction.guildId!),
          value: `${this.formatDuration(progress)} / ${this.formatDuration(track.duration)}`,
          inline: true,
        },
        {
          name: i18n.t('music.source', interaction.guildId!),
          value: track.source.toUpperCase(),
          inline: true,
        },
        {
          name: i18n.t('music.requested_by', interaction.guildId!),
          value: track.requestedBy.mention,
          inline: true,
        },
        {
          name: i18n.t('music.volume', interaction.guildId!),
          value: `${queue.volume}%`,
          inline: true,
        },
        {
          name: i18n.t('music.loop', interaction.guildId!),
          value: i18n.t(`music.loop_${queue.loop}`, interaction.guildId!),
          inline: true,
        },
        {
          name: i18n.t('music.queue_length', interaction.guildId!),
          value: queue.tracks.length.toString(),
          inline: true,
        },
        {
          name: i18n.t('music.progress', interaction.guildId!),
          value: progressBar,
          inline: false,
        }
      );

    // Add status indicator
    if (queue.paused) {
      embed.setFooter({
        text: `⏸️ ${i18n.t('music.paused', interaction.guildId!)}`,
      });
    } else {
      embed.setFooter({
        text: `▶️ ${i18n.t('music.playing', interaction.guildId!)}`,
      });
    }

    // Control buttons
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('music_pause')
        .setLabel(
          queue.paused
            ? i18n.t('music.resume', interaction.guildId!)
            : i18n.t('music.pause', interaction.guildId!)
        )
        .setEmoji(queue.paused ? '▶️' : '⏸️')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('music_skip')
        .setLabel(i18n.t('music.skip', interaction.guildId!))
        .setEmoji('⏭️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('music_stop')
        .setLabel(i18n.t('music.stop', interaction.guildId!))
        .setEmoji('⏹️')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('music_queue')
        .setLabel(i18n.t('music.view_queue', interaction.guildId!))
        .setEmoji('📋')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
  }

  private formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;

    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  private createProgressBar(current: number, total: number): string {
    const barLength = 20;
    const progress = total > 0 ? Math.min(current / total, 1) : 0;
    const filledLength = Math.round(progress * barLength);
    const emptyLength = barLength - filledLength;

    const filledBar = '█'.repeat(filledLength);
    const emptyBar = '░'.repeat(emptyLength);

    return `\`${filledBar}${emptyBar}\``;
  }
}
