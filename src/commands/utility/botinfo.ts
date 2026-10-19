import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { formatDuration, formatNumber } from '../../utils/helpers';
import { i18n } from '../../utils/i18n';

export default class BotInfoCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'botinfo',
      description: i18n.t('commands.botinfo.description', 'en'),
      category: 'utility',
      aliases: ['info', 'stats'],
      cooldown: 10,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription(i18n.t('commands.botinfo.description', 'en'))
      .setDescriptionLocalizations({
        'es-ES': i18n.t('commands.botinfo.description', 'es'),
        'es-419': i18n.t('commands.botinfo.description', 'es'),
      });
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const lang = i18n.getGuildLanguage(interaction.guildId!);
    await interaction.deferReply();

    try {
      const botInfo = this.client.getBotInfo();
      const healthCheck = await this.client.healthCheck();
      const version = botInfo.version || process.env.npm_package_version || '1.0.0';

      const embed = new EmbedBuilder()
        .setColor(this.client.config.colors.primary)
        .setTitle(i18n.t('commands.botinfo.title', lang))
        .setThumbnail(this.client.user?.displayAvatarURL() || null)
        .setTimestamp();

      embed.addFields([
        {
          name: i18n.t('commands.botinfo.general', lang),
          value:
            `**${i18n.t('commands.botinfo.version', lang)}:** ${botInfo.version}\n` +
            `**${i18n.t('commands.botinfo.uptime', lang)}:** ${formatDuration(botInfo.uptime)}\n` +
            `**${i18n.t('commands.botinfo.created', lang)}:** <t:${Math.floor((this.client.user?.createdTimestamp || 0) / 1000)}:R>`,
          inline: true,
        },
        {
          name: i18n.t('commands.botinfo.stats', lang),
          value:
            `**${i18n.t('commands.botinfo.servers', lang)}:** ${formatNumber(botInfo.guilds)}\n` +
            `**${i18n.t('commands.botinfo.users', lang)}:** ${formatNumber(botInfo.users)}\n` +
            `**${i18n.t('commands.botinfo.channels', lang)}:** ${formatNumber(botInfo.channels)}\n` +
            `**${i18n.t('commands.botinfo.commands', lang)}:** ${formatNumber(botInfo.commands)}`,
          inline: true,
        },
        {
          name: i18n.t('commands.botinfo.latency', lang),
          value:
            `**${i18n.t('commands.botinfo.latency_ws', lang)}:** ${botInfo.ping}ms\n` +
            `**${i18n.t('commands.botinfo.latency_status', lang)}:** ${this.getLatencyStatus(botInfo.ping, lang)}`,
          inline: true,
        },
      ]);

      const memoryUsage = process.memoryUsage();

      embed.addFields([
        {
          name: i18n.t('commands.botinfo.memory', lang),
          value:
            `**${i18n.t('commands.botinfo.memory', lang)}:** ${this.formatBytes(memoryUsage.heapUsed)}\n` +
            `**Total:** ${this.formatBytes(memoryUsage.heapTotal)}\n` +
            `**RSS:** ${this.formatBytes(memoryUsage.rss)}`,
          inline: true,
        },
        {
          name: i18n.t('commands.botinfo.system', lang),
          value:
            `**${i18n.t('commands.botinfo.node_version', lang)}:** ${process.version}\n` +
            `**${i18n.t('commands.botinfo.platform', lang)}:** ${process.platform}\n` +
            `**Arch:** ${process.arch}`,
          inline: true,
        },
        {
          name: i18n.t('commands.botinfo.addons', lang),
          value:
            `**${i18n.t('commands.botinfo.addons_loaded', lang)}:** ${botInfo.addons}\n` +
            `**${i18n.t('commands.botinfo.addons_available', lang)}:** ${this.client.addons.addons.size}`,
          inline: true,
        },
      ]);

      embed.addFields([
        {
          name: i18n.t('commands.botinfo.services', lang),
          value: this.getServicesStatus(healthCheck, lang),
          inline: false,
        },
        {
          name: i18n.t('commands.botinfo.links', lang),
          value:
            `[${i18n.t('commands.botinfo.links', lang)}](${process.env.DASHBOARD_URL || 'https://panel.korex.dev'}) • ` +
            `[Docs](https://docs.korex.dev) • ` +
            `[Support](https://discord.gg/korex)`,
          inline: false,
        },
      ]);

      embed.setFooter({ text: i18n.t('commands.botinfo.footer', lang, { version }) });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      this.client.logger.error('Error in botinfo command:', error);
      await interaction.editReply({ content: i18n.t('commands.botinfo.error', lang) });
    }
  }

  private formatBytes(bytes: number): string {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  }

  private getLatencyStatus(ping: number, lang: string): string {
    if (ping < 100) return i18n.t('commands.botinfo.status_excellent', lang);
    if (ping < 200) return i18n.t('commands.botinfo.status_good', lang);
    if (ping < 300) return i18n.t('commands.botinfo.status_fair', lang);
    return i18n.t('commands.botinfo.status_poor', lang);
  }

  private getServicesStatus(healthCheck: any, lang: string): string {
    const services = [
      { key: 'service_discord', status: healthCheck.checks.discord.status === 'ok', latency: healthCheck.checks.discord.ping },
      { key: 'service_db',      status: healthCheck.checks.database.status === 'ok', latency: healthCheck.checks.database.latency },
      { key: 'service_redis',   status: healthCheck.checks.redis.status === 'ok',    latency: healthCheck.checks.redis.latency },
    ];

    return services.map(s => {
      const emoji = s.status ? '🟢' : '🔴';
      const lat = s.latency ? ` (${s.latency}ms)` : '';
      return `${emoji} **${i18n.t(`commands.botinfo.${s.key}`, lang)}**${lat}`;
    }).join('\n');
  }
}
