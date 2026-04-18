import { GuildMember } from 'discord.js';
import { Event } from '../../client/structures/Event';
import { KorexClient } from '../../client/KorexClient';

export default class GuildMemberAddEvent extends Event<'guildMemberAdd'> {
  constructor(client: KorexClient) {
    super(client, {
      name: 'guildMemberAdd',
      once: false,
    });
  }

  public async execute(...args: [GuildMember]): Promise<void> {
    const [member] = args;

    try {
      // Track activity for analytics
      await this.client.analytics.trackActivity(member.guild.id, 'join', {
        userId: member.id,
        username: member.user.username
      });

      // Track invite usage
      await this.client.inviteService.trackMemberJoin(member);

      // Handle welcome message
      await this.client.welcome.handleMemberJoin(member);

      // Log member join
      await this.client.logging.logMemberJoin(member);

      // Handle auto-roles
      await this.client.autoRole.handleMemberJoin(member);
    } catch (error) {
      this.client.logger.error('Error handling guild member add event:', error);
    }
  }
}
