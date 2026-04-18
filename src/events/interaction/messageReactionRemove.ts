import { MessageReaction, User, PartialMessageReaction, PartialUser } from 'discord.js';
import { Event } from '../../client/structures/Event';
import { KorexClient } from '../../client/KorexClient';

export default class MessageReactionRemoveEvent extends Event<'messageReactionRemove'> {
  constructor(client: KorexClient) {
    super(client, {
      name: 'messageReactionRemove',
      once: false,
    });
  }

  public async execute(
    ...args: [MessageReaction | PartialMessageReaction, User | PartialUser]
  ): Promise<void> {
    const [reaction, user] = args;

    try {
      // Handle reaction roles
      await this.client.autoRole.handleReactionRemove(reaction, user);
    } catch (error) {
      this.client.logger.error('Error handling message reaction remove event:', error);
    }
  }
}
