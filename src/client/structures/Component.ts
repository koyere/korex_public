import {
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  UserSelectMenuInteraction,
  RoleSelectMenuInteraction,
  ChannelSelectMenuInteraction,
  MentionableSelectMenuInteraction,
  MessageFlags,
} from 'discord.js';
import { KorexClient } from '../KorexClient';
import { i18n } from '../../utils/i18n';

export type ComponentInteraction =
  | ButtonInteraction
  | StringSelectMenuInteraction
  | UserSelectMenuInteraction
  | RoleSelectMenuInteraction
  | ChannelSelectMenuInteraction
  | MentionableSelectMenuInteraction
  | ModalSubmitInteraction;

export interface ComponentOptions {
  customId: string;
  type: 'button' | 'selectMenu' | 'modal';
  permissions?: bigint[];
  ownerOnly?: boolean;
  guildOnly?: boolean;
  ephemeral?: boolean;
  addon?: string | null;
}

export abstract class Component {
  public client: KorexClient;
  public customId: string;
  public type: 'button' | 'selectMenu' | 'modal';
  public permissions: bigint[];
  public ownerOnly: boolean;
  public guildOnly: boolean;
  public ephemeral: boolean;
  public addon: string | null;

  constructor(client: KorexClient, options: ComponentOptions) {
    this.client = client;
    this.customId = options.customId;
    this.type = options.type;
    this.permissions = options.permissions ?? [];
    this.ownerOnly = options.ownerOnly ?? false;
    this.guildOnly = options.guildOnly ?? false;
    this.ephemeral = options.ephemeral ?? false;
    this.addon = options.addon ?? null;
  }

  /**
   * Ejecutar el componente
   */
  abstract execute(interaction: ComponentInteraction): Promise<void>;

  /**
   * Verificar si el usuario puede usar este componente
   */
  async canExecute(
    userId: string,
    guildId?: string,
    memberPermissions?: Readonly<bigint>
  ): Promise<{ canExecute: boolean; reason?: string }> {
    // Verificar owner only
    if (this.ownerOnly && !this.client.isOwner(userId)) {
      return { canExecute: false, reason: 'Solo el propietario puede usar este componente' };
    }

    // Verificar guild only
    if (this.guildOnly && !guildId) {
      return { canExecute: false, reason: 'Este componente solo puede usarse en servidores' };
    }

    // Verificar addon habilitado
    if (this.addon && guildId) {
      const addonEnabled = await this.client.addons.isEnabled(guildId, this.addon);

      if (!addonEnabled) {
        return {
          canExecute: false,
          reason: `El addon \`${this.addon}\` no está habilitado en este servidor`,
        };
      }
    }

    // Verificar permisos del usuario (usando operaciones de bits con bigint)
    if (this.permissions.length > 0 && memberPermissions) {
      const missingPerms = this.permissions.filter((perm) => (memberPermissions & perm) !== perm);

      if (missingPerms.length > 0) {
        return { canExecute: false, reason: 'No tienes los permisos necesarios' };
      }
    }

    return { canExecute: true };
  }

  /**
   * Wrapper para ejecutar el componente con verificaciones
   */
  async safeExecute(interaction: ComponentInteraction): Promise<void> {
    try {
      const canExecute = await this.canExecute(
        interaction.user.id,
        interaction.guildId || undefined,
        interaction.memberPermissions?.bitfield || undefined
      );

      if (!canExecute.canExecute) {
        const errorMessage = canExecute.reason || 'No puedes usar este componente';

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: `❌ ${errorMessage}`, flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ content: `❌ ${errorMessage}`, flags: MessageFlags.Ephemeral });
        }

        return;
      }

      await this.execute(interaction);
    } catch (error) {
      this.client.logger.error(`Error en componente ${this.customId}:`, error);

      const errorMessage = i18n.t('common.errors.component_error', interaction.guildId || undefined);

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: errorMessage, flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
        }
      } catch (replyError) {
        this.client.logger.error('Error enviando mensaje de error:', replyError);
      }

      // Reportar error si hay handler
      if (this.client.errorHandler) {
        await this.client.errorHandler.handleComponentError(error as Error, {
          customId: this.customId,
          type: this.type,
          addon: this.addon,
          interaction,
        });
      }
    }
  }

  /**
   * Verificar si el customId coincide con este componente
   */
  matches(customId: string): boolean {
    // Soporte para customIds dinámicos (ej: "button_user_123456")
    if (this.customId.includes('*')) {
      const pattern = this.customId.replace(/\*/g, '.*');
      const regex = new RegExp(`^${pattern}$`);

      return regex.test(customId);
    }

    return this.customId === customId;
  }

  /**
   * Obtener información del componente
   */
  getInfo(): {
    customId: string;
    type: string;
    permissions: string[];
    ownerOnly: boolean;
    guildOnly: boolean;
    ephemeral: boolean;
    addon: string | null;
  } {
    return {
      customId: this.customId,
      type: this.type,
      permissions: this.permissions.map((perm) => perm.toString()),
      ownerOnly: this.ownerOnly,
      guildOnly: this.guildOnly,
      ephemeral: this.ephemeral,
      addon: this.addon,
    };
  }
}
