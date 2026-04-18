import { logger } from '../utils/Logger';
import { DatabaseManager } from '../client/managers/DatabaseManager';
import { i18n } from '../utils/i18n';

export interface EconomyUser {
  guildId: string;
  userId: string;
  balance: number;
  bank: number;
  dailyStreak: number;
  lastDaily: Date | null;
  lastWeekly: Date | null;
  lastWork: Date | null;
}

export interface EconomyConfig {
  guildId: string;
  enabled: boolean;
  currencyName: string;
  currencySymbol: string;
  dailyReward: number;
  weeklyReward: number;
  workMinReward: number;
  workMaxReward: number;
  workCooldown: number;
  maxBalance: number;
  maxBank: number;
  robChance: number;
  robCooldown: number;
  shopEnabled: boolean;
}

export interface TransactionResult {
  success: boolean;
  newBalance?: number;
  message: string;
}

export class EconomyService {
  private static instance: EconomyService;
  private logger = logger;
  private db: DatabaseManager | null = null;
  private userCache = new Map<string, EconomyUser>();

  private constructor() {}

  public static getInstance(): EconomyService {
    if (!EconomyService.instance) {
      EconomyService.instance = new EconomyService();
    }

    return EconomyService.instance;
  }

  /**
   * Inicializa la conexión a la base de datos
   */
  public setDatabase(db: DatabaseManager): void {
    this.db = db;
  }

  /**
   * Obtiene los datos económicos de un usuario
   */
  public async getUser(guildId: string, userId: string): Promise<EconomyUser> {
    const cacheKey = `${guildId}:${userId}`;

    // Verificar caché primero
    let user = this.userCache.get(cacheKey);

    if (!user && this.db) {
      // Buscar en base de datos
      const dbUser = await this.db.prisma.guildUser.findUnique({
        where: {
          guildId_userId: {
            guildId,
            userId,
          },
        },
      });

      if (dbUser) {
        user = {
          guildId: dbUser.guildId,
          userId: dbUser.userId,
          balance: dbUser.balance,
          bank: dbUser.bank,
          dailyStreak: dbUser.dailyStreak,
          lastDaily: dbUser.lastDaily || null,
          lastWeekly: dbUser.lastWeekly || null,
          lastWork: dbUser.lastWork || null,
        };
      } else {
        // Crear usuario nuevo
        user = await this.createUser(guildId, userId);
      }

      // Cachear por 5 minutos
      this.userCache.set(cacheKey, user);
      setTimeout(() => this.userCache.delete(cacheKey), 5 * 60 * 1000);
    }

    return (
      user || {
        guildId,
        userId,
        balance: 0,
        bank: 0,
        dailyStreak: 0,
        lastDaily: null,
        lastWeekly: null,
        lastWork: null,
      }
    );
  }

  /**
   * Crea un nuevo usuario en el sistema económico
   */
  private async createUser(guildId: string, userId: string): Promise<EconomyUser> {
    if (!this.db) {
      throw new Error('Database not available');
    }

    // Crear usuario global primero si no existe
    await this.db.prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId }
    });

    const dbUser = await this.db.prisma.guildUser.upsert({
      where: {
        guildId_userId: {
          guildId,
          userId,
        },
      },
      update: {},
      create: {
        guildId,
        userId,
        balance: 100, // Balance inicial
        bank: 0,
        dailyStreak: 0,
      },
    });

    return {
      guildId: dbUser.guildId,
      userId: dbUser.userId,
      balance: dbUser.balance,
      bank: dbUser.bank,
      dailyStreak: dbUser.dailyStreak,
      lastDaily: dbUser.lastDaily || null,
      lastWeekly: dbUser.lastWeekly || null,
      lastWork: dbUser.lastWork || null,
    };
  }

  /**
   * Actualiza los datos de un usuario
   */
  private async updateUser(user: EconomyUser): Promise<void> {
    if (!this.db) {
      throw new Error('Database not available');
    }

    await this.db.prisma.guildUser.update({
      where: {
        guildId_userId: {
          guildId: user.guildId,
          userId: user.userId,
        },
      },
      data: {
        balance: user.balance,
        bank: user.bank,
        dailyStreak: user.dailyStreak,
        lastDaily: user.lastDaily || null,
        lastWeekly: user.lastWeekly || null,
        lastWork: user.lastWork || null,
      },
    });

    // Actualizar caché
    const cacheKey = `${user.guildId}:${user.userId}`;

    this.userCache.set(cacheKey, user);
  }

  /**
   * Obtiene la configuración económica de un servidor
   */
  public async getConfig(guildId: string): Promise<EconomyConfig> {
    if (!this.db) {
      return this.getDefaultConfig(guildId);
    }

    try {
      const config = await this.db.prisma.economyConfig.findUnique({
        where: { guildId },
      });

      if (!config) {
        return this.getDefaultConfig(guildId);
      }

      return {
        guildId: config.guildId,
        enabled: config.enabled,
        currencyName: config.currencyName,
        currencySymbol: config.currencySymbol,
        dailyReward: config.dailyReward,
        weeklyReward: config.weeklyReward,
        workMinReward: config.workMinReward,
        workMaxReward: config.workMaxReward,
        workCooldown: config.workCooldown,
        maxBalance: config.maxBalance,
        maxBank: config.maxBank,
        robChance: config.robChance,
        robCooldown: config.robCooldown,
        shopEnabled: config.shopEnabled,
      };
    } catch (error) {
      this.logger.error('Error getting economy config:', error);

      return this.getDefaultConfig(guildId);
    }
  }

  private getDefaultConfig(guildId: string): EconomyConfig {
    return {
      guildId,
      enabled: true,
      currencyName: 'monedas',
      currencySymbol: '🪙',
      dailyReward: 100,
      weeklyReward: 500,
      workMinReward: 50,
      workMaxReward: 200,
      workCooldown: 3600, // 1 hora en segundos
      maxBalance: 1000000,
      maxBank: 5000000,
      robChance: 40,
      robCooldown: 7200, // 2 horas en segundos
      shopEnabled: true,
    };
  }

  /**
   * Añade dinero a un usuario
   */
  public async addMoney(
    guildId: string,
    userId: string,
    amount: number,
    reason: string = 'Unknown'
  ): Promise<TransactionResult> {
    try {
      const config = await this.getConfig(guildId);

      if (!config.enabled) {
        return {
          success: false,
          message: 'El sistema económico está deshabilitado en este servidor.',
        };
      }

      const user = await this.getUser(guildId, userId);
      const newBalance = user.balance + amount;

      if (newBalance > config.maxBalance) {
        return {
          success: false,
          message: `No puedes tener más de ${config.maxBalance} ${config.currencyName}.`,
        };
      }

      user.balance = newBalance;
      await this.updateUser(user);

      this.logger.info(
        `Added ${amount} ${config.currencyName} to user ${userId} in guild ${guildId}. Reason: ${reason}`
      );

      return {
        success: true,
        newBalance: user.balance,
        message: `Se añadieron ${amount} ${config.currencySymbol} a tu balance.`,
      };
    } catch (error) {
      this.logger.error('Error adding money:', error);

      return {
        success: false,
        message: 'Error al procesar la transacción.',
      };
    }
  }

  /**
   * Quita dinero a un usuario
   */
  public async removeMoney(
    guildId: string,
    userId: string,
    amount: number,
    reason: string = 'Unknown'
  ): Promise<TransactionResult> {
    try {
      const config = await this.getConfig(guildId);

      if (!config.enabled) {
        return {
          success: false,
          message: 'El sistema económico está deshabilitado en este servidor.',
        };
      }

      const user = await this.getUser(guildId, userId);

      if (user.balance < amount) {
        return {
          success: false,
          message: `No tienes suficientes ${config.currencyName}.`,
        };
      }

      user.balance -= amount;
      await this.updateUser(user);

      this.logger.info(
        `Removed ${amount} ${config.currencyName} from user ${userId} in guild ${guildId}. Reason: ${reason}`
      );

      return {
        success: true,
        newBalance: user.balance,
        message: `Se quitaron ${amount} ${config.currencySymbol} de tu balance.`,
      };
    } catch (error) {
      this.logger.error('Error removing money:', error);

      return {
        success: false,
        message: 'Error al procesar la transacción.',
      };
    }
  }

  /**
   * Transfiere dinero entre usuarios
   */
  public async transferMoney(
    guildId: string,
    fromUserId: string,
    toUserId: string,
    amount: number
  ): Promise<TransactionResult> {
    try {
      const config = await this.getConfig(guildId);

      if (!config.enabled) {
        return {
          success: false,
          message: 'El sistema económico está deshabilitado en este servidor.',
        };
      }

      if (fromUserId === toUserId) {
        return {
          success: false,
          message: 'No puedes transferir dinero a ti mismo.',
        };
      }

      const fromUser = await this.getUser(guildId, fromUserId);
      const toUser = await this.getUser(guildId, toUserId);

      if (fromUser.balance < amount) {
        return {
          success: false,
          message: `No tienes suficientes ${config.currencyName}.`,
        };
      }

      if (toUser.balance + amount > config.maxBalance) {
        return {
          success: false,
          message: `El usuario receptor no puede recibir esa cantidad (límite: ${config.maxBalance}).`,
        };
      }

      fromUser.balance -= amount;
      toUser.balance += amount;

      await this.updateUser(fromUser);
      await this.updateUser(toUser);

      this.logger.info(
        `Transferred ${amount} ${config.currencyName} from ${fromUserId} to ${toUserId} in guild ${guildId}`
      );

      return {
        success: true,
        newBalance: fromUser.balance,
        message: `Transferiste ${amount} ${config.currencySymbol} exitosamente.`,
      };
    } catch (error) {
      this.logger.error('Error transferring money:', error);

      return {
        success: false,
        message: 'Error al procesar la transferencia.',
      };
    }
  }

  /**
   * Reclama recompensa diaria
   */
  public async claimDaily(guildId: string, userId: string): Promise<TransactionResult> {
    const lang = i18n.getGuildLanguage(guildId);

    try {
      const config = await this.getConfig(guildId);

      if (!config.enabled) {
        return {
          success: false,
          message: i18n.t('economy.disabled', lang),
        };
      }

      const user = await this.getUser(guildId, userId);
      const now = new Date();

      // Verificar si ya reclamó hoy
      if (user.lastDaily) {
        const lastDaily = new Date(user.lastDaily);
        const timeDiff = now.getTime() - lastDaily.getTime();
        const hoursDiff = timeDiff / (1000 * 60 * 60);

        if (hoursDiff < 24) {
          const hoursLeft = Math.ceil(24 - hoursDiff);

          return {
            success: false,
            message: i18n.t('economy.daily.cooldown', lang, { hours: hoursLeft.toString() }),
          };
        }

        // Verificar racha
        if (hoursDiff <= 48) {
          user.dailyStreak += 1;
        } else {
          user.dailyStreak = 1;
        }
      } else {
        user.dailyStreak = 1;
      }

      const streakBonus = Math.min(user.dailyStreak * 10, 200);
      const totalReward = config.dailyReward + streakBonus;

      user.balance += totalReward;
      user.lastDaily = now;

      if (user.balance > config.maxBalance) {
        user.balance = config.maxBalance;
      }

      await this.updateUser(user);

      return {
        success: true,
        newBalance: user.balance,
        message: i18n.t('economy.daily.success', lang, {
          amount: totalReward.toString(),
          symbol: config.currencySymbol,
          base: config.dailyReward.toString(),
          bonus: streakBonus.toString(),
          streak: user.dailyStreak.toString()
        }),
      };
    } catch (error) {
      this.logger.error('Error claiming daily:', error);

      return {
        success: false,
        message: i18n.t('economy.daily.error', lang),
      };
    }
  }

  /**
   * Reclama recompensa semanal
   */
  public async claimWeekly(guildId: string, userId: string): Promise<TransactionResult> {
    const lang = i18n.getGuildLanguage(guildId);

    try {
      const config = await this.getConfig(guildId);

      if (!config.enabled) {
        return { success: false, message: i18n.t('economy.disabled', lang) };
      }

      const user = await this.getUser(guildId, userId);
      const now = new Date();

      if (user.lastWeekly) {
        const lastWeekly = new Date(user.lastWeekly);
        const timeDiff = now.getTime() - lastWeekly.getTime();
        const daysDiff = timeDiff / (1000 * 60 * 60 * 24);

        if (daysDiff < 7) {
          const daysLeft = Math.ceil(7 - daysDiff);

          return { success: false, message: i18n.t('economy.weekly.cooldown', lang, { days: daysLeft.toString() }) };
        }
      }

      user.balance += config.weeklyReward;
      user.lastWeekly = now;

      if (user.balance > config.maxBalance) {
        user.balance = config.maxBalance;
      }

      await this.updateUser(user);

      return {
        success: true,
        newBalance: user.balance,
        message: i18n.t('economy.weekly.success', lang, { amount: config.weeklyReward.toString(), symbol: config.currencySymbol }),
      };
    } catch (error) {
      this.logger.error('Error claiming weekly:', error);

      return { success: false, message: i18n.t('economy.weekly.error', lang) };
    }
  }

  /**
   * Trabaja para ganar dinero
   */
  public async work(guildId: string, userId: string): Promise<TransactionResult> {
    const lang = i18n.getGuildLanguage(guildId);

    try {
      const config = await this.getConfig(guildId);

      if (!config.enabled) {
        return { success: false, message: i18n.t('economy.disabled', lang) };
      }

      const user = await this.getUser(guildId, userId);
      const now = new Date();

      if (user.lastWork) {
        const lastWork = new Date(user.lastWork);
        const timeDiff = now.getTime() - lastWork.getTime();
        const secondsDiff = timeDiff / 1000;

        if (secondsDiff < config.workCooldown) {
          const minutesLeft = Math.ceil((config.workCooldown - secondsDiff) / 60);

          return { success: false, message: i18n.t('economy.work.cooldown', lang, { minutes: minutesLeft.toString() }) };
        }
      }

      const reward = Math.floor(
        Math.random() * (config.workMaxReward - config.workMinReward + 1) + config.workMinReward
      );

      user.balance += reward;
      user.lastWork = now;

      if (user.balance > config.maxBalance) {
        user.balance = config.maxBalance;
      }

      await this.updateUser(user);

      return {
        success: true,
        newBalance: user.balance,
        message: i18n.t('economy.work.success', lang, { amount: reward.toString(), symbol: config.currencySymbol }),
      };
    } catch (error) {
      this.logger.error('Error working:', error);

      return { success: false, message: i18n.t('economy.work.error', lang) };
    }
  }

  /**
   * Deposita dinero en el banco
   */
  public async deposit(
    guildId: string,
    userId: string,
    amount: number
  ): Promise<TransactionResult> {
    try {
      const config = await this.getConfig(guildId);

      if (!config.enabled) {
        return {
          success: false,
          message: 'El sistema económico está deshabilitado en este servidor.',
        };
      }

      const user = await this.getUser(guildId, userId);

      if (user.balance < amount) {
        return {
          success: false,
          message: `No tienes suficientes ${config.currencyName} en tu balance.`,
        };
      }

      if (user.bank + amount > config.maxBank) {
        return {
          success: false,
          message: `No puedes depositar más de ${config.maxBank} ${config.currencyName} en el banco.`,
        };
      }

      user.balance -= amount;
      user.bank += amount;

      await this.updateUser(user);

      return {
        success: true,
        newBalance: user.balance,
        message: `Depositaste ${amount} ${config.currencySymbol} en el banco.`,
      };
    } catch (error) {
      this.logger.error('Error depositing:', error);

      return {
        success: false,
        message: 'Error al depositar.',
      };
    }
  }

  /**
   * Retira dinero del banco
   */
  public async withdraw(
    guildId: string,
    userId: string,
    amount: number
  ): Promise<TransactionResult> {
    try {
      const config = await this.getConfig(guildId);

      if (!config.enabled) {
        return {
          success: false,
          message: 'El sistema económico está deshabilitado en este servidor.',
        };
      }

      const user = await this.getUser(guildId, userId);

      if (user.bank < amount) {
        return {
          success: false,
          message: `No tienes suficientes ${config.currencyName} en el banco.`,
        };
      }

      if (user.balance + amount > config.maxBalance) {
        return {
          success: false,
          message: `No puedes tener más de ${config.maxBalance} ${config.currencyName} en tu balance.`,
        };
      }

      user.bank -= amount;
      user.balance += amount;

      await this.updateUser(user);

      return {
        success: true,
        newBalance: user.balance,
        message: `Retiraste ${amount} ${config.currencySymbol} del banco.`,
      };
    } catch (error) {
      this.logger.error('Error withdrawing:', error);

      return {
        success: false,
        message: 'Error al retirar.',
      };
    }
  }

  /**
   * Obtiene el leaderboard de dinero
   */
  public async getLeaderboard(guildId: string, limit: number = 10): Promise<EconomyUser[]> {
    try {
      if (!this.db) {
        return [];
      }

      const users = await this.db.prisma.guildUser.findMany({
        where: { guildId },
        orderBy: [{ balance: 'desc' }, { bank: 'desc' }],
        take: limit,
      });

      return users.map((user) => ({
        guildId: user.guildId,
        userId: user.userId,
        balance: user.balance,
        bank: user.bank,
        dailyStreak: user.dailyStreak,
        lastDaily: user.lastDaily || null,
        lastWeekly: user.lastWeekly || null,
        lastWork: user.lastWork || null,
      }));
    } catch (error) {
      this.logger.error('Error getting leaderboard:', error);

      return [];
    }
  }

  /**
   * Obtiene estadísticas económicas del servidor
   */
  public async getServerStats(guildId: string): Promise<{
    totalUsers: number;
    totalMoney: number;
    totalBank: number;
    averageBalance: number;
    richestUser: EconomyUser | null;
  }> {
    try {
      if (!this.db) {
        return {
          totalUsers: 0,
          totalMoney: 0,
          totalBank: 0,
          averageBalance: 0,
          richestUser: null,
        };
      }

      const stats = await this.db.prisma.guildUser.aggregate({
        where: { guildId },
        _count: { userId: true },
        _sum: {
          balance: true,
          bank: true,
        },
        _avg: { balance: true },
      });

      const richestUser = await this.db.prisma.guildUser.findFirst({
        where: { guildId },
        orderBy: { balance: 'desc' },
      });

      return {
        totalUsers: stats._count.userId,
        totalMoney: stats._sum.balance || 0,
        totalBank: stats._sum.bank || 0,
        averageBalance: Math.round(stats._avg.balance || 0),
        richestUser: richestUser
          ? {
              guildId: richestUser.guildId,
              userId: richestUser.userId,
              balance: richestUser.balance,
              bank: richestUser.bank,
              dailyStreak: richestUser.dailyStreak,
              lastDaily: richestUser.lastDaily || null,
              lastWeekly: richestUser.lastWeekly || null,
              lastWork: richestUser.lastWork || null,
            }
          : null,
      };
    } catch (error) {
      this.logger.error('Error getting server stats:', error);

      return {
        totalUsers: 0,
        totalMoney: 0,
        totalBank: 0,
        averageBalance: 0,
        richestUser: null,
      };
    }
  }
}
