import { createCanvas, loadImage, registerFont } from 'canvas';
import { GuildMember, AttachmentBuilder } from 'discord.js';
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
  description: string;
  width: number;
  height: number;
  colors: { primary: string; secondary: string; text: string; accent: string };
}

const templates: Record<string, WelcomeTemplate> = {
  'modern-dark': { id: 'modern-dark', name: 'Modern Dark', description: 'Tema oscuro moderno', width: 700, height: 250, colors: { primary: '#1a1a2e', secondary: '#16213e', text: '#ffffff', accent: '#00d4ff' } },
  'modern-light': { id: 'modern-light', name: 'Modern Light', description: 'Tema claro moderno', width: 700, height: 250, colors: { primary: '#f0f0f0', secondary: '#e0e0e0', text: '#1a1a1a', accent: '#5865f2' } },
  'sunset': { id: 'sunset', name: 'Sunset', description: 'Atardecer cálido', width: 700, height: 250, colors: { primary: '#2d1a3d', secondary: '#4a1942', text: '#ffffff', accent: '#ff6b6b' } },
  'ocean': { id: 'ocean', name: 'Ocean', description: 'Océano profundo', width: 700, height: 250, colors: { primary: '#0a1628', secondary: '#1a2744', text: '#ffffff', accent: '#00bcd4' } },
  'forest': { id: 'forest', name: 'Forest', description: 'Bosque verde', width: 700, height: 250, colors: { primary: '#1a2e1a', secondary: '#2d4a2d', text: '#ffffff', accent: '#4caf50' } },
};

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

  public async generateWelcomeImage(member: GuildMember, templateId: string = 'modern-dark', backgroundUrl?: string): Promise<AttachmentBuilder | null> {
    try {
      const template = templates[templateId] || templates['modern-dark'];
      const buffer = await this.createImage(member, template, backgroundUrl);

      return new AttachmentBuilder(buffer, { name: 'welcome.png' });
    } catch (error) {
      console.error('Error generating welcome image:', error);

      return null;
    }
  }

  private async createImage(member: GuildMember, template: WelcomeTemplate, backgroundUrl?: string): Promise<Buffer> {
    const width = 700;
    const height = 250;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Background
    if (backgroundUrl) {
      try {
        const bg = await loadImage(backgroundUrl);

        ctx.drawImage(bg, 0, 0, width, height);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, width, height);
      } catch {
        this.drawGradientBackground(ctx, width, height, template);
      }
    } else {
      this.drawGradientBackground(ctx, width, height, template);
    }

    // Avatar
    const avatarSize = 100;
    const avatarX = 50;
    const avatarY = (height - avatarSize) / 2;

    // Avatar border
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 4, 0, Math.PI * 2);
    ctx.fillStyle = template.colors.accent;
    ctx.fill();

    // Load avatar
    try {
      const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 256 });
      const avatar = await loadImage(avatarUrl);

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

    // Text
    const textX = avatarX + avatarSize + 30;

    ctx.fillStyle = template.colors.text;
    ctx.font = 'bold 28px Poppins, Arial, sans-serif';
    ctx.fillText('¡Bienvenido!', textX, 80);

    ctx.font = 'bold 22px Poppins, Arial, sans-serif';
    ctx.fillStyle = template.colors.accent;
    const username = member.user.username.length > 20 ? `${member.user.username.substring(0, 17)}...` : member.user.username;

    ctx.fillText(username, textX, 115);

    ctx.font = '16px Poppins, Arial, sans-serif';
    ctx.fillStyle = '#cccccc';
    ctx.fillText(`Eres el miembro #${member.guild.memberCount}`, textX, 150);
    ctx.fillText(member.guild.name, textX, 175);

    // Member count badge
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(width - 120, height - 40, 110, 30);
    ctx.fillStyle = template.colors.text;
    ctx.font = '14px Poppins, Arial, sans-serif';
    ctx.fillText(`#${member.guild.memberCount}`, width - 80, height - 20);

    return canvas.toBuffer('image/png');
  }

  private drawGradientBackground(ctx: any, width: number, height: number, template: WelcomeTemplate) {
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
}

// Export standalone function for API use
export async function generateWelcomeImage(options: {
  member: GuildMember;
  message: string;
  backgroundUrl?: string;
  type: 'welcome' | 'goodbye';
}): Promise<Buffer> {
  const { member, backgroundUrl, type } = options;
  const template = type === 'welcome' ? templates['modern-dark'] : templates['sunset'];
  
  const width = 700;
  const height = 250;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background
  if (backgroundUrl) {
    try {
      const bg = await loadImage(backgroundUrl);

      ctx.drawImage(bg, 0, 0, width, height);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, 0, width, height);
    } catch {
      drawBg(ctx, width, height, template);
    }
  } else {
    drawBg(ctx, width, height, template);
  }

  // Avatar
  const avatarSize = 100;
  const avatarX = 50;
  const avatarY = (height - avatarSize) / 2;

  ctx.beginPath();
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 4, 0, Math.PI * 2);
  ctx.fillStyle = template.colors.accent;
  ctx.fill();

  try {
    const avatar = await loadImage(member.user.displayAvatarURL({ extension: 'png', size: 256 }));

    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
    ctx.restore();
  } catch {
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#7289da';
    ctx.fill();
  }

  const textX = avatarX + avatarSize + 30;

  ctx.fillStyle = template.colors.text;
  ctx.font = 'bold 28px Poppins, Arial, sans-serif';
  ctx.fillText(type === 'welcome' ? '¡Bienvenido!' : '¡Hasta pronto!', textX, 80);

  ctx.font = 'bold 22px Poppins, Arial, sans-serif';
  ctx.fillStyle = template.colors.accent;
  ctx.fillText(member.user.username.substring(0, 20), textX, 115);

  ctx.font = '16px Poppins, Arial, sans-serif';
  ctx.fillStyle = '#cccccc';
  ctx.fillText(`Miembro #${member.guild.memberCount}`, textX, 150);
  ctx.fillText(member.guild.name, textX, 175);

  return canvas.toBuffer('image/png');
}

function drawBg(ctx: any, w: number, h: number, t: WelcomeTemplate) {
  const g = ctx.createLinearGradient(0, 0, w, h);

  g.addColorStop(0, t.colors.primary);
  g.addColorStop(1, t.colors.secondary);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.beginPath();
  ctx.arc(w - 50, 50, 100, 0, Math.PI * 2);
  ctx.fill();
}
