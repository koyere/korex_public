import { VoiceState, VoiceBasedChannel } from 'discord.js';
import { Event } from '../../client/structures/Event';
import { KorexClient } from '../../client/KorexClient';

export default class VoiceStateUpdateEvent extends Event<'voiceStateUpdate'> {
  constructor(client: KorexClient) {
    super(client, {
      name: 'voiceStateUpdate',
      once: false,
    });
  }

  public async execute(...args: [VoiceState, VoiceState]): Promise<void> {
    const [oldState, newState] = args;

    try {
      const member = newState.member;

      if (!member) return;

      // Member joined a voice channel
      if (!oldState.channel && newState.channel) {
        await this.client.logging.logVoiceJoin(member, newState.channel);
      }

      // Member left a voice channel
      else if (oldState.channel && !newState.channel) {
        await this.client.logging.logVoiceLeave(member, oldState.channel);
      }
    } catch (error) {
      this.client.logger.error('Error handling voice state update event:', error);
    }
  }
}
