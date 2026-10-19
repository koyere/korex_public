import { Client, ClientOptions, Collection } from 'discord.js';
import { PrismaClient } from '@prisma/client';

// Managers
import { CommandManager } from './managers/CommandManager';
import { EventManager } from './managers/EventManager';
import { AddonManager } from './managers/AddonManager';
import { CooldownManager } from './managers/CooldownManager';
import { ComponentManager } from './managers/ComponentManager';
import { DatabaseManager } from './managers/DatabaseManager';

// Cache
import { RedisClient } from '../database/cache/RedisClient';
import { CacheManager } from '../database/cache/CacheManager';

// Services (to be imported once they are created)
import { LicenseService } from '../services/LicenseService';
import { ErrorHandler } from '../services/ErrorHandler';
import { ModerationService } from '../services/ModerationService';
import { EconomyService } from '../services/EconomyService';
import { LevelService } from '../services/LevelService';
import { LoggingService } from '../services/LoggingService';
import { WelcomeService } from '../services/WelcomeService';
import { VerificationService } from '../services/VerificationService';
import { AutoRoleService } from '../services/AutoRoleService';
import { MusicService } from '../services/MusicService';
import { GiveawayService } from '../services/GiveawayService';
import { PollService } from '../services/PollService';
import { InviteService } from '../services/InviteService';
import { UserStatsService } from '../services/UserStatsService';
import { ShopService } from '../services/ShopService';
import { SuggestionService } from '../services/SuggestionService';
import { AutoResponseService } from '../services/AutoResponseService';
import { PremiumService } from '../services/PremiumService';
import { AddonSyncService } from '../services/AddonSyncService';
import { AnalyticsService } from '../services/AnalyticsService';
import { AutoModService } from '../services/AutoModService';
import { StarboardService } from '../services/StarboardService';
import { HoneypotService } from '../services/HoneypotService';
import { AntiRaidService } from '../services/AntiRaidService';

import { LicenseExpiryJob } from '../services/LicenseExpiryJob';
import { GuildKickoutService } from '../services/GuildKickoutService';
import { PrefixCommandHandler } from './prefix/PrefixCommandHandler';

// Admin Panel Services
import { AdminAuthService } from '../services/admin/AdminAuthService';
import { EmailService } from '../services/admin/EmailService';
import { TeamNotificationService } from '../services/admin/TeamNotificationService';
import { SupportTicketService } from '../services/admin/SupportTicketService';

// Production Services
import { RateLimiter } from '../middleware/rateLimiting';
import { ProductionLogger } from '../logging/ProductionLogger';
import { HealthMonitor } from '../monitoring/HealthMonitor';
import { BackupManager } from '../backup/BackupManager';
import { DatabaseOptimizer } from '../database/optimization/DatabaseOptimizer';
import { StatusPageService } from '../services/StatusPageService';

// Utils
import { createLogger } from '../utils/Logger';
import { i18n } from '../utils/i18n';
import { botConfig } from '../config/bot.config';
import path from 'path';

export class KorexClient extends Client {
  // ═══════════════════════════════════════════════════════════════
  // MANAGERS
  // ═══════════════════════════════════════════════════════════════
  public commands: CommandManager;
  public events: EventManager;
  public addons: AddonManager;
  public cooldowns: CooldownManager;
  public components: ComponentManager;
  public database: DatabaseManager;

  // ═══════════════════════════════════════════════════════════════
  // DATABASE & CACHE
  // ═══════════════════════════════════════════════════════════════
  public db: PrismaClient;
  public redis: RedisClient;
  public cache: CacheManager;

  // ═══════════════════════════════════════════════════════════════
  // SERVICES
  // ═══════════════════════════════════════════════════════════════
  public licenses: LicenseService;
  public errorHandler: ErrorHandler;
  public moderation: ModerationService;
  public economy: EconomyService;
  public levels: LevelService;
  public logging: LoggingService;
  public welcome: WelcomeService;
  public verificationService: VerificationService;
  public autoRole: AutoRoleService;
  public music: MusicService;
  public giveawayService: GiveawayService;
  public pollService: PollService;
  public inviteService: InviteService;
  public userStats: UserStatsService;
  public shop: ShopService;
  public suggestionService: SuggestionService;
  public autoResponseService: AutoResponseService;
  public premiumService: PremiumService;
  public addonSync: AddonSyncService;
  public analytics: AnalyticsService;
  public autoMod: AutoModService;
  public starboard: StarboardService;
  public honeypot: HoneypotService;
  public antiRaid: AntiRaidService;

  // ═══════════════════════════════════════════════════════════════
  // ADMIN PANEL SERVICES
  // ═══════════════════════════════════════════════════════════════
  public adminAuthService: AdminAuthService;
  public emailService: EmailService;
  public teamNotification: TeamNotificationService;
  public supportTicketService: SupportTicketService;

  // ═══════════════════════════════════════════════════════════════
  // PRODUCTION SERVICES
  // ═══════════════════════════════════════════════════════════════
  public rateLimiter: RateLimiter;
  public productionLogger: ProductionLogger;
  public healthMonitor: HealthMonitor;
  public backupManager: BackupManager;
  public databaseOptimizer: DatabaseOptimizer;
  public licenseExpiryJob: LicenseExpiryJob;
  public kickoutService: GuildKickoutService;
  public prefixCommands: PrefixCommandHandler;
  public statusPage: StatusPageService;

  public services: {
    // license: LicenseService;
    // moderation: ModerationService;
    // economy: EconomyService;
    // levels: LevelService;
    // logging: LoggingService;
    // music: MusicService;
  } = {};

  // ═══════════════════════════════════════════════════════════════
  // HANDLERS & UTILS
  // ═══════════════════════════════════════════════════════════════
  // public errorHandler!: ErrorHandler;
  public logger = createLogger('korex');
  public i18n = i18n;
  public config = botConfig;

  // ═══════════════════════════════════════════════════════════════
  // BOT STATE
  // ═══════════════════════════════════════════════════════════════
  // Bot ready state (different from Discord.js isReady method)
  public botReady: boolean = false;
  public startTime: Date = new Date();
  public owners: Set<string> = new Set();

  constructor(options?: ClientOptions) {
    super({
      intents: botConfig.intents,
      partials: botConfig.partials,
      ...options,
    });

    // Initialize managers
    this.commands = new CommandManager(this);
    this.events = new EventManager(this);
    this.addons = new AddonManager(this);
    this.cooldowns = new CooldownManager(this);
    this.components = new ComponentManager(this);
    this.database = new DatabaseManager(this);

    // Initialize database and cache
    this.db = this.database.prisma;
    this.redis = new RedisClient(this);
    this.cache = new CacheManager(this);

    // Initialize services that do not require DatabaseManager
    this.errorHandler = ErrorHandler.getInstance();
    this.economy = EconomyService.getInstance();
    this.levels = LevelService.getInstance();
    this.shop = ShopService.getInstance();
    this.music = new MusicService(this);
    this.giveawayService = new GiveawayService(this);
    this.pollService = new PollService(this);
    this.inviteService = new InviteService(this);
    this.suggestionService = new SuggestionService(this);
    this.autoResponseService = new AutoResponseService(this);
    this.premiumService = new PremiumService(this);
    this.addonSync = new AddonSyncService(this);
    this.analytics = new AnalyticsService(this);
    this.autoMod = new AutoModService(this);
    this.starboard = new StarboardService(this);
    this.honeypot  = new HoneypotService(this);
    this.antiRaid  = new AntiRaidService(this);

    // Admin Panel Services
    this.adminAuthService    = new AdminAuthService(this.db, this.redis.getClient() as any);
    this.emailService        = new EmailService(this.db);
    this.teamNotification    = new TeamNotificationService(this);
    this.supportTicketService = new SupportTicketService(
      this.db,
      this.redis.getClient() as any,
      this.teamNotification,
      this.emailService
    );

    // Initialize services that require DatabaseManager
    this.licenses = LicenseService.getInstance(this.database);
    this.moderation = ModerationService.getInstance(this.database);
    this.logging = LoggingService.getInstance(this.database);
    this.welcome = WelcomeService.getInstance(this.database);
    this.verificationService = new VerificationService(this);
    this.autoRole = AutoRoleService.getInstance(this.database);
    this.userStats = UserStatsService.getInstance(this.database);

    // Set the database on the services
    this.errorHandler.setDatabase(this.database);
    this.economy.setDatabase(this.database);
    this.economy.setRedis(this.redis.getClient() as any); // "transactions today" counter
    this.levels.setDatabase(this.database);
    this.shop.setDatabase(this.database);

    // Initialize production services
    this.rateLimiter = new RateLimiter(this);
    this.productionLogger = new ProductionLogger(this);
    this.healthMonitor = new HealthMonitor(this);
    this.statusPage = new StatusPageService(this.healthMonitor);
    this.backupManager = new BackupManager(this);
    this.databaseOptimizer = new DatabaseOptimizer(this.db);
    this.licenseExpiryJob = new LicenseExpiryJob(this);
    this.kickoutService = new GuildKickoutService(this);
    this.prefixCommands = new PrefixCommandHandler(this);

    // Configure owners
    this.setupOwners();

    // Configure basic event handlers
    this.setupBasicHandlers();
  }

  // ═══════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Start the full bot
   */
  async start(): Promise<void> {
    try {
      this.logger.info('🚀 Starting Korex...');
      this.logger.info(`📋 Version: ${process.env.npm_package_version || '1.0.0'}`);
      this.logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);

      // 1. Validate environment variables
      await this.validateEnvironment();

      // 2. Connect to the database
      await this.database.connect();
      this.logger.info('✅ Database connected');

      // 2.1 Load guild language preferences
      await i18n.loadGuildLanguagesFromDB(this.db);

      // 3. Connect to Redis
      await this.redis.connect();
      this.logger.info('✅ Redis connected');

      // 4. Validate license (once the service exists)
      // await this.validateLicense();

      // 5. Load core commands
      await this.commands.loadCommands(path.join(__dirname, '../commands'));

      // 6. Load core events
      await this.events.loadEvents(path.join(__dirname, '../events'));

      // 7. Load core components
      await this.components.loadComponents(path.join(__dirname, '../components'));

      // 8. Load addons
      await this.addons.loadAddons();

      // 9. Start production services
      if (process.env.NODE_ENV === 'production') {
        await this.startProductionServices();
      }

      // 10. Connect to Discord with retries for transient errors.
      // Discord.js internal REST library retries 429s indefinitely — we wrap
      // each login attempt with a hard timeout via Promise.race to guarantee
      // the outer retry loop gets control.
      let loginAttempts = 0;
      const maxLoginRetries = 10;
      const loginTimeoutMs = 20_000;
      const baseLoginDelay = 5_000;

      while (loginAttempts < maxLoginRetries) {
        try {
          await Promise.race([
            this.login(process.env.DISCORD_TOKEN),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error('Login timeout — REST internal retry loop may be stuck on rate limit')),
                loginTimeoutMs
              )
            ),
          ]);
          break;
        } catch (loginError: any) {
          loginAttempts++;
          const isTransient =
            loginError?.status === 429 ||
            loginError?.status === 503 ||
            loginError?.status === 502 ||
            loginError?.code === 'ECONNRESET' ||
            loginError?.code === 'ETIMEDOUT' ||
            loginError?.message?.includes('Service Unavailable') ||
            loginError?.message?.includes('timeout');

          if (isTransient && loginAttempts < maxLoginRetries) {
            const delay = baseLoginDelay * Math.pow(2, Math.min(loginAttempts - 1, 4));
            this.logger.warn(
              `Discord login attempt ${loginAttempts}/${maxLoginRetries} failed (${loginError?.status || loginError?.code || loginError?.message}). Retrying in ${delay / 1000}s...`
            );
            await this.destroy();  // cleanup internal state before next attempt
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            throw loginError;
          }
        }
      }

      this.logger.info('🎉 Korex started successfully');
    } catch (error) {
      this.logger.error('❌ Error starting Korex:', error);
      await this.shutdown(1);
    }
  }

  /**
   * Start production services
   */
  private async startProductionServices(): Promise<void> {
    this.logger.info('🔧 Starting production services...');

    try {
      // Optimize database
      await this.databaseOptimizer.optimizeDatabase();
      this.logger.info('✅ Database optimization completed');

      // Start health monitoring
      this.healthMonitor.startMonitoring(30000); // Every 30 seconds
      this.logger.info('✅ Health monitoring started');

      // Statuspage.io integration
      this.statusPage.start();
      this.logger.info('✅ Statuspage integration started');

      // Start license expiry job
      this.licenseExpiryJob.start();
      this.logger.info('✅ License expiry job started');

      // Start guild kickout service
      this.kickoutService.start();
      this.logger.info('✅ Guild kickout service started');

      // Start backup manager
      if (process.env.ENABLE_BACKUPS !== 'false') {
        await this.backupManager.start();
        this.logger.info('✅ Backup manager started');
      }

      this.logger.info('✅ All production services started');

    } catch (error) {
      this.logger.error('❌ Error starting production services:', error);
      throw error;
    }
  }

  /**
   * Validate required environment variables
   */
  private async validateEnvironment(): Promise<void> {
    const required = [
      'DISCORD_TOKEN',
      'DISCORD_CLIENT_ID',
      'DATABASE_URL',
      'JWT_SECRET',
      'ENCRYPTION_KEY',
    ];

    const missing = required.filter((env) => !process.env[env]);

    if (missing.length > 0) {
      throw new Error(`Missing environment variables: ${missing.join(', ')}`);
    }

    this.logger.debug('✅ Environment variables validated');
  }

  /**
   * Configure bot owners
   */
  private setupOwners(): void {
    // Get owners from the environment variable or fall back to the application owner
    const ownerIds = process.env.BOT_OWNERS?.split(',') || [];

    for (const ownerId of ownerIds) {
      if (ownerId.trim()) {
        this.owners.add(ownerId.trim());
      }
    }

    this.logger.debug(`👑 ${this.owners.size} owners configured`);
  }

  /**
   * Configure basic client event handlers
   */
  private setupBasicHandlers(): void {
    // Basic error handling
    this.on('error', (error) => {
      this.logger.error('Discord client error:', error);
    });

    this.on('warn', (warning) => {
      this.logger.warn('Discord client warning:', warning);
    });

    this.on('debug', (info) => {
      if (process.env.LOG_LEVEL === 'debug') {
        this.logger.debug('Debug Discord:', info);
      }
    });

    // Shard events
    this.on('shardError', (error, shardId) => {
      this.logger.error(`Error on shard ${shardId}:`, error);
    });

    this.on('shardReady', (shardId) => {
      this.logger.info(`✅ Shard ${shardId} ready`);
    });

    this.on('shardDisconnect', (event, shardId) => {
      this.logger.warn(`🔌 Shard ${shardId} disconnected:`, event);
    });

    this.on('shardReconnecting', (shardId) => {
      this.logger.info(`🔄 Shard ${shardId} reconnecting...`);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // UTILITY METHODS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Check whether a user is a bot owner
   */
  isOwner(userId: string): boolean {
    return this.owners.has(userId) || this.application?.owner?.id === userId;
  }

  /**
   * Get bot information
   */
  getBotInfo(): {
    name: string;
    version: string;
    uptime: number;
    guilds: number;
    users: number;
    channels: number;
    commands: number;
    addons: number;
    ping: number;
    memory: NodeJS.MemoryUsage;
  } {
    return {
      name: this.user?.username || 'Korex',
      version: process.env.npm_package_version || '1.0.0',
      uptime: Date.now() - this.startTime.getTime(),
      guilds: this.guilds.cache.size,
      users: this.users.cache.size,
      channels: this.channels.cache.size,
      commands: this.commands.commands.size,
      addons: this.addons.addons.size,
      ping: this.ws.ping,
      memory: process.memoryUsage(),
    };
  }

  /**
   * Get detailed statistics
   */
  async getDetailedStats() {
    return {
      bot: this.getBotInfo(),
      database: await this.database.getStats(),
      cache: await this.cache.getStats(),
      commands: this.commands.getStats(),
      events: this.events.getStats(),
      addons: this.addons.getStats(),
      cooldowns: this.cooldowns.getStats(),
      components: this.components.getStats(),
    };
  }

  /**
   * Check system health
   */
  async healthCheck() {
    const checks = {
      discord: { status: 'ok' as const, ping: this.ws.ping },
      database: await this.database.healthCheck(),
      redis: await this.redis.healthCheck(),
    };

    // Determine overall status
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    const failedChecks = Object.values(checks).filter(
      (check) => (check as any).status === 'error' || !(check as any).healthy
    );

    if (failedChecks.length > 0) {
      status = failedChecks.length === Object.keys(checks).length ? 'unhealthy' : 'degraded';
    }

    // Add production checks if available
    let productionHealth: any = null;

    if (this.healthMonitor) {
      productionHealth = this.healthMonitor.getCurrentHealth();
    }

    return {
      status,
      checks: {
        discord: checks.discord,
        database: {
          status: (checks.database as any).healthy ? 'ok' : 'error',
          latency: (checks.database as any).latency || undefined,
          error: (checks.database as any).error || undefined,
        },
        redis: {
          status: (checks.redis as any).healthy ? 'ok' : 'error',
          latency: (checks.redis as any).latency || undefined,
          error: (checks.redis as any).error || undefined,
        },
      },
      production: productionHealth,
      timestamp: new Date().toISOString(),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // GUILD MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get or create guild configuration
   */
  async getGuildConfig(guildId: string) {
    return await this.cache.getGuildConfig(guildId);
  }

  /**
   * Update guild configuration
   */
  async updateGuildConfig(guildId: string, updates: any) {
    const updated = await this.db.guild.update({
      where: { id: guildId },
      data: updates,
    });

    // Invalidate cache
    await this.cache.invalidateGuildConfig(guildId);

    return updated;
  }

  // ═══════════════════════════════════════════════════════════════
  // LIFECYCLE EVENTS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Called when the bot is ready
   */
  async onReady(): Promise<void> {
    this.botReady = true;
    this.startTime = new Date();

    // Notify the health monitor that the WS handshake is complete so startup-grace
    // leniency (degraded vs unhealthy for ping=-1, music node, etc.) is lifted.
    this.healthMonitor?.markBotReady();

    // Register global slash commands (core only, no addons)
    await this.commands.registerSlashCommands();

    // Sync addon commands per guild for guilds that already have active addons
    this.commands.syncAllGuildsOnStartup().catch(err =>
      this.logger.warn('Startup guild command sync failed:', err)
    );

    // Configure owners if not already configured
    if (this.owners.size === 0 && this.application?.owner) {
      if ('id' in this.application.owner) {
        this.owners.add(this.application.owner.id);
      }
    }

    this.logger.info(`🤖 ${this.user?.tag} is ready!`);
    this.logger.info(
      `📊 Serving ${this.guilds.cache.size} servers with ${this.users.cache.size} users`
    );
    this.logger.info(`⚡ Latency: ${this.ws.ping}ms`);
  }

  // ═══════════════════════════════════════════════════════════════
  // SHUTDOWN AND CLEANUP
  // ═══════════════════════════════════════════════════════════════

  /**
   * Shut down the bot safely
   */
  async shutdown(exitCode: number = 0): Promise<void> {
    this.logger.info('🛑 Shutting down Korex...');

    try {
      // 1. Stop production services
      if (this.healthMonitor) {
        this.healthMonitor.destroy();
      }
      if (this.backupManager) {
        this.backupManager.stop();
      }
      if (this.licenseExpiryJob) {
        this.licenseExpiryJob.stop();
      }
      if (this.kickoutService) {
        this.kickoutService.stop();
      }
      if (this.rateLimiter) {
        this.rateLimiter.destroy();
      }
      if (this.productionLogger) {
        this.productionLogger.destroy();
      }

      // 2. Unload addons
      await this.addons.clear();

      // 3. Clean up services
      if (this.addonSync) {
        await this.addonSync.destroy();
      }

      // 4. Clean up managers
      this.cooldowns.destroy();
      this.commands.clear();
      this.events.clear();
      this.components.clear();

      // 5. Disconnect from Discord
      this.destroy();

      // 6. Close database connections
      await this.database.disconnect();
      await this.redis.disconnect();

      this.logger.info('✅ Korex shut down cleanly');
    } catch (error) {
      this.logger.error('❌ Error during shutdown:', error);
    } finally {
      process.exit(exitCode);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // CONVENIENCE METHODS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Send a message to a channel
   */
  async sendMessage(channelId: string, content: any) {
    try {
      const channel = await this.channels.fetch(channelId);

      if (channel?.isTextBased()) {
        if ('send' in channel) {
          return await channel.send(content);
        }
      }
    } catch (error) {
      this.logger.error(`Error sending message to channel ${channelId}:`, error);
    }

    return null;
  }

  /**
   * Get a guild member
   */
  async getMember(guildId: string, userId: string) {
    try {
      const guild = await this.guilds.fetch(guildId);

      return await guild.members.fetch(userId);
    } catch (error) {
      this.logger.debug(`Could not fetch member ${userId} in guild ${guildId}`);

      return null;
    }
  }

  /**
   * Check bot permissions in a guild
   */
  async checkBotPermissions(guildId: string, permissions: bigint[]) {
    try {
      const guild = await this.guilds.fetch(guildId);
      const botMember = await guild.members.fetch(this.user!.id);

      return permissions.every((permission) => botMember.permissions.has(permission));
    } catch (error) {
      this.logger.error(`Error checking permissions in guild ${guildId}:`, error);

      return false;
    }
  }

  /**
   * Get guild information
   */
  async getGuildInfo(guildId: string) {
    try {
      const guild = await this.guilds.fetch(guildId);

      return {
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL(),
        memberCount: guild.memberCount,
        ownerId: guild.ownerId,
        createdAt: guild.createdAt,
        features: guild.features,
      };
    } catch (error) {
      this.logger.error(`Error fetching info for guild ${guildId}:`, error);

      return null;
    }
  }
}
