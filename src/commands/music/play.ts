import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
  EmbedBuilder,
  Colors,
  VoiceChannel,
  TextChannel,
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class PlayCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'play',
      description: 'Reproduce música desde YouTube, Spotify, SoundCloud y más',
      category: 'music',
      addon: 'music', // Requires 'music' in Guild.enabledAddons — toggled via dashboard settings
      permissions: {},
      cooldown: 3,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('play')
      .setDescription('Reproduce música desde YouTube, Spotify, SoundCloud y más')
      .addStringOption(option =>
        option
          .setName('query')
          .setDescription('Canción, artista, URL o playlist a reproducir')
          .setRequired(true)
      );
  }

  public async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const query = interaction.options.getString('query', true);
    const member = interaction.member as GuildMember;

    if (!this.client.music.isReady()) {
      await interaction.editReply(i18n.t('music.node_unavailable', interaction.guildId!));

      return;
    }

    // Verificar si el usuario está en un canal de voz
    if (!member.voice.channel) {
      await interaction.editReply(i18n.t('music.not_in_voice', interaction.guildId!));

      return;
    }

    const voiceChannel = member.voice.channel as VoiceChannel;

    // Verificar permisos del bot
    if (!voiceChannel.permissionsFor(interaction.guild!.members.me!)?.has(['Connect', 'Speak'])) {
      await interaction.editReply(i18n.t('music.no_voice_permissions', interaction.guildId!));

      return;
    }

    try {
      const result = await this.client.music.play(
        member,
        interaction.channel as TextChannel,
        query
      );

      const embed = new EmbedBuilder()
        .setColor(result.started ? Colors.Green : Colors.Blue)
        .setTitle(
          (result.started ? '🎵 ' : '📋 ') +
            i18n.t(result.started ? 'music.now_playing' : 'music.added_to_queue', interaction.guildId!)
        )
        .setDescription(`**${result.track.title}**\n${result.track.artist}`)
        .addFields(
          {
            name: i18n.t('music.duration', interaction.guildId!),
            value: this.formatDuration(result.track.duration),
            inline: true,
          },
          {
            name: i18n.t('music.source', interaction.guildId!),
            value: result.track.source.toUpperCase(),
            inline: true,
          },
          {
            name: i18n.t('music.queue_length', interaction.guildId!),
            value: result.queueSize.toString(),
            inline: true,
          }
        );

      if (result.track.thumbnail) {
        embed.setThumbnail(result.track.thumbnail);
      }

      await interaction.editReply({ embeds: [embed] });
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      let localized = i18n.t('common.errors.generic', interaction.guildId!);

      if (errorMessage === 'MUSIC_NODE_UNAVAILABLE') {
        localized = i18n.t('music.node_unavailable', interaction.guildId!);
      } else if (errorMessage === 'MUSIC_DIFFERENT_VOICE_CHANNEL') {
        localized = i18n.t('music.different_voice_channel', interaction.guildId!);
      } else if (errorMessage.toLowerCase().includes('no se encontraron resultados')) {
        localized = i18n.t('music.no_results', interaction.guildId!, { query });
      } else if (errorMessage.toLowerCase().includes('canal de voz')) {
        localized = i18n.t('music.not_in_voice', interaction.guildId!);
      }

      await interaction.editReply({
        content: localized
      });
    }
  }

  private formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}
