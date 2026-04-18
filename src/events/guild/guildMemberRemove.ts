import { GuildMember } from 'discord.js';
import { Event } from '../../client/structures/Event';
import { KorexClient } from '../../client/KorexClient';

export default class GuildMemberRemoveEvent extends Event<'guildMemberRemove'> {
  constructor(client: KorexClient) {
    super(client, {
      name: 'guildMemberRemove',
      once: false,
    });
  }

  public async execute(...args: [GuildMember]): Promise<void> {
    const [member] = args;

    try {
      // Track activity for analytics
      await this.client.analytics.trackActivity(member.guild.id, 'leave', {
        userId: member.id,
        username: member.user.username
      });

      // Track invite statistics on leave
      await this.client.inviteService.trackMemberLeave(member);

      // Handle goodbye message
      await this.client.welcome.handleMemberLeave(member);

      // Log member leave
      await this.client.logging.logMemberLeave(member);
    } catch (error) {
      this.client.logger.error('Error handling guild member remove event:', error);
    }
  }
}
