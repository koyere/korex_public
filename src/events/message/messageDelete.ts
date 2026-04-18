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

    try {
      // Check for ghost ping (message with mentions deleted)
      if (message.author && !message.author.bot && message.guild) {
        await this.client.autoMod.processGhostPing(message as Message);
      }

      // Log message deletion
      await this.client.logging.logMessageDelete(message);
    } catch (error) {
      this.client.logger.error('Error handling message delete event:', error);
    }
  }
}
