import { Guild } from 'discord.js';
import { Event } from '../../client/structures/Event';
import { KorexClient } from '../../client/KorexClient';

export default class GuildDeleteEvent extends Event<'guildDelete'> {
  constructor(client: KorexClient) {
    super(client, {
      name: 'guildDelete',
      once: false,
    });
  }

  async execute(guild: Guild): Promise<void> {
    this.client.logger.info(`📤 Bot removido del servidor: ${guild.name} (${guild.id})`);

    try {
      // Limpiar datos del servidor (opcional, según política de retención)
      await this.cleanupGuildData(guild.id);

      // Actualizar presencia del bot
      this.updateBotPresence();

      // Log estadísticas
      this.client.logger.info(`📊 Ahora sirviendo ${this.client.guilds.cache.size} servidores`);
    } catch (error) {
      this.client.logger.error(`Error limpiando datos del servidor ${guild.id}:`, error);
    }
  }

  /**
   * Limpiar datos del servidor
   */
  private async cleanupGuildData(guildId: string): Promise<void> {
    try {
      // Política de retención: mantener datos por 30 días por si el bot es re-añadido
      // Solo marcar como inactivo en lugar de eliminar inmediatamente

      // Invalidar caché del servidor
      await this.client.cache.invalidateGuildConfig(guildId);

      // Limpiar datos temporales de Redis
      await this.client.cache.clearPattern(`guild:${guildId}:*`);

      // Opcional: Marcar servidor como inactivo en lugar de eliminar
      // await this.client.db.guild.update({
      //   where: { id: guildId },
      //   data: {
      //     leftAt: new Date(),
      //     active: false
      //   }
      // });

      this.client.logger.debug(`Datos temporales limpiados para servidor ${guildId}`);
    } catch (error) {
      this.client.logger.error(`Error limpiando datos del servidor ${guildId}:`, error);
    }
  }

  /**
   * Actualizar presencia del bot
   */
  private updateBotPresence(): void {
    this.client.user?.setPresence({
      activities: [
        {
          name: `${this.client.guilds.cache.size} servidores | !help`,
          type: 3, // WATCHING
        },
      ],
      status: 'online',
    });
  }
}
