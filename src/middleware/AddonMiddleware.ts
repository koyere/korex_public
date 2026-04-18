import { CommandInteraction, ChatInputCommandInteraction } from 'discord.js';
import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';

export interface AddonCheckResult {
  allowed: boolean;
  reason?: string;
  upgradeUrl?: string;
}

/**
 * Verificar si un addon está activo para un servidor
 */
export async function requireAddon(
  client: KorexClient,
  interaction: CommandInteraction,
  addonName: string
): Promise<AddonCheckResult> {
  const guildId = interaction.guildId;
  
  if (!guildId) {
    return {
      allowed: false,
      reason: i18n.t('addons.errors.guild_only', guildId || 'en')
    };
  }

  try {
    // Verificar licencia (AddonLicense activa) Y que el addon esté habilitado en el guild
    const [isActive, isEnabled] = await Promise.all([
      client.addonSync.isAddonActive(guildId, addonName),
      client.addons.isEnabled(guildId, addonName),
    ]);

    if (isActive && isEnabled) {
      return { allowed: true };
    }

    // Addon no activo - mostrar mensaje premium
    const addonInfo = client.addons.getAddon(addonName);
    const displayName = addonInfo?.config.displayName || addonName;

    return {
      allowed: false,
      reason: i18n.t('addons.premium_required', guildId, { 
        addon: displayName 
      }),
      upgradeUrl: `${process.env.PANEL_URL || 'https://panel.korex.dev'}/dashboard/${guildId}/addons`
    };
  } catch (error) {
    client.logger.error(`Error checking addon ${addonName} for guild ${guildId}:`, error);
    
    return {
      allowed: false,
      reason: i18n.t('addons.errors.check_failed', guildId)
    };
  }
}

/**
 * Decorador para comandos de addon
 */
export function AddonCommand(addonName: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (interaction: ChatInputCommandInteraction) {
      const client = (this as any).client as KorexClient;
      const check = await requireAddon(client, interaction, addonName);

      if (!check.allowed) {
        const components = check.upgradeUrl ? [{
          type: 1,
          components: [{
            type: 2,
            style: 5,
            label: i18n.t('addons.buttons.activate', interaction.guildId || 'en'),
            url: check.upgradeUrl
          }]
        }] : [];

        await interaction.reply({
          content: check.reason || 'Access denied',
          components,
          ephemeral: true
        });

        return;
      }

      return originalMethod.apply(this, [interaction]);
    };

    return descriptor;
  };
}

/**
 * Middleware para verificar addon en tiempo de ejecución
 */
export async function checkAddonAccess(
  client: KorexClient,
  guildId: string,
  addonName: string
): Promise<boolean> {
  try {
    return await client.addonSync.isAddonActive(guildId, addonName);
  } catch (error) {
    client.logger.error(`Error checking addon access for ${addonName} in guild ${guildId}:`, error);

    return false;
  }
}

/**
 * Obtener lista de addons activos para un servidor
 */
export async function getActiveAddons(
  client: KorexClient,
  guildId: string
): Promise<string[]> {
  try {
    const licenses = await client.db.addonLicense.findMany({
      where: {
        guildId,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() }
      },
      select: {
        addonName: true
      }
    });

    return licenses.map((license: any) => license.addonName);
  } catch (error) {
    client.logger.error(`Error getting active addons for guild ${guildId}:`, error);

    return [];
  }
}

/**
 * Verificar si un servidor tiene acceso a funciones premium
 */
export async function hasPremiumAccess(
  client: KorexClient,
  guildId: string
): Promise<boolean> {
  try {
    const activeAddons = await getActiveAddons(client, guildId);

    return activeAddons.length > 0;
  } catch (error) {
    client.logger.error(`Error checking premium access for guild ${guildId}:`, error);

    return false;
  }
}

/**
 * Obtener información de licencia de addon
 */
export async function getAddonLicense(
  client: KorexClient,
  guildId: string,
  addonName: string
) {
  try {
    return await client.db.addonLicense.findFirst({
      where: {
        guildId,
        addonName,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() }
      }
    });
  } catch (error) {
    client.logger.error(`Error getting addon license for ${addonName} in guild ${guildId}:`, error);

    return null;
  }
}

/**
 * Verificar límites de uso de addon
 */
export async function checkAddonLimits(
  client: KorexClient,
  guildId: string,
  addonName: string,
  feature: string,
  currentUsage: number
): Promise<{ allowed: boolean; limit?: number; remaining?: number }> {
  try {
    const license = await getAddonLicense(client, guildId, addonName);
    
    if (!license) {
      return { allowed: false };
    }

    // Obtener límites desde configuración del addon
    const addonInfo = client.addons.getAddon(addonName);
    const limits = (addonInfo?.config as any)?.limits?.[license.plan];
    
    if (!limits || !limits[feature]) {
      return { allowed: true }; // Sin límites definidos
    }

    const limit = limits[feature];
    const remaining = Math.max(0, limit - currentUsage);
    
    return {
      allowed: currentUsage < limit,
      limit,
      remaining
    };
  } catch (error) {
    client.logger.error(`Error checking addon limits for ${addonName} in guild ${guildId}:`, error);

    return { allowed: false };
  }
}