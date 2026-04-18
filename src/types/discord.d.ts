import { KorexClient } from '../client/KorexClient';

declare module 'discord.js' {
  interface Client {
    korex?: KorexClient;
  }
}

export interface KorexGuild {
  id: string;
  name: string;
  icon: string | null;
  memberCount: number;
  botJoined: boolean;
  permissions?: string[];
}

export interface KorexUser {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  bot: boolean;
  system?: boolean;
}

export interface KorexMember extends KorexUser {
  nickname?: string;
  roles: string[];
  joinedAt: string;
  premiumSince?: string;
  permissions: string[];
}

export interface CommandContext {
  client: KorexClient;
  guild: KorexGuild;
  user: KorexUser;
  member?: KorexMember;
  channel: {
    id: string;
    name: string;
    type: number;
  };
}
