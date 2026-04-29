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

// Services (se importarán cuando los creemos)
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

import { LicenseExpiryJob } from '../services/LicenseExpiryJob';
import { GuildKickoutService } from '../services/GuildKickoutService';

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
  // ESTADO DEL BOT
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

    // Inicializar managers
    this.commands = new CommandManager(this);
    this.events = new EventManager(this);
    this.addons = new AddonManager(this);
    this.cooldowns = new CooldownManager(this);
    this.components = new ComponentManager(this);
    this.database = new DatabaseManager(this);

    // Inicializar database y cache
    this.db = this.database.prisma;
    this.redis = new RedisClient(this);
    this.cache = new CacheManager(this);

    // Inicializar servicios que no requieren DatabaseManager
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

    // Inicializar servicios que requieren DatabaseManager
    this.licenses = LicenseService.getInstance(this.database);
    this.moderation = ModerationService.getInstance(this.database);
    this.logging = LoggingService.getInstance(this.database);
    this.welcome = WelcomeService.getInstance(this.database);
    this.verificationService = new VerificationService(this);
    this.autoRole = AutoRoleService.getInstance(this.database);
    this.userStats = UserStatsService.getInstance(this.database);

    // Configurar la base de datos en los servicios
    this.errorHandler.setDatabase(this.database);
    this.economy.setDatabase(this.database);
    this.levels.setDatabase(this.database);
    this.shop.setDatabase(this.database);

    // Inicializar servicios de producción
    this.rateLimiter = new RateLimiter(this);
    this.productionLogger = new ProductionLogger(this);
    this.healthMonitor = new HealthMonitor(this);
    this.statusPage = new StatusPageService(this.healthMonitor);
    this.backupManager = new BackupManager(this);
    this.databaseOptimizer = new DatabaseOptimizer(this.db);
    this.licenseExpiryJob = new LicenseExpiryJob(this);
    this.kickoutService = new GuildKickoutService(this);

    // Configurar owners
    this.setupOwners();

    // Configurar event handlers básicos
    this.setupBasicHandlers();
  }

  // ═══════════════════════════════════════════════════════════════
  // INICIALIZACIÓN
  // ═══════════════════════════════════════════════════════════════

  /**
   * Iniciar el bot completo
   */
  async start(): Promise<void> {
    try {
      this.logger.info('🚀 Iniciando Korex...');
      this.logger.info(`📋 Versión: ${process.env.npm_package_version || '1.0.0'}`);
      this.logger.info(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}`);

      // 1. Validar variables de entorno
      await this.validateEnvironment();

      // 2. Conectar a base de datos
      await this.database.connect();
      this.logger.info('✅ Base de datos conectada');

      // 2.1 Cargar preferencias de idioma de guilds
      await i18n.loadGuildLanguagesFromDB(this.db);

      // 3. Conectar a Redis
      await this.redis.connect();
      this.logger.info('✅ Redis conectado');

      // 4. Validar licencia (cuando creemos el servicio)
      // await this.validateLicense();

      // 5. Cargar comandos del core
      await this.commands.loadCommands(path.join(__dirname, '../commands'));

      // 6. Cargar eventos del core
      await this.events.loadEvents(path.join(__dirname, '../events'));

      // 7. Cargar componentes del core
      await this.components.loadComponents(path.join(__dirname, '../components'));

      // 8. Cargar addons
      await this.addons.loadAddons();

      // 9. Iniciar servicios de producción
      if (process.env.NODE_ENV === 'production') {
        await this.startProductionServices();
      }

      // 10. Conectar a Discord
      await this.login(process.env.DISCORD_TOKEN);

      this.logger.info('🎉 Korex iniciado exitosamente');
    } catch (error) {
      this.logger.error('❌ Error iniciando Korex:', error);
      await this.shutdown(1);
    }
  }

  /**
   * Iniciar servicios de producción
   */
  private async startProductionServices(): Promise<void> {
    this.logger.info('🔧 Starting production services...');

    try {
      // Optimizar base de datos
      await this.databaseOptimizer.optimizeDatabase();
      this.logger.info('✅ Database optimization completed');

      // Iniciar health monitoring
      this.healthMonitor.startMonitoring(30000); // Cada 30 segundos
      this.logger.info('✅ Health monitoring started');

      // Statuspage.io integration
      this.statusPage.start();
      this.logger.info('✅ Statuspage integration started');

      // Iniciar job de expiración de licencias
      this.licenseExpiryJob.start();
      this.logger.info('✅ License expiry job started');

      // Iniciar servicio de kickout de guilds
      this.kickoutService.start();
      this.logger.info('✅ Guild kickout service started');

      // Iniciar backup manager
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
   * Validar variables de entorno requeridas
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
      throw new Error(`Variables de entorno faltantes: ${missing.join(', ')}`);
    }

    this.logger.debug('✅ Variables de entorno validadas');
  }

  /**
   * Configurar propietarios del bot
   */
  private setupOwners(): void {
    // Obtener owners desde variable de entorno o usar el owner de la aplicación
    const ownerIds = process.env.BOT_OWNERS?.split(',') || [];

    for (const ownerId of ownerIds) {
      if (ownerId.trim()) {
        this.owners.add(ownerId.trim());
      }
    }

    this.logger.debug(`👑 ${this.owners.size} propietarios configurados`);
  }

  /**
   * Configurar event handlers básicos del cliente
   */
  private setupBasicHandlers(): void {
    // Error handling básico
    this.on('error', (error) => {
      this.logger.error('Error del cliente Discord:', error);
    });

    this.on('warn', (warning) => {
      this.logger.warn('Advertencia del cliente Discord:', warning);
    });

    this.on('debug', (info) => {
      if (process.env.LOG_LEVEL === 'debug') {
        this.logger.debug('Debug Discord:', info);
      }
    });

    // Shard events
    this.on('shardError', (error, shardId) => {
      this.logger.error(`Error en shard ${shardId}:`, error);
    });

    this.on('shardReady', (shardId) => {
      this.logger.info(`✅ Shard ${shardId} listo`);
    });

    this.on('shardDisconnect', (event, shardId) => {
      this.logger.warn(`🔌 Shard ${shardId} desconectado:`, event);
    });

    this.on('shardReconnecting', (shardId) => {
      this.logger.info(`🔄 Shard ${shardId} reconectando...`);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // MÉTODOS DE UTILIDAD
  // ═══════════════════════════════════════════════════════════════

  /**
   * Verificar si un usuario es propietario del bot
   */
  isOwner(userId: string): boolean {
    return this.owners.has(userId) || this.application?.owner?.id === userId;
  }

  /**
   * Obtener información del bot
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
   * Obtener estadísticas detalladas
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
   * Verificar salud del sistema
   */
  async healthCheck() {
    const checks = {
      discord: { status: 'ok' as const, ping: this.ws.ping },
      database: await this.database.healthCheck(),
      redis: await this.redis.healthCheck(),
    };

    // Determinar estado general
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    const failedChecks = Object.values(checks).filter(
      (check) => (check as any).status === 'error' || !(check as any).healthy
    );

    if (failedChecks.length > 0) {
      status = failedChecks.length === Object.keys(checks).length ? 'unhealthy' : 'degraded';
    }

    // Agregar checks de producción si están disponibles
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
  // GESTIÓN DE GUILDS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Obtener o crear configuración de guild
   */
  async getGuildConfig(guildId: string) {
    return await this.cache.getGuildConfig(guildId);
  }

  /**
   * Actualizar configuración de guild
   */
  async updateGuildConfig(guildId: string, updates: any) {
    const updated = await this.db.guild.update({
      where: { id: guildId },
      data: updates,
    });

    // Invalidar caché
    await this.cache.invalidateGuildConfig(guildId);

    return updated;
  }

  // ═══════════════════════════════════════════════════════════════
  // EVENTOS DEL CICLO DE VIDA
  // ═══════════════════════════════════════════════════════════════

  /**
   * Llamado cuando el bot está listo
   */
  async onReady(): Promise<void> {
    this.botReady = true;
    this.startTime = new Date();

    // Notify the health monitor that the WS handshake is complete so startup-grace
    // leniency (degraded vs unhealthy for ping=-1, music node, etc.) is lifted.
    this.healthMonitor?.markBotReady();

    // Registrar slash commands globales (solo core, sin addons)
    await this.commands.registerSlashCommands();

    // Sincronizar comandos de addons por guild para las guilds que ya tienen addons activos
    this.commands.syncAllGuildsOnStartup().catch(err =>
      this.logger.warn('Startup guild command sync failed:', err)
    );

    // Configurar owners si no están configurados
    if (this.owners.size === 0 && this.application?.owner) {
      if ('id' in this.application.owner) {
        this.owners.add(this.application.owner.id);
      }
    }

    this.logger.info(`🤖 ${this.user?.tag} está listo!`);
    this.logger.info(
      `📊 Sirviendo ${this.guilds.cache.size} servidores con ${this.users.cache.size} usuarios`
    );
    this.logger.info(`⚡ Latencia: ${this.ws.ping}ms`);
  }

  // ═══════════════════════════════════════════════════════════════
  // SHUTDOWN Y CLEANUP
  // ═══════════════════════════════════════════════════════════════

  /**
   * Apagar el bot de forma segura
   */
  async shutdown(exitCode: number = 0): Promise<void> {
    this.logger.info('🛑 Apagando Korex...');

    try {
      // 1. Detener servicios de producción
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

      // 2. Descargar addons
      await this.addons.clear();

      // 3. Limpiar servicios
      if (this.addonSync) {
        await this.addonSync.destroy();
      }

      // 4. Limpiar managers
      this.cooldowns.destroy();
      this.commands.clear();
      this.events.clear();
      this.components.clear();

      // 5. Desconectar de Discord
      this.destroy();

      // 6. Cerrar conexiones de base de datos
      await this.database.disconnect();
      await this.redis.disconnect();

      this.logger.info('✅ Korex apagado correctamente');
    } catch (error) {
      this.logger.error('❌ Error durante el apagado:', error);
    } finally {
      process.exit(exitCode);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // MÉTODOS DE CONVENIENCIA
  // ═══════════════════════════════════════════════════════════════

  /**
   * Enviar mensaje a un canal
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
      this.logger.error(`Error enviando mensaje a canal ${channelId}:`, error);
    }

    return null;
  }

  /**
   * Obtener miembro de guild
   */
  async getMember(guildId: string, userId: string) {
    try {
      const guild = await this.guilds.fetch(guildId);

      return await guild.members.fetch(userId);
    } catch (error) {
      this.logger.debug(`No se pudo obtener miembro ${userId} en guild ${guildId}`);

      return null;
    }
  }

  /**
   * Verificar permisos de bot en guild
   */
  async checkBotPermissions(guildId: string, permissions: bigint[]) {
    try {
      const guild = await this.guilds.fetch(guildId);
      const botMember = await guild.members.fetch(this.user!.id);

      return permissions.every((permission) => botMember.permissions.has(permission));
    } catch (error) {
      this.logger.error(`Error verificando permisos en guild ${guildId}:`, error);

      return false;
    }
  }

  /**
   * Obtener información de guild
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
      this.logger.error(`Error obteniendo info de guild ${guildId}:`, error);

      return null;
    }
  }
}
