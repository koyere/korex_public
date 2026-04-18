import { Collection } from 'discord.js';
import { Addon } from '../structures/Addon';
import { KorexClient } from '../KorexClient';
import { AddonConfig } from '../../types/addon';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';

export class AddonManager {
  public client: KorexClient;
  public addons: Collection<string, Addon>;
  private addonDirectory: string;

  constructor(client: KorexClient) {
    this.client = client;
    this.addons = new Collection();
    this.addonDirectory = join(__dirname, '../../addons');
  }

  /**
   * Load all available addons
   */
  async loadAddons(): Promise<void> {
    if (!existsSync(this.addonDirectory)) {
      this.client.logger.warn('Addons directory not found, creating...');
      const fs = require('fs');

      fs.mkdirSync(this.addonDirectory, { recursive: true });

      return;
    }

    const addonFolders = readdirSync(this.addonDirectory, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    this.client.logger.info(`Found ${addonFolders.length} potential addons`);

    for (const folder of addonFolders) {
      await this.loadAddon(folder);
    }

    this.client.logger.info(`${this.addons.size} addons loaded successfully`);
  }

  /**
   * Load a specific addon
   */
  async loadAddon(addonName: string): Promise<boolean> {
    const addonPath = join(this.addonDirectory, addonName);
    // Support both compiled (.js) and dev (.ts) environments
    const ext = existsSync(join(addonPath, 'addon.config.js')) ? '.js' : '.ts';
    const configPath = join(addonPath, `addon.config${ext}`);
    const indexPath  = join(addonPath, `index${ext}`);

    // Check that necessary files exist
    if (!existsSync(configPath)) {
      this.client.logger.warn(`Addon ${addonName}: addon.config${ext} file not found`);

      return false;
    }

    if (!existsSync(indexPath)) {
      this.client.logger.warn(`Addon ${addonName}: index${ext} file not found`);

      return false;
    }

    try {
      // Load addon configuration — config key varies by addon
      const configModule = await import(configPath);
      const config = configModule.default ?? Object.values(configModule).find((v: any) => v && typeof v === 'object' && v.name);

      if (!config || !this.validateAddonConfig(config as any)) {
        this.client.logger.error(`Addon ${addonName}: invalid configuration`);

        return false;
      }

      // Verify addon license
      const licenseKey = process.env[`ADDON_${addonName.toUpperCase().replace(/-/g, '_')}_LICENSE`];

      if (licenseKey) {
        // Dev bypass: keys starting with 'dev-' skip DB validation
        if (!licenseKey.startsWith('dev-')) {
          const validation = await this.client.licenses?.validateLicense(
            addonName,
            'global'
          );

          if (!validation?.valid) {
            this.client.logger.warn(`Addon ${addonName}: invalid or expired license`);

            return false;
          }
        }
      } else {
        this.client.logger.warn(`Addon ${addonName}: license key not found`);

        return false;
      }

      // Load main addon class
      const { default: AddonClass } = await import(indexPath);

      if (!AddonClass) {
        this.client.logger.error(`Addon ${addonName}: no default export`);

        return false;
      }

      // Create addon instance
      const addon: Addon = new AddonClass(this.client, config);

      // Check dependencies
      const dependencyCheck = await addon.checkDependencies();

      if (!dependencyCheck.satisfied) {
        this.client.logger.error(
          `Addon ${addonName}: missing dependencies: ${dependencyCheck.missing.join(', ')}`
        );

        return false;
      }

      // Load the addon
      await addon.onLoad();
      addon.loaded = true;

      this.addons.set(addon.config.name, addon);
      this.client.logger.info(
        `Addon loaded: ${addon.config.displayName} v${addon.config.version} by ${addon.config.author}`
      );

      return true;
    } catch (error) {
      this.client.logger.error(`Error loading addon ${addonName}:`, error);

      return false;
    }
  }

  /**
   * Validate addon configuration
   */
  private validateAddonConfig(config: AddonConfig): boolean {
    const required = ['name', 'displayName', 'description', 'version', 'author'];

    for (const field of required) {
      if (!config[field as keyof AddonConfig]) {
        this.client.logger.error(`Invalid addon configuration: missing field '${field}'`);

        return false;
      }
    }

    return true;
  }

  /**
   * Unload an addon
   */
  async unloadAddon(addonName: string): Promise<boolean> {
    const addon = this.addons.get(addonName);

    if (!addon) {
      return false;
    }

    try {
      // Notify each guild's lifecycle hook WITHOUT touching the DB.
      // disableAddon() would remove the addon from guild.enabledAddons, wiping the
      // user's explicit opt-in across bot restarts. onDisable() is enough here —
      // it lets the addon clean up per-guild in-memory state without persisting a
      // "disabled" state that the user never requested.
      const guilds = await this.client.db.guild.findMany({
        where: {
          enabledAddons: {
            has: addonName,
          },
        },
        select: { id: true },
      });

      for (const guild of guilds) {
        try {
          await addon.onDisable(guild.id);
        } catch (err) {
          this.client.logger.warn(
            `Error calling onDisable for ${addonName} in guild ${guild.id} during unload:`,
            err
          );
        }
      }

      // Call addon unload method
      await addon.onUnload();

      // Remove addon commands
      addon.unloadCommands();

      // Remove addon events
      addon.unloadEvents();

      // Mark as not loaded
      addon.loaded = false;
      addon.enabled = false;

      // Remove from collection
      this.addons.delete(addonName);

      this.client.logger.info(`Addon unloaded: ${addon.config.displayName}`);

      return true;
    } catch (error) {
      this.client.logger.error(`Error unloading addon ${addonName}:`, error);

      return false;
    }
  }

  /**
   * Reload an addon
   */
  async reloadAddon(addonName: string): Promise<boolean> {
    this.client.logger.info(`Reloading addon: ${addonName}`);

    // Unload first
    await this.unloadAddon(addonName);

    // Clear require cache (Node.js)
    const addonPath = join(this.addonDirectory, addonName);
    const moduleKeys = Object.keys(require.cache).filter((key) => key.startsWith(addonPath));

    for (const key of moduleKeys) {
      delete require.cache[key];
    }

    // Load again
    const success = await this.loadAddon(addonName);

    if (success) {
      this.client.logger.info(`Addon reloaded successfully: ${addonName}`);
    } else {
      this.client.logger.error(`Error reloading addon: ${addonName}`);
    }

    return success;
  }

  /**
   * Check if an addon/module is enabled in a server.
   *
   * Rules:
   *  - If the guild has no DB record yet, core modules default to ENABLED and
   *    registered addons default to DISABLED (they require explicit opt-in).
   *  - If the guild record exists but enabledAddons is empty (legacy guilds
   *    created before the module-toggle feature), core modules also default
   *    to ENABLED for backward compatibility.
   *  - Otherwise the array is authoritative.
   *
   * A "core module" is anything NOT registered in this.addons (e.g. moderation,
   * welcome, levels, logging). Registered addons require license + opt-in.
   */
  async isEnabled(guildId: string, addonName: string): Promise<boolean> {
    // For external addons, check if loaded first
    const addon = this.addons.get(addonName);

    if (addon && !addon.loaded) {
      return false;
    }

    const guild = await this.client.db.guild.findUnique({
      where: { id: guildId },
      select: { enabledAddons: true },
    });

    // No record or empty array → core modules enabled by default, addons disabled
    if (!guild || guild.enabledAddons.length === 0) {
      return !addon; // !addon is true for core modules (not in this.addons)
    }

    return guild.enabledAddons.includes(addonName);
  }

  /**
   * Enable an addon in a server
   */
  async enableAddon(guildId: string, addonName: string): Promise<boolean> {
    const addon = this.addons.get(addonName);

    // If the addon is registered in memory but not yet loaded, bail out
    if (addon && !addon.loaded) {
      return false;
    }

    try {
      // Check if not already enabled
      const isAlreadyEnabled = await this.isEnabled(guildId, addonName);

      if (isAlreadyEnabled) {
        return true;
      }

      // Always update the database regardless of whether the addon is currently in memory.
      // This ensures courtesy/reactivation flows work even if the addon hasn't loaded yet.
      await this.client.db.guild.upsert({
        where: { id: guildId },
        create: {
          id: guildId,
          enabledAddons: [addonName],
        },
        update: {
          enabledAddons: {
            push: addonName,
          },
        },
      });

      // Only call the lifecycle hook if the addon is actually loaded in memory
      if (addon?.loaded) {
        await addon.onEnable(guildId);
      }

      this.client.logger.info(`Addon ${addonName} enabled in server ${guildId}`);

      return true;
    } catch (error) {
      this.client.logger.error(`Error enabling addon ${addonName} in ${guildId}:`, error);

      return false;
    }
  }

  /**
   * Disable an addon in a server
   */
  async disableAddon(guildId: string, addonName: string): Promise<boolean> {
    const addon = this.addons.get(addonName);

    if (!addon) {
      return false;
    }

    try {
      // Get current configuration
      const guild = await this.client.db.guild.findUnique({
        where: { id: guildId },
        select: { enabledAddons: true },
      });

      if (!guild?.enabledAddons?.includes(addonName)) {
        return true; // Already disabled
      }

      // Update database
      await this.client.db.guild.update({
        where: { id: guildId },
        data: {
          enabledAddons: guild.enabledAddons.filter((a) => a !== addonName),
        },
      });

      // Call addon disable method
      await addon.onDisable(guildId);

      this.client.logger.info(`Addon ${addonName} disabled in server ${guildId}`);

      return true;
    } catch (error) {
      this.client.logger.error(`Error disabling addon ${addonName} in ${guildId}:`, error);

      return false;
    }
  }

  /**
   * Get an addon by name
   */
  getAddon(name: string): Addon | undefined {
    return this.addons.get(name);
  }

  /**
   * Get all loaded addons
   */
  getLoadedAddons(): Addon[] {
    return Array.from(this.addons.values()).filter((a) => a.loaded);
  }

  /**
   * Get enabled addons in a server
   */
  async getEnabledAddons(guildId: string): Promise<Addon[]> {
    const guild = await this.client.db.guild.findUnique({
      where: { id: guildId },
      select: { enabledAddons: true },
    });

    if (!guild?.enabledAddons) {
      return [];
    }

    return guild.enabledAddons
      .map((name) => this.addons.get(name))
      .filter((addon): addon is Addon => addon !== undefined && addon.loaded);
  }

  /**
   * Get addon statistics
   */
  getStats(): {
    total: number;
    loaded: number;
    unloaded: number;
    byCategory: Record<string, number>;
    byAuthor: Record<string, number>;
  } {
    const stats = {
      total: this.addons.size,
      loaded: 0,
      unloaded: 0,
      byCategory: {} as Record<string, number>,
      byAuthor: {} as Record<string, number>,
    };

    for (const addon of this.addons.values()) {
      // Count loaded/unloaded
      if (addon.loaded) {
        stats.loaded++;
      } else {
        stats.unloaded++;
      }

      // Count by category
      const category = addon.config.category || 'other';

      stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;

      // Count by author
      stats.byAuthor[addon.config.author] = (stats.byAuthor[addon.config.author] || 0) + 1;
    }

    return stats;
  }

  /**
   * Get information about all addons
   */
  getAddonsInfo(): Array<{
    name: string;
    displayName: string;
    description: string;
    version: string;
    author: string;
    category: string | null;
    loaded: boolean;
    commandCount: number;
    eventCount: number;
  }> {
    return Array.from(this.addons.values()).map((addon) => ({
      name: addon.config.name,
      displayName: addon.config.displayName,
      description: addon.config.description,
      version: addon.config.version,
      author: addon.config.author,
      category: addon.config.category || null,
      loaded: addon.loaded,
      commandCount: addon.commands.size,
      eventCount: addon.events.size,
    }));
  }

  /**
   * Clear all addons
   */
  async clear(): Promise<void> {
    const addonNames = Array.from(this.addons.keys());

    for (const addonName of addonNames) {
      await this.unloadAddon(addonName);
    }

    this.addons.clear();
    this.client.logger.info('All addons have been unloaded');
  }
}
