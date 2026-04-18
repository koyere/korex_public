/**
 * EmailService
 *
 * Servicio de correo transaccional usando Resend.
 * Todos los templates están disponibles en ES e EN.
 * Registra cada envío en email_log para trazabilidad.
 */

import { Resend } from 'resend';
import type { PrismaClient } from '@prisma/client';
import { createLogger } from '../../utils/Logger';

const logger = createLogger('email-service');

// ─── Templates ───────────────────────────────────────────────────────────────

type TemplateVars = Record<string, string>;

interface EmailTemplate {
  subject: (vars: TemplateVars, lang: string) => string;
  html:    (vars: TemplateVars, lang: string) => string;
}

const KOREX_BLUE  = '#00D9FF';
const KOREX_DARK  = '#0d0d1a';
const KOREX_CARD  = '#1a1a2e';
const KOREX_TEXT  = '#e0e0e0';
const KOREX_MUTED = '#888888';

function baseLayout(content: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Korex</title>
</head>
<body style="margin:0;padding:0;background-color:${KOREX_DARK};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:${KOREX_DARK};padding:40px 20px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background-color:${KOREX_CARD};border-radius:12px;overflow:hidden;border:1px solid #2a2a3e;">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#0d0d1a 0%,#1a1a2e 100%);padding:28px 32px;border-bottom:1px solid #2a2a3e;">
            <table cellpadding="0" cellspacing="0"><tr>
              <td style="width:40px;height:40px;background-color:${KOREX_BLUE};border-radius:8px;text-align:center;vertical-align:middle;">
                <span style="color:#000;font-weight:900;font-size:18px;">K</span>
              </td>
              <td style="padding-left:12px;color:${KOREX_BLUE};font-size:20px;font-weight:700;letter-spacing:-0.5px;">Korex</td>
            </tr></table>
          </td>
        </tr>
        <!-- Content -->
        <tr><td style="padding:32px;color:${KOREX_TEXT};">${content}</td></tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #2a2a3e;text-align:center;color:${KOREX_MUTED};font-size:12px;">
            Korex Bot &nbsp;·&nbsp; <a href="https://korex.dev" style="color:${KOREX_BLUE};text-decoration:none;">korex.dev</a>
            &nbsp;·&nbsp; <a href="https://panel.korex.dev" style="color:${KOREX_BLUE};text-decoration:none;">Panel de control</a>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function button(text: string, url: string): string {
  return `<div style="margin:24px 0;">
    <a href="${url}" style="display:inline-block;background-color:${KOREX_BLUE};color:#000;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:15px;">${text}</a>
  </div>`;
}

function heading(text: string): string {
  return `<h1 style="color:${KOREX_BLUE};font-size:24px;margin:0 0 16px 0;font-weight:700;">${text}</h1>`;
}

function para(text: string): string {
  return `<p style="color:${KOREX_TEXT};font-size:15px;line-height:1.6;margin:0 0 12px 0;">${text}</p>`;
}

function divider(): string {
  return `<hr style="border:none;border-top:1px solid #2a2a3e;margin:24px 0;">`;
}

// ─── Definición de templates ─────────────────────────────────────────────────

const TEMPLATES: Record<string, EmailTemplate> = {
  welcome: {
    subject: (v, lang) => lang === 'es'
      ? `¡Bienvenido a Korex Premium, ${v.ownerName}!`
      : `Welcome to Korex Premium, ${v.ownerName}!`,
    html: (v, lang) => baseLayout(
      lang === 'es'
        ? heading('¡Bienvenido a Korex Premium!') +
          para(`Hola <strong>${v.ownerName}</strong>, gracias por confiar en Korex.`) +
          para(`Tu servidor <strong>${v.guildName}</strong> ya tiene acceso a las funcionalidades premium.`) +
          button('Ir al panel de control', `${process.env.PANEL_URL}/dashboard/${v.guildId}/addons`) +
          divider() +
          para(`<small style="color:${KOREX_MUTED}">Puedes cancelar tu suscripción en cualquier momento desde PayPal.</small>`)
        : heading('Welcome to Korex Premium!') +
          para(`Hello <strong>${v.ownerName}</strong>, thank you for choosing Korex.`) +
          para(`Your server <strong>${v.guildName}</strong> now has access to premium features.`) +
          button('Go to dashboard', `${process.env.PANEL_URL}/dashboard/${v.guildId}/addons`) +
          divider() +
          para(`<small style="color:${KOREX_MUTED}">You can cancel your subscription anytime from PayPal.</small>`)
    ),
  },

  license_activated: {
    subject: (v, lang) => lang === 'es'
      ? `[${v.addonName}] activado en ${v.guildName}`
      : `[${v.addonName}] activated on ${v.guildName}`,
    html: (v, lang) => baseLayout(
      lang === 'es'
        ? heading(`¡${v.addonName} activado!`) +
          para(`El addon <strong>${v.addonName}</strong> ha sido activado en <strong>${v.guildName}</strong>.`) +
          para(`Vencimiento: <strong>${v.expiresAt}</strong>`) +
          button('Configurar addon', `${process.env.PANEL_URL}/dashboard/${v.guildId}/addons/${v.addonSlug}`)
        : heading(`${v.addonName} activated!`) +
          para(`The addon <strong>${v.addonName}</strong> has been activated on <strong>${v.guildName}</strong>.`) +
          para(`Expires: <strong>${v.expiresAt}</strong>`) +
          button('Configure addon', `${process.env.PANEL_URL}/dashboard/${v.guildId}/addons/${v.addonSlug}`)
    ),
  },

  license_expiring: {
    subject: (v, lang) => lang === 'es'
      ? `Tu licencia de ${v.addonName} vence en 3 días`
      : `Your ${v.addonName} license expires in 3 days`,
    html: (v, lang) => baseLayout(
      lang === 'es'
        ? heading('Tu licencia está por vencer') +
          para(`El addon <strong>${v.addonName}</strong> en <strong>${v.guildName}</strong> vence el <strong>${v.expiresAt}</strong>.`) +
          para('Tu suscripción de PayPal se renovará automáticamente. Si tienes algún problema con el pago, actualiza tu método en PayPal.') +
          button('Gestionar suscripción', v.paypalUrl || 'https://paypal.com')
        : heading('Your license is expiring soon') +
          para(`The addon <strong>${v.addonName}</strong> on <strong>${v.guildName}</strong> expires on <strong>${v.expiresAt}</strong>.`) +
          para('Your PayPal subscription will renew automatically. If you have any payment issues, update your payment method on PayPal.') +
          button('Manage subscription', v.paypalUrl || 'https://paypal.com')
    ),
  },

  payment_failed: {
    subject: (v, lang) => lang === 'es'
      ? `Problema con tu pago de Korex — ${v.addonName}`
      : `Payment issue with your Korex subscription — ${v.addonName}`,
    html: (v, lang) => baseLayout(
      lang === 'es'
        ? heading('Problema con tu pago') +
          para(`Hemos tenido un problema al procesar el pago de <strong>${v.addonName}</strong> en <strong>${v.guildName}</strong>.`) +
          para('Por favor actualiza tu método de pago en PayPal para evitar la suspensión del servicio.') +
          para(`<strong>Intentos fallidos: ${v.failures}/2</strong>. Tras 2 fallos el servicio será suspendido automáticamente.`) +
          button('Actualizar método de pago', v.paypalUrl || 'https://paypal.com')
        : heading('Payment issue') +
          para(`We had trouble processing the payment for <strong>${v.addonName}</strong> on <strong>${v.guildName}</strong>.`) +
          para('Please update your payment method on PayPal to avoid service suspension.') +
          para(`<strong>Failed attempts: ${v.failures}/2</strong>. After 2 failures the service will be automatically suspended.`) +
          button('Update payment method', v.paypalUrl || 'https://paypal.com')
    ),
  },

  payment_failed_final: {
    subject: (v, lang) => lang === 'es'
      ? `Tu addon ${v.addonName} ha sido suspendido`
      : `Your ${v.addonName} addon has been suspended`,
    html: (v, lang) => baseLayout(
      lang === 'es'
        ? heading('Servicio suspendido') +
          para(`El addon <strong>${v.addonName}</strong> en <strong>${v.guildName}</strong> ha sido suspendido por fallo de pago.`) +
          para('Para reactivar el servicio, actualiza tu método de pago en PayPal y contacta a nuestro soporte.') +
          button('Contactar soporte', `${process.env.PANEL_URL}/dashboard/${v.guildId}/support`)
        : heading('Service suspended') +
          para(`The addon <strong>${v.addonName}</strong> on <strong>${v.guildName}</strong> has been suspended due to payment failure.`) +
          para('To reactivate the service, update your payment method on PayPal and contact our support.') +
          button('Contact support', `${process.env.PANEL_URL}/dashboard/${v.guildId}/support`)
    ),
  },

  license_cancelled: {
    subject: (v, lang) => lang === 'es'
      ? `Confirmación de cancelación — ${v.addonName}`
      : `Cancellation confirmation — ${v.addonName}`,
    html: (v, lang) => baseLayout(
      lang === 'es'
        ? heading('Suscripción cancelada') +
          para(`Has cancelado el addon <strong>${v.addonName}</strong> en <strong>${v.guildName}</strong>.`) +
          para(`El servicio permanecerá activo hasta el <strong>${v.expiresAt}</strong>.`) +
          para('Puedes volver a suscribirte en cualquier momento desde tu panel de control.')
        : heading('Subscription cancelled') +
          para(`You have cancelled the addon <strong>${v.addonName}</strong> on <strong>${v.guildName}</strong>.`) +
          para(`The service will remain active until <strong>${v.expiresAt}</strong>.`) +
          para('You can resubscribe at any time from your control panel.')
    ),
  },

  courtesy_activated: {
    subject: (v, lang) => lang === 'es'
      ? `Korex te ha activado ${v.addonName} de cortesía`
      : `Korex has activated ${v.addonName} for you (courtesy)`,
    html: (v, lang) => baseLayout(
      lang === 'es'
        ? heading('¡Tienes acceso de cortesía!') +
          para(`El equipo de Korex ha activado el addon <strong>${v.addonName}</strong> de forma gratuita en <strong>${v.guildName}</strong> durante <strong>${v.days} día(s)</strong>.`) +
          (v.reason ? para(`Motivo: <em>${v.reason}</em>`) : '') +
          button('Ir al panel', `${process.env.PANEL_URL}/dashboard/${v.guildId}/addons`)
        : heading('You have courtesy access!') +
          para(`The Korex team has activated the addon <strong>${v.addonName}</strong> for free on <strong>${v.guildName}</strong> for <strong>${v.days} day(s)</strong>.`) +
          (v.reason ? para(`Reason: <em>${v.reason}</em>`) : '') +
          button('Go to panel', `${process.env.PANEL_URL}/dashboard/${v.guildId}/addons`)
    ),
  },

  support_reply: {
    subject: (v, lang) => lang === 'es'
      ? `Respuesta a tu ticket #${v.ticketId} — Soporte Korex`
      : `Reply to your ticket #${v.ticketId} — Korex Support`,
    html: (v, lang) => baseLayout(
      lang === 'es'
        ? heading(`Respuesta a tu ticket #${v.ticketId}`) +
          para(`El equipo de Korex ha respondido a tu ticket <strong>"${v.subject}"</strong>.`) +
          `<div style="background-color:#0d0d1a;border-left:3px solid ${KOREX_BLUE};padding:16px;border-radius:0 8px 8px 0;margin:16px 0;">
            <p style="color:${KOREX_TEXT};font-size:14px;margin:0;line-height:1.6;">${v.preview}</p>
          </div>` +
          button('Ver ticket completo', `${process.env.PANEL_URL}/dashboard/${v.guildId}/support/${v.ticketId}`)
        : heading(`Reply to your ticket #${v.ticketId}`) +
          para(`The Korex team has replied to your ticket <strong>"${v.subject}"</strong>.`) +
          `<div style="background-color:#0d0d1a;border-left:3px solid ${KOREX_BLUE};padding:16px;border-radius:0 8px 8px 0;margin:16px 0;">
            <p style="color:${KOREX_TEXT};font-size:14px;margin:0;line-height:1.6;">${v.preview}</p>
          </div>` +
          button('View full ticket', `${process.env.PANEL_URL}/dashboard/${v.guildId}/support/${v.ticketId}`)
    ),
  },

  reactivation: {
    subject: (v, lang) => lang === 'es'
      ? `Tu licencia de ${v.addonName} ha sido reactivada`
      : `Your ${v.addonName} license has been reactivated`,
    html: (v, lang) => baseLayout(
      lang === 'es'
        ? heading('¡Servicio reactivado!') +
          para(`El addon <strong>${v.addonName}</strong> en <strong>${v.guildName}</strong> ha sido reactivado correctamente.`) +
          button('Ir al panel', `${process.env.PANEL_URL}/dashboard/${v.guildId}/addons`)
        : heading('Service reactivated!') +
          para(`The addon <strong>${v.addonName}</strong> on <strong>${v.guildName}</strong> has been successfully reactivated.`) +
          button('Go to panel', `${process.env.PANEL_URL}/dashboard/${v.guildId}/addons`)
    ),
  },
};

// ─── Clase principal ──────────────────────────────────────────────────────────

export class EmailService {
  private resend: Resend | null = null;
  private from: string;
  private db: PrismaClient;

  constructor(db: PrismaClient) {
    this.db = db;
    this.from = process.env.RESEND_FROM_EMAIL || 'noreply@korex.dev';

    if (process.env.RESEND_API_KEY) {
      this.resend = new Resend(process.env.RESEND_API_KEY);
    } else {
      logger.warn('RESEND_API_KEY not set — emails will be logged but not sent');
    }
  }

  /**
   * Envía un email transaccional.
   * @param to        Dirección de destino
   * @param templateId ID del template (ej: 'license_activated')
   * @param variables  Variables para el template
   * @param opts       Opciones opcionales (guildId, campaignId, lang)
   */
  async send(
    to: string,
    templateId: string,
    variables: TemplateVars,
    opts: { guildId?: string; campaignId?: string; lang?: string } = {}
  ): Promise<void> {
    const template = TEMPLATES[templateId];
    if (!template) {
      logger.error(`Unknown email template: ${templateId}`);
      return;
    }

    const lang    = opts.lang || 'es';
    const subject = template.subject(variables, lang);
    const html    = template.html(variables, lang);

    let resendId: string | undefined;
    let error: string | undefined;

    try {
      if (this.resend) {
        const { data, error: resendError } = await this.resend.emails.send({
          from: this.from,
          to,
          subject,
          html,
        });
        if (resendError) throw new Error(resendError.message);
        resendId = data?.id;
      } else {
        // Dev mode: log the email in console
        logger.info(`[EMAIL DEV] To: ${to} | Subject: ${subject}`);
      }
    } catch (err: any) {
      error = err.message;
      logger.error(`Email send failed: ${err.message}`, { to, templateId });
    }

    // Siempre registrar en email_log
    await this.db.emailLog.create({
      data: {
        guildId:    opts.guildId,
        recipient:  to,
        templateId,
        campaignId: opts.campaignId,
        status:     error ? 'failed' : 'sent',
        resendId,
        error,
      },
    }).catch(e => logger.error('Error writing email_log', { error: e }));
  }

  /** Lista los templates disponibles */
  getTemplateIds(): string[] {
    return Object.keys(TEMPLATES);
  }

  /** Obtiene la lista de logs de emails de un guild */
  async getLogsForGuild(guildId: string, limit = 50) {
    return this.db.emailLog.findMany({
      where: { guildId },
      orderBy: { sentAt: 'desc' },
      take: limit,
    });
  }
}
