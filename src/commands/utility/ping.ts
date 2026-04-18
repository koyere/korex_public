import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { createInfoEmbed } from '../../utils/helpers';

export default class PingCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'ping',
      description: 'Muestra la latencia del bot',
      category: 'utility',
      cooldown: 3,
    });
  }

  data() {
    return new SlashCommandBuilder().setName(this.name).setDescription(this.description);
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const start = Date.now();

    // Responder inicialmente
    await interaction.reply({ content: '🏓 Calculando ping...', ephemeral: true });

    const end = Date.now();
    const apiLatency = end - start;
    const wsLatency = this.client.ws.ping;

    // Determinar estado de la latencia
    const getLatencyStatus = (latency: number) => {
      if (latency < 100) return { emoji: '🟢', status: 'Excelente' };
      if (latency < 200) return { emoji: '🟡', status: 'Buena' };
      if (latency < 300) return { emoji: '🟠', status: 'Regular' };

      return { emoji: '🔴', status: 'Mala' };
    };

    const apiStatus = getLatencyStatus(apiLatency);
    const wsStatus = getLatencyStatus(wsLatency);

    const embed = createInfoEmbed(
      '🏓 Pong!',
      `**Latencia de API:** ${apiStatus.emoji} ${apiLatency}ms (${apiStatus.status})\n` +
        `**Latencia WebSocket:** ${wsStatus.emoji} ${wsLatency}ms (${wsStatus.status})\n\n` +
        `**Uptime:** ${this.formatUptime(this.client.uptime || 0)}\n` +
        `**Memoria:** ${this.formatMemory(process.memoryUsage().heapUsed)}`
    );

    embed.setTimestamp();
    embed.setFooter({
      text: `Korex v${process.env.npm_package_version || '1.0.0'}`,
    });

    await interaction.editReply({
      content: null,
      embeds: [embed],
    });
  }

  /**
   * Formatear uptime a texto legible
   */
  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else {
      return `${minutes}m ${seconds % 60}s`;
    }
  }

  /**
   * Formatear memoria a texto legible
   */
  private formatMemory(bytes: number): string {
    const mb = bytes / 1024 / 1024;

    return `${mb.toFixed(2)} MB`;
  }
}
