import {
  EmbedBuilder,
  User,
  GuildMember,
  Guild,
  TextChannel,
  MessageFlags,
  InteractionReplyOptions,
  InteractionDeferReplyOptions,
} from 'discord.js';
import { botConfig } from '../config/bot.config';
import { DISCORD_LIMITS, REGEX_PATTERNS } from './constants';
import { i18n } from './i18n';

/**
 * Creates ephemeral reply options compatible with Discord.js v14/v15
 * Use this instead of { ephemeral: true } for future compatibility
 */
export function ephemeralReply<T extends object>(options: T): T & { flags: MessageFlags } {
  return {
    ...options,
    flags: MessageFlags.Ephemeral,
  };
}

/**
 * Creates ephemeral defer options compatible with Discord.js v14/v15
 */
export function ephemeralDefer(): InteractionDeferReplyOptions {
  return {
    flags: MessageFlags.Ephemeral,
  };
}

/**
 * Creates a simple ephemeral text reply
 */
export function ephemeralContent(content: string): InteractionReplyOptions {
  return {
    content,
    flags: MessageFlags.Ephemeral,
  };
}

/**
 * Creates an ephemeral embed reply
 */
export function ephemeralEmbed(embed: EmbedBuilder | EmbedBuilder[]): InteractionReplyOptions {
  return {
    embeds: Array.isArray(embed) ? embed : [embed],
    flags: MessageFlags.Ephemeral,
  };
}

/**
 * Creates a basic embed with bot styling
 */
export function createEmbed(options: {
  title?: string;
  description?: string;
  color?: keyof typeof botConfig.colors | string;
  footer?: string;
  timestamp?: boolean;
}): EmbedBuilder {
  const embed = new EmbedBuilder();

  if (options.title) {
    embed.setTitle(options.title.slice(0, DISCORD_LIMITS.EMBED_TITLE));
  }

  if (options.description) {
    embed.setDescription(options.description.slice(0, DISCORD_LIMITS.EMBED_DESCRIPTION));
  }

  // Color
  const color = options.color;

  if (color) {
    if (color in botConfig.colors) {
      embed.setColor(botConfig.colors[color as keyof typeof botConfig.colors]);
    } else {
      embed.setColor(color as any);
    }
  } else {
    embed.setColor(botConfig.colors.primary);
  }

  if (options.footer) {
    embed.setFooter({ text: options.footer.slice(0, DISCORD_LIMITS.EMBED_FOOTER) });
  }

  if (options.timestamp) {
    embed.setTimestamp();
  }

  return embed;
}

/**
 * Creates a success embed
 */
export function createSuccessEmbed(
  title: string,
  description?: string,
  guildId?: string
): EmbedBuilder {
  const embedOptions: any = {
    title: `${botConfig.emojis.success} ${title}`,
    color: 'success',
    timestamp: true,
  };

  if (description) {
    embedOptions.description = description;
  }

  return createEmbed(embedOptions);
}

/**
 * Creates an error embed
 */
export function createErrorEmbed(
  title: string,
  description?: string,
  guildId?: string
): EmbedBuilder {
  const embedOptions: any = {
    title: `${botConfig.emojis.error} ${title}`,
    color: 'error',
    timestamp: true,
  };

  if (description) {
    embedOptions.description = description;
  }

  return createEmbed(embedOptions);
}

/**
 * Creates a warning embed
 */
export function createWarningEmbed(
  title: string,
  description?: string,
  guildId?: string
): EmbedBuilder {
  const embedOptions: any = {
    title: `${botConfig.emojis.warning} ${title}`,
    color: 'warning',
    timestamp: true,
  };

  if (description) {
    embedOptions.description = description;
  }

  return createEmbed(embedOptions);
}

/**
 * Creates an info embed
 */
export function createInfoEmbed(
  title: string,
  description?: string,
  guildId?: string
): EmbedBuilder {
  const embedOptions: any = {
    title: `${botConfig.emojis.info} ${title}`,
    color: 'info',
    timestamp: true,
  };

  if (description) {
    embedOptions.description = description;
  }

  return createEmbed(embedOptions);
}

/**
 * Formats a number with thousands separators
 */
export function formatNumber(num: number, locale: string = 'en-US'): string {
  return num.toLocaleString(locale);
}

/**
 * Formats a duration in milliseconds to readable text
 */
export function formatDuration(ms: number, guildId?: string): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Formats a relative time (X time ago)
 */
export function formatRelativeTime(date: Date, guildId?: string): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  // Use English by default for now, can be enhanced with i18n later
  if (years > 0) return `${years} year${years > 1 ? 's' : ''} ago`;
  if (months > 0) return `${months} month${months > 1 ? 's' : ''} ago`;
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;

  return 'a few seconds ago';
}

/**
 * Truncates text to a specific length
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  return `${text.slice(0, maxLength - 3)}...`;
}

/**
 * Capitalizes the first letter of a string
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Converts a string to title case
 */
export function toTitleCase(str: string): string {
  return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

/**
 * Validates if a string is a valid Discord ID
 */
export function isValidDiscordId(id: string): boolean {
  return REGEX_PATTERNS.DISCORD_ID.test(id);
}

/**
 * Extracts ID from a user mention
 */
export function extractUserId(mention: string): string | null {
  const match = mention.match(REGEX_PATTERNS.MENTION_USER);

  return match ? match[1] : null;
}

/**
 * Extracts ID from a role mention
 */
export function extractRoleId(mention: string): string | null {
  const match = mention.match(REGEX_PATTERNS.MENTION_ROLE);

  return match ? match[1] : null;
}

/**
 * Extracts ID from a channel mention
 */
export function extractChannelId(mention: string): string | null {
  const match = mention.match(REGEX_PATTERNS.MENTION_CHANNEL);

  return match ? match[1] : null;
}

/**
 * Gets the display name of a user
 */
export function getDisplayName(user: User | GuildMember): string {
  if (user instanceof GuildMember) {
    return user.displayName;
  }

  return user.displayName || user.username;
}

/**
 * Gets the avatar of a user
 */
export function getUserAvatar(user: User | GuildMember): string {
  const baseUser = user instanceof GuildMember ? user.user : user;

  return baseUser.displayAvatarURL({ size: 256, extension: 'png' });
}

/**
 * Generates a random code
 */
export function generateRandomCode(length: number = 8): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';

  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return result;
}

/**
 * Calculates XP required for a specific level
 */
export function calculateXpForLevel(level: number): number {
  return Math.floor(100 * Math.pow(1.5, level - 1));
}

/**
 * Calculates level based on total XP
 */
export function calculateLevelFromXp(totalXp: number): number {
  let level = 1;
  let xpRequired = 0;

  while (xpRequired <= totalXp) {
    level++;
    xpRequired += calculateXpForLevel(level);
  }

  return level - 1;
}

/**
 * Splits an array into chunks of specific size
 */
export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }

  return chunks;
}

/**
 * Waits for a specific time (promise)
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);

    return timer;
  });
}

/**
 * Escapes markdown special characters
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/[*_`~|\\]/g, '\\$&');
}

/**
 * Validates if a URL is valid
 */
export function isValidUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);

    return !!urlObj;
  } catch {
    return false;
  }
}
