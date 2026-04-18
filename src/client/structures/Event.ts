import { ClientEvents } from 'discord.js';
import { KorexClient } from '../KorexClient';

export interface EventOptions<K extends keyof ClientEvents> {
  name: K;
  once?: boolean;
  enabled?: boolean;
  addon?: string | null; // Si pertenece a un addon
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
   * Ejecutar el evento
   */
  abstract execute(...args: ClientEvents[K]): Promise<void> | void;

  /**
   * Verificar si el evento puede ejecutarse
   */
  async canExecute(): Promise<boolean> {
    // Verificar si el evento está habilitado
    if (!this.enabled) {
      return false;
    }

    // Si pertenece a un addon, verificar que esté cargado
    if (this.addon) {
      const addon = this.client.addons.getAddon(this.addon);

      if (!addon || !addon.loaded) {
        return false;
      }
    }

    return true;
  }

  /**
   * Wrapper para ejecutar el evento con verificaciones
   */
  async safeExecute(...args: ClientEvents[K]): Promise<void> {
    try {
      const canExecute = await this.canExecute();

      if (!canExecute) {
        return;
      }

      await this.execute(...args);
    } catch (error) {
      this.client.logger.error(`Error en evento ${this.name}:`, error);

      // Reportar error crítico si es necesario
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
   * Obtener información del evento
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
