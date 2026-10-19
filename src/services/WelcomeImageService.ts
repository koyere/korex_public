import { createCanvas, loadImage, registerFont } from 'canvas';
import { fetchPublicImage } from '../utils/safeUrl';
import { GuildMember, AttachmentBuilder } from 'discord.js';
import { i18n } from '../utils/i18n';
import path from 'path';

// Register custom font if available
try {
  registerFont(path.join(__dirname, '../../assets/fonts/Poppins-Bold.ttf'), { family: 'Poppins', weight: 'bold' });
  registerFont(path.join(__dirname, '../../assets/fonts/Poppins-Regular.ttf'), { family: 'Poppins' });
} catch (e) {
  // Fonts not available, will use default
}

export interface WelcomeTemplate {
  id: string;
  name: string;
  width: number;
  height: number;
  // subtext: color de las líneas secundarias (por defecto gris claro, para fondos oscuros)
  colors: { primary: string; secondary: string; text: string; accent: string; subtext?: string };
}

export type WelcomeImageKind = 'welcome' | 'goodbye';

const templates: Record<string, WelcomeTemplate> = {
  'modern-dark':  { id: 'modern-dark',  name: 'Modern Dark',  width: 700, height: 250, colors: { primary: '#1a1a2e', secondary: '#16213e', text: '#ffffff', accent: '#00d4ff' } },
  'modern-light': { id: 'modern-light', name: 'Modern Light', width: 700, height: 250, colors: { primary: '#f0f0f0', secondary: '#e0e0e0', text: '#1a1a1a', accent: '#5865f2', subtext: '#555555' } },
  'sunset':       { id: 'sunset',       name: 'Sunset',       width: 700, height: 250, colors: { primary: '#2d1a3d', secondary: '#4a1942', text: '#ffffff', accent: '#ff6b6b' } },
  'ocean':        { id: 'ocean',        name: 'Ocean',        width: 700, height: 250, colors: { primary: '#0a1628', secondary: '#1a2744', text: '#ffffff', accent: '#00bcd4' } },
  'forest':       { id: 'forest',       name: 'Forest',       width: 700, height: 250, colors: { primary: '#1a2e1a', secondary: '#2d4a2d', text: '#ffffff', accent: '#4caf50' } },
  // Plantillas del catálogo de /welcome-image (paletas propias; mismo diseño de tarjeta)
  'minimalist-light': { id: 'minimalist-light', name: 'Minimalist Light', width: 700, height: 250, colors: { primary: '#ffffff', secondary: '#eef0f3', text: '#111827', accent: '#4b5563', subtext: '#4b5563' } },
  'gaming-neon':      { id: 'gaming-neon',      name: 'Gaming Neon',      width: 700, height: 250, colors: { primary: '#0d0221', secondary: '#1b0b3b', text: '#ffffff', accent: '#39ff14' } },
  'corporate-blue':   { id: 'corporate-blue',   name: 'Corporate Blue',   width: 700, height: 250, colors: { primary: '#0b2e6b', secondary: '#1d4f9c', text: '#ffffff', accent: '#7cc4ff' } },
  'anime-kawaii':     { id: 'anime-kawaii',     name: 'Anime Kawaii',     width: 700, height: 250, colors: { primary: '#ffe3ec', secondary: '#ffc2d6', text: '#4a1f3d', accent: '#ff5fa2', subtext: '#7a3e63' } },
  'retro-synthwave':  { id: 'retro-synthwave',  name: 'Retro Synthwave',  width: 700, height: 250, colors: { primary: '#241047', secondary: '#9b2a8a', text: '#ffffff', accent: '#00f0ff' } },
  'nature-green':     { id: 'nature-green',     name: 'Nature Green',     width: 700, height: 250, colors: { primary: '#14421f', secondary: '#3b7a3f', text: '#ffffff', accent: '#b5e655' } },
  'space-cosmic':     { id: 'space-cosmic',     name: 'Space Cosmic',     width: 700, height: 250, colors: { primary: '#05061a', secondary: '#24164f', text: '#ffffff', accent: '#b388ff' } },
  'elegant-purple':   { id: 'elegant-purple',   name: 'Elegant Purple',   width: 700, height: 250, colors: { primary: '#2a1033', secondary: '#55256b', text: '#f6eaff', accent: '#d4af37' } },
  'sunset-orange':    { id: 'sunset-orange',    name: 'Sunset Orange',    width: 700, height: 250, colors: { primary: '#c2410c', secondary: '#f59e0b', text: '#ffffff', accent: '#fff3b0', subtext: '#fff1e0' } },
};

export const WELCOME_TEMPLATE_IDS = Object.keys(templates);
export const DEFAULT_WELCOME_TEMPLATE = 'modern-dark';
const DEFAULT_GOODBYE_TEMPLATE = 'sunset';

export class WelcomeImageService {
  private static instance: WelcomeImageService;

  public static getInstance(): WelcomeImageService {
    if (!WelcomeImageService.instance) {
      WelcomeImageService.instance = new WelcomeImageService();
    }

    return WelcomeImageService.instance;
  }

  public getTemplates(): WelcomeTemplate[] {
    return Object.values(templates);
  }

  public getTemplate(templateId: string): WelcomeTemplate | undefined {
    return templates[templateId];
  }

  /** Imagen de bienvenida o despedida lista para adjuntar (null si falla). */
  public async generateImage(
    member: GuildMember,
    kind: WelcomeImageKind,
    templateId?: string,
    backgroundUrl?: string
  ): Promise<AttachmentBuilder | null> {
    try {
      const fallback = kind === 'welcome' ? DEFAULT_WELCOME_TEMPLATE : DEFAULT_GOODBYE_TEMPLATE;
      const template = (templateId && templates[templateId]) || templates[fallback];
      const buffer = await renderImage(member, kind, template, backgroundUrl);

      return new AttachmentBuilder(buffer, { name: `${kind}.png` });
    } catch (error) {
      console.error(`Error generating ${kind} image:`, error);

      return null;
    }
  }

  /** Compatibilidad con /welcome-image (vista previa). */
  public async generateWelcomeImage(member: GuildMember, templateId: string = DEFAULT_WELCOME_TEMPLATE, backgroundUrl?: string): Promise<AttachmentBuilder | null> {
    return this.generateImage(member, 'welcome', templateId, backgroundUrl);
  }
}

async function renderImage(member: GuildMember, kind: WelcomeImageKind, template: WelcomeTemplate, backgroundUrl?: string): Promise<Buffer> {
  const width = 700;
  const height = 250;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const guildId = member.guild.id;

  // Background (URL pública del usuario, con protección SSRF; si falla, degradado)
  let drewCustomBg = false;
  if (backgroundUrl) {
    try {
      const bg = await loadImage(await fetchPublicImage(backgroundUrl));

      ctx.drawImage(bg, 0, 0, width, height);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, 0, width, height);
      drewCustomBg = true;
    } catch {
      drewCustomBg = false;
    }
  }
  if (!drewCustomBg) drawGradientBackground(ctx, width, height, template);

  // Avatar with border
  const avatarSize = 150;
  const avatarX = 50;
  const avatarY = (height - avatarSize) / 2;

  ctx.beginPath();
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 5, 0, Math.PI * 2);
  ctx.fillStyle = template.colors.accent;
  ctx.fill();

  try {
    const avatar = await loadImage(member.user.displayAvatarURL({ extension: 'png', size: 256 }));

    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
    ctx.restore();
  } catch {
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#7289da';
    ctx.fill();
  }

  // Text (en el idioma del servidor)
  const textX = avatarX + avatarSize + 30;
  const count = String(member.guild.memberCount);

  ctx.fillStyle = drewCustomBg ? '#ffffff' : template.colors.text;
  ctx.font = 'bold 28px Poppins, Arial, sans-serif';
  ctx.fillText(i18n.t(`welcome.image.title_${kind}`, guildId), textX, 80);

  ctx.font = 'bold 22px Poppins, Arial, sans-serif';
  ctx.fillStyle = template.colors.accent;
  const username = member.user.username.length > 20 ? `${member.user.username.substring(0, 17)}...` : member.user.username;

  ctx.fillText(username, textX, 115);

  ctx.font = '16px Poppins, Arial, sans-serif';
  ctx.fillStyle = drewCustomBg ? '#cccccc' : (template.colors.subtext ?? '#cccccc');
  const subtitle = kind === 'welcome'
    ? i18n.t('welcome.image.member_number', guildId, { count })
    : i18n.t('welcome.image.members_now', guildId, { count });
  ctx.fillText(subtitle, textX, 150);
  ctx.fillText(member.guild.name.substring(0, 40), textX, 175);

  return canvas.toBuffer('image/png');
}

function drawGradientBackground(ctx: any, width: number, height: number, template: WelcomeTemplate) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);

  gradient.addColorStop(0, template.colors.primary);
  gradient.addColorStop(1, template.colors.secondary);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Decorative circles
  ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.beginPath();
  ctx.arc(width - 50, 50, 100, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(100, height + 50, 150, 0, Math.PI * 2);
  ctx.fill();
}
