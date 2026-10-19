import { ApplicationCommandPermissionsUpdateData } from 'discord.js';
import { Event } from '../../client/structures/Event';
import { KorexClient } from '../../client/KorexClient';

/**
 * El servidor cambió los permisos de comandos de Korex (Integraciones):
 * invalidar la caché que usan los comandos con prefijo.
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
      this.client.logger.warn('[Prefix] Error invalidando permisos de comandos:', error);
    }
  }
}
