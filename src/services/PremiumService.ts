import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';

// ─── Public types ──────────────────────────────────────────────────────────────

export interface PremiumPlan {
  id: string;
  name: string;
  price: number;
  duration: number; // days
  features: string[];
  limits: {
    autoResponses: number;    // -1 = unlimited
    giveaways: number;
    polls: number;
    customCommands: number;
  };
}

/** Normalized representation of a subscription, compatible with existing commands. */
export interface PremiumSubscription {
  id: string;
  guildId: string;
  planId: string;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  isDemo: boolean;
  usage: {
    autoResponses: number;
    giveaways: number;
    polls: number;
    customCommands: number;
  };
}

// ─── Redis cache key ──────────────────────────────────────────────────────────

const CACHE_TTL = 5 * 60; // 5 minutes

function cacheKey(guildId: string): string {
  return `premium:guild:${guildId}`;
}

// ─── Service ───────────────────────────────────────────────────────────────────

export class PremiumService {
  private client: KorexClient;

  /** Plans defined in code (prices, limits, features). */
  private readonly plans: Map<string, PremiumPlan> = new Map([
    ['demo', {
      id: 'demo',
      name: 'Demo Trial',
      price: 0,
      duration: 7,
      features: [
        'unlimited_autoresponses',
        'advanced_giveaways',
        'extended_polls',
        'priority_support',
        'custom_branding',
        'advanced_analytics',
        'custom_commands',
      ],
      limits: { autoResponses: -1, giveaways: -1, polls: -1, customCommands: 10 },
    }],
    ['basic', {
      id: 'basic',
      name: 'Basic Premium',
      price: 4.99,
      duration: 30,
      features: [
        'unlimited_autoresponses',
        'advanced_giveaways',
        'extended_polls',
        'priority_support',
      ],
      limits: { autoResponses: -1, giveaways: 10, polls: 20, customCommands: 5 },
    }],
    ['pro', {
      id: 'pro',
      name: 'Pro Premium',
      price: 9.99,
      duration: 30,
      features: [
        'unlimited_autoresponses',
        'advanced_giveaways',
        'extended_polls',
        'priority_support',
        'custom_branding',
        'advanced_analytics',
        'custom_commands',
      ],
      limits: { autoResponses: -1, giveaways: -1, polls: -1, customCommands: 25 },
    }],
  ]);

  constructor(client: KorexClient) {
    this.client = client;
  }

  // ─── Queries ─────────────────────────────────────────────────────────────────

  /**
   * Returns the active subscription of a guild from the DB (with Redis cache).
   * Returns null if it does not exist or has expired/been cancelled/suspended.
   */
  async getGuildSubscription(guildId: string): Promise<PremiumSubscription | null> {
    // 1. Try cache
    try {
      const cached = await this.client.redis.getClient().get(cacheKey(guildId));
      if (cached === 'null') return null;
      if (cached) return JSON.parse(cached) as PremiumSubscription;
    } catch {
      // If Redis fails, fall back to the DB
    }

    // 2. Query DB
    const row = await this.client.db.guildPremium.findUnique({
      where: { guildId },
    });

    if (!row) {
      await this.setCache(guildId, null);
      return null;
    }

    const sub = this.mapRowToSubscription(row);
    await this.setCache(guildId, sub);
    return sub;
  }

  /** Checks whether the guild has an active, non-expired subscription. */
  async hasActivePremium(guildId: string): Promise<boolean> {
    const sub = await this.getGuildSubscription(guildId);
    if (!sub) return false;
    return sub.isActive && sub.endDate > new Date();
  }

  getAvailablePlans(): PremiumPlan[] {
    return Array.from(this.plans.values());
  }

  getPlan(planId: string): PremiumPlan | null {
    return this.plans.get(planId) ?? null;
  }

  // ─── Activation ──────────────────────────────────────────────────────────────

  /**
   * Activates (or reactivates) a subscription for the guild.
   * For paid plans (basic/pro) the actual activation comes from the PayPal webhook;
   * this method only handles the demo plan and administrative activations.
   */
  async activatePremium(
    guildId: string,
    planId: string,
    userId: string
  ): Promise<{ success: boolean; subscription?: PremiumSubscription; error?: string }> {
    const plan = this.getPlan(planId);
    if (!plan) return { success: false, error: 'Invalid plan' };

    // The demo is single-use per server: any previous record (demo, bundle,
    // courtesy…) blocks it, so it cannot be repeated nor overwrite a paid plan.
    if (planId === 'demo') {
      const anyPrevious = await this.client.db.guildPremium.findUnique({ where: { guildId }, select: { id: true } });
      if (anyPrevious) return { success: false, error: 'demo_already_used' };
    }

    const existing = await this.getGuildSubscription(guildId);
    if (existing?.isActive && existing.endDate > new Date()) {
      return { success: false, error: 'The server already has an active subscription' };
    }

    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + plan.duration * 24 * 60 * 60 * 1000);

    const row = await this.client.db.guildPremium.upsert({
      where: { guildId },
      update: {
        planId,
        userId,
        status: 'ACTIVE',
        isDemo: planId === 'demo',
        startedAt,
        expiresAt,
        cancelledAt: null,
        suspendedAt: null,
        paymentFailures: 0,
        lastPaymentFailedAt: null,
        usageAutoResponses: 0,
        usageGiveaways: 0,
        usagePolls: 0,
        usageCustomCommands: 0,
      },
      create: {
        guildId,
        planId,
        userId,
        status: 'ACTIVE',
        isDemo: planId === 'demo',
        startedAt,
        expiresAt,
      },
    });

    await this.invalidateCache(guildId);
    this.client.logger.info(`Premium activated: guild=${guildId} plan=${planId} user=${userId}`);

    return { success: true, subscription: this.mapRowToSubscription(row) };
  }

  // ─── Cancellation ───────────────────────────────────────────────────────────

  async cancelPremium(guildId: string): Promise<{ success: boolean; error?: string }> {
    const sub = await this.getGuildSubscription(guildId);
    if (!sub?.isActive) return { success: false, error: 'No active subscription' };

    await this.client.db.guildPremium.update({
      where: { guildId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    await this.invalidateCache(guildId);
    this.client.logger.info(`Premium cancelled: guild=${guildId}`);
    return { success: true };
  }

  // ─── Usage / Limits ──────────────────────────────────────────────────────────

  async getUsageStats(guildId: string): Promise<{
    subscription: PremiumSubscription | null;
    plan: PremiumPlan | null;
    usage: {
      autoResponses:  { used: number; limit: number; percentage: number };
      giveaways:      { used: number; limit: number; percentage: number };
      polls:          { used: number; limit: number; percentage: number };
      customCommands: { used: number; limit: number; percentage: number };
    };
    daysRemaining: number;
  }> {
    const sub = await this.getGuildSubscription(guildId);
    const plan = sub ? this.getPlan(sub.planId) : null;
    const empty = { used: 0, limit: 0, percentage: 0 };

    if (!sub || !plan) {
      return {
        subscription: null, plan: null,
        usage: { autoResponses: empty, giveaways: empty, polls: empty, customCommands: empty },
        daysRemaining: 0,
      };
    }

    const calc = (used: number, limit: number) => ({
      used,
      limit,
      percentage: limit === -1 ? 0 : Math.round((used / limit) * 100),
    });

    const daysRemaining = Math.max(
      0,
      Math.ceil((sub.endDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    );

    return {
      subscription: sub,
      plan,
      usage: {
        autoResponses:  calc(sub.usage.autoResponses,  plan.limits.autoResponses),
        giveaways:      calc(sub.usage.giveaways,      plan.limits.giveaways),
        polls:          calc(sub.usage.polls,           plan.limits.polls),
        customCommands: calc(sub.usage.customCommands,  plan.limits.customCommands),
      },
      daysRemaining,
    };
  }

  async canUseFeature(guildId: string, feature: string): Promise<boolean> {
    const sub = await this.getGuildSubscription(guildId);
    if (!sub?.isActive || sub.endDate <= new Date()) return false;
    return this.getPlan(sub.planId)?.features.includes(feature) ?? false;
  }

  async isUsageLimitReached(
    guildId: string,
    type: keyof PremiumSubscription['usage']
  ): Promise<boolean> {
    const sub = await this.getGuildSubscription(guildId);
    if (!sub) return true;
    const plan = this.getPlan(sub.planId);
    if (!plan) return true;
    const limit = plan.limits[type];
    return limit !== -1 && sub.usage[type] >= limit;
  }

  async incrementUsage(
    guildId: string,
    type: keyof PremiumSubscription['usage']
  ): Promise<void> {
    const dbField = `usage${type.charAt(0).toUpperCase()}${type.slice(1)}` as
      'usageAutoResponses' | 'usageGiveaways' | 'usagePolls' | 'usageCustomCommands';

    await this.client.db.guildPremium.update({
      where: { guildId },
      data: { [dbField]: { increment: 1 } },
    });
    await this.invalidateCache(guildId);
  }

  // ─── Presentation ─────────────────────────────────────────────────────────────

  getPremiumBenefits(guildId: string): string[] {
    return [
      i18n.t('premium.benefits.unlimited_autoresponses', guildId),
      i18n.t('premium.benefits.advanced_giveaways', guildId),
      i18n.t('premium.benefits.extended_polls', guildId),
      i18n.t('premium.benefits.priority_support', guildId),
      i18n.t('premium.benefits.custom_branding', guildId),
      i18n.t('premium.benefits.advanced_analytics', guildId),
      i18n.t('premium.benefits.custom_commands', guildId),
    ];
  }

  formatPrice(price: number): string {
    return `$${price.toFixed(2)}`;
  }

  getDaysRemaining(sub: PremiumSubscription): number {
    return Math.max(0, Math.ceil((sub.endDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /** Converts a DB row into the PremiumSubscription format used by commands. */
  private mapRowToSubscription(row: any): PremiumSubscription {
    return {
      id:        row.id,
      guildId:   row.guildId,
      planId:    row.planId,
      startDate: row.startedAt,
      endDate:   row.expiresAt,
      isActive:  row.status === 'ACTIVE',
      isDemo:    row.isDemo,
      usage: {
        autoResponses:  row.usageAutoResponses,
        giveaways:      row.usageGiveaways,
        polls:          row.usagePolls,
        customCommands: row.usageCustomCommands,
      },
    };
  }

  private async setCache(guildId: string, sub: PremiumSubscription | null): Promise<void> {
    try {
      const redis = this.client.redis.getClient();
      if (sub === null) {
        // Cache absence to avoid hitting the DB on every command
        await redis.setex(cacheKey(guildId), CACHE_TTL, 'null');
      } else {
        await redis.setex(cacheKey(guildId), CACHE_TTL, JSON.stringify(sub));
      }
    } catch {
      // Redis error is not critical
    }
  }

  /** Clears the guild cache. Always call after modifying the subscription. */
  async invalidateCache(guildId: string): Promise<void> {
    try {
      await this.client.redis.getClient().del(cacheKey(guildId));
    } catch {
      // Ignore Redis errors
    }
  }
}
