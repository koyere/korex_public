import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { formatDuration, formatNumber } from '../../utils/helpers';

export default class BotInfoCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'botinfo',
      description: 'Muestra información detallada sobre el bot',
      category: 'utility',
      aliases: ['info', 'stats'],
      cooldown: 10,
    });
  }

  data() {
    return new SlashCommandBuilder().setName(this.name).setDescription(this.description);
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    try {
      // Obtener estadísticas del bot
      const botInfo = this.client.getBotInfo();
      const healthCheck = await this.client.healthCheck();

      // Crear embed principal
      const embed = new EmbedBuilder()
        .setColor(this.client.config.colors.primary)
        .setTitle('🤖 Información del Bot')
        .setThumbnail(this.client.user?.displayAvatarURL() || null)
        .setTimestamp();

      // Información básica
      embed.addFields([
        {
          name: '📋 Información General',
          value:
            `**Nombre:** ${botInfo.name}\n` +
            `**Versión:** ${botInfo.version}\n` +
            `**Uptime:** ${formatDuration(botInfo.uptime)}\n` +
            `**Creado:** <t:${Math.floor((this.client.user?.createdTimestamp || 0) / 1000)}:R>`,
          inline: true,
        },
        {
          name: '📊 Estadísticas',
          value:
            `**Servidores:** ${formatNumber(botInfo.guilds)}\n` +
            `**Usuarios:** ${formatNumber(botInfo.users)}\n` +
            `**Canales:** ${formatNumber(botInfo.channels)}\n` +
            `**Comandos:** ${formatNumber(botInfo.commands)}`,
          inline: true,
        },
        {
          name: '🏓 Latencia',
          value:
            `**WebSocket:** ${botInfo.ping}ms\n` +
            `**Estado:** ${this.getLatencyStatus(botInfo.ping)}`,
          inline: true,
        },
      ]);

      // Información del sistema
      const memoryUsage = process.memoryUsage();

      embed.addFields([
        {
          name: '💾 Memoria',
          value:
            `**Usada:** ${this.formatBytes(memoryUsage.heapUsed)}\n` +
            `**Total:** ${this.formatBytes(memoryUsage.heapTotal)}\n` +
            `**RSS:** ${this.formatBytes(memoryUsage.rss)}`,
          inline: true,
        },
        {
          name: '⚙️ Sistema',
          value:
            `**Node.js:** ${process.version}\n` +
            `**Plataforma:** ${process.platform}\n` +
            `**Arquitectura:** ${process.arch}`,
          inline: true,
        },
        {
          name: '🧩 Addons',
          value:
            `**Cargados:** ${botInfo.addons}\n` +
            `**Disponibles:** ${this.client.addons.addons.size}`,
          inline: true,
        },
      ]);

      // Estado de servicios
      const servicesStatus = this.getServicesStatus(healthCheck);

      embed.addFields([
        {
          name: '🔧 Estado de Servicios',
          value: servicesStatus,
          inline: false,
        },
      ]);

      // Enlaces útiles
      embed.addFields([
        {
          name: '🔗 Enlaces',
          value:
            `[Panel Web](${process.env.DASHBOARD_URL || 'https://panel.korex.dev'}) • ` +
            `[Documentación](https://docs.korex.dev) • ` +
            `[Soporte](https://discord.gg/korex) • ` +
            `[GitHub](https://github.com/korex-dev)`,
          inline: false,
        },
      ]);

      embed.setFooter({
        text: `Korex v${botInfo.version} - The Core of Your Community`,
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      this.client.logger.error('Error en comando botinfo:', error);

      await interaction.editReply({
        content: '❌ Ocurrió un error al obtener la información del bot.',
      });
    }
  }

  /**
   * Formatear bytes a texto legible
   */
  private formatBytes(bytes: number): string {
    const sizes = ['B', 'KB', 'MB', 'GB'];

    if (bytes === 0) return '0 B';

    const i = Math.floor(Math.log(bytes) / Math.log(1024));

    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  }

  /**
   * Obtener estado de latencia
   */
  private getLatencyStatus(ping: number): string {
    if (ping < 100) return '🟢 Excelente';
    if (ping < 200) return '🟡 Buena';
    if (ping < 300) return '🟠 Regular';

    return '🔴 Mala';
  }

  /**
   * Obtener estado de servicios
   */
  private getServicesStatus(healthCheck: any): string {
    const services = [
      {
        name: 'Discord',
        status: healthCheck.checks.discord.status === 'ok',
        latency: healthCheck.checks.discord.ping,
      },
      {
        name: 'Base de Datos',
        status: healthCheck.checks.database.status === 'ok',
        latency: healthCheck.checks.database.latency,
      },
      {
        name: 'Redis',
        status: healthCheck.checks.redis.status === 'ok',
        latency: healthCheck.checks.redis.latency,
      },
    ];

    return services
      .map((service) => {
        const statusEmoji = service.status ? '🟢' : '🔴';
        const latencyText = service.latency ? ` (${service.latency}ms)` : '';

        return `${statusEmoji} **${service.name}**${latencyText}`;
      })
      .join('\n');
  }
}
