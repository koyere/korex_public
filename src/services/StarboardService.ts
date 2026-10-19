import {
  Guild,
  Message,
  PartialMessage,
  MessageReaction,
  PartialMessageReaction,
  User,
  PartialUser,
  TextChannel,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';

export class StarboardService {
  private client: KorexClient;
  // Short-lived config cache (queried on every reaction in any server)
  private configCache = new Map<string, { config: any; expires: number }>();
  // Serializes processing per message: avoids posting twice during a burst of reactions
  private locks = new Map<string, Promise<void>>();

  constructor(client: KorexClient) {
    this.client = client;
  }

  invalidateCache(guildId: string): void {
    this.configCache.delete(guildId);
  }

  async handleReactionAdd(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser
  ): Promise<void> {
    if (user.bot) return;
    await this.process(reaction);
  }

  async handleReactionRemove(
    reaction: MessageReaction | PartialMessageReaction,
    _user: User | PartialUser
  ): Promise<void> {
    await this.process(reaction);
  }

  /** Recalculates the message count and creates/updates/dims its entry. */
  private async process(reaction: MessageReaction | PartialMessageReaction): Promise<void> {
    const messageId = reaction.message.id;
    const previous = this.locks.get(messageId) ?? Promise.resolve();
    const current = previous.then(() => this.evaluate(reaction)).catch((error) => {
      this.client.logger.error('[Starboard] Error processing reaction:', error);
    });
    this.locks.set(messageId, current);
    await current;
    if (this.locks.get(messageId) === current) this.locks.delete(messageId);
  }

  private async evaluate(reaction: MessageReaction | PartialMessageReaction): Promise<void> {
    if (!reaction.message.guild) return;

    const guild = reaction.message.guild;
    const config = await this.getConfig(guild.id);
    if (!config || !config.enabled || !config.channelId) return;

    if (!this.emojiMatches(reaction, config.emoji)) return;

    // Fetch partials
    if (reaction.partial) await reaction.fetch().catch(() => null);
    if (reaction.message.partial) await reaction.message.fetch().catch(() => null);

    const message = reaction.message as Message;
    if (!message?.channel) return;

    // Same filters when adding and removing stars
    if (message.channel.id === config.channelId) return;
    if (config.ignoreBots && message.author?.bot) return;
    if (config.ignoreNsfw && (message.channel as TextChannel).nsfw) return;
    if (config.ignoredChannels.includes(message.channel.id)) return;

    const count = await this.countReactions(reaction, config, message.author?.id ?? null);
    const existing = await this.client.db.starboardEntry.findUnique({ where: { originalMsgId: message.id } });

    if (count >= config.threshold) {
      await this.createOrUpdateEntry(guild, message, count, config.channelId, config.emoji);
    } else if (existing) {
      await this.markEntryBelow(guild.id, message.id, config.channelId, config.emoji, count);
    }
  }

  /** Unicode by name; custom ones (animated too) by ID. */
  private emojiMatches(reaction: MessageReaction | PartialMessageReaction, configured: string): boolean {
    const customId = configured.match(/(\d{15,})>?$/)?.[1];
    if (customId) return reaction.emoji.id === customId;
    return !reaction.emoji.id && reaction.emoji.name === configured;
  }

  async handleMessageDelete(message: Message | PartialMessage): Promise<void> {
    try {
      if (!message.guild) return;
      const entry = await this.client.db.starboardEntry.findUnique({
        where: { originalMsgId: message.id },
      });
      if (!entry) return;
      const config = await this.getConfig(message.guild.id);
      if (!config?.channelId) return;
      const sbChannel = message.guild.channels.cache.get(config.channelId) as TextChannel;
      if (sbChannel) {
        await sbChannel.messages.delete(entry.starboardMsgId).catch(() => null);
      }
      await this.client.db.starboardEntry.delete({ where: { originalMsgId: message.id } }).catch(() => null);
    } catch (error) {
      this.client.logger.error('[Starboard] Error handling message delete:', error);
    }
  }

  private async countReactions(
    reaction: MessageReaction | PartialMessageReaction,
    config: any,
    authorId: string | null
  ): Promise<number> {
    // Re-fetch to get accurate count
    const fresh = await reaction.fetch().catch(() => reaction);
    const count = fresh.count ?? 0;
    // No self-star: the author's reaction does not count, whenever it was added
    if (!config.selfStar && authorId && count > 0) {
      const users = await fresh.users.fetch({ limit: 100 }).catch(() => null);
      if (users?.has(authorId)) return Math.max(0, count - 1);
    }
    return count;
  }


  private async createOrUpdateEntry(
    guild: Guild,
    message: Message,
    count: number,
    channelId: string,
    emoji: string
  ): Promise<void> {
    const sbChannel = guild.channels.cache.get(channelId) as TextChannel;
    if (!sbChannel) return;

    const embed = this.buildEmbed(message, count, emoji);
    const jumpUrl = message.url;

    const existing = await this.client.db.starboardEntry.findUnique({
      where: { originalMsgId: message.id },
    });

    if (existing) {
      // Update the existing starboard message
      try {
        const sbMsg = await sbChannel.messages.fetch(existing.starboardMsgId);
        await sbMsg.edit({ content: `${emoji} **${count}** | <#${message.channel.id}>`, embeds: [embed] });
        await this.client.db.starboardEntry.update({
          where: { originalMsgId: message.id },
          data: { starCount: count },
        });
      } catch {
        // Message was deleted externally — remove stale entry
        await this.client.db.starboardEntry.delete({ where: { originalMsgId: message.id } }).catch(() => null);
        await this.postNewEntry(sbChannel, guild.id, message, count, embed, emoji);
      }
    } else {
      await this.postNewEntry(sbChannel, guild.id, message, count, embed, emoji);
    }
  }

  private async postNewEntry(
    sbChannel: TextChannel,
    guildId: string,
    message: Message,
    count: number,
    embed: EmbedBuilder,
    emoji: string
  ): Promise<void> {
    const sbMsg = await sbChannel.send({
      content: `${emoji} **${count}** | <#${message.channel.id}>`,
      embeds: [embed],
    });
    await this.client.db.starboardEntry.create({
      data: {
        guildId,
        originalMsgId: message.id,
        originalChId: message.channel.id,
        starboardMsgId: sbMsg.id,
        authorId: message.author?.id ?? 'unknown',
        starCount: count,
      },
    });
  }

  private async markEntryBelow(
    guildId: string,
    originalMsgId: string,
    channelId: string,
    emoji: string,
    count: number
  ): Promise<void> {
    const entry = await this.client.db.starboardEntry.findUnique({ where: { originalMsgId } });
    if (!entry) return;
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return;
    const sbChannel = guild.channels.cache.get(channelId) as TextChannel;
    if (!sbChannel) return;
    try {
      const sbMsg = await sbChannel.messages.fetch(entry.starboardMsgId);
      // Edit to show gray state (below threshold)
      const grayEmbed = new EmbedBuilder(sbMsg.embeds[0]?.toJSON()).setColor(Colors.DarkGrey);
      await sbMsg.edit({
        content: `${emoji} **${count}** | <#${entry.originalChId}>`,
        embeds: [grayEmbed],
      });
      await this.client.db.starboardEntry.update({
        where: { originalMsgId },
        data: { starCount: count },
      });
    } catch {
      await this.client.db.starboardEntry.delete({ where: { originalMsgId } }).catch(() => null);
    }
  }

  private buildEmbed(message: Message, count: number, emoji: string): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(this.starColor(count))
      .setAuthor({
        name: message.author?.tag ?? i18n.t('starboard.unknown_author', message.guildId!),
        iconURL: message.author?.displayAvatarURL() ?? undefined,
      })
      .setTimestamp(message.createdAt)
      .addFields({
        name: i18n.t('starboard.original_message', message.guildId!),
        value: `[${i18n.t('starboard.jump_to_message', message.guildId!)}](${message.url})`,
        inline: true,
      });

    if (message.content) {
      embed.setDescription(
        message.content.length > 1000
          ? `${message.content.substring(0, 1000)}…`
          : message.content
      );
    }

    // Attach first image if present
    const attachment = message.attachments.find(a => a.contentType?.startsWith('image/'));
    if (attachment) embed.setImage(attachment.url);

    // Embed thumbnail from first embed
    if (!attachment && message.embeds[0]?.thumbnail?.url) {
      embed.setThumbnail(message.embeds[0].thumbnail.url);
    }

    return embed;
  }

  private starColor(count: number): number {
    if (count >= 20) return 0xFFD700; // gold
    if (count >= 10) return 0xFFA500; // orange
    if (count >= 5)  return 0xFFFF00; // yellow
    return 0xFFFACD;                  // lemon chiffon
  }

  async getConfig(guildId: string) {
    const cached = this.configCache.get(guildId);
    if (cached && cached.expires > Date.now()) return cached.config;
    const config = await this.client.db.starboardConfig.findUnique({ where: { guildId } });
    this.configCache.set(guildId, { config, expires: Date.now() + 60_000 });
    return config;
  }


  async getStats(guildId: string) {
    const [total, topAuthor] = await Promise.all([
      this.client.db.starboardEntry.count({ where: { guildId } }),
      this.client.db.starboardEntry.groupBy({
        by: ['authorId'],
        where: { guildId },
        _sum: { starCount: true },
        orderBy: { _sum: { starCount: 'desc' } },
        take: 1,
      }),
    ]);
    return { total, topAuthorId: topAuthor[0]?.authorId ?? null, topAuthorStars: topAuthor[0]?._sum.starCount ?? 0 };
  }
}
