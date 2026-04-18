import { KorexClient } from '../client/KorexClient';

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      // Discord
      DISCORD_TOKEN: string;
      DISCORD_CLIENT_ID: string;
      DISCORD_CLIENT_SECRET: string;
      DISCORD_DEV_GUILD_ID?: string;

      // Database
      DATABASE_PROVIDER: 'postgresql' | 'mongodb' | 'mysql' | 'sqlite';
      DATABASE_URL: string;

      // Redis
      REDIS_URL: string;
      REDIS_PASSWORD?: string;
      REDIS_PREFIX?: string;

      // Lavalink
      LAVALINK_HOST: string;
      LAVALINK_PORT: string;
      LAVALINK_PASSWORD: string;
      LAVALINK_SECURE?: string;

      // API
      API_PORT?: string;
      API_URL: string;
      DASHBOARD_URL: string;
      JWT_SECRET: string;
      JWT_EXPIRES_IN?: string;
      SESSION_SECRET: string;
      CORS_ORIGINS: string;

      // License
      LICENSE_KEY: string;
      LICENSE_SERVER_URL: string;
      INSTALLATION_TOKEN?: string;

      // Addons
      ADDON_STORE_LICENSE?: string;
      ADDON_STAFF_LICENSE?: string;
      ADDON_TICKETS_LICENSE?: string;
      ADDON_FORMS_LICENSE?: string;
      ADDON_LINKS_LICENSE?: string;
      ADDON_PASTE_LICENSE?: string;
      ADDON_MUSIC_PRO_LICENSE?: string;
      ADDON_ANALYTICS_PRO_LICENSE?: string;
      ADDON_IA_ASSISTANT_LICENSE?: string;

      // External APIs
      STRIPE_SECRET_KEY?: string;
      STRIPE_WEBHOOK_SECRET?: string;
      PAYPAL_CLIENT_ID?: string;
      PAYPAL_CLIENT_SECRET?: string;
      OPENAI_API_KEY?: string;
      ANTHROPIC_API_KEY?: string;
      GOOGLE_AI_API_KEY?: string;
      SPOTIFY_CLIENT_ID?: string;
      SPOTIFY_CLIENT_SECRET?: string;
      LASTFM_API_KEY?: string;
      TWITCH_CLIENT_ID?: string;
      TWITCH_CLIENT_SECRET?: string;

      // General
      NODE_ENV: 'development' | 'production' | 'test';
      LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error';
      DEFAULT_PREFIX?: string;
      DEFAULT_LANGUAGE?: string;
      TIMEZONE?: string;

      // Security
      ENCRYPTION_KEY: string;
      ERROR_CHANNEL_ID?: string;
    }
  }
}

export {};
