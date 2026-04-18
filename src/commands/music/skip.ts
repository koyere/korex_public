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

export default class SkipCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'skip',
      description: 'Skip the current song',
      category: 'music',
      addon: 'music',
      permissions: {},
      cooldown: 3,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('skip')
      .setDescription('Skip the current song')
      .addBooleanOption((option) =>
        option
          .setName('force')
          .setDescription('Force skip without voting (DJ only)')
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
    const force = interaction.options.getBoolean('force') || false;

    // Check if user is in voice channel
    if (!member.voice.channel) {
      await interaction.editReply({
        content: i18n.t('music.not_in_voice', interaction.guildId!),
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

    // Check if user is in the same voice channel as bot
    if (!queue.voiceChannel || member.voice.channelId !== queue.voiceChannel.id) {
      await interaction.editReply({
        content: i18n.t('music.different_voice_channel', interaction.guildId!),
      });

      return;
    }

    // Check DJ permissions for force skip
    if (force && !(await this.client.music.hasDJPermissions(member))) {
      await interaction.editReply({
        content: i18n.t('music.dj_only', interaction.guildId!),
      });

      return;
    }

    const currentTrack = queue.currentTrack;

    try {
      // Skip the track
      const skipped = await this.client.music.skip(member, interaction.channel as TextChannel);

      if (!skipped) {
        await interaction.editReply({
          content: i18n.t('music.skip_failed', interaction.guildId!),
        });

        return;
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.Yellow)
        .setTitle(`⏭️ ${i18n.t('music.skipped', interaction.guildId!)}`)
        .setDescription(`**${currentTrack.title}**\n${currentTrack.artist}`);

      if (currentTrack.thumbnail) {
        embed.setThumbnail(currentTrack.thumbnail);
      }

      embed
        .setFooter({
          text: i18n.t('music.skipped_by', interaction.guildId!, { user: member.displayName }),
        });

      // Check if there's a next track
      const newQueue = this.client.music.getQueue(interaction.guildId!);

      if (newQueue?.currentTrack) {
        embed.addFields({
          name: i18n.t('music.now_playing', interaction.guildId!),
          value: `**${newQueue.currentTrack.title}**\n${newQueue.currentTrack.artist}`,
          inline: false,
        });
      } else {
        embed.addFields({
          name: i18n.t('music.queue_ended', interaction.guildId!),
          value: i18n.t('music.queue_ended_description', interaction.guildId!),
          inline: false,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      this.client.logger.error('Error in skip command:', error);
      await interaction.editReply({
        content: i18n.t('common.error', interaction.guildId!),
      });
    }
  }
}
