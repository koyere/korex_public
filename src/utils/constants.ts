// Bot constants
export const BOT_NAME = 'Korex';
export const BOT_VERSION = '1.0.0';
export const BOT_DESCRIPTION = 'The Core of Your Community';

// Important URLs
export const SUPPORT_SERVER = 'https://discord.gg/korex';
export const WEBSITE = 'https://korex.dev';
export const DOCUMENTATION = 'https://docs.korex.dev';
export const GITHUB = 'https://github.com/korex-dev';

// Discord limits
export const DISCORD_LIMITS = {
  MESSAGE_CONTENT: 2000,
  EMBED_TITLE: 256,
  EMBED_DESCRIPTION: 4096,
  EMBED_FIELD_NAME: 256,
  EMBED_FIELD_VALUE: 1024,
  EMBED_FOOTER: 2048,
  EMBED_AUTHOR: 256,
  EMBED_FIELDS: 25,
  EMBED_TOTAL: 6000,
} as const;

// Common timeouts (in milliseconds)
export const TIMEOUTS = {
  INTERACTION_REPLY: 3000,
  MESSAGE_DELETE: 5000,
  VOICE_DISCONNECT: 300000, // 5 minutes
  CACHE_TTL: 300000, // 5 minutes
} as const;

// Common regex patterns
export const REGEX_PATTERNS = {
  DISCORD_ID: /^\d{17,19}$/,
  DISCORD_INVITE: /discord(?:\.gg|app\.com\/invite)\/([a-zA-Z0-9-]+)/i,
  URL: /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  MENTION_USER: /<@!?(\d{17,19})>/,
  MENTION_ROLE: /<@&(\d{17,19})>/,
  MENTION_CHANNEL: /<#(\d{17,19})>/,
} as const;

// Common error codes
export const ERROR_CODES = {
  // Discord API
  MISSING_PERMISSIONS: 50013,
  CANNOT_MESSAGE_USER: 50007,
  UNKNOWN_MESSAGE: 10008,
  UNKNOWN_CHANNEL: 10003,
  UNKNOWN_GUILD: 10004,
  UNKNOWN_USER: 10013,
  UNKNOWN_MEMBER: 10007,

  // Bot-specific
  COMMAND_NOT_FOUND: 'COMMAND_NOT_FOUND',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  COOLDOWN_ACTIVE: 'COOLDOWN_ACTIVE',
  ADDON_NOT_ENABLED: 'ADDON_NOT_ENABLED',
  LICENSE_INVALID: 'LICENSE_INVALID',
} as const;

// Pagination configuration
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 10,
  MAX_PAGE_SIZE: 25,
  EMBED_PAGE_SIZE: 10,
} as const;

// Default economy configuration
export const ECONOMY_DEFAULTS = {
  STARTING_BALANCE: 100,
  DAILY_REWARD: 100,
  WEEKLY_REWARD: 500,
  WORK_MIN: 50,
  WORK_MAX: 200,
  WORK_COOLDOWN: 3600, // 1 hour
  DAILY_COOLDOWN: 86400, // 24 hours
  WEEKLY_COOLDOWN: 604800, // 7 days
} as const;

// Default leveling configuration
export const LEVELS_DEFAULTS = {
  XP_PER_MESSAGE: 15,
  XP_PER_VOICE_MINUTE: 5,
  XP_COOLDOWN: 60, // 1 minute
  BASE_XP_REQUIRED: 100,
  XP_MULTIPLIER: 1.5,
} as const;
