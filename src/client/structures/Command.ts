import {
  ChatInputCommandInteraction,
  Message,
  PermissionFlagsBits,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import { KorexClient } from '../KorexClient';

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
  addon?: string | null; // Si pertenece a un addon
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
   * Builder para Slash Commands
   */
  abstract data():
    | SlashCommandBuilder
    | SlashCommandOptionsOnlyBuilder
    | SlashCommandSubcommandsOnlyBuilder
    | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;

  /**
   * Ejecutar como Slash Command
   */
  abstract executeSlash(interaction: ChatInputCommandInteraction): Promise<void>;

  /**
   * Ejecutar como comando de prefijo (opcional)
   */
  async executePrefix?(message: Message, args: string[]): Promise<void>;

  /**
   * Verificar si el usuario puede usar este comando
   */
  async canExecute(
    userId: string,
    guildId?: string,
    memberPermissions?: Readonly<bigint>
  ): Promise<{ canExecute: boolean; reason?: string }> {
    // Verificar si el comando está habilitado
    if (!this.enabled) {
      return { canExecute: false, reason: 'Comando deshabilitado' };
    }

    // Verificar owner only
    if (this.ownerOnly && !this.client.isOwner(userId)) {
      return { canExecute: false, reason: 'Solo el propietario puede usar este comando' };
    }

    // Verificar guild only
    if (this.guildOnly && !guildId) {
      return { canExecute: false, reason: 'Este comando solo puede usarse en servidores' };
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
    if (this.permissions.user.length > 0 && memberPermissions) {
      const missingPerms = this.permissions.user.filter(
        (perm) => (memberPermissions & perm) !== perm
      );

      if (missingPerms.length > 0) {
        return { canExecute: false, reason: 'No tienes los permisos necesarios' };
      }
    }

    return { canExecute: true };
  }

  /**
   * Verificar cooldown del comando
   */
  checkCooldown(userId: string): number | null {
    return this.client.cooldowns.checkCooldown(this.name, userId);
  }

  /**
   * Aplicar cooldown al comando
   */
  applyCooldown(userId: string): void {
    this.client.cooldowns.applyCooldown(this.name, userId, this.cooldown);
  }

  /**
   * Obtener información del comando para help
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
