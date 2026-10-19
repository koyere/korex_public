import { ChatInputCommandInteraction, Interaction } from 'discord.js';
import { Event } from '../../client/structures/Event';
import { KorexClient } from '../../client/KorexClient';
import { runChatInputCommand, replyCommandError } from '../../client/commandPipeline';

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
      // Verification captcha: open the modal to type the code
      if (interaction.customId === 'verify:captcha') {
        const svc = (this.client as any).verificationService;
        if (svc) await svc.handleCaptchaButton(interaction).catch(() => {});
        return;
      }
      // Addon-namespaced buttons (e.g. paste:*, tickets:*) are handled by addon interactionCreate events
      if (interaction.customId.includes(':')) {
        const prefix = interaction.customId.split(':')[0];
        const addonNames = this.client.addons.getLoadedAddons().map((a: any) => a.config.name);
        if (addonNames.includes(prefix)) return;
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
      // Verification captcha: check the code
      if (interaction.customId === 'verify:captcha_modal') {
        const svc = (this.client as any).verificationService;
        if (svc) await svc.handleCaptchaModal(interaction).catch(() => {});
        return;
      }
      // Addon-namespaced modals (e.g. paste:*, tickets:*) are handled by addon interactionCreate events
      if (interaction.customId.includes(':')) {
        const prefix = interaction.customId.split(':')[0];
        const addonNames = this.client.addons.getLoadedAddons().map((a: any) => a.config.name);
        if (addonNames.includes(prefix)) return;
      }
      await this.client.components.handleModal(interaction);
      return;
    }
  }

  /**
   * Handle slash commands
   * (pipeline shared with prefix commands: src/client/commandPipeline.ts)
   */
  private async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await runChatInputCommand(this.client, interaction);
  }

  /**
   * Handle autocomplete
   */
  private async handleAutocomplete(interaction: any): Promise<void> {
    const command = this.client.commands.getCommand(interaction.commandName);

    if (!command || typeof (command as any).executeAutocomplete !== 'function') {
      return;
    }

    try {
      await (command as any).executeAutocomplete(interaction);
    } catch (error) {
      this.client.logger.error(`Error in autocomplete ${command.name}:`, error);
    }
  }

  /**
   * Reply with an error consistently
   */
  private async replyError(
    interaction: ChatInputCommandInteraction,
    message: string
  ): Promise<void> {
    await replyCommandError(this.client, interaction, message);
  }
}
