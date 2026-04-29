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

export default class QueueCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'queue',
      description: 'View the current music queue',
      category: 'music',
      addon: 'music',
      permissions: {},
      cooldown: 3,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('queue')
      .setDescription('View the current music queue')
      .addIntegerOption((option) =>
        option
          .setName('page')
          .setDescription('Page number to view')
          .setMinValue(1)
          .setRequired(false)
      );
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

    if (!queue) {
      await interaction.editReply({
        content: i18n.t('music.no_queue', interaction.guildId!),
      });

      return;
    }

    const page = interaction.options.getInteger('page') || 1;
    const queueData = this.client.music.getQueueDisplay(interaction.guildId!, page);

    if (!queueData) {
      await interaction.editReply({
        content: i18n.t('music.no_queue', interaction.guildId!),
      });

      return;
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.Blue)
      .setTitle(`📋 ${i18n.t('music.queue_title', interaction.guildId!)}`)
      .setFooter({
        text: i18n.t('music.queue_footer', interaction.guildId!, {
          page: String(queueData.page),
          totalPages: String(queueData.totalPages),
          total: String(queueData.totalTracks),
        }),
      });

    // Current track
    if (queueData.currentTrack) {
      const current = queueData.currentTrack;

      embed.addFields({
        name: `🎵 ${i18n.t('music.now_playing', interaction.guildId!)}`,
        value: `**${current.title}**\n${current.artist} • ${this.formatDuration(current.duration)}\n${i18n.t('music.requested_by', interaction.guildId!, { user: current.requestedBy.displayName })}`,
        inline: false,
      });
    }

    // Queue tracks
    if (queueData.tracks.length > 0) {
      const queueList = queueData.tracks
        .map((track, index: number) => {
          const position = (queueData.page - 1) * 10 + index + 1;

          return `**${position}.** ${track.title}\n${track.artist} • ${this.formatDuration(track.duration)} • ${track.requestedBy.displayName}`;
        })
        .join('\n\n');

      embed.addFields({
        name: `📋 ${i18n.t('music.up_next', interaction.guildId!)}`,
        value: queueList,
        inline: false,
      });
    } else if (!queueData.currentTrack) {
      embed.setDescription(i18n.t('music.queue_empty', interaction.guildId!));
    }

    // Queue info
    const infoFields: { name: string; value: string; inline: boolean }[] = [];

    if (queueData.currentTrack || queueData.tracks.length > 0) {
      infoFields.push(
        {
          name: i18n.t('music.volume', interaction.guildId!),
          value: `${queueData.volume}%`,
          inline: true,
        },
        {
          name: i18n.t('music.loop', interaction.guildId!),
          value: i18n.t(`music.loop_${queueData.loop}`, interaction.guildId!),
          inline: true,
        },
        {
          name: i18n.t('music.status', interaction.guildId!),
          value: queueData.paused
            ? i18n.t('music.paused', interaction.guildId!)
            : i18n.t('music.playing', interaction.guildId!),
          inline: true,
        }
      );
    }

    if (infoFields.length > 0) {
      embed.addFields(infoFields);
    }

    // Navigation buttons
    const components: ActionRowBuilder<ButtonBuilder>[] = [];

    if (queueData.totalPages > 1) {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`queue_page_${Math.max(1, queueData.page - 1)}`)
          .setLabel(i18n.t('common.previous', interaction.guildId!))
          .setEmoji('⬅️')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(queueData.page === 1),
        new ButtonBuilder()
          .setCustomId(`queue_page_${Math.min(queueData.totalPages, queueData.page + 1)}`)
          .setLabel(i18n.t('common.next', interaction.guildId!))
          .setEmoji('➡️')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(queueData.page === queueData.totalPages)
      );

      components.push(row);
    }

    // Control buttons (if there's music playing)
    if (queueData.currentTrack) {
      const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('music_pause')
          .setLabel(
            queueData.paused
              ? i18n.t('music.resume', interaction.guildId!)
              : i18n.t('music.pause', interaction.guildId!)
          )
          .setEmoji(queueData.paused ? '▶️' : '⏸️')
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
          .setCustomId('music_shuffle')
          .setLabel(i18n.t('music.shuffle', interaction.guildId!))
          .setEmoji('🔀')
          .setStyle(ButtonStyle.Secondary)
      );

      components.push(controlRow);
    }

    await interaction.editReply({
      embeds: [embed],
      components: components.length > 0 ? components : [],
    });
  }

  private formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;

    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
}
