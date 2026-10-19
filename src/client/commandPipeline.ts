import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { KorexClient } from './KorexClient';
import { Command } from './structures/Command';
import { i18n } from '../utils/i18n';

/**
 * Single execution pipeline for slash commands.
 *
 * Used both by `interactionCreate` (native slash) and by prefix
 * commands (via MessageCommandInteraction), so that the security checks
 * are exactly the same in both cases: command enabled,
 * owner-only, addon/license and module enabled, addon toggles,
 * user permissions, cooldown, Music access and analytics.
 */
export interface CommandPipelineHooks {
  /**
   * Runs after `canExecute` and before the cooldown. If it returns `false` the
   * command is not executed (the hook has already replied to the user).
   */
  beforeExecute?: (command: Command) => Promise<boolean>;
  /**
   * Error thrown by the command. If it returns `true` the error is considered
   * handled and the generic message is not sent.
   */
  onError?: (error: unknown, command: Command) => Promise<boolean>;
  /** After successful execution */
  afterExecute?: (command: Command) => Promise<void> | void;
}

export async function runChatInputCommand(
  client: KorexClient,
  interaction: ChatInputCommandInteraction,
  hooks: CommandPipelineHooks = {},
  resolvedCommand?: Command
): Promise<void> {
  const command = resolvedCommand ?? client.commands.getCommand(interaction.commandName);
  const guildId = interaction.guildId || undefined;

  if (!command) {
    return replyCommandError(client, interaction, i18n.t('common.errors.command_not_found', guildId));
  }

  try {
    // Check whether the command can be executed
    const canExecute = await command.canExecute(
      interaction.user.id,
      interaction.guildId || undefined,
      interaction.memberPermissions?.bitfield || undefined
    );

    if (!canExecute.canExecute) {
      return replyCommandError(
        client,
        interaction,
        canExecute.reason || i18n.t('common.errors.cannot_use_command', guildId)
      );
    }

    // Source-specific checks (e.g. prefix: argument parsing)
    if (hooks.beforeExecute && !(await hooks.beforeExecute(command))) return;

    // Check cooldown
    const cooldownRemaining = command.checkCooldown(interaction.user.id);

    if (cooldownRemaining) {
      return replyCommandError(
        client,
        interaction,
        i18n.t('common.errors.command_cooldown', guildId, {
          time: `${cooldownRemaining.toFixed(1)}s`,
        })
      );
    }

    // Apply cooldown
    command.applyCooldown(interaction.user.id);

    // Defer for commands that need it (avoids Unknown Interaction 10062)
    // Music commands perform async searches that can take >3s
    if (command.category === 'music') {
      // Dashboard Music settings: enabled, allowed channels and DJ mode
      if (interaction.guildId && interaction.member) {
        const denied = await client.music.checkAccess(interaction.member as any, interaction.channelId);
        if (denied) {
          return replyCommandError(client, interaction, i18n.t(`music.access.${denied}`, guildId));
        }
      }
      await interaction.deferReply();
    }

    // Execute command
    await command.executeSlash(interaction);

    // Record command usage for analytics
    if (interaction.guildId) {
      await client.analytics.trackCommand(
        interaction.guildId,
        interaction.user.id,
        command.name,
        true
      );
    }

    if (hooks.afterExecute) {
      try { await hooks.afterExecute(command); } catch { /* never affects the command result */ }
    }

    client.logger.debug(`Command executed: ${command.name} by ${interaction.user.tag}`);
  } catch (error) {
    if (hooks.onError) {
      const handled = await hooks.onError(error, command).catch(() => false);
      if (handled) return;
    }

    client.logger.error(`Error in command ${command.name}:`, error);

    // Record the failure for analytics (real success rate)
    if (interaction.guildId) {
      await client.analytics.trackCommand(interaction.guildId, interaction.user.id, command.name, false).catch(() => {});
    }

    const errorMessage = i18n.t('common.errors.command_execution_failed', guildId);

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errorMessage, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
      }
    } catch (replyError) {
      client.logger.error('Error sending error message:', replyError);
    }
  }
}

/**
 * Reply with an error consistently
 */
export async function replyCommandError(
  client: KorexClient,
  interaction: ChatInputCommandInteraction,
  message: string
): Promise<void> {
  try {
    const content = `❌ ${message}`;

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    client.logger.error('Error sending error message:', error);
  }
}
