import { Collection } from 'discord.js';
import { Event } from '../structures/Event';
import { KorexClient } from '../KorexClient';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';

export class EventManager {
  public client: KorexClient;
  public events: Collection<string, Event>;

  constructor(client: KorexClient) {
    this.client = client;
    this.events = new Collection();
  }

  /**
   * Load events from a directory
   */
  async loadEvents(directory: string): Promise<void> {
    if (!existsSync(directory)) {
      this.client.logger.warn(`Events directory not found: ${directory}`);

      return;
    }

    const categories = readdirSync(directory, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    for (const category of categories) {
      const categoryPath = join(directory, category);
      const eventFiles = readdirSync(categoryPath).filter(
        (file) =>
          (file.endsWith('.ts') || file.endsWith('.js')) &&
          !file.endsWith('.d.ts') &&
          !file.endsWith('.map')
      );

      for (const file of eventFiles) {
        try {
          const eventPath = join(categoryPath, file);
          const { default: EventClass } = await import(eventPath);

          if (!EventClass) {
            this.client.logger.warn(`Event ${file} has no default export`);
            continue;
          }

          const event: Event = new EventClass(this.client);

          // Validate event
          if (!this.validateEvent(event)) {
            continue;
          }

          // Only load if enabled
          if (!event.enabled) {
            this.client.logger.debug(`Event ${event.name} disabled, skipping`);
            continue;
          }

          this.events.set(`${event.name}_${file}`, event);

          // Register the event in the client
          if (event.once) {
            this.client.once(event.name, (...args) => event.safeExecute(...args));
          } else {
            this.client.on(event.name, (...args) => event.safeExecute(...args));
          }

          this.client.logger.debug(`Event loaded: ${event.name} (${category})`);
          console.log(`[DEBUG] Event registered: ${event.name} from ${file}`);
        } catch (error) {
          this.client.logger.error(`Error loading event ${file}:`, error);
        }
      }
    }

    this.client.logger.info(`${this.events.size} events loaded`);
  }

  /**
   * Validate an event before loading it
   */
  private validateEvent(event: Event): boolean {
    // Check required properties
    if (!event.name) {
      this.client.logger.error(`Invalid event: missing name`);

      return false;
    }

    // Check required method
    if (typeof event.execute !== 'function') {
      this.client.logger.error(`Event '${event.name}' does not implement execute method`);

      return false;
    }

    return true;
  }

  /**
   * Get events by name
   */
  getEventsByName(eventName: string): Event[] {
    return this.events.filter((event) => event.name === eventName).map((event) => event);
  }

  /**
   * Get enabled events
   */
  getEnabledEvents(): Event[] {
    return this.events.filter((event) => event.enabled).map((event) => event);
  }

  /**
   * Get events from a specific addon
   */
  getAddonEvents(addonName: string): Event[] {
    return this.events.filter((event) => event.addon === addonName).map((event) => event);
  }

  /**
   * Enable/disable an event
   */
  async toggleEvent(eventKey: string, enabled: boolean): Promise<boolean> {
    const event = this.events.get(eventKey);

    if (!event) {
      return false;
    }

    const wasEnabled = event.enabled;

    event.enabled = enabled;

    // If disabling, remove listeners
    if (wasEnabled && !enabled) {
      this.client.removeAllListeners(event.name);

      // Re-register other events with the same name that are still enabled
      const otherEvents = this.getEventsByName(event.name).filter((e) => e.enabled && e !== event);

      for (const otherEvent of otherEvents) {
        if (otherEvent.once) {
          this.client.once(otherEvent.name, (...args) => otherEvent.safeExecute(...args));
        } else {
          this.client.on(otherEvent.name, (...args) => otherEvent.safeExecute(...args));
        }
      }
    }

    // If enabling, register listener
    if (!wasEnabled && enabled) {
      if (event.once) {
        this.client.once(event.name, (...args) => event.safeExecute(...args));
      } else {
        this.client.on(event.name, (...args) => event.safeExecute(...args));
      }
    }

    this.client.logger.info(`Event '${event.name}' ${enabled ? 'enabled' : 'disabled'}`);

    return true;
  }

  /**
   * Remove a specific event
   */
  removeEvent(eventKey: string): boolean {
    const event = this.events.get(eventKey);

    if (!event) {
      return false;
    }

    // Remove from client
    this.client.removeAllListeners(event.name);

    // Re-register other events with the same name
    const otherEvents = this.getEventsByName(event.name).filter((e) => e !== event && e.enabled);

    for (const otherEvent of otherEvents) {
      if (otherEvent.once) {
        this.client.once(otherEvent.name, (...args) => otherEvent.safeExecute(...args));
      } else {
        this.client.on(otherEvent.name, (...args) => otherEvent.safeExecute(...args));
      }
    }

    // Remove from collection
    this.events.delete(eventKey);

    this.client.logger.info(`Event '${event.name}' removed`);

    return true;
  }

  /**
   * Get event statistics
   */
  getStats(): {
    total: number;
    enabled: number;
    disabled: number;
    once: number;
    persistent: number;
    byName: Record<string, number>;
    byAddon: Record<string, number>;
  } {
    const stats = {
      total: this.events.size,
      enabled: 0,
      disabled: 0,
      once: 0,
      persistent: 0,
      byName: {} as Record<string, number>,
      byAddon: {} as Record<string, number>,
    };

    for (const event of this.events.values()) {
      // Count enabled/disabled
      if (event.enabled) {
        stats.enabled++;
      } else {
        stats.disabled++;
      }

      // Count once/persistent
      if (event.once) {
        stats.once++;
      } else {
        stats.persistent++;
      }

      // Count by event name
      stats.byName[event.name] = (stats.byName[event.name] || 0) + 1;

      // Count by addon
      if (event.addon) {
        stats.byAddon[event.addon] = (stats.byAddon[event.addon] || 0) + 1;
      }
    }

    return stats;
  }

  /**
   * Clear events (useful for complete reloads)
   */
  clear(): void {
    // Remove all listeners
    for (const event of this.events.values()) {
      this.client.removeAllListeners(event.name);
    }

    this.events.clear();
    this.client.logger.debug('Events cleared');
  }

  /**
   * Reload all events
   */
  async reload(directory: string): Promise<void> {
    this.client.logger.info('Reloading events...');

    this.clear();
    await this.loadEvents(directory);

    this.client.logger.info('Events reloaded');
  }
}
