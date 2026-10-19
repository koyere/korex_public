import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

/**
 * /pause — pausa o reanuda la reproducción (mismo comportamiento que el botón ⏯️ de /queue).
 * La respuesta ya viene diferida (interactionCreate difiere los comandos de música).
 */
export default class PauseCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'pause',
      description: 'Pause or resume playback',
      category: 'music',
      addon: 'music',
      permissions: {},
      cooldown: 2,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('pause')
      .setDescription('Pause or resume playback');
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    return this.execute(interaction);
  }

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;

    if (!interaction.guild || !interaction.member) {
      await interaction.editReply({ content: i18n.t('common.guild_only', guildId) });
      return;
    }

    const member = interaction.member as GuildMember;

    if (!member.voice.channel) {
      await interaction.editReply({ content: i18n.t('music.not_in_voice', guildId) });
      return;
    }

    const queue = this.client.music.getQueue(guildId);

    if (!queue || !queue.currentTrack) {
      await interaction.editReply({ content: i18n.t('music.nothing_playing', guildId) });
      return;
    }

    if (!queue.voiceChannel || member.voice.channelId !== queue.voiceChannel.id) {
      await interaction.editReply({ content: i18n.t('music.different_voice_channel', guildId) });
      return;
    }

    try {
      await this.client.music.togglePause(guildId);
      const paused = this.client.music.getQueue(guildId)?.paused ?? false;

      await interaction.editReply({
        content: paused
          ? `⏸️ ${i18n.t('music.paused', guildId)} - ${member.displayName}`
          : `▶️ ${i18n.t('music.playing', guildId)} - ${member.displayName}`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      this.client.logger.error('Error in pause command:', error);
      await interaction.editReply({ content: i18n.t('common.error', guildId) });
    }
  }
}
