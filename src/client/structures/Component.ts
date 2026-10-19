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
   * Execute the component
   */
  abstract execute(interaction: ComponentInteraction): Promise<void>;

  /**
   * Check whether the user can use this component
   */
  async canExecute(
    userId: string,
    guildId?: string,
    memberPermissions?: Readonly<bigint>
  ): Promise<{ canExecute: boolean; reason?: string }> {
    // Check owner only
    if (this.ownerOnly && !this.client.isOwner(userId)) {
      return { canExecute: false, reason: 'Only the owner can use this component' };
    }

    // Check guild only
    if (this.guildOnly && !guildId) {
      return { canExecute: false, reason: 'This component can only be used in servers' };
    }

    // Check that the addon is enabled
    if (this.addon && guildId) {
      const addonEnabled = await this.client.addons.isEnabled(guildId, this.addon);

      if (!addonEnabled) {
        return {
          canExecute: false,
          reason: `The addon \`${this.addon}\` is not enabled on this server`,
        };
      }
    }

    // Check user permissions (using bigint bitwise operations)
    if (this.permissions.length > 0 && memberPermissions) {
      const missingPerms = this.permissions.filter((perm) => (memberPermissions & perm) !== perm);

      if (missingPerms.length > 0) {
        return { canExecute: false, reason: 'You do not have the required permissions' };
      }
    }

    return { canExecute: true };
  }

  /**
   * Wrapper to execute the component with checks
   */
  async safeExecute(interaction: ComponentInteraction): Promise<void> {
    try {
      const canExecute = await this.canExecute(
        interaction.user.id,
        interaction.guildId || undefined,
        interaction.memberPermissions?.bitfield || undefined
      );

      if (!canExecute.canExecute) {
        const errorMessage = canExecute.reason || 'You cannot use this component';

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: `❌ ${errorMessage}`, flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ content: `❌ ${errorMessage}`, flags: MessageFlags.Ephemeral });
        }

        return;
      }

      await this.execute(interaction);
    } catch (error) {
      this.client.logger.error(`Error in component ${this.customId}:`, error);

      const errorMessage = i18n.t('common.errors.component_error', interaction.guildId || undefined);

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: errorMessage, flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
        }
      } catch (replyError) {
        this.client.logger.error('Error sending error message:', replyError);
      }

      // Report the error if there is a handler
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
   * Check whether the customId matches this component
   */
  matches(customId: string): boolean {
    // Support for dynamic customIds (e.g. "button_user_123456")
    if (this.customId.includes('*')) {
      const pattern = this.customId.replace(/\*/g, '.*');
      const regex = new RegExp(`^${pattern}$`);

      return regex.test(customId);
    }

    return this.customId === customId;
  }

  /**
   * Get component information
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
