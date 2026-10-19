import { GatewayIntentBits, Partials } from 'discord.js';

export const botConfig = {
  // Required intents
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildEmojisAndStickers,
    GatewayIntentBits.GuildIntegrations,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMessageTyping,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.MessageContent,
  ],

  // Partials for incomplete events
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User,
    Partials.GuildMember,
  ],

  // Default settings
  defaults: {
    prefix: process.env.DEFAULT_PREFIX || '!',
    language: process.env.DEFAULT_LANGUAGE || 'es',
    embedColor: '#00D9FF',
    timezone: process.env.TIMEZONE || 'UTC',
  },

  // Default cooldowns (in seconds)
  cooldowns: {
    default: 3,
    economy: 5,
    moderation: 2,
    music: 2,
    fun: 3,
  },

  // Limits
  limits: {
    maxWarnings: 5,
    maxQueueSize: 500,
    maxPlaylistSize: 100,
    xpCooldown: 60, // seconds between XP gains
    giveaways: 5, // max active giveaways per server
    polls: 10, // max active polls per server
  },

  // Bot emojis (custom emoji IDs or unicode)
  emojis: {
    success: '✅',
    error: '❌',
    loading: '⏳',
    music: '🎵',
    money: '💰',
    xp: '⭐',
    warning: '⚠️',
    info: 'ℹ️',
    ban: '🔨',
    kick: '👢',
    mute: '🔇',
  },

  // Embed colors
  colors: {
    primary: '#00D9FF',
    success: '#00FF00',
    error: '#FF0000',
    warning: '#FFFF00',
    info: '#0099FF',
    moderation: '#FF6600',
    economy: '#FFD700',
    music: '#9932CC',
  },
} as const;
