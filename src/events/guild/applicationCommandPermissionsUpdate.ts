import { ApplicationCommandPermissionsUpdateData } from 'discord.js';
import { Event } from '../../client/structures/Event';
import { KorexClient } from '../../client/KorexClient';

/**
 * The server changed Korex's command permissions (Integrations):
 * invalidate the cache used by prefix commands.
 */
export default class ApplicationCommandPermissionsUpdateEvent extends Event<'applicationCommandPermissionsUpdate'> {
  constructor(client: KorexClient) {
    super(client, {
      name: 'applicationCommandPermissionsUpdate',
      once: false,
    });
  }

  async execute(data: ApplicationCommandPermissionsUpdateData): Promise<void> {
    try {
      const appId = this.client.application?.id ?? this.client.user?.id;
      if (!data?.guildId || (appId && data.applicationId !== appId)) return;
      await this.client.prefixCommands.commandPermissions.invalidate(data.guildId);
    } catch (error) {
      this.client.logger.warn('[Prefix] Error invalidating command permissions:', error);
    }
  }
}
