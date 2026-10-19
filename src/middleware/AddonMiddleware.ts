import { CommandInteraction, ChatInputCommandInteraction } from 'discord.js';
import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';

export interface AddonCheckResult {
  allowed: boolean;
  reason?: string;
  upgradeUrl?: string;
}

/**
 * Check whether an addon is active for a server
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
    // Check license (active AddonLicense) AND that the addon is enabled in the guild
    const [isActive, isEnabled] = await Promise.all([
      client.addonSync.isAddonActive(guildId, addonName),
      client.addons.isEnabled(guildId, addonName),
    ]);

    if (isActive && isEnabled) {
      return { allowed: true };
    }

    // Addon not active - show premium message
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
 * Decorator for addon commands
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
 * Middleware to check an addon at runtime
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
 * Get the list of active addons for a server
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
 * Check whether a server has access to premium features
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
 * Get addon license information
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
 * Check addon usage limits
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

    // Get limits from the addon configuration
    const addonInfo = client.addons.getAddon(addonName);
    const limits = (addonInfo?.config as any)?.limits?.[license.plan];
    
    if (!limits || !limits[feature]) {
      return { allowed: true }; // No limits defined
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