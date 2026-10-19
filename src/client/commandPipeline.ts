import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { KorexClient } from './KorexClient';
import { Command } from './structures/Command';
import { i18n } from '../utils/i18n';

/**
 * Pipeline único de ejecución de comandos slash.
 *
 * Lo usan tanto `interactionCreate` (slash nativo) como los comandos con
 * prefijo (a través de MessageCommandInteraction), para que las comprobaciones
 * de seguridad sean exactamente las mismas en ambos casos: comando habilitado,
 * owner-only, addon/licencia y módulo activados, interruptores del addon,
 * permisos del usuario, cooldown, acceso a Música y analíticas.
 */
export interface CommandPipelineHooks {
  /**
   * Se ejecuta tras `canExecute` y antes del cooldown. Si devuelve `false` el
   * comando no se ejecuta (el hook ya ha respondido al usuario).
   */
  beforeExecute?: (command: Command) => Promise<boolean>;
  /**
   * Error lanzado por el comando. Si devuelve `true` el error se considera
   * gestionado y no se envía el mensaje genérico.
   */
  onError?: (error: unknown, command: Command) => Promise<boolean>;
  /** Tras ejecutarse correctamente */
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
    // Verificar si el comando puede ejecutarse
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

    // Comprobaciones propias del origen (p. ej. prefijo: parseo de argumentos)
    if (hooks.beforeExecute && !(await hooks.beforeExecute(command))) return;

    // Verificar cooldown
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

    // Aplicar cooldown
    command.applyCooldown(interaction.user.id);

    // Defer para comandos que lo necesiten (evita Unknown Interaction 10062)
    // Los comandos de música hacen búsquedas async que pueden tardar >3s
    if (command.category === 'music') {
      // Ajustes de Música del dashboard: activado, canales permitidos y modo DJ
      if (interaction.guildId && interaction.member) {
        const denied = await client.music.checkAccess(interaction.member as any, interaction.channelId);
        if (denied) {
          return replyCommandError(client, interaction, i18n.t(`music.access.${denied}`, guildId));
        }
      }
      await interaction.deferReply();
    }

    // Ejecutar comando
    await command.executeSlash(interaction);

    // Registrar uso del comando para analytics
    if (interaction.guildId) {
      await client.analytics.trackCommand(
        interaction.guildId,
        interaction.user.id,
        command.name,
        true
      );
    }

    if (hooks.afterExecute) {
      try { await hooks.afterExecute(command); } catch { /* nunca afecta al resultado del comando */ }
    }

    client.logger.debug(`Comando ejecutado: ${command.name} por ${interaction.user.tag}`);
  } catch (error) {
    if (hooks.onError) {
      const handled = await hooks.onError(error, command).catch(() => false);
      if (handled) return;
    }

    client.logger.error(`Error en comando ${command.name}:`, error);

    // Registrar el fallo para las analíticas (tasa de éxito real)
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
      client.logger.error('Error enviando mensaje de error:', replyError);
    }
  }
}

/**
 * Responder con error de forma consistente
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
    client.logger.error('Error enviando mensaje de error:', error);
  }
}
