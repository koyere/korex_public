import {
  ChatInputCommandInteraction,
  Message,
  PermissionFlagsBits,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import { KorexClient } from '../KorexClient';
import { i18n } from '../../utils/i18n';
import { isCoreModule } from '../../config/coreModules';

export interface CommandOptions {
  name: string;
  description: string;
  category: CommandCategory;
  aliases?: string[];
  cooldown?: number;
  permissions?: {
    user?: bigint[];
    bot?: bigint[];
  };
  ownerOnly?: boolean;
  guildOnly?: boolean;
  nsfw?: boolean;
  enabled?: boolean;
  addon?: string | null; // If it belongs to an addon
}

export type CommandCategory =
  | 'moderation'
  | 'utility'
  | 'economy'
  | 'levels'
  | 'fun'
  | 'music'
  | 'admin'
  | 'giveaways'
  | 'welcome'
  | 'logging'
  | 'addon';

export abstract class Command {
  public client: KorexClient;
  public name: string;
  public description: string;
  public category: CommandCategory;
  public aliases: string[];
  public cooldown: number;
  public permissions: {
    user: bigint[];
    bot: bigint[];
  };
  public ownerOnly: boolean;
  public guildOnly: boolean;
  public nsfw: boolean;
  public enabled: boolean;
  public addon: string | null;

  constructor(client: KorexClient, options: CommandOptions) {
    this.client = client;
    this.name = options.name;
    this.description = options.description;
    this.category = options.category;
    this.aliases = options.aliases ?? [];
    this.cooldown = options.cooldown ?? this.client.config.cooldowns.default;
    this.permissions = {
      user: options.permissions?.user ?? [],
      bot: options.permissions?.bot ?? [PermissionFlagsBits.SendMessages],
    };
    this.ownerOnly = options.ownerOnly ?? false;
    this.guildOnly = options.guildOnly ?? true;
    this.nsfw = options.nsfw ?? false;
    this.enabled = options.enabled ?? true;
    this.addon = options.addon ?? null;
  }

  /**
   * Builder for Slash Commands
   */
  abstract data():
    | SlashCommandBuilder
    | SlashCommandOptionsOnlyBuilder
    | SlashCommandSubcommandsOnlyBuilder
    | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;

  /**
   * Execute as a Slash Command
   */
  abstract executeSlash(interaction: ChatInputCommandInteraction): Promise<void>;

  /**
   * Execute as a prefix command (optional)
   */
  async executePrefix?(message: Message, args: string[]): Promise<void>;

  /**
   * Check whether the user can use this command
   */
  async canExecute(
    userId: string,
    guildId?: string,
    memberPermissions?: Readonly<bigint>
  ): Promise<{ canExecute: boolean; reason?: string }> {
    // Check whether the command is enabled
    if (!this.enabled) {
      return { canExecute: false, reason: i18n.t('command_errors.disabled', guildId || 'global') };
    }

    // Check owner only
    if (this.ownerOnly && !this.client.isOwner(userId)) {
      return { canExecute: false, reason: i18n.t('command_errors.owner_only', guildId || 'global') };
    }

    // Check guild only
    if (this.guildOnly && !guildId) {
      return { canExecute: false, reason: i18n.t('command_errors.guild_only', 'global') };
    }

    // Check addon enabled
    if (this.addon && guildId) {
      const addonEnabled = await this.client.addons.isEnabled(guildId, this.addon);

      if (!addonEnabled) {
        // Free modules (Settings) and paid addons have different messages
        const isCore = isCoreModule(this.addon);
        return {
          canExecute: false,
          reason: isCore
            ? i18n.t('common.module_disabled', guildId)
            : i18n.t('command_errors.addon_disabled', guildId, { addon: this.addon }),
        };
      }

      // The addon's own switch (server configuration)
      const blocked = await this.client.addons.getAddon(this.addon)?.commandBlockedReason(guildId, this.name).catch(() => null);
      if (blocked) return { canExecute: false, reason: blocked };
    }

    // Check user permissions (using bigint bitwise operations)
    if (this.permissions.user.length > 0 && memberPermissions) {
      const missingPerms = this.permissions.user.filter(
        (perm) => (memberPermissions & perm) !== perm
      );

      if (missingPerms.length > 0) {
        return { canExecute: false, reason: i18n.t('command_errors.missing_permissions', guildId || 'global') };
      }
    }

    return { canExecute: true };
  }

  /**
   * Check the command cooldown
   */
  checkCooldown(userId: string): number | null {
    return this.client.cooldowns.checkCooldown(this.name, userId);
  }

  /**
   * Apply the command cooldown
   */
  applyCooldown(userId: string): void {
    this.client.cooldowns.applyCooldown(this.name, userId, this.cooldown);
  }

  /**
   * Get command info for help
   */
  getInfo(): {
    name: string;
    description: string;
    category: string;
    aliases: string[];
    cooldown: number;
    permissions: string[];
    ownerOnly: boolean;
    guildOnly: boolean;
    nsfw: boolean;
    addon: string | null;
  } {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      aliases: this.aliases,
      cooldown: this.cooldown,
      permissions: this.permissions.user.map((perm) => perm.toString()),
      ownerOnly: this.ownerOnly,
      guildOnly: this.guildOnly,
      nsfw: this.nsfw,
      addon: this.addon,
    };
  }
}
