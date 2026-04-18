import { Events, Message } from 'discord.js';
import { Event } from '../../client/structures/Event';
import { KorexClient } from '../../client/KorexClient';

export default class MessageCreateEvent extends Event {
  constructor(client: KorexClient) {
    super(client, {
      name: Events.MessageCreate,
      once: false,
    });
  }

  async execute(...args: any[]): Promise<void> {
    const message = args[0] as Message;
    
    try {
      // Ignore bot messages and DMs
      if (message.author.bot || !message.guild) return;

      // AutoMod check (returns true if message was handled/deleted)
      if (await this.client.autoMod.processMessage(message)) return;

      // AutoResponse system
      await this.client.autoResponseService.processMessage(message);

      // Track message for analytics (solo contar, no guardar contenido)
      await this.client.analytics.trackActivity(message.guild.id, 'message', {
        userId: message.author.id,
        channelId: message.channel.id
      });

      // Handle user stats tracking
      await this.client.userStats.handleMessage(message);

      // Handle level system (if message qualifies for XP)
      if (this.client.levels && message.member) {
        await this.client.levels.addMessageXp(
          message.guild, 
          message.member, 
          message.channel.id, 
          message.channel as any
        );
      }

    } catch (error) {
      await this.client.errorHandler.handleEventError(error as Error, {
        eventName: 'messageCreate',
        args: [{ 
          messageId: message.id,
          guildId: message.guild?.id,
          channelId: message.channel.id,
          authorId: message.author.id
        }]
      });
    }
  }
}
