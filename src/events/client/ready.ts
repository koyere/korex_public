import { Event } from '../../client/structures/Event';
import { KorexClient } from '../../client/KorexClient';

/**
 * Event fired when the client is ready and connected to Discord.
 * Uses 'clientReady' for compatibility with Discord.js v15+
 */
export default class ReadyEvent extends Event<'clientReady'> {
  constructor(client: KorexClient) {
    super(client, {
      name: 'clientReady',
      once: true,
    });
  }

  async execute(): Promise<void> {
    // Call the client's onReady method
    await this.client.onReady();

    // Invite cache to know who invited each member (/invites)
    this.client.inviteService.init().catch((err) => this.client.logger.warn('Invite tracking init failed:', err));

    // Set up the bot presence
    this.client.user?.setPresence({
      activities: [
        {
          name: `${this.client.guilds.cache.size} servers | /help`,
          type: 3, // WATCHING
        },
      ],
      status: 'online',
    });

    // Update presence every 5 minutes
    setInterval(
      () => {
        this.updatePresence();
      },
      5 * 60 * 1000
    );

    // Initialize periodic tasks
    this.setupPeriodicTasks();

    // Initialize music system
    if (this.client.music && this.client.music.isEnabled()) {
      try {
        await this.client.music.init();
        this.client.logger.info('🎵 Music system initialized');
      } catch (error) {
        this.client.logger.warn('Music system unavailable:', error);
      }
    }

    // Restore bot nicknames configured per guild
    this.restoreNicknames().catch(err =>
      this.client.logger.warn('Could not restore bot nicknames:', err)
    );

    this.client.logger.info('🎯 Ready event fully executed');
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
      this.client.logger.info(`✅ Nicknames restored in ${guildsWithNickname.length} server(s)`);
    }
  }

  /**
   * Update the bot presence
   */
  private updatePresence(): void {
    if (!this.client.user) return;

    const activities = [
      `${this.client.guilds.cache.size} servers`,
      `${this.client.users.cache.size} users`,
      `/help`,
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
   * Set up periodic tasks
   */
  private setupPeriodicTasks(): void {
    // Pending delayed join roles (persisted in DB: survive restarts)
    try {
      this.client.autoRole.startDelayedJoinRoleWorker(this.client);
    } catch (error) {
      this.client.logger.error('Error starting delayed join role worker:', error);
    }

    // Pending verification deadlines (persisted in Redis: survive restarts)
    try {
      this.client.verificationService.startDeadlineWorker();
    } catch (error) {
      this.client.logger.error('Error starting verification deadline worker:', error);
    }

    // Clean the database every 24 hours
    setInterval(
      async () => {
        try {
          this.client.logger.info('🧹 Starting periodic database cleanup...');
          const result = await this.client.database.cleanup();

          this.client.logger.info('✅ Cleanup completed:', result);
        } catch (error) {
          this.client.logger.error('❌ Error in periodic cleanup:', error);
        }
      },
      24 * 60 * 60 * 1000
    ); // 24 hours

    // Update statistics every hour
    setInterval(
      async () => {
        try {
          const stats = this.client.getBotInfo();

          this.client.logger.debug('📊 Statistics updated:', {
            guilds: stats.guilds,
            users: stats.users,
            uptime: Math.floor(stats.uptime / 1000 / 60), // minutes
            memory: Math.floor(stats.memory.heapUsed / 1024 / 1024), // MB
          });
        } catch (error) {
          this.client.logger.error('❌ Error updating statistics:', error);
        }
      },
      60 * 60 * 1000
    ); // 1 hour

    this.client.logger.debug('⏰ Periodic tasks configured');
  }
}
