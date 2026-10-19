import { KorexClient } from '../KorexClient';
import { Command } from './Command';
import { Event } from './Event';
import { AddonConfig } from '../../types/addon';

export abstract class Addon {
  public client: KorexClient;
  public config: AddonConfig;
  public commands: Map<string, Command>;
  public events: Map<string, Event>;
  public services: Map<string, any>;
  public loaded: boolean;
  public enabled: boolean;
  /** Listeners registered by this addon on the client (to remove only its own). */
  private registeredListeners: Array<{ event: string; listener: (...args: any[]) => void }> = [];

  constructor(client: KorexClient, config: AddonConfig) {
    this.client = client;
    this.config = config;
    this.commands = new Map();
    this.events = new Map();
    this.services = new Map();
    this.loaded = false;
    this.enabled = false;
  }

  /**
   * Called when the addon is loaded for the first time
   */
  abstract onLoad(): Promise<void>;

  /**
   * Called when the addon is unloaded
   */
  abstract onUnload(): Promise<void>;

  /**
   * Called when the addon is enabled in a server
   */
  abstract onEnable(guildId: string): Promise<void>;

  /**
   * Called when the addon is disabled in a server
   */
  abstract onDisable(guildId: string): Promise<void>;

  /**
   * The addon's own per-server toggle, in addition to the license (e.g. the
   * `enabled` flag of Music Pro). Returns the translated reason if the command cannot
   * be used in that server, or null. By default it blocks nothing.
   */
  async commandBlockedReason(_guildId: string, _commandName: string): Promise<string | null> {
    return null;
  }

  /**
   * Check addon dependencies
   */
  async checkDependencies(): Promise<{ satisfied: boolean; missing: string[] }> {
    const missing: string[] = [];

    if (this.config.dependencies) {
      for (const dependency of this.config.dependencies) {
        const dependencyAddon = this.client.addons.getAddon(dependency);

        if (!dependencyAddon || !dependencyAddon.loaded) {
          missing.push(dependency);
        }
      }
    }

    return {
      satisfied: missing.length === 0,
      missing,
    };
  }

  /**
   * Check addon license
   */
  async checkLicense(): Promise<boolean> {
    if (!this.client.licenses) {
      return false;
    }

    const validation = await this.client.licenses.validateLicense(
      this.config.name,
      'global' // For global addons
    );

    return validation.valid;
  }

  /**
   * Load addon commands
   */
  protected async loadCommands(commandsPath: string): Promise<void> {
    const fs = require('fs');
    const path = require('path');

    if (!fs.existsSync(commandsPath)) {
      return;
    }

    const commandFiles = fs
      .readdirSync(commandsPath)
      .filter((file: string) =>
        (file.endsWith('.ts') || file.endsWith('.js')) &&
        !file.endsWith('.d.ts') &&
        !file.endsWith('.map')
      );

    for (const file of commandFiles) {
      try {
        const { default: CommandClass } = await import(path.join(commandsPath, file));
        const command: Command = new CommandClass(this.client);

        // Mark as belonging to this addon
        command.addon = this.config.name;

        this.commands.set(command.name, command);
        this.client.commands.commands.set(command.name, command);

        // Register aliases
        for (const alias of command.aliases) {
          this.client.commands.aliases.set(alias, command.name);
        }

        this.client.logger.debug(`Addon ${this.config.name} command loaded: ${command.name}`);
      } catch (error) {
        this.client.logger.error(
          `Error loading command ${file} of addon ${this.config.name}:`,
          error
        );
      }
    }
  }

  /**
   * Load addon events
   */
  protected async loadEvents(eventsPath: string): Promise<void> {
    const fs = require('fs');
    const path = require('path');

    if (!fs.existsSync(eventsPath)) {
      return;
    }

    const eventFiles = fs
      .readdirSync(eventsPath)
      .filter((file: string) =>
        (file.endsWith('.ts') || file.endsWith('.js')) &&
        !file.endsWith('.d.ts') &&
        !file.endsWith('.map')
      );

    for (const file of eventFiles) {
      try {
        const { default: EventClass } = await import(path.join(eventsPath, file));
        const event: Event = new EventClass(this.client);

        // Mark as belonging to this addon
        event.addon = this.config.name;

        this.events.set(event.name, event);

        // Register the event on the client, keeping the listener reference
        const listener = (...args: any[]) => event.safeExecute(...(args as any));
        if (event.once) {
          this.client.once(event.name, listener);
        } else {
          this.client.on(event.name, listener);
        }
        this.registeredListeners.push({ event: event.name, listener });

        this.client.logger.debug(`Addon ${this.config.name} event loaded: ${event.name}`);
      } catch (error) {
        this.client.logger.error(
          `Error loading event ${file} of addon ${this.config.name}:`,
          error
        );
      }
    }
  }

  /**
   * Unload addon commands
   */
  public unloadCommands(): void {
    for (const [commandName] of this.commands) {
      // Remove from client
      this.client.commands.commands.delete(commandName);

      // Remove aliases
      const command = this.commands.get(commandName);

      if (command) {
        for (const alias of command.aliases) {
          this.client.commands.aliases.delete(alias);
        }
      }
    }

    this.commands.clear();
  }

  /**
   * Unload addon events
   */
  public unloadEvents(): void {
    // Remove only the listeners this addon registered: removeAllListeners
    // would also remove the core's and other addons' listeners for the same event.
    for (const { event, listener } of this.registeredListeners) {
      this.client.off(event, listener);
    }
    this.registeredListeners = [];

    this.events.clear();
  }

  /**
   * Get addon information
   */
  getInfo(): {
    config: AddonConfig;
    loaded: boolean;
    enabled: boolean;
    commandCount: number;
    eventCount: number;
    serviceCount: number;
  } {
    return {
      config: this.config,
      loaded: this.loaded,
      enabled: this.enabled,
      commandCount: this.commands.size,
      eventCount: this.events.size,
      serviceCount: this.services.size,
    };
  }

  /**
   * Get addon statistics
   */
  getStats(): {
    name: string;
    version: string;
    author: string;
    commands: string[];
    events: string[];
    dependencies: string[];
    loaded: boolean;
    enabled: boolean;
  } {
    return {
      name: this.config.name,
      version: this.config.version,
      author: this.config.author,
      commands: Array.from(this.commands.keys()),
      events: Array.from(this.events.keys()),
      dependencies: this.config.dependencies || [],
      loaded: this.loaded,
      enabled: this.enabled,
    };
  }
}
