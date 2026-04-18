/**
 * LicenseExpiryJob
 *
 * Runs every 60 minutes. Finds all AddonLicense records where
 * status = 'ACTIVE' and expiresAt <= now, marks them EXPIRED, and
 * removes the addon from guild.enabledAddons so the bot stops
 * serving it instantly.
 *
 * This covers courtesy licenses, coupon-discounted subscriptions,
 * and any other license with a finite expiry that is NOT managed
 * by PayPal webhooks.
 */

import { createLogger } from '../utils/Logger';
import type { KorexClient } from '../client/KorexClient';

const logger = createLogger('license-expiry-job');

/** How often the job runs (ms). */
const RUN_INTERVAL_MS = 60 * 60 * 1_000; // 1 hour

/** Delay before the first run after bot startup (ms). */
const INITIAL_DELAY_MS = 30_000; // 30 seconds — let the bot finish loading

export class LicenseExpiryJob {
  private client: KorexClient;
  private interval: NodeJS.Timeout | null = null;

  constructor(client: KorexClient) {
    this.client = client;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  start(): void {
    // Initial run after bot stabilises
    setTimeout(() => {
      this.run().catch(err => logger.error('Initial expiry run failed:', err));
    }, INITIAL_DELAY_MS);

    // Recurring runs
    this.interval = setInterval(() => {
      this.run().catch(err => logger.error('Expiry run failed:', err));
    }, RUN_INTERVAL_MS);

    logger.info(`LicenseExpiryJob started (interval: ${RUN_INTERVAL_MS / 60_000} min)`);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    logger.info('LicenseExpiryJob stopped');
  }

  // ─── Core logic ──────────────────────────────────────────────────────────────

  private async run(): Promise<void> {
    const now = new Date();

    // 1. Find all expired-but-still-ACTIVE licenses in a single DB query
    const expired = await this.client.db.addonLicense.findMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { lte: now },
      },
      select: {
        id:        true,
        guildId:   true,
        addonName: true,
        expiresAt: true,
        courtesy:  true,
      },
    });

    if (expired.length === 0) return;

    logger.info(`Found ${expired.length} expired license(s) to process`);

    // 2. Bulk-mark them EXPIRED in a single transaction
    const ids = expired.map(l => l.id);
    await this.client.db.addonLicense.updateMany({
      where:  { id: { in: ids } },
      data:   { status: 'EXPIRED' },
    });

    // 3. Per-guild: remove from enabledAddons + clear Redis cache
    //    Group by guildId so we update each guild record only once.
    const byGuild = new Map<string, string[]>();
    for (const lic of expired) {
      const existing = byGuild.get(lic.guildId) ?? [];
      existing.push(lic.addonName);
      byGuild.set(lic.guildId, existing);
    }

    const redis = this.client.redis.getClient();

    for (const [guildId, addonNames] of byGuild) {
      try {
        // a) Remove each addon from enabledAddons
        for (const addonName of addonNames) {
          await this.client.addons.disableAddon(guildId, addonName);
        }

        // b) Invalidate all license-related Redis keys for this guild
        const licKeys = await redis.keys(`license:${guildId}:*`);
        if (licKeys.length > 0) await redis.del(...licKeys);

        // c) Invalidate AddonSyncService cache keys
        for (const addonName of addonNames) {
          await redis.del(`addon:active:${guildId}:${addonName}`);
        }

        // d) Notify the guild owner via DM (best-effort)
        await this.notifyOwner(guildId, addonNames).catch(err =>
          logger.warn(`DM notification failed for guild ${guildId}:`, err)
        );

        logger.info(
          `Guild ${guildId}: expired [${addonNames.join(', ')}] and removed from enabledAddons`
        );
      } catch (err) {
        logger.error(`Error processing expiry for guild ${guildId}:`, err);
      }
    }

    logger.info(`LicenseExpiryJob complete — ${expired.length} license(s) expired`);
  }

  // ─── DM notification ─────────────────────────────────────────────────────────

  private async notifyOwner(guildId: string, addonNames: string[]): Promise<void> {
    const discordGuild = this.client.guilds.cache.get(guildId)
      ?? await this.client.guilds.fetch(guildId).catch(() => null);

    if (!discordGuild) return;

    const owner = await this.client.users.fetch(discordGuild.ownerId).catch(() => null);
    if (!owner) return;

    const addonList = addonNames.map(n => `• **${n}**`).join('\n');
    const message = [
      `⚠️ **Korex — Licencia expirada**`,
      ``,
      `Las siguientes licencias premium han expirado en **${discordGuild.name}**:`,
      addonList,
      ``,
      `Para renovar el acceso, visita el panel: https://panel.korex.dev`,
    ].join('\n');

    await owner.send({ content: message });
  }
}
