/**
 * GuildKickoutService
 *
 * Handles the full lifecycle when a guild removes the bot:
 *   1. Immediately: marks licenses/premium as KICKOUT (suspends access but keeps data)
 *   2. Grace period (7 days): if bot is re-added, all KICKOUT records are restored to ACTIVE
 *   3. After grace period: daily job cancels PayPal subscriptions and marks records CANCELLED
 *
 * This ensures:
 *   - Accidental removals don't result in immediate billing cancellation
 *   - After 7 days, PayPal subs are cleanly cancelled to prevent phantom charges
 *   - Full audit trail via kickoutAt timestamp
 */

import { createLogger } from '../utils/Logger';
import type { KorexClient } from '../client/KorexClient';
import { BUNDLE_ADDONS } from './AddonSyncService';

const logger = createLogger('guild-kickout');

/** Days before KICKOUT records are permanently cancelled */
export const KICKOUT_GRACE_DAYS = 7;

/** How often the cleanup job runs */
const RUN_INTERVAL_MS = 24 * 60 * 60 * 1_000; // 24 hours

/** Delay before first run (let bot finish loading) */
const INITIAL_DELAY_MS = 60_000; // 1 minute

export class GuildKickoutService {
  private client: KorexClient;
  private interval: NodeJS.Timeout | null = null;

  constructor(client: KorexClient) {
    this.client = client;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  start(): void {
    setTimeout(() => {
      this.runCleanupJob().catch(err => logger.error('Initial kickout cleanup failed:', err));
    }, INITIAL_DELAY_MS);

    this.interval = setInterval(() => {
      this.runCleanupJob().catch(err => logger.error('Kickout cleanup failed:', err));
    }, RUN_INTERVAL_MS);

    logger.info('GuildKickoutService started');
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    logger.info('GuildKickoutService stopped');
  }

  // ─── Kickout (bot removed from guild) ────────────────────────────────────────

  /**
   * Called when guildDelete fires. Suspends all paid access with KICKOUT status.
   * Does NOT cancel PayPal yet — waits for grace period.
   */
  async handleGuildLeft(guildId: string): Promise<void> {
    const now = new Date();
    logger.info(`Handling guild left: ${guildId}`);

    try {
      await Promise.all([
        // Mark guild leftAt
        this.client.db.guild.updateMany({
          where: { id: guildId },
          data: { leftAt: now },
        }),

        // Suspend all active addon licenses → KICKOUT
        this.client.db.addonLicense.updateMany({
          where: { guildId, status: 'ACTIVE' },
          data: { status: 'KICKOUT', kickoutAt: now },
        }),

        // Suspend active bundle premium → KICKOUT
        this.client.db.guildPremium.updateMany({
          where: { guildId, status: 'ACTIVE' },
          data: { status: 'KICKOUT', kickoutAt: now },
        }),
      ]);

      // Purge all addon cache for this guild so isAddonActive returns false immediately
      await this.purgeGuildAddonCache(guildId);

      // Remove paid addons from enabledAddons (handleGuildRejoined restores them)
      await this.disablePaidAddons(guildId);

      logger.info(`Guild ${guildId} marked as KICKOUT — grace period: ${KICKOUT_GRACE_DAYS} days`);
    } catch (error) {
      logger.error(`Error handling guild left for ${guildId}:`, error);
      throw error;
    }
  }

  // ─── Restore (bot re-added within grace period) ───────────────────────────────

  /**
   * Called when guildCreate fires. If KICKOUT records exist within grace period,
   * restores them to ACTIVE and refreshes cache.
   * Returns true if any records were restored.
   */
  async handleGuildRejoined(guildId: string): Promise<boolean> {
    const graceDeadline = new Date(Date.now() - KICKOUT_GRACE_DAYS * 24 * 60 * 60 * 1_000);

    try {
      // Find KICKOUT records still within grace period
      const [kickoutLicenses, kickoutPremium] = await Promise.all([
        this.client.db.addonLicense.findMany({
          where: {
            guildId,
            status: 'KICKOUT',
            kickoutAt: { gte: graceDeadline },
          },
        }),
        this.client.db.guildPremium.findMany({
          where: {
            guildId,
            status: 'KICKOUT',
            kickoutAt: { gte: graceDeadline },
          },
        }),
      ]);

      if (kickoutLicenses.length === 0 && kickoutPremium.length === 0) {
        return false;
      }

      const now = new Date();

      // Restore each record: PayPal subscriptions kept charging during
      // the grace period (SALE.COMPLETED extends expiresAt), but anything not billed (comps,
      // manual reactivations) gets back the time it was paused. Anything that expired
      // during the kickout is not reactivated.
      const resumeExpiry = (rec: { expiresAt: Date; kickoutAt: Date | null; paypalSubscriptionId: string | null }) => {
        const billedByPayPal = !!rec.paypalSubscriptionId?.startsWith('I-');
        const pausedMs = rec.kickoutAt ? Math.max(0, now.getTime() - rec.kickoutAt.getTime()) : 0;
        return billedByPayPal ? rec.expiresAt : new Date(rec.expiresAt.getTime() + pausedMs);
      };

      const restoredLicenses: typeof kickoutLicenses = [];
      for (const lic of kickoutLicenses) {
        const expiresAt = resumeExpiry(lic);
        const alive = expiresAt > now;
        await this.client.db.addonLicense.updateMany({
          where: { id: lic.id, status: 'KICKOUT' },
          data: alive
            ? { status: 'ACTIVE', kickoutAt: null, expiresAt }
            : { status: lic.cancelledAt ? 'CANCELLED' : 'EXPIRED', kickoutAt: null },
        });
        if (alive) restoredLicenses.push(lic);
      }

      const restoredPremium: typeof kickoutPremium = [];
      for (const premium of kickoutPremium) {
        const expiresAt = resumeExpiry(premium);
        const alive = expiresAt > now;
        await this.client.db.guildPremium.updateMany({
          where: { id: premium.id, status: 'KICKOUT' },
          data: alive
            ? { status: 'ACTIVE', kickoutAt: null, expiresAt }
            : { status: premium.cancelledAt ? 'CANCELLED' : 'EXPIRED', kickoutAt: null },
        });
        if (alive) restoredPremium.push(premium);
      }

      // Clear leftAt since bot is back
      await this.client.db.guild.updateMany({
        where: { id: guildId },
        data: { leftAt: null },
      });

      // Clear negative caches before re-enabling
      await this.purgeGuildAddonCache(guildId);

      const restoresBundle = restoredPremium.some(p => p.planId === 'bundle');
      if (restoresBundle) {
        await this.client.redis.getClient().setex(`bundle:guild:${guildId}`, 3600, 'true');
      }

      // Re-enable (onEnable + command sync) the addons whose license was
      // restored and, if the bundle is back, the addons it covers.
      const restoredAddonNames = restoredLicenses.map(l => l.addonName);
      const allRestoredNames = [
        ...restoredAddonNames,
        ...(restoresBundle ? Array.from(BUNDLE_ADDONS) : []),
      ];

      for (const addonName of [...new Set(allRestoredNames)]) {
        await this.client.addons.enableAddon(guildId, addonName).catch(() => false);
        await this.client.addonSync.publishEvent({
          type: 'ADDON_ACTIVATED',
          guildId,
          addonName,
        });
      }

      logger.info(
        `Guild ${guildId} restored: ${restoredLicenses.length}/${kickoutLicenses.length} licenses, ${restoredPremium.length}/${kickoutPremium.length} premium records`
      );

      return restoredLicenses.length > 0 || restoredPremium.length > 0;
    } catch (error) {
      logger.error(`Error handling guild rejoin for ${guildId}:`, error);
      return false;
    }
  }

  // ─── Daily cleanup job ────────────────────────────────────────────────────────

  /**
   * Finds all KICKOUT records older than KICKOUT_GRACE_DAYS.
   * Cancels their PayPal subscriptions and marks them CANCELLED.
   */
  private async runCleanupJob(): Promise<void> {
    const graceDeadline = new Date(Date.now() - KICKOUT_GRACE_DAYS * 24 * 60 * 60 * 1_000);
    logger.info(`Running kickout cleanup for records kicked before ${graceDeadline.toISOString()}`);

    try {
      await Promise.all([
        this.processExpiredLicenses(graceDeadline),
        this.processExpiredPremium(graceDeadline),
      ]);
    } catch (error) {
      logger.error('Kickout cleanup job error:', error);
    }
  }

  private async processExpiredLicenses(graceDeadline: Date): Promise<void> {
    const expired = await this.client.db.addonLicense.findMany({
      where: {
        status: 'KICKOUT',
        kickoutAt: { lt: graceDeadline },
      },
    });

    if (expired.length === 0) return;

    logger.info(`Processing ${expired.length} expired addon license kickouts`);

    for (const license of expired) {
      try {
        // Cancel PayPal subscription if it's a real one (starts with I-)
        if (license.paypalSubscriptionId?.startsWith('I-')) {
          await this.cancelPayPalSubscription(license.paypalSubscriptionId, license.guildId, license.addonName);
        }

        await this.client.db.addonLicense.update({
          where: { id: license.id },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
        });

        logger.info(`License permanently cancelled: ${license.addonName} guild=${license.guildId}`);
      } catch (error) {
        logger.error(`Error cancelling expired license ${license.id}:`, error);
        // Continue processing other licenses even if one fails
      }
    }
  }

  private async processExpiredPremium(graceDeadline: Date): Promise<void> {
    const expired = await this.client.db.guildPremium.findMany({
      where: {
        status: 'KICKOUT',
        kickoutAt: { lt: graceDeadline },
      },
    });

    if (expired.length === 0) return;

    logger.info(`Processing ${expired.length} expired guild premium kickouts`);

    for (const premium of expired) {
      try {
        if (premium.paypalSubscriptionId?.startsWith('I-')) {
          await this.cancelPayPalSubscription(premium.paypalSubscriptionId, premium.guildId, `premium:${premium.planId}`);
        }

        await this.client.db.guildPremium.update({
          where: { id: premium.id },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
        });

        logger.info(`Premium permanently cancelled: planId=${premium.planId} guild=${premium.guildId}`);
      } catch (error) {
        logger.error(`Error cancelling expired premium ${premium.id}:`, error);
      }
    }
  }

  // ─── PayPal ───────────────────────────────────────────────────────────────────

  private async cancelPayPalSubscription(
    subscriptionId: string,
    guildId: string,
    label: string
  ): Promise<void> {
    const token = await this.getPayPalToken();
    const baseUrl =
      process.env.PAYPAL_MODE === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com';

    const res = await fetch(
      `${baseUrl}/v1/billing/subscriptions/${subscriptionId}/cancel`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Bot removed from server — grace period expired' }),
      }
    );

    if (res.status === 200 || res.status === 204 || res.status === 422) {
      // 422 = subscription already cancelled/suspended in PayPal — treat as success
      logger.info(`PayPal sub ${subscriptionId} cancelled (${label}, guild=${guildId})`);
    } else {
      const body = await res.text().catch(() => '');
      throw new Error(`PayPal cancel failed: ${res.status} ${body}`);
    }
  }

  private async getPayPalToken(): Promise<string> {
    const clientId = process.env.PAYPAL_CLIENT_ID!;
    const secret = process.env.PAYPAL_CLIENT_SECRET!;
    const baseUrl =
      process.env.PAYPAL_MODE === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com';

    const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!res.ok) throw new Error(`PayPal OAuth failed: ${res.status}`);
    const data: any = await res.json();
    return data.access_token;
  }

  // ─── Cache helpers ────────────────────────────────────────────────────────────

  /** Removes loaded paid addons from enabledAddons (without touching core modules). */
  private async disablePaidAddons(guildId: string): Promise<void> {
    const guild = await this.client.db.guild.findUnique({
      where: { id: guildId },
      select: { enabledAddons: true },
    });
    for (const addonName of guild?.enabledAddons ?? []) {
      if (!this.client.addons.getAddon(addonName)) continue; // core module
      await this.client.addons.disableAddon(guildId, addonName).catch(() => false);
    }
  }

  private async purgeGuildAddonCache(guildId: string): Promise<void> {
    const redis = this.client.redis.getClient();

    // Delete bundle cache
    await redis.del(`bundle:guild:${guildId}`);

    // Delete individual addon caches for all known addon names
    const allAddonNames = [...new Set([
      ...Array.from(BUNDLE_ADDONS),
      ...this.client.addons.getLoadedAddons().map(a => a.config.name),
      'music-pro', 'ai-assistant',
    ])];

    await Promise.all(
      allAddonNames.map(name => redis.del(`addon:${name}:guild_${guildId}`))
    );
  }
}
