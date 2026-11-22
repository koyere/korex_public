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

      // AutoMod also checks edits (otherwise you could post "hi" and edit it into
      // a banned word or link)
      if (newMessage.guild && !newMessage.author?.bot && oldMessage.content !== newMessage.content) {
        const message = newMessage.partial ? await newMessage.fetch().catch(() => null) : newMessage;
        if (message) await (this.client as any).autoMod?.processMessage(message, { edit: true });
      }
    } catch (error) {
      this.client.logger.error('Error handling message update event:', error);
    }
  }
}
