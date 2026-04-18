import { GatewayIntentBits, Partials } from 'discord.js';

export const botConfig = {
  // Intents necesarios
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

  // Partials para eventos incompletos
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User,
    Partials.GuildMember,
  ],

  // Configuración por defecto
  defaults: {
    prefix: process.env.DEFAULT_PREFIX || '!',
    language: process.env.DEFAULT_LANGUAGE || 'es',
    embedColor: '#00D9FF',
    timezone: process.env.TIMEZONE || 'UTC',
  },

  // Cooldowns por defecto (en segundos)
  cooldowns: {
    default: 3,
    economy: 5,
    moderation: 2,
    music: 2,
    fun: 3,
  },

  // Límites
  limits: {
    maxWarnings: 5,
    maxQueueSize: 500,
    maxPlaylistSize: 100,
    xpCooldown: 60, // segundos entre ganancia de XP
    giveaways: 5, // máximo giveaways activos por servidor
    polls: 10, // máximo polls activas por servidor
  },

  // Emojis del bot (IDs de emojis custom o unicode)
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

  // Colores para embeds
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
