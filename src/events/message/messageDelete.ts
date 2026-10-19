import { Message, PartialMessage } from 'discord.js';
import { Event } from '../../client/structures/Event';
import { KorexClient } from '../../client/KorexClient';

export default class MessageDeleteEvent extends Event<'messageDelete'> {
  constructor(client: KorexClient) {
    super(client, {
      name: 'messageDelete',
      once: false,
    });
  }

  public async execute(...args: [Message | PartialMessage]): Promise<void> {
    const [message] = args;

    // Cada paso es independiente: un fallo no debe impedir los siguientes
    const step = (name: string, fn: () => Promise<unknown>) =>
      fn().catch((error) => this.client.logger.error(`Error in messageDelete (${name}):`, error));

    try {
      // Check for ghost ping (message with mentions deleted)
      if (message.author && !message.author.bot && message.guild) {
        await step('ghost-ping', () => this.client.autoMod.processGhostPing(message as Message));
      }

      // Handle starboard cleanup
      if (message.guild) await step('starboard', () => this.client.starboard.handleMessageDelete(message));

      // Panel de roles borrado a mano en Discord: quitar sus registros
      if (message.guildId && (!message.author || message.author.id === this.client.user?.id)) {
        await step('role-panels', async () => {
          await this.client.db.reactionRole.deleteMany({ where: { messageId: message.id } });
          await this.client.db.reactionRoleMessage.deleteMany({ where: { guildId: message.guildId!, messageId: message.id } });
        });
      }

      // Log message deletion
      await step('logging', () => this.client.logging.logMessageDelete(message));
    } catch (error) {
      this.client.logger.error('Error handling message delete event:', error);
    }
  }
}
