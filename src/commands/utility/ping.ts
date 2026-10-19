import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { createInfoEmbed } from '../../utils/helpers';
import { i18n } from '../../utils/i18n';

export default class PingCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'ping',
      description: i18n.t('commands.ping.description', 'en'),
      category: 'utility',
      cooldown: 3,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription(i18n.t('commands.ping.description', 'en'))
      .setDescriptionLocalizations({
        'es-ES': i18n.t('commands.ping.description', 'es'),
        'es-419': i18n.t('commands.ping.description', 'es'),
      });
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const lang = i18n.getGuildLanguage(interaction.guildId!);
    const start = Date.now();

    await interaction.reply({ content: i18n.t('commands.ping.calculating', lang), ephemeral: true });

    const end = Date.now();
    const apiLatency = end - start;
    const wsLatency = this.client.ws.ping;

    const getStatus = (ms: number) => {
      if (ms < 100) return { emoji: '🟢', label: i18n.t('commands.ping.status_excellent', lang) };
      if (ms < 200) return { emoji: '🟡', label: i18n.t('commands.ping.status_good', lang) };
      if (ms < 300) return { emoji: '🟠', label: i18n.t('commands.ping.status_fair', lang) };
      return { emoji: '🔴', label: i18n.t('commands.ping.status_poor', lang) };
    };

    const apiStatus = getStatus(apiLatency);
    const wsStatus = getStatus(wsLatency);

    const embed = createInfoEmbed(
      i18n.t('commands.ping.title', lang),
      `**${i18n.t('commands.ping.api_latency', lang)}:** ${apiStatus.emoji} ${apiLatency}ms (${apiStatus.label})\n` +
      `**${i18n.t('commands.ping.ws_latency', lang)}:** ${wsStatus.emoji} ${wsLatency}ms (${wsStatus.label})\n\n` +
      `**${i18n.t('commands.ping.uptime_label', lang)}:** ${this.formatUptime(this.client.uptime || 0)}\n` +
      `**${i18n.t('commands.ping.memory_label', lang)}:** ${this.formatMemory(process.memoryUsage().heapUsed)}`
    );

    embed.setTimestamp();
    embed.setFooter({
      text: i18n.t('commands.ping.footer', lang, { version: process.env.npm_package_version || '1.0.0' }),
    });

    await interaction.editReply({ content: null, embeds: [embed] });
  }

  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m ${seconds % 60}s`;
  }

  private formatMemory(bytes: number): string {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }
}
