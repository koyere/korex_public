import { Message, PartialMessage } from 'discord.js';
import { Event } from '../../client/structures/Event';
import { KorexClient } from '../../client/KorexClient';

export default class MessageUpdateEvent extends Event<'messageUpdate'> {
  constructor(client: KorexClient) {
    super(client, {
      name: 'messageUpdate',
      once: false,
    });
  }

  public async execute(...args: [Message | PartialMessage, Message]): Promise<void> {
    const [oldMessage, newMessage] = args;

    try {
      // Log message edit
      await this.client.logging.logMessageEdit(oldMessage, newMessage);
    } catch (error) {
      this.client.logger.error('Error handling message update event:', error);
    }
  }
}
