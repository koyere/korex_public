import { ClientEvents } from 'discord.js';
import { KorexClient } from '../KorexClient';

export interface EventOptions<K extends keyof ClientEvents> {
  name: K;
  once?: boolean;
  enabled?: boolean;
  addon?: string | null; // If it belongs to an addon
}

export abstract class Event<K extends keyof ClientEvents = keyof ClientEvents> {
  public client: KorexClient;
  public name: K;
  public once: boolean;
  public enabled: boolean;
  public addon: string | null;

  constructor(client: KorexClient, options: EventOptions<K>) {
    this.client = client;
    this.name = options.name;
    this.once = options.once ?? false;
    this.enabled = options.enabled ?? true;
    this.addon = options.addon ?? null;
  }

  /**
   * Execute the event
   */
  abstract execute(...args: ClientEvents[K]): Promise<void> | void;

  /**
   * Check whether the event can run
   */
  async canExecute(): Promise<boolean> {
    // Check whether the event is enabled
    if (!this.enabled) {
      return false;
    }

    // If it belongs to an addon, check that it is loaded
    if (this.addon) {
      const addon = this.client.addons.getAddon(this.addon);

      if (!addon || !addon.loaded) {
        return false;
      }
    }

    return true;
  }

  /**
   * Wrapper to execute the event with checks
   */
  async safeExecute(...args: ClientEvents[K]): Promise<void> {
    try {
      const canExecute = await this.canExecute();

      if (!canExecute) {
        return;
      }

      await this.execute(...args);
    } catch (error) {
      this.client.logger.error(`Error in event ${this.name}:`, error);

      // Report critical error if needed
      if (this.client.errorHandler) {
        const errorContext: any = {
          eventName: this.name as string,
          args,
        };

        if (this.addon) {
          errorContext.addon = this.addon;
        }

        await this.client.errorHandler.handleEventError(error as Error, errorContext);
      }
    }
  }

  /**
   * Get event information
   */
  getInfo(): {
    name: string;
    once: boolean;
    enabled: boolean;
    addon: string | null;
  } {
    return {
      name: this.name as string,
      once: this.once,
      enabled: this.enabled,
      addon: this.addon,
    };
  }
}
