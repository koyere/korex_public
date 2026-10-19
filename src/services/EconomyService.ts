import { randomInt } from 'crypto';
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
  /** Cantidad ganada (daily/weekly/work) para mostrarla sin parsear el mensaje */
  amount?: number;
  message: string;
}

/** Saldo con el que empieza cada usuario en un servidor. */
export const STARTING_BALANCE = 100;

class TransferError extends Error {
  constructor(public readonly reason: 'insufficient' | 'receiver_limit') {
    super(reason);
  }
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
   * Contador diario de transacciones (dashboard → Economía → "Transacciones hoy").
   * No hay tabla de transacciones: se cuenta en Redis por servidor y día UTC (TTL 3 días).
   */
  private redis: { incr(key: string): Promise<number>; expire(key: string, seconds: number): Promise<number>; get(key: string): Promise<string | null> } | null = null;

  public setRedis(redis: EconomyService['redis']): void {
    this.redis = redis;
  }

  private transactionKey(guildId: string, day: string = new Date().toISOString().slice(0, 10)): string {
    return `economy:tx:${guildId}:${day}`;
  }

  private recordTransaction(guildId: string): void {
    if (!this.redis) return;
    const key = this.transactionKey(guildId);
    this.redis.incr(key)
      .then((count) => (count === 1 ? this.redis!.expire(key, 3 * 24 * 60 * 60) : 0))
      .catch(() => { /* el contador es informativo: nunca bloquea una transacción */ });
  }

  /** Transacciones correctas de hoy (UTC) en el servidor; 0 si Redis no está disponible */
  public async getTransactionsToday(guildId: string): Promise<number> {
    if (!this.redis) return 0;
    try {
      return Number(await this.redis.get(this.transactionKey(guildId))) || 0;
    } catch {
      return 0;
    }
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
        balance: STARTING_BALANCE,
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
  // ─── Operaciones atómicas ───────────────────────────────────────────────
  // Cada movimiento es un único UPDATE condicional (saldo, límites y cooldown
  // se comprueban en el WHERE) que devuelve la fila resultante. Así dos
  // operaciones simultáneas nunca se pisan ni dejan saldos negativos.

  private toEconomyUser(row: any): EconomyUser {
    return {
      guildId: row.guildId,
      userId: row.userId,
      balance: Number(row.balance),
      bank: Number(row.bank),
      dailyStreak: Number(row.dailyStreak),
      lastDaily: row.lastDaily ?? null,
      lastWeekly: row.lastWeekly ?? null,
      lastWork: row.lastWork ?? null,
    };
  }

  /** Guarda en caché el estado devuelto por la BD tras una operación. */
  private remember(row: any): EconomyUser {
    const user = this.toEconomyUser(row);
    this.userCache.set(`${user.guildId}:${user.userId}`, user);
    return user;
  }

  /** Lee el estado real (sin caché) para explicar por qué falló una operación. */
  private async freshUser(guildId: string, userId: string): Promise<EconomyUser> {
    this.userCache.delete(`${guildId}:${userId}`);
    return this.getUser(guildId, userId);
  }

  private invalidAmount(amount: number): boolean {
    return !Number.isSafeInteger(amount) || amount <= 0;
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
      // Un importe negativo invertiría la operación (p. ej. precio < 0 sumaría dinero)
      if (this.invalidAmount(amount)) {
        return { success: false, message: i18n.t('economy.errors.invalid_amount', guildId) };
      }

      const config = await this.getConfig(guildId);

      if (!config.enabled) {
        return { success: false, message: i18n.t('economy.tx.disabled', guildId) };
      }

      await this.getUser(guildId, userId); // crea la fila si no existe
      const rows = await this.db!.prisma.$queryRaw<any[]>`
        UPDATE guild_users SET balance = balance + ${amount}, "updatedAt" = NOW()
        WHERE "guildId" = ${guildId} AND "userId" = ${userId} AND balance + ${amount} <= ${config.maxBalance}
        RETURNING *`;

      if (rows.length === 0) {
        return {
          success: false,
          message: i18n.t('economy.tx.max_balance', guildId, { max: String(config.maxBalance), currency: config.currencyName }),
        };
      }

      const user = this.remember(rows[0]);
      this.logger.info(`Added ${amount} ${config.currencyName} to user ${userId} in guild ${guildId}. Reason: ${reason}`);

      this.recordTransaction(guildId);

      return {
        success: true,
        newBalance: user.balance,
        message: i18n.t('economy.tx.added', guildId, { amount: String(amount), symbol: config.currencySymbol }),
      };
    } catch (error) {
      this.logger.error('Error adding money:', error);

      return { success: false, message: i18n.t('economy.tx.error', guildId) };
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
      if (this.invalidAmount(amount)) {
        return { success: false, message: i18n.t('economy.errors.invalid_amount', guildId) };
      }

      const config = await this.getConfig(guildId);

      if (!config.enabled) {
        return { success: false, message: i18n.t('economy.tx.disabled', guildId) };
      }

      await this.getUser(guildId, userId);
      const rows = await this.db!.prisma.$queryRaw<any[]>`
        UPDATE guild_users SET balance = balance - ${amount}, "updatedAt" = NOW()
        WHERE "guildId" = ${guildId} AND "userId" = ${userId} AND balance >= ${amount}
        RETURNING *`;

      if (rows.length === 0) {
        return {
          success: false,
          message: i18n.t('economy.tx.insufficient', guildId, { currency: config.currencyName }),
        };
      }

      const user = this.remember(rows[0]);
      this.logger.info(`Removed ${amount} ${config.currencyName} from user ${userId} in guild ${guildId}. Reason: ${reason}`);

      this.recordTransaction(guildId);

      return {
        success: true,
        newBalance: user.balance,
        message: i18n.t('economy.tx.removed', guildId, { amount: String(amount), symbol: config.currencySymbol }),
      };
    } catch (error) {
      this.logger.error('Error removing money:', error);

      return { success: false, message: i18n.t('economy.tx.error', guildId) };
    }
  }

  /**
   * Transfiere dinero entre usuarios (débito y crédito en una sola transacción)
   */
  public async transferMoney(
    guildId: string,
    fromUserId: string,
    toUserId: string,
    amount: number
  ): Promise<TransactionResult> {
    try {
      if (this.invalidAmount(amount)) {
        return { success: false, message: i18n.t('economy.errors.invalid_amount', guildId) };
      }

      const config = await this.getConfig(guildId);

      if (!config.enabled) {
        return { success: false, message: i18n.t('economy.tx.disabled', guildId) };
      }

      if (fromUserId === toUserId) {
        return { success: false, message: i18n.t('economy.tx.self_transfer', guildId) };
      }

      await this.getUser(guildId, fromUserId);
      await this.getUser(guildId, toUserId);

      const outcome = await this.db!.prisma.$transaction(async (tx) => {
        const debited = await tx.$queryRaw<any[]>`
          UPDATE guild_users SET balance = balance - ${amount}, "updatedAt" = NOW()
          WHERE "guildId" = ${guildId} AND "userId" = ${fromUserId} AND balance >= ${amount}
          RETURNING *`;
        if (debited.length === 0) throw new TransferError('insufficient');

        const credited = await tx.$queryRaw<any[]>`
          UPDATE guild_users SET balance = balance + ${amount}, "updatedAt" = NOW()
          WHERE "guildId" = ${guildId} AND "userId" = ${toUserId} AND balance + ${amount} <= ${config.maxBalance}
          RETURNING *`;
        if (credited.length === 0) throw new TransferError('receiver_limit');

        return { from: debited[0], to: credited[0] };
      }).catch((err) => {
        if (err instanceof TransferError) return err.reason;
        throw err;
      });

      if (outcome === 'insufficient') {
        return { success: false, message: i18n.t('economy.tx.insufficient', guildId, { currency: config.currencyName }) };
      }
      if (outcome === 'receiver_limit') {
        return { success: false, message: i18n.t('economy.tx.receiver_limit', guildId, { max: String(config.maxBalance) }) };
      }

      const fromUser = this.remember(outcome.from);
      this.remember(outcome.to);
      this.logger.info(`Transferred ${amount} ${config.currencyName} from ${fromUserId} to ${toUserId} in guild ${guildId}`);

      this.recordTransaction(guildId);

      return {
        success: true,
        newBalance: fromUser.balance,
        message: i18n.t('economy.tx.transferred', guildId, { amount: String(amount), symbol: config.currencySymbol }),
      };
    } catch (error) {
      this.logger.error('Error transferring money:', error);

      return { success: false, message: i18n.t('economy.tx.transfer_error', guildId) };
    }
  }

  /**
   * Reclama recompensa diaria (racha: +1 si la anterior fue hace menos de 48 h)
   */
  public async claimDaily(guildId: string, userId: string): Promise<TransactionResult> {
    const lang = i18n.getGuildLanguage(guildId);

    try {
      const config = await this.getConfig(guildId);

      if (!config.enabled) {
        return { success: false, message: i18n.t('economy.disabled', lang) };
      }

      await this.getUser(guildId, userId);
      // Racha y recompensa se calculan dentro del UPDATE (bono = 10 por día, máx. 200)
      const rows = await this.db!.prisma.$queryRaw<any[]>`
        WITH next AS (
          SELECT CASE WHEN "lastDaily" IS NOT NULL AND "lastDaily" > NOW() - INTERVAL '48 hours'
                      THEN "dailyStreak" + 1 ELSE 1 END AS streak
          FROM guild_users WHERE "guildId" = ${guildId} AND "userId" = ${userId}
        )
        UPDATE guild_users g
        SET "dailyStreak" = next.streak,
            balance = LEAST(g.balance + ${config.dailyReward} + LEAST(next.streak * 10, 200), ${config.maxBalance}),
            "lastDaily" = NOW(),
            "updatedAt" = NOW()
        FROM next
        WHERE g."guildId" = ${guildId} AND g."userId" = ${userId}
          AND (g."lastDaily" IS NULL OR g."lastDaily" <= NOW() - INTERVAL '24 hours')
        RETURNING g.*`;

      if (rows.length === 0) {
        const current = await this.freshUser(guildId, userId);
        const hoursLeft = current.lastDaily
          ? Math.max(1, Math.ceil(24 - (Date.now() - new Date(current.lastDaily).getTime()) / 3_600_000))
          : 1;
        return { success: false, message: i18n.t('economy.daily.cooldown', lang, { hours: hoursLeft.toString() }) };
      }

      const user = this.remember(rows[0]);
      const streakBonus = Math.min(user.dailyStreak * 10, 200);

      this.recordTransaction(guildId);

      return {
        success: true,
        newBalance: user.balance,
        amount: config.dailyReward + streakBonus,
        message: i18n.t('economy.daily.success', lang, {
          amount: (config.dailyReward + streakBonus).toString(),
          symbol: config.currencySymbol,
          base: config.dailyReward.toString(),
          bonus: streakBonus.toString(),
          streak: user.dailyStreak.toString()
        }),
      };
    } catch (error) {
      this.logger.error('Error claiming daily:', error);

      return { success: false, message: i18n.t('economy.daily.error', lang) };
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

      await this.getUser(guildId, userId);
      const rows = await this.db!.prisma.$queryRaw<any[]>`
        UPDATE guild_users
        SET balance = LEAST(balance + ${config.weeklyReward}, ${config.maxBalance}), "lastWeekly" = NOW(), "updatedAt" = NOW()
        WHERE "guildId" = ${guildId} AND "userId" = ${userId}
          AND ("lastWeekly" IS NULL OR "lastWeekly" <= NOW() - INTERVAL '7 days')
        RETURNING *`;

      if (rows.length === 0) {
        const current = await this.freshUser(guildId, userId);
        const daysLeft = current.lastWeekly
          ? Math.max(1, Math.ceil(7 - (Date.now() - new Date(current.lastWeekly).getTime()) / 86_400_000))
          : 1;
        return { success: false, message: i18n.t('economy.weekly.cooldown', lang, { days: daysLeft.toString() }) };
      }

      const user = this.remember(rows[0]);

      this.recordTransaction(guildId);

      return {
        success: true,
        newBalance: user.balance,
        amount: config.weeklyReward,
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

      const min = Math.min(config.workMinReward, config.workMaxReward);
      const max = Math.max(config.workMinReward, config.workMaxReward);
      const reward = randomInt(min, max + 1);

      await this.getUser(guildId, userId);
      const rows = await this.db!.prisma.$queryRaw<any[]>`
        UPDATE guild_users
        SET balance = LEAST(balance + ${reward}, ${config.maxBalance}), "lastWork" = NOW(), "updatedAt" = NOW()
        WHERE "guildId" = ${guildId} AND "userId" = ${userId}
          AND ("lastWork" IS NULL OR "lastWork" <= NOW() - make_interval(secs => ${config.workCooldown}))
        RETURNING *`;

      if (rows.length === 0) {
        const current = await this.freshUser(guildId, userId);
        const secondsLeft = current.lastWork
          ? config.workCooldown - (Date.now() - new Date(current.lastWork).getTime()) / 1000
          : 60;
        return { success: false, message: i18n.t('economy.work.cooldown', lang, { minutes: Math.max(1, Math.ceil(secondsLeft / 60)).toString() }) };
      }

      const user = this.remember(rows[0]);

      this.recordTransaction(guildId);

      return {
        success: true,
        newBalance: user.balance,
        amount: reward,
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
      if (this.invalidAmount(amount)) {
        return { success: false, message: i18n.t('economy.errors.invalid_amount', guildId) };
      }

      const config = await this.getConfig(guildId);

      if (!config.enabled) {
        return { success: false, message: i18n.t('economy.tx.disabled', guildId) };
      }

      await this.getUser(guildId, userId);
      const rows = await this.db!.prisma.$queryRaw<any[]>`
        UPDATE guild_users SET balance = balance - ${amount}, bank = bank + ${amount}, "updatedAt" = NOW()
        WHERE "guildId" = ${guildId} AND "userId" = ${userId}
          AND balance >= ${amount} AND bank + ${amount} <= ${config.maxBank}
        RETURNING *`;

      if (rows.length === 0) {
        const current = await this.freshUser(guildId, userId);
        return {
          success: false,
          message: current.balance < amount
            ? i18n.t('economy.tx.insufficient_wallet', guildId, { currency: config.currencyName })
            : i18n.t('economy.tx.max_bank', guildId, { max: String(config.maxBank), currency: config.currencyName }),
        };
      }

      const user = this.remember(rows[0]);

      this.recordTransaction(guildId);

      return {
        success: true,
        newBalance: user.balance,
        message: i18n.t('economy.tx.deposited', guildId, { amount: String(amount), symbol: config.currencySymbol }),
      };
    } catch (error) {
      this.logger.error('Error depositing:', error);

      return { success: false, message: i18n.t('economy.tx.deposit_error', guildId) };
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
      if (this.invalidAmount(amount)) {
        return { success: false, message: i18n.t('economy.errors.invalid_amount', guildId) };
      }

      const config = await this.getConfig(guildId);

      if (!config.enabled) {
        return { success: false, message: i18n.t('economy.tx.disabled', guildId) };
      }

      await this.getUser(guildId, userId);
      const rows = await this.db!.prisma.$queryRaw<any[]>`
        UPDATE guild_users SET bank = bank - ${amount}, balance = balance + ${amount}, "updatedAt" = NOW()
        WHERE "guildId" = ${guildId} AND "userId" = ${userId}
          AND bank >= ${amount} AND balance + ${amount} <= ${config.maxBalance}
        RETURNING *`;

      if (rows.length === 0) {
        const current = await this.freshUser(guildId, userId);
        return {
          success: false,
          message: current.bank < amount
            ? i18n.t('economy.tx.insufficient_bank', guildId, { currency: config.currencyName })
            : i18n.t('economy.tx.max_wallet', guildId, { max: String(config.maxBalance), currency: config.currencyName }),
        };
      }

      const user = this.remember(rows[0]);

      this.recordTransaction(guildId);

      return {
        success: true,
        newBalance: user.balance,
        message: i18n.t('economy.tx.withdrew', guildId, { amount: String(amount), symbol: config.currencySymbol }),
      };
    } catch (error) {
      this.logger.error('Error withdrawing:', error);

      return { success: false, message: i18n.t('economy.tx.withdraw_error', guildId) };
    }
  }

  /**
   * Obtiene el leaderboard de dinero
   */
  public async getLeaderboard(guildId: string, limit: number = 10, offset: number = 0): Promise<EconomyUser[]> {
    try {
      if (!this.db) {
        return [];
      }

      // Ordenado por riqueza total (cartera + banco); se omiten usuarios sin dinero
      const users = await this.db.prisma.$queryRaw<Array<{
        guildId: string; userId: string; balance: number; bank: number; dailyStreak: number;
        lastDaily: Date | null; lastWeekly: Date | null; lastWork: Date | null;
      }>>`
        SELECT "guildId", "userId", balance, bank, "dailyStreak", "lastDaily", "lastWeekly", "lastWork"
        FROM guild_users
        WHERE "guildId" = ${guildId} AND (balance + bank) > 0
        ORDER BY (balance::bigint + bank::bigint) DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

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
