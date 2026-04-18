import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class VolumeCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'volume',
      description: 'Set or view the music volume',
      category: 'music',
      addon: 'music',
      permissions: {},
      cooldown: 3,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('volume')
      .setDescription('Set or view the music volume')
      .addIntegerOption((option) =>
        option
          .setName('level')
          .setDescription('Volume level (0-100)')
          .setMinValue(0)
          .setMaxValue(100)
          .setRequired(false)
      );
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
    const volume = interaction.options.getInteger('level');

    const queue = this.client.music.getQueue(interaction.guildId!);

    if (!queue) {
      await interaction.editReply({
        content: i18n.t('music.nothing_playing', interaction.guildId!),
      });

      return;
    }

    // If no volume specified, show current volume
    if (volume === null) {
      const embed = new EmbedBuilder()
        .setColor(Colors.Blue)
        .setTitle(`🔊 ${i18n.t('music.current_volume', interaction.guildId!)}`)
        .setDescription(
          i18n.t('music.volume_level', interaction.guildId!, { volume: queue.volume.toString() })
        )
        .addFields({
          name: i18n.t('music.volume_bar', interaction.guildId!),
          value: this.createVolumeBar(queue.volume),
          inline: false,
        });

      await interaction.editReply({ embeds: [embed] });

      return;
    }

    // Check if user is in voice channel
    if (!member.voice.channel) {
      await interaction.editReply({
        content: i18n.t('music.not_in_voice', interaction.guildId!),
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
      const oldVolume = queue.volume;

      // Set new volume
      const success = await this.client.music.setVolume(interaction.guildId!, volume);

      if (!success) {
        await interaction.editReply({
          content: i18n.t('music.volume_failed', interaction.guildId!),
        });

        return;
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle(`🔊 ${i18n.t('music.volume_changed', interaction.guildId!)}`)
        .setDescription(
          i18n.t('music.volume_changed_description', interaction.guildId!, {
            oldVolume: oldVolume.toString(),
            newVolume: volume.toString(),
          })
        )
        .addFields({
          name: i18n.t('music.volume_bar', interaction.guildId!),
          value: this.createVolumeBar(volume),
          inline: false,
        })
        .setFooter({
          text: i18n.t('music.changed_by', interaction.guildId!, { user: member.displayName }),
        });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      this.client.logger.error('Error in volume command:', error);
      await interaction.editReply({
        content: i18n.t('common.error', interaction.guildId!),
      });
    }
  }

  private createVolumeBar(volume: number): string {
    const barLength = 20;
    const filledLength = Math.round((volume / 100) * barLength);
    const emptyLength = barLength - filledLength;

    const filledBar = '█'.repeat(filledLength);
    const emptyBar = '░'.repeat(emptyLength);

    return `\`${filledBar}${emptyBar}\` ${volume}%`;
  }
}
