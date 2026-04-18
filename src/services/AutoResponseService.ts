import { Guild, Message, EmbedBuilder, TextChannel } from 'discord.js';
import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';
import { botConfig } from '../config/bot.config';

export interface AutoResponseTrigger {
  id: string;
  guildId: string;
  name: string;
  triggers: string[];
  triggerType: 'exact' | 'contains' | 'starts' | 'ends' | 'regex';
  caseSensitive: boolean;
  responses: AutoResponseAction[];
  cooldown: number; // seconds
  enabled: boolean;
  createdBy: string;
  createdAt: Date;
  usageCount: number;
  lastUsed?: Date;
}

export interface AutoResponseAction {
  type: 'text' | 'embed' | 'reaction' | 'dm' | 'role_add' | 'role_remove';
  content?: string;
  embed?: {
    title?: string;
    description?: string;
    color?: string;
    thumbnail?: string;
    image?: string;
    footer?: string;
  };
  emoji?: string;
  roleId?: string;
  deleteOriginal?: boolean;
  delay?: number; // milliseconds
}

export class AutoResponseService {
  private client: KorexClient;
  private cooldowns: Map<string, Map<string, number>> = new Map(); // guildId -> userId -> timestamp

  constructor(client: KorexClient) {
    this.client = client;
  }

  /**
   * Process a message for auto-responses
   */
  async processMessage(message: Message): Promise<void> {
    if (!message.guild || message.author.bot) return;

    try {
      const autoResponses = await this.getGuildAutoResponses(message.guild.id);

      if (!autoResponses.length) return;

      for (const autoResponse of autoResponses) {
        if (!autoResponse.enabled) continue;

        // Check cooldown
        if (this.isOnCooldown(message.guild.id, message.author.id, autoResponse.id)) {
          continue;
        }

        // Check if message matches trigger
        if (this.matchesTrigger(message.content, autoResponse)) {
          await this.executeAutoResponse(message, autoResponse);
          
          // Set cooldown
          this.setCooldown(message.guild.id, message.author.id, autoResponse.id, autoResponse.cooldown);
          
          // Update usage stats
          await this.updateUsageStats(autoResponse.id);
          
          // Only trigger one auto-response per message
          break;
        }
      }
    } catch (error) {
      this.client.logger.error('Error processing auto-response:', error);
    }
  }

  /**
   * Check if trigger matches message content
   */
  private matchesTrigger(content: string, autoResponse: AutoResponseTrigger): boolean {
    const messageContent = autoResponse.caseSensitive ? content : content.toLowerCase();
    
    for (const trigger of autoResponse.triggers) {
      const triggerText = autoResponse.caseSensitive ? trigger : trigger.toLowerCase();
      
      switch (autoResponse.triggerType) {
        case 'exact':
          if (messageContent === triggerText) return true;
          break;
        case 'contains':
          if (messageContent.includes(triggerText)) return true;
          break;
        case 'starts':
          if (messageContent.startsWith(triggerText)) return true;
          break;
        case 'ends':
          if (messageContent.endsWith(triggerText)) return true;
          break;
        case 'regex':
          try {
            const regex = new RegExp(triggerText, autoResponse.caseSensitive ? 'g' : 'gi');

            if (regex.test(messageContent)) return true;
          } catch (error) {
            this.client.logger.warn(`Invalid regex pattern: ${triggerText}`);
          }
          break;
      }
    }
    
    return false;
  }

  /**
   * Execute auto-response actions
   */
  private async executeAutoResponse(message: Message, autoResponse: AutoResponseTrigger): Promise<void> {
    for (const action of autoResponse.responses) {
      try {
        // Apply delay if specified
        if (action.delay && action.delay > 0) {
          await new Promise(resolve => setTimeout(resolve, action.delay));
        }

        switch (action.type) {
          case 'text':
            if (action.content && message.channel.isTextBased()) {
              const processedContent = this.processVariables(action.content, message);

              await (message.channel as any).send(processedContent);
            }
            break;

          case 'embed':
            if (action.embed && message.channel.isTextBased()) {
              const embed = new EmbedBuilder();
              
              if (action.embed.title) {
                embed.setTitle(this.processVariables(action.embed.title, message));
              }
              if (action.embed.description) {
                embed.setDescription(this.processVariables(action.embed.description, message));
              }
              if (action.embed.color) {
                embed.setColor(action.embed.color as any);
              }
              if (action.embed.thumbnail) {
                embed.setThumbnail(this.processVariables(action.embed.thumbnail, message));
              }
              if (action.embed.image) {
                embed.setImage(this.processVariables(action.embed.image, message));
              }
              if (action.embed.footer) {
                embed.setFooter({ text: this.processVariables(action.embed.footer, message) });
              }
              
              embed.setTimestamp();
              await (message.channel as any).send({ embeds: [embed] });
            }
            break;

          case 'reaction':
            if (action.emoji) {
              await message.react(action.emoji);
            }
            break;

          case 'dm':
            if (action.content) {
              try {
                const processedContent = this.processVariables(action.content, message);

                await message.author.send(processedContent);
              } catch (error) {
                // User has DMs disabled, ignore
              }
            }
            break;

          case 'role_add':
            if (action.roleId && message.member) {
              const role = message.guild?.roles.cache.get(action.roleId);

              if (role && !message.member.roles.cache.has(action.roleId)) {
                await message.member.roles.add(role);
              }
            }
            break;

          case 'role_remove':
            if (action.roleId && message.member) {
              const role = message.guild?.roles.cache.get(action.roleId);

              if (role && message.member.roles.cache.has(action.roleId)) {
                await message.member.roles.remove(role);
              }
            }
            break;
        }

        // Delete original message if specified
        if (action.deleteOriginal && message.deletable) {
          await message.delete();
        }
      } catch (error) {
        this.client.logger.error(`Error executing auto-response action:`, error);
      }
    }
  }

  /**
   * Process variables in text content
   */
  private processVariables(content: string, message: Message): string {
    return content
      .replace(/{user}/g, message.author.toString())
      .replace(/{username}/g, message.author.username)
      .replace(/{displayname}/g, message.author.displayName)
      .replace(/{server}/g, message.guild?.name || 'Unknown')
      .replace(/{channel}/g, message.channel.toString())
      .replace(/{membercount}/g, message.guild?.memberCount?.toString() || '0')
      .replace(/{date}/g, new Date().toLocaleDateString())
      .replace(/{time}/g, new Date().toLocaleTimeString());
  }

  /**
   * Check if user is on cooldown for specific auto-response
   */
  private isOnCooldown(guildId: string, userId: string, autoResponseId: string): boolean {
    const guildCooldowns = this.cooldowns.get(guildId);

    if (!guildCooldowns) return false;

    const cooldownKey = `${userId}:${autoResponseId}`;
    const lastUsed = guildCooldowns.get(cooldownKey);

    if (!lastUsed) return false;

    return Date.now() - lastUsed < 1000; // Always allow if more than 1 second passed
  }

  /**
   * Set cooldown for user and auto-response
   */
  private setCooldown(guildId: string, userId: string, autoResponseId: string, cooldownSeconds: number): void {
    if (!this.cooldowns.has(guildId)) {
      this.cooldowns.set(guildId, new Map());
    }

    const guildCooldowns = this.cooldowns.get(guildId)!;
    const cooldownKey = `${userId}:${autoResponseId}`;

    guildCooldowns.set(cooldownKey, Date.now());

    // Clean up old cooldowns after the specified time
    setTimeout(() => {
      guildCooldowns.delete(cooldownKey);
    }, cooldownSeconds * 1000);
  }

  /**
   * Get all auto-responses for a guild
   */
  async getGuildAutoResponses(guildId: string): Promise<AutoResponseTrigger[]> {
    const dbResponses = await this.client.database.prisma.autoResponse.findMany({
      where: { guildId },
      include: { actions: { orderBy: { order: 'asc' } } }
    });

    return dbResponses.map(r => this.mapDbToTrigger(r));
  }

  /**
   * Create new auto-response
   */
  async createAutoResponse(guildId: string, data: Partial<AutoResponseTrigger>): Promise<AutoResponseTrigger> {
    const dbResponse = await this.client.database.prisma.autoResponse.create({
      data: {
        guildId,
        name: data.name || 'Unnamed Response',
        triggers: data.triggers || [],
        triggerType: this.mapTriggerTypeToDb(data.triggerType || 'contains'),
        caseSensitive: data.caseSensitive || false,
        cooldown: data.cooldown || 5,
        enabled: data.enabled !== false,
        createdBy: data.createdBy || 'unknown',
        usageCount: 0,
        actions: {
          create: (data.responses || []).map((action, index) => ({
            type: this.mapActionTypeToDb(action.type),
            order: index,
            content: action.content,
            embedTitle: action.embed?.title,
            embedDescription: action.embed?.description,
            embedColor: action.embed?.color,
            embedThumbnail: action.embed?.thumbnail,
            embedImage: action.embed?.image,
            embedFooter: action.embed?.footer,
            emoji: action.emoji,
            roleId: action.roleId,
            deleteOriginal: action.deleteOriginal || false,
            delay: action.delay || 0
          }))
        }
      },
      include: { actions: { orderBy: { order: 'asc' } } }
    });

    return this.mapDbToTrigger(dbResponse);
  }

  /**
   * Update auto-response
   */
  async updateAutoResponse(id: string, data: Partial<AutoResponseTrigger>): Promise<boolean> {
    try {
      await this.client.database.prisma.autoResponse.update({
        where: { id },
        data: {
          name: data.name,
          triggers: data.triggers,
          triggerType: data.triggerType ? this.mapTriggerTypeToDb(data.triggerType) : undefined,
          caseSensitive: data.caseSensitive,
          cooldown: data.cooldown,
          enabled: data.enabled,
          ...(data.responses
            ? {
                actions: {
                  deleteMany: {},
                  create: data.responses.map((action, index) => ({
                    type: this.mapActionTypeToDb(action.type),
                    order: index,
                    content: action.content,
                    embedTitle: action.embed?.title,
                    embedDescription: action.embed?.description,
                    embedColor: action.embed?.color,
                    embedThumbnail: action.embed?.thumbnail,
                    embedImage: action.embed?.image,
                    embedFooter: action.embed?.footer,
                    emoji: action.emoji,
                    roleId: action.roleId,
                    deleteOriginal: action.deleteOriginal || false,
                    delay: action.delay || 0
                  }))
                }
              }
            : {})
        }
      });

      return true;
    } catch (error) {
      this.client.logger.error('Error updating auto-response:', error);

      return false;
    }
  }

  /**
   * Delete auto-response
   */
  async deleteAutoResponse(id: string): Promise<boolean> {
    try {
      await this.client.database.prisma.autoResponse.delete({ where: { id } });

      return true;
    } catch (error) {
      this.client.logger.error('Error deleting auto-response:', error);

      return false;
    }
  }

  /**
   * Update usage statistics
   */
  private async updateUsageStats(autoResponseId: string): Promise<void> {
    try {
      await this.client.database.prisma.autoResponse.update({
        where: { id: autoResponseId },
        data: {
          usageCount: { increment: 1 },
          lastUsed: new Date()
        }
      });
    } catch (error) {
      this.client.logger.error('Error updating usage stats:', error);
    }
  }

  /**
   * Get auto-response statistics for guild
   */
  async getGuildStats(guildId: string): Promise<{
    total: number;
    enabled: number;
    disabled: number;
    totalUsage: number;
    mostUsed?: AutoResponseTrigger;
  }> {
    const autoResponses = await this.getGuildAutoResponses(guildId);
    
    const stats = {
      total: autoResponses.length,
      enabled: autoResponses.filter(ar => ar.enabled).length,
      disabled: autoResponses.filter(ar => !ar.enabled).length,
      totalUsage: autoResponses.reduce((sum, ar) => sum + ar.usageCount, 0),
      mostUsed: autoResponses.sort((a, b) => b.usageCount - a.usageCount)[0]
    };

    return stats;
  }

  /**
   * Map database response to AutoResponseTrigger
   */
  private mapDbToTrigger(dbResponse: any): AutoResponseTrigger {
    return {
      id: dbResponse.id,
      guildId: dbResponse.guildId,
      name: dbResponse.name,
      triggers: dbResponse.triggers,
      triggerType: this.mapDbToTriggerType(dbResponse.triggerType),
      caseSensitive: dbResponse.caseSensitive,
      responses: dbResponse.actions.map((action: any) => ({
        type: this.mapDbToActionType(action.type),
        content: action.content,
        embed: action.embedTitle || action.embedDescription ? {
          title: action.embedTitle,
          description: action.embedDescription,
          color: action.embedColor,
          thumbnail: action.embedThumbnail,
          image: action.embedImage,
          footer: action.embedFooter
        } : undefined,
        emoji: action.emoji,
        roleId: action.roleId,
        deleteOriginal: action.deleteOriginal,
        delay: action.delay
      })),
      cooldown: dbResponse.cooldown,
      enabled: dbResponse.enabled,
      createdBy: dbResponse.createdBy,
      createdAt: dbResponse.createdAt,
      usageCount: dbResponse.usageCount,
      lastUsed: dbResponse.lastUsed
    };
  }

  /**
   * Map trigger type to database enum
   */
  private mapTriggerTypeToDb(type: string): any {
    const map: Record<string, string> = {
      'exact': 'EXACT',
      'contains': 'CONTAINS',
      'starts': 'STARTS',
      'ends': 'ENDS',
      'regex': 'REGEX'
    };

    return map[type] || 'CONTAINS';
  }

  /**
   * Map database enum to trigger type
   */
  private mapDbToTriggerType(type: string): 'exact' | 'contains' | 'starts' | 'ends' | 'regex' {
    const map: Record<string, any> = {
      'EXACT': 'exact',
      'CONTAINS': 'contains',
      'STARTS': 'starts',
      'ENDS': 'ends',
      'REGEX': 'regex'
    };

    return map[type] || 'contains';
  }

  /**
   * Map action type to database enum
   */
  private mapActionTypeToDb(type: string): any {
    const map: Record<string, string> = {
      'text': 'TEXT',
      'embed': 'EMBED',
      'reaction': 'REACTION',
      'dm': 'DM',
      'role_add': 'ROLE_ADD',
      'role_remove': 'ROLE_REMOVE'
    };

    return map[type] || 'TEXT';
  }

  /**
   * Map database enum to action type
   */
  private mapDbToActionType(type: string): 'text' | 'embed' | 'reaction' | 'dm' | 'role_add' | 'role_remove' {
    const map: Record<string, any> = {
      'TEXT': 'text',
      'EMBED': 'embed',
      'REACTION': 'reaction',
      'DM': 'dm',
      'ROLE_ADD': 'role_add',
      'ROLE_REMOVE': 'role_remove'
    };

    return map[type] || 'text';
  }
}
