import { ChatInputCommandInteraction, Interaction, MessageFlags } from 'discord.js';
import { Event } from '../../client/structures/Event';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class InteractionCreateEvent extends Event<'interactionCreate'> {
  constructor(client: KorexClient) {
    super(client, {
      name: 'interactionCreate',
      once: false,
    });
  }

  async execute(interaction: Interaction): Promise<void> {
    // Slash Commands
    if (interaction.isChatInputCommand()) {
      await this.handleSlashCommand(interaction);

      return;
    }

    // Autocomplete
    if (interaction.isAutocomplete()) {
      await this.handleAutocomplete(interaction);

      return;
    }

    // Buttons
    if (interaction.isButton()) {
      // Verification button handled directly
      if (interaction.customId === 'verify') {
        const svc = (this.client as any).verificationService;
        if (svc) await svc.handleButton(interaction).catch(() => {});
        return;
      }
      await this.client.components.handleButton(interaction);
      return;
    }

    // Select Menus
    if (interaction.isAnySelectMenu()) {
      await this.client.components.handleSelectMenu(interaction);

      return;
    }

    // Modals
    if (interaction.isModalSubmit()) {
      await this.client.components.handleModal(interaction);

      return;
    }
  }

  /**
   * Manejar comandos slash
   */
  private async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const command = this.client.commands.getCommand(interaction.commandName);
    const guildId = interaction.guildId || undefined;

    if (!command) {
      return this.replyError(interaction, i18n.t('common.errors.command_not_found', guildId));
    }

    try {
      // Verificar si el comando puede ejecutarse
      const canExecute = await command.canExecute(
        interaction.user.id,
        interaction.guildId || undefined,
        interaction.memberPermissions?.bitfield || undefined
      );

      if (!canExecute.canExecute) {
        return this.replyError(
          interaction,
          canExecute.reason || i18n.t('common.errors.cannot_use_command', guildId)
        );
      }

      // Verificar cooldown
      const cooldownRemaining = command.checkCooldown(interaction.user.id);

      if (cooldownRemaining) {
        return this.replyError(
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
        await interaction.deferReply();
      }

      // Ejecutar comando
      await command.executeSlash(interaction);

      // Registrar uso del comando para analytics
      if (interaction.guildId) {
        await this.client.analytics.trackCommand(
          interaction.guildId,
          interaction.user.id,
          command.name,
          true
        );
      }

      this.client.logger.debug(`Comando ejecutado: ${command.name} por ${interaction.user.tag}`);
    } catch (error) {
      this.client.logger.error(`Error en comando ${command.name}:`, error);

      const errorMessage = i18n.t('common.errors.command_execution_failed', guildId);

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: errorMessage, flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
        }
      } catch (replyError) {
        this.client.logger.error('Error enviando mensaje de error:', replyError);
      }

      // Reportar error (cuando creemos el ErrorHandler)
      // if (this.client.errorHandler) {
      //   await this.client.errorHandler.handleCommandError(error as Error, interaction);
      // }
    }
  }

  /**
   * Manejar autocomplete
   */
  private async handleAutocomplete(interaction: any): Promise<void> {
    const command = this.client.commands.getCommand(interaction.commandName);

    if (!command || typeof (command as any).executeAutocomplete !== 'function') {
      return;
    }

    try {
      await (command as any).executeAutocomplete(interaction);
    } catch (error) {
      this.client.logger.error(`Error en autocomplete ${command.name}:`, error);
    }
  }

  /**
   * Responder con error de forma consistente
   */
  private async replyError(
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
      this.client.logger.error('Error enviando mensaje de error:', error);
    }
  }
}
