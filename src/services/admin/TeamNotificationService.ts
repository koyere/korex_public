/**
 * TeamNotificationService
 *
 * Notifica al equipo de Korex (operadores) cuando ocurren eventos importantes:
 * - Nuevo ticket de soporte abierto por un guild owner
 * - Ticket urgente sin respuesta
 * - Nuevo cliente (primera licencia activada)
 * - Cancelación de licencia
 * - Error crítico del bot
 *
 * Canales de notificación:
 * 1. Discord webhook al canal privado del equipo
 * 2. (Extensible) Slack webhook
 */

import type { KorexClient } from '../../client/KorexClient';
import { createLogger } from '../../utils/Logger';

const logger = createLogger('team-notifications');

export interface SupportTicketNotification {
  ticketId:   string;
  guildId:    string;
  guildName:  string;
  ownerName:  string;
  subject:    string;
  category:   string;
  priority:   string;
  addonName?: string;
}

export interface LicenseEventNotification {
  type:      'new_client' | 'cancellation' | 'payment_failed' | 'courtesy_activated';
  guildId:   string;
  guildName: string;
  addonName: string;
  details?:  string;
}

export class TeamNotificationService {
  private client: KorexClient;
  private discordWebhookUrl: string | null;
  private adminPanelUrl: string;

  constructor(client: KorexClient) {
    this.client         = client;
    this.discordWebhookUrl = process.env.TEAM_DISCORD_WEBHOOK || null;
    this.adminPanelUrl  = process.env.ADMIN_PANEL_URL || 'https://admin.korex.dev';
  }

  private async sendDiscordWebhook(payload: object): Promise<void> {
    if (!this.discordWebhookUrl) return;

    try {
      const response = await fetch(this.discordWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        logger.warn(`Discord webhook failed: ${response.status}`);
      }
    } catch (err) {
      logger.error('Error sending Discord webhook', { error: err });
    }
  }

  /** Notifica al equipo cuando un guild abre un nuevo ticket de soporte */
  async notifyNewSupportTicket(n: SupportTicketNotification): Promise<void> {
    const priorityColors: Record<string, number> = {
      low:    0x2ecc71,
      normal: 0x3498db,
      high:   0xe67e22,
      urgent: 0xe74c3c,
    };
    const priorityEmoji: Record<string, string> = {
      low:    '🟢',
      normal: '🔵',
      high:   '🟡',
      urgent: '🔴',
    };

    const color = priorityColors[n.priority] || 0x3498db;

    await this.sendDiscordWebhook({
      embeds: [{
        title:       `🎫 Nuevo ticket de soporte #${n.ticketId.slice(0, 8)}`,
        description: `**${n.subject}**`,
        color,
        fields: [
          { name: '🏠 Servidor',  value: n.guildName,                  inline: true  },
          { name: '👤 Owner',     value: n.ownerName,                  inline: true  },
          { name: '📂 Categoría', value: n.category,                   inline: true  },
          { name: `${priorityEmoji[n.priority]} Prioridad`, value: n.priority.toUpperCase(), inline: true },
          ...(n.addonName ? [{ name: '🔌 Addon', value: n.addonName, inline: true }] : []),
        ],
        footer: { text: 'Korex Admin' },
        timestamp: new Date().toISOString(),
      }],
      components: [{
        type: 1,
        components: [{
          type: 2,
          style: 5, // LINK
          label: 'Ver en Admin Panel',
          url:   `${this.adminPanelUrl}/support/${n.ticketId}`,
        }],
      }],
    });

    logger.info(`Team notified: new support ticket ${n.ticketId} from guild ${n.guildId}`);
  }

  /** Notifica eventos de licencia (nuevo cliente, cancelación, fallo de pago) */
  async notifyLicenseEvent(n: LicenseEventNotification): Promise<void> {
    const colorMap: Record<string, number> = {
      new_client:         0x00D9FF,
      cancellation:       0xe74c3c,
      payment_failed:     0xe67e22,
      courtesy_activated: 0x9b59b6,
    };
    const emojiMap: Record<string, string> = {
      new_client:         '🎉',
      cancellation:       '😢',
      payment_failed:     '⚠️',
      courtesy_activated: '🎁',
    };
    const titleMap: Record<string, string> = {
      new_client:         'Nuevo cliente premium',
      cancellation:       'Cancelación de licencia',
      payment_failed:     'Fallo de pago',
      courtesy_activated: 'Cortesía activada',
    };

    await this.sendDiscordWebhook({
      embeds: [{
        title:       `${emojiMap[n.type]} ${titleMap[n.type]}`,
        color:       colorMap[n.type] || 0x3498db,
        fields: [
          { name: '🏠 Servidor', value: n.guildName, inline: true  },
          { name: '🔌 Addon',    value: n.addonName, inline: true  },
          ...(n.details ? [{ name: 'ℹ️ Detalles', value: n.details, inline: false }] : []),
        ],
        footer:    { text: 'Korex Admin' },
        timestamp: new Date().toISOString(),
      }],
    });

    logger.info(`Team notified: license event ${n.type} for guild ${n.guildId}`);
  }

  /** Notifica un error crítico del bot */
  async notifyCriticalError(service: string, message: string, meta?: object): Promise<void> {
    await this.sendDiscordWebhook({
      embeds: [{
        title:       `🚨 Error crítico — ${service}`,
        description: `\`\`\`${message}\`\`\``,
        color:       0xe74c3c,
        fields:      meta ? [{ name: 'Meta', value: `\`\`\`json\n${JSON.stringify(meta, null, 2).slice(0, 1000)}\`\`\`` }] : [],
        footer:      { text: 'Korex Bot Error Monitor' },
        timestamp:   new Date().toISOString(),
      }],
    });
  }
}
