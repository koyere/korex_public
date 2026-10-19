/**
 * LicenseExpiryJob
 *
 * Runs every 60 minutes. Finds all AddonLicense records where
 * status = 'ACTIVE' and expiresAt <= now, marks them EXPIRED (or CANCELLED
 * when the subscription was cancelled and kept access until the end of the
 * paid period), and removes the addon from guild.enabledAddons unless it is
 * still covered by the bundle. Also expires bundles (guild_premiums).
 *
 * This covers courtesy licenses, coupon-discounted subscriptions,
 * and any other license with a finite expiry that is NOT managed
 * by PayPal webhooks.
 */

import { createLogger } from '../utils/Logger';
import { i18n } from '../utils/i18n';
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
    await this.expireLicenses();
    await this.expireBundles();
  }

  /**
   * Licencias individuales vencidas. Una licencia cancelada (cancelledAt) conserva
   * el acceso hasta expiresAt y aquí pasa a CANCELLED; el resto a EXPIRED.
   * El addon solo se deshabilita si no sigue cubierto por el bundle.
   */
  private async expireLicenses(): Promise<void> {
    const now = new Date();

    // 1. Find all expired-but-still-ACTIVE licenses in a single DB query
    const expired = await this.client.db.addonLicense.findMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { lte: now },
      },
      select: {
        id:          true,
        guildId:     true,
        addonName:   true,
        expiresAt:   true,
        courtesy:    true,
        cancelledAt: true,
      },
    });

    if (expired.length === 0) return;

    logger.info(`Found ${expired.length} expired license(s) to process`);

    // 2. Bulk-mark them (status guard: no pisar una renovación concurrente)
    const cancelledIds = expired.filter(l => l.cancelledAt).map(l => l.id);
    const expiredIds   = expired.filter(l => !l.cancelledAt).map(l => l.id);
    if (cancelledIds.length > 0) {
      await this.client.db.addonLicense.updateMany({
        where: { id: { in: cancelledIds }, status: 'ACTIVE', expiresAt: { lte: now } },
        data:  { status: 'CANCELLED' },
      });
    }
    if (expiredIds.length > 0) {
      await this.client.db.addonLicense.updateMany({
        where: { id: { in: expiredIds }, status: 'ACTIVE', expiresAt: { lte: now } },
        data:  { status: 'EXPIRED' },
      });
    }

    // 3. Per-guild: retirar el acceso (respeta el bundle) y avisar
    const byGuild = new Map<string, string[]>();
    for (const lic of expired) {
      const existing = byGuild.get(lic.guildId) ?? [];
      existing.push(lic.addonName);
      byGuild.set(lic.guildId, existing);
    }

    for (const [guildId, addonNames] of byGuild) {
      try {
        const lost: string[] = [];
        for (const addonName of addonNames) {
          if (await this.client.addonSync.revokeAccess(guildId, addonName)) lost.push(addonName);
        }

        if (lost.length > 0) {
          await this.notifyOwner(guildId, lost).catch(err =>
            logger.warn(`DM notification failed for guild ${guildId}:`, err)
          );
        }

        logger.info(
          `Guild ${guildId}: expired [${addonNames.join(', ')}]; disabled [${lost.join(', ')}]`
        );
      } catch (err) {
        logger.error(`Error processing expiry for guild ${guildId}:`, err);
      }
    }

    logger.info(`LicenseExpiryJob complete — ${expired.length} license(s) expired`);
  }

  /**
   * Bundles (guild_premiums planId='bundle') vencidos: sin renovación de PayPal ni
   * cortesía vigente. Se marcan CANCELLED/EXPIRED y se retiran los addons del bundle
   * que no tengan licencia propia.
   */
  private async expireBundles(): Promise<void> {
    const now = new Date();
    const expired = await this.client.db.guildPremium.findMany({
      where: { planId: 'bundle', status: 'ACTIVE', expiresAt: { lte: now } },
      select: { id: true, guildId: true, cancelledAt: true },
    });
    if (expired.length === 0) return;

    logger.info(`Found ${expired.length} expired bundle(s) to process`);

    for (const premium of expired) {
      try {
        const { count } = await this.client.db.guildPremium.updateMany({
          where: { id: premium.id, status: 'ACTIVE', expiresAt: { lte: now } },
          data:  { status: premium.cancelledAt ? 'CANCELLED' : 'EXPIRED' },
        });
        if (count === 0) continue; // renovado entre la consulta y la actualización

        await this.client.addonSync.revokeBundleAccess(premium.guildId);
        await this.notifyBundleOwner(premium.guildId).catch(err =>
          logger.warn(`Bundle DM notification failed for guild ${premium.guildId}:`, err)
        );
        logger.info(`Guild ${premium.guildId}: bundle expired`);
      } catch (err) {
        logger.error(`Error processing bundle expiry for guild ${premium.guildId}:`, err);
      }
    }
  }

  // ─── DM notification ─────────────────────────────────────────────────────────

  private async notifyOwner(guildId: string, addonNames: string[]): Promise<void> {
    const discordGuild = this.client.guilds.cache.get(guildId)
      ?? await this.client.guilds.fetch(guildId).catch(() => null);

    if (!discordGuild) return;

    const owner = await this.client.users.fetch(discordGuild.ownerId).catch(() => null);
    if (!owner) return;

    const addonList = addonNames
      .map(n => `• **${this.client.addons.getAddon(n)?.config.displayName ?? n}**`)
      .join('\n');
    const lang = await i18n.getGuildLanguageAsync(this.client.db as any, guildId);
    const message = i18n.t('addons.deactivation.expired', lang, {
      server: discordGuild.name,
      list:   addonList,
    });

    await owner.send({ content: message, allowedMentions: { parse: [] } });
  }

  private async notifyBundleOwner(guildId: string): Promise<void> {
    const discordGuild = this.client.guilds.cache.get(guildId)
      ?? await this.client.guilds.fetch(guildId).catch(() => null);
    if (!discordGuild) return;

    const owner = await this.client.users.fetch(discordGuild.ownerId).catch(() => null);
    if (!owner) return;

    const lang = await i18n.getGuildLanguageAsync(this.client.db as any, guildId);
    await owner.send({
      content: i18n.t('addons.billing.bundle_expired_dm', lang, { server: discordGuild.name }),
      allowedMentions: { parse: [] },
    });
  }
}
