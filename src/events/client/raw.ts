/**
 * raw event — previously used to forward Discord gateway packets to Lavalink.
 * discord-player handles voice state internally, so this is now a no-op.
 *
 * LAVALINK FALLBACK: If reverting to Lavalink, restore:
 *   async execute(data: any) { this.client.music.updateVoiceState(data); }
 */
import { Event } from '../../client/structures/Event';
import { KorexClient } from '../../client/KorexClient';

export default class RawEvent extends Event {
  constructor(client: KorexClient) {
    super(client, { name: 'raw' as any, once: false });
  }
  async execute(_data: any): Promise<void> {}
}
