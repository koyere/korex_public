import { GuildMember } from 'discord.js';
import { Event } from '../../client/structures/Event';
import { KorexClient } from '../../client/KorexClient';

export default class GuildMemberUpdateEvent extends Event<'guildMemberUpdate'> {
  constructor(client: KorexClient) {
    super(client, {
      name: 'guildMemberUpdate',
      once: false,
    });
  }

  public async execute(...args: [GuildMember, GuildMember]): Promise<void> {
    const [oldMember, newMember] = args;

    try {
      // Check if member started boosting
      const wasBooster = oldMember.premiumSince !== null;
      const isBooster = newMember.premiumSince !== null;

      if (!wasBooster && isBooster) {
        // Member started boosting
        await this.client.autoRole.handleMemberBoost(newMember);
        this.client.logger.info(`${newMember.user.tag} started boosting ${newMember.guild.name}`);
      }
    } catch (error) {
      this.client.logger.error('Error handling guild member update event:', error);
    }
  }
}
