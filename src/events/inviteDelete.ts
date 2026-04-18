import { Invite } from 'discord.js';
import { Event } from '../client/structures/Event';
import { KorexClient } from '../client/KorexClient';

export default class InviteDeleteEvent extends Event {
  constructor(client: KorexClient) {
    super(client, {
      name: 'inviteDelete',
      once: false
    });
  }

  async execute(invite: Invite): Promise<void> {
    try {
      if (!invite.guild) return;

      // Update invite cache - cast to Guild since we know it exists
      await this.client.inviteService.cacheGuildInvites(invite.guild as any);

    } catch (error) {
      await this.client.errorHandler.handleEventError(error as Error, {
        eventName: 'inviteDelete',
        args: [{ 
          guildId: invite.guild?.id,
          inviteCode: invite.code 
        }]
      });
    }
  }
}