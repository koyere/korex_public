import { Events, VoiceState } from 'discord.js';
import { Event } from '../client/structures/Event';
import { KorexClient } from '../client/KorexClient';

export default class VoiceStateUpdateEvent extends Event {
  constructor(client: KorexClient) {
    super(client, {
      name: Events.VoiceStateUpdate,
      once: false,
    });
  }

  async execute(...args: any[]): Promise<void> {
    const [oldState, newState] = args as [VoiceState, VoiceState];
    
    try {
      // Handle user stats voice tracking
      await this.client.userStats.handleVoiceStateUpdate(oldState, newState);

      // Handle auto-roles for boosters if applicable
      if (this.client.autoRole && newState.member) {
        // Check if member boost status changed (this would need additional logic)
        // For now, we'll just handle the voice state change
      }

    } catch (error) {
      await this.client.errorHandler.handleEventError(error as Error, {
        eventName: 'voiceStateUpdate',
        args: [{ 
          guildId: newState.guild.id,
          userId: newState.member?.id,
          oldChannelId: oldState.channel?.id,
          newChannelId: newState.channel?.id
        }]
      });
    }
  }
}