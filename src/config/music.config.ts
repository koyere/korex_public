/**
 * Music System Configuration
 * Configure Lavalink nodes and music APIs
 */

export interface LavalinkNode {
  host: string;
  port: number;
  password: string;
  secure: boolean;
  identifier: string;
}

export interface MusicAPIConfig {
  youtube: {
    enabled: boolean;
    apiKey?: string;
  };
  spotify: {
    enabled: boolean;
    clientId?: string;
    clientSecret?: string;
  };
  soundcloud: {
    enabled: boolean;
    clientId?: string;
  };
}

export interface MusicConfig {
  enabled: boolean;
  lavalink: {
    nodes: LavalinkNode[];
    options: {
      resumeKey?: string;
      resumeTimeout?: number;
      autoResume?: boolean;
      useVersionPath?: boolean;
    };
  };
  apis: MusicAPIConfig;
  defaults: {
    volume: number;
    maxQueueSize: number;
    maxSongDuration: number; // in seconds
    searchLimit: number;
    leaveOnEmpty: boolean;
    leaveOnEmptyDelay: number; // in milliseconds
    leaveOnEnd: boolean;
    leaveOnEndDelay: number; // in milliseconds
  };
}

export const musicConfig: MusicConfig = {
  enabled: process.env.MUSIC_ENABLED === 'true',
  lavalink: {
    nodes: [
      {
        host: process.env.LAVALINK_HOST || 'localhost',
        port: parseInt(process.env.LAVALINK_PORT || '2333'),
        password: process.env.LAVALINK_PASSWORD || 'youshallnotpass',
        secure: process.env.LAVALINK_SECURE === 'true',
        identifier: process.env.LAVALINK_IDENTIFIER || 'main-node',
      },
    ],
    options: {
      ...(process.env.LAVALINK_RESUME_KEY && { resumeKey: process.env.LAVALINK_RESUME_KEY }),
      resumeTimeout: parseInt(process.env.LAVALINK_RESUME_TIMEOUT || '60000'),
      autoResume: process.env.LAVALINK_AUTO_RESUME !== 'false',
      useVersionPath: process.env.LAVALINK_USE_VERSION_PATH !== 'false',
    },
  },
  apis: {
    youtube: {
      enabled: process.env.YOUTUBE_API_ENABLED === 'true',
      ...(process.env.YOUTUBE_API_KEY && { apiKey: process.env.YOUTUBE_API_KEY }),
    },
    spotify: {
      enabled: process.env.SPOTIFY_API_ENABLED === 'true',
      ...(process.env.SPOTIFY_CLIENT_ID && { clientId: process.env.SPOTIFY_CLIENT_ID }),
      ...(process.env.SPOTIFY_CLIENT_SECRET && { clientSecret: process.env.SPOTIFY_CLIENT_SECRET }),
    },
    soundcloud: {
      enabled: process.env.SOUNDCLOUD_API_ENABLED === 'true',
      ...(process.env.SOUNDCLOUD_CLIENT_ID && { clientId: process.env.SOUNDCLOUD_CLIENT_ID }),
    },
  },
  defaults: {
    volume: parseInt(process.env.MUSIC_DEFAULT_VOLUME || '50'),
    maxQueueSize: parseInt(process.env.MUSIC_MAX_QUEUE_SIZE || '500'),
    maxSongDuration: parseInt(process.env.MUSIC_MAX_SONG_DURATION || '3600'),
    searchLimit: parseInt(process.env.MUSIC_SEARCH_LIMIT || '10'),
    leaveOnEmpty: process.env.MUSIC_LEAVE_ON_EMPTY !== 'false',
    leaveOnEmptyDelay: parseInt(process.env.MUSIC_LEAVE_ON_EMPTY_DELAY || '300000'),
    leaveOnEnd: process.env.MUSIC_LEAVE_ON_END !== 'false',
    leaveOnEndDelay: parseInt(process.env.MUSIC_LEAVE_ON_END_DELAY || '30000'),
  },
};
