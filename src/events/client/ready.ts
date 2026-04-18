import { Event } from '../../client/structures/Event';
import { KorexClient } from '../../client/KorexClient';

/**
 * Evento que se dispara cuando el cliente está listo y conectado a Discord.
 * Usa 'clientReady' para compatibilidad con Discord.js v15+
 */
export default class ReadyEvent extends Event<'clientReady'> {
  constructor(client: KorexClient) {
    super(client, {
      name: 'clientReady',
      once: true,
    });
  }

  async execute(): Promise<void> {
    // Llamar al método onReady del cliente
    await this.client.onReady();

    // Configurar presencia del bot
    this.client.user?.setPresence({
      activities: [
        {
          name: `${this.client.guilds.cache.size} servidores | !help`,
          type: 3, // WATCHING
        },
      ],
      status: 'online',
    });

    // Actualizar presencia cada 5 minutos
    setInterval(
      () => {
        this.updatePresence();
      },
      5 * 60 * 1000
    );

    // Inicializar tareas periódicas
    this.setupPeriodicTasks();

    // Inicializar sistema de música
    if (this.client.music && this.client.music.isEnabled()) {
      try {
        await this.client.music.init();
        this.client.logger.info('🎵 Sistema de música inicializado');
      } catch (error) {
        this.client.logger.warn('Sistema de música no disponible:', error);
      }
    }

    // Restore bot nicknames configured per guild
    this.restoreNicknames().catch(err =>
      this.client.logger.warn('Could not restore bot nicknames:', err)
    );

    this.client.logger.info('🎯 Evento ready ejecutado completamente');
  }

  /**
   * Apply any guild-specific bot nicknames stored in the database
   */
  private async restoreNicknames(): Promise<void> {
    const guildsWithNickname = await this.client.db.guild.findMany({
      where: { botNickname: { not: null } },
      select: { id: true, botNickname: true },
    });

    for (const row of guildsWithNickname) {
      const guild = this.client.guilds.cache.get(row.id);
      if (!guild) continue;
      try {
        await guild.members.me?.setNickname(row.botNickname);
      } catch {
        // Ignore permission errors per guild
      }
    }

    if (guildsWithNickname.length > 0) {
      this.client.logger.info(`✅ Nicknames restaurados en ${guildsWithNickname.length} servidor(es)`);
    }
  }

  /**
   * Actualizar presencia del bot
   */
  private updatePresence(): void {
    if (!this.client.user) return;

    const activities = [
      `${this.client.guilds.cache.size} servidores`,
      `${this.client.users.cache.size} usuarios`,
      `!help para ayuda`,
      `korex.dev`,
      `v${process.env.npm_package_version || '1.0.0'}`,
    ];

    const randomActivity = activities[Math.floor(Math.random() * activities.length)];

    this.client.user.setPresence({
      activities: [
        {
          name: randomActivity,
          type: 3, // WATCHING
        },
      ],
      status: 'online',
    });
  }

  /**
   * Configurar tareas periódicas
   */
  private setupPeriodicTasks(): void {
    // Limpiar base de datos cada 24 horas
    setInterval(
      async () => {
        try {
          this.client.logger.info('🧹 Iniciando limpieza periódica de base de datos...');
          const result = await this.client.database.cleanup();

          this.client.logger.info('✅ Limpieza completada:', result);
        } catch (error) {
          this.client.logger.error('❌ Error en limpieza periódica:', error);
        }
      },
      24 * 60 * 60 * 1000
    ); // 24 horas

    // Actualizar estadísticas cada hora
    setInterval(
      async () => {
        try {
          const stats = this.client.getBotInfo();

          this.client.logger.debug('📊 Estadísticas actualizadas:', {
            guilds: stats.guilds,
            users: stats.users,
            uptime: Math.floor(stats.uptime / 1000 / 60), // minutos
            memory: Math.floor(stats.memory.heapUsed / 1024 / 1024), // MB
          });
        } catch (error) {
          this.client.logger.error('❌ Error actualizando estadísticas:', error);
        }
      },
      60 * 60 * 1000
    ); // 1 hora

    this.client.logger.debug('⏰ Tareas periódicas configuradas');
  }
}
