import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
  EmbedBuilder,
  Colors,
  TextChannel,
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class StopCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'stop',
      description: 'Stop music and clear the queue',
      category: 'music',
      addon: 'music',
      permissions: {},
      cooldown: 3,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Stop music and clear the queue');
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    return this.execute(interaction);
  }

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guild || !interaction.member) {
      await interaction.editReply({
        content: i18n.t('common.guild_only', interaction.guildId!),
      });

      return;
    }

    const member = interaction.member as GuildMember;

    // Check if user is in voice channel
    if (!member.voice.channel) {
      await interaction.editReply({
        content: i18n.t('music.not_in_voice', interaction.guildId!),
      });

      return;
    }

    const queue = this.client.music.getQueue(interaction.guildId!);

    if (!queue) {
      await interaction.editReply({
        content: i18n.t('music.nothing_playing', interaction.guildId!),
      });

      return;
    }

    // Check if user is in the same voice channel as bot
    if (!queue.voiceChannel || member.voice.channelId !== queue.voiceChannel.id) {
      await interaction.editReply({
        content: i18n.t('music.different_voice_channel', interaction.guildId!),
      });

      return;
    }

    // Check DJ permissions
    if (!(await this.client.music.hasDJPermissions(member))) {
      await interaction.editReply({
        content: i18n.t('music.dj_only', interaction.guildId!),
      });

      return;
    }

    try {
      const currentTrack = queue.currentTrack;
      const queueLength = queue.tracks.length;

      // Stop playback and clear queue
      const stopped = await this.client.music.stop(member, interaction.channel as TextChannel);

      if (!stopped) {
        await interaction.editReply({
          content: i18n.t('music.stop_failed', interaction.guildId!),
        });

        return;
      }

      // Disconnect from voice channel
      this.client.music.disconnect(interaction.guildId!);

      const embed = new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle(`⏹️ ${i18n.t('music.stopped', interaction.guildId!)}`)
        .setDescription(i18n.t('music.stopped_description', interaction.guildId!))
        .setFooter({
          text: i18n.t('music.stopped_by', interaction.guildId!, { user: member.displayName }),
        });

      if (currentTrack) {
        embed.addFields({
          name: i18n.t('music.last_track', interaction.guildId!),
          value: `**${currentTrack.title}**\n${currentTrack.artist}`,
          inline: true,
        });
      }

      if (queueLength > 0) {
        embed.addFields({
          name: i18n.t('music.cleared_tracks', interaction.guildId!),
          value: queueLength.toString(),
          inline: true,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      this.client.logger.error('Error in stop command:', error);
      await interaction.editReply({
        content: i18n.t('common.error', interaction.guildId!),
      });
    }
  }
}
