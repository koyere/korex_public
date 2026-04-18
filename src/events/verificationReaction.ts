import { MessageReaction, User, PartialMessageReaction, PartialUser } from 'discord.js';
import { Event } from '../client/structures/Event';
import { KorexClient } from '../client/KorexClient';

export default class VerificationReactionEvent extends Event<'messageReactionAdd'> {
  constructor(client: KorexClient) {
    super(client, {
      name: 'messageReactionAdd',
      once: false,
    });
  }

  async execute(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): Promise<void> {
    if (user.bot) return;
    if (!reaction.message.guildId) return;

    try {
      // Fetch partials if needed
      if (reaction.partial) reaction = await reaction.fetch();
      if (user.partial)     user     = await user.fetch();
      if (!reaction.message.guild) return;

      const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
      if (!member) return;

      const svc = (this.client as any).verificationService;
      await svc.handleReaction(reaction, member);
    } catch (err) {
      // Silent — not every reaction is a verification
    }
  }
}
