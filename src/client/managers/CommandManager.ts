import { Collection, REST, Routes } from 'discord.js';
import { Command } from '../structures/Command';
import { KorexClient } from '../KorexClient';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';

export class CommandManager {
  public client: KorexClient;
  public commands: Collection<string, Command>;
  public aliases: Collection<string, string>;

  constructor(client: KorexClient) {
    this.client = client;
    this.commands = new Collection();
    this.aliases = new Collection();
  }

  /**
   * Load commands from a directory
   */
  async loadCommands(directory: string): Promise<void> {
    if (!existsSync(directory)) {
      this.client.logger.warn(`Commands directory not found: ${directory}`);

      return;
    }

    const categories = readdirSync(directory, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    for (const category of categories) {
      const categoryPath = join(directory, category);
      const commandFiles = readdirSync(categoryPath).filter(
        (file) =>
          (file.endsWith('.ts') || file.endsWith('.js')) &&
          !file.endsWith('.d.ts') &&
          !file.endsWith('.map')
      );

      for (const file of commandFiles) {
        try {
          const commandPath = join(categoryPath, file);
          const { default: CommandClass } = await import(commandPath);

          if (!CommandClass) {
            this.client.logger.warn(`Command ${file} has no default export`);
            continue;
          }

          const command: Command = new CommandClass(this.client);

          // Validate command
          if (!this.validateCommand(command)) {
            continue;
          }

          this.commands.set(command.name, command);

          // Register aliases
          for (const alias of command.aliases) {
            if (this.aliases.has(alias)) {
              this.client.logger.warn(
                `Alias '${alias}' already exists, skipping for command '${command.name}'`
              );
              continue;
            }
            this.aliases.set(alias, command.name);
          }

          this.client.logger.debug(`Command loaded: ${command.name} (${category})`);
        } catch (error) {
          this.client.logger.error(`Error loading command ${file}:`, error);
        }
      }
    }

    this.client.logger.info(`${this.commands.size} commands loaded`);
  }

  /**
   * Validate a command before loading it
   */
  private validateCommand(command: Command): boolean {
    // Check required properties
    if (!command.name || !command.description) {
      this.client.logger.error(`Invalid command: missing name or description`);

      return false;
    }

    // Check if it already exists
    if (this.commands.has(command.name)) {
      this.client.logger.error(`Command '${command.name}' already exists`);

      return false;
    }

    // Check required methods
    if (typeof command.data !== 'function' || typeof command.executeSlash !== 'function') {
      this.client.logger.error(`Command '${command.name}' does not implement required methods`);

      return false;
    }

    return true;
  }

  /**
   * Register GLOBAL slash commands (core only — addon commands go per-guild).
   * Safe to call on every startup; Discord deduplicates unchanged payloads.
   */
  async registerSlashCommands(): Promise<void> {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);

    const toJSON = (cmd: Command) => {
      try { return cmd.data().toJSON(); } catch { return null; }
    };

    // Development: dump everything into the dev guild for instant feedback
    if (process.env.NODE_ENV === 'development' && process.env.DISCORD_DEV_GUILD_ID) {
      const all = this.commands.filter(c => c.enabled).map(toJSON).filter(Boolean);
      await rest.put(
        Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID!, process.env.DISCORD_DEV_GUILD_ID),
        { body: all }
      );
      this.client.logger.info(`Slash commands registered in dev guild (${all.length})`);
      return;
    }

    // Production: register globally all commands that are NOT premium addon commands.
    // Core module commands (addon: 'music', 'economy', etc.) are included globally —
    // only commands from registered premium addons (addon: 'music-pro', etc.) go per-guild.
    const premiumAddonNames = new Set(this.client.addons.addons.keys());
    const globalCmds = this.commands
      .filter(c => c.enabled && (c.addon === null || !premiumAddonNames.has(c.addon)))
      .map(toJSON)
      .filter(Boolean);

    try {
      this.client.logger.info(`Registering ${globalCmds.length} global slash commands...`);
      await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID!), { body: globalCmds });
      this.client.logger.info('Global slash commands registered');
    } catch (error) {
      this.client.logger.error('Error registering global slash commands:', error);
      throw error;
    }
  }

  /**
   * Register addon slash commands for a specific guild.
   * Called when a guild enables or disables an addon.
   * A PUT replaces all guild commands atomically — Discord removes any that are absent.
   */
  async syncGuildAddonCommands(guildId: string): Promise<void> {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);

    // Resolve which addons are currently enabled for this guild
    let enabledAddons: string[] = [];
    try {
      const guild = await this.client.db.guild.findUnique({
        where: { id: guildId },
        select: { enabledAddons: true },
      });
      enabledAddons = guild?.enabledAddons ?? [];
    } catch {
      this.client.logger.warn(`[CommandManager] Could not fetch guild ${guildId} for command sync`);
      return;
    }

    const toJSON = (cmd: Command) => {
      try { return cmd.data().toJSON(); } catch { return null; }
    };

    // Only include commands from registered premium addons (not core module commands).
    const premiumAddonNames = new Set(this.client.addons.addons.keys());
    const guildCmds = this.commands
      .filter(c => c.enabled && c.addon !== null && premiumAddonNames.has(c.addon) && enabledAddons.includes(c.addon))
      .map(toJSON)
      .filter(Boolean);

    try {
      await rest.put(
        Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID!, guildId),
        { body: guildCmds }
      );
      this.client.logger.info(
        `Guild ${guildId}: ${guildCmds.length} addon command(s) synced [${enabledAddons.join(', ')}]`
      );
    } catch (error) {
      this.client.logger.error(`Error syncing addon commands for guild ${guildId}:`, error);
    }
  }

  /**
   * One-time startup sync for guilds that already have addons enabled.
   * Runs sequentially to avoid Discord rate limits.
   */
  async syncAllGuildsOnStartup(): Promise<void> {
    let guilds: { id: string; enabledAddons: string[] }[] = [];
    try {
      guilds = await this.client.db.guild.findMany({
        where: { enabledAddons: { isEmpty: false } },
        select: { id: true, enabledAddons: true },
      });
    } catch {
      return;
    }

    if (guilds.length === 0) return;

    this.client.logger.info(`Syncing addon commands for ${guilds.length} guild(s)...`);
    for (const guild of guilds) {
      await this.syncGuildAddonCommands(guild.id);
      // Small pause to respect Discord's rate limits when there are many guilds
      if (guilds.length > 10) await new Promise(r => setTimeout(r, 500));
    }
    this.client.logger.info('Startup guild command sync complete');
  }

  /**
   * Get a command by name or alias
   */
  getCommand(name: string): Command | undefined {
    return this.commands.get(name) ?? this.commands.get(this.aliases.get(name) ?? '');
  }

  /**
   * Get commands by category
   */
  getCommandsByCategory(category: string): Command[] {
    return this.commands.filter((cmd) => cmd.category === category).map((cmd) => cmd);
  }

  /**
   * Get enabled commands
   */
  getEnabledCommands(): Command[] {
    return this.commands.filter((cmd) => cmd.enabled).map((cmd) => cmd);
  }

  /**
   * Get commands from a specific addon
   */
  getAddonCommands(addonName: string): Command[] {
    return this.commands.filter((cmd) => cmd.addon === addonName).map((cmd) => cmd);
  }

  /**
   * Enable/disable a command
   */
  async toggleCommand(commandName: string, enabled: boolean): Promise<boolean> {
    const command = this.getCommand(commandName);

    if (!command) {
      return false;
    }

    command.enabled = enabled;
    this.client.logger.info(`Command '${commandName}' ${enabled ? 'enabled' : 'disabled'}`);

    return true;
  }

  /**
   * Reload a specific command
   */
  async reloadCommand(commandName: string): Promise<boolean> {
    const command = this.getCommand(commandName);

    if (!command) {
      return false;
    }

    try {
      // Remove current command
      this.commands.delete(command.name);

      // Remove aliases
      for (const alias of command.aliases) {
        this.aliases.delete(alias);
      }

      // TODO: Reload from file
      // This would require maintaining a registry of file paths

      this.client.logger.info(`Command '${commandName}' reloaded`);

      return true;
    } catch (error) {
      this.client.logger.error(`Error reloading command '${commandName}':`, error);

      return false;
    }
  }

  /**
   * Get command statistics
   */
  getStats(): {
    total: number;
    enabled: number;
    disabled: number;
    byCategory: Record<string, number>;
    byAddon: Record<string, number>;
  } {
    const stats = {
      total: this.commands.size,
      enabled: 0,
      disabled: 0,
      byCategory: {} as Record<string, number>,
      byAddon: {} as Record<string, number>,
    };

    for (const command of this.commands.values()) {
      // Count enabled/disabled
      if (command.enabled) {
        stats.enabled++;
      } else {
        stats.disabled++;
      }

      // Count by category
      stats.byCategory[command.category] = (stats.byCategory[command.category] || 0) + 1;

      // Count by addon
      if (command.addon) {
        stats.byAddon[command.addon] = (stats.byAddon[command.addon] || 0) + 1;
      }
    }

    return stats;
  }

  /**
   * Clear commands (useful for complete reloads)
   */
  clear(): void {
    this.commands.clear();
    this.aliases.clear();
    this.client.logger.debug('Commands cleared');
  }
}
