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
   * Llamado cuando el addon se carga por primera vez
   */
  abstract onLoad(): Promise<void>;

  /**
   * Llamado cuando el addon se descarga
   */
  abstract onUnload(): Promise<void>;

  /**
   * Llamado cuando el addon se habilita en un servidor
   */
  abstract onEnable(guildId: string): Promise<void>;

  /**
   * Llamado cuando el addon se deshabilita en un servidor
   */
  abstract onDisable(guildId: string): Promise<void>;

  /**
   * Verificar dependencias del addon
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
   * Verificar licencia del addon
   */
  async checkLicense(): Promise<boolean> {
    if (!this.client.licenses) {
      return false;
    }

    const validation = await this.client.licenses.validateLicense(
      this.config.name,
      'global' // Para addons globales
    );

    return validation.valid;
  }

  /**
   * Cargar comandos del addon
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

        // Marcar como perteneciente a este addon
        command.addon = this.config.name;

        this.commands.set(command.name, command);
        this.client.commands.commands.set(command.name, command);

        // Registrar aliases
        for (const alias of command.aliases) {
          this.client.commands.aliases.set(alias, command.name);
        }

        this.client.logger.debug(`Comando del addon ${this.config.name} cargado: ${command.name}`);
      } catch (error) {
        this.client.logger.error(
          `Error cargando comando ${file} del addon ${this.config.name}:`,
          error
        );
      }
    }
  }

  /**
   * Cargar eventos del addon
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

        // Marcar como perteneciente a este addon
        event.addon = this.config.name;

        this.events.set(event.name, event);

        // Registrar el evento en el cliente
        if (event.once) {
          this.client.once(event.name, (...args) => event.safeExecute(...args));
        } else {
          this.client.on(event.name, (...args) => event.safeExecute(...args));
        }

        this.client.logger.debug(`Evento del addon ${this.config.name} cargado: ${event.name}`);
      } catch (error) {
        this.client.logger.error(
          `Error cargando evento ${file} del addon ${this.config.name}:`,
          error
        );
      }
    }
  }

  /**
   * Descargar comandos del addon
   */
  public unloadCommands(): void {
    for (const [commandName] of this.commands) {
      // Remover del cliente
      this.client.commands.commands.delete(commandName);

      // Remover aliases
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
   * Descargar eventos del addon
   */
  public unloadEvents(): void {
    for (const [eventName, event] of this.events) {
      // Remover listeners del cliente
      this.client.removeAllListeners(eventName);
    }

    this.events.clear();
  }

  /**
   * Obtener información del addon
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
   * Obtener estadísticas del addon
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
