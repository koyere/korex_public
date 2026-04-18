import { KorexClient } from '../client/KorexClient';
import { Command } from '../client/structures/Command';
import { Event } from '../client/structures/Event';

export interface AddonConfig {
  name: string;
  displayName: string;
  description: string;
  version: string;
  author: string;
  dependencies?: string[];
  requiredPermissions?: bigint[];
  category?: 'utility' | 'moderation' | 'economy' | 'entertainment' | 'music' | 'other';
}

export interface AddonManifest {
  config: AddonConfig;
  commands: string[];
  events: string[];
  services: string[];
}

export interface AddonLicense {
  key: string;
  type: 'personal' | 'professional' | 'enterprise';
  maxServers: number;
  expiresAt: Date | null;
  features: string[];
}

export interface LoadedAddon {
  config: AddonConfig;
  commands: Map<string, Command>;
  events: Map<string, Event>;
  services: Map<string, any>;
  loaded: boolean;
  enabled: boolean;
}

export interface AddonContext {
  client: KorexClient;
  config: AddonConfig;
  logger: any;
}
