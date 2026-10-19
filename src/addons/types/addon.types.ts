/**
 * Types for the dynamic addon system
 */

export interface AddonConfig {
  // Basic information
  name: string;
  displayName: string;
  description: string;
  version: string;
  
  // Monetization
  price: number;
  currency: string;
  category: AddonCategory;
  
  // Features
  features: string[];
  permissions: string[];
  dependencies: string[];
  
  // Technical configuration
  enabled: boolean;
  beta: boolean;
  requiresSetup: boolean;
  
  // Metadata
  author: string;
  website?: string;
  supportUrl?: string;
  documentationUrl?: string;
  
  // Default configuration
  defaultConfig: Record<string, any>;
  
  // Limits and restrictions
  limits?: AddonLimits;
}

export type AddonCategory = 
  | 'support'      // Tickets, Forms
  | 'monetization' // Store
  | 'management'   // Staff
  | 'automation'   // Forms, AI Assistant
  | 'utility'      // Links, Paste
  | 'entertainment'// Music Pro
  | 'analytics'    // Analytics Pro
  | 'ai'           // AI Assistant
  | 'general';

export interface AddonLimits {
  maxServers?: number;
  maxUsers?: number;
  maxRequests?: number;
  maxStorage?: number; // in MB
  features?: Record<string, number>;
}

export interface AddonLicense {
  id: string;
  guildId: string;
  addonName: string;
  userId: string;
  plan: 'individual' | 'bundle';
  status: AddonStatus;
  paypalSubscriptionId?: string;
  price: number;
  currency: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  cancelledAt?: Date;
}

export type AddonStatus = 
  | 'ACTIVE'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'SUSPENDED'
  | 'TRIAL';

export interface AddonConfigData {
  id: string;
  guildId: string;
  addonName: string;
  config: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface AddonEvent {
  type: 'ADDON_ACTIVATED' | 'ADDON_DEACTIVATED' | 'ADDON_CONFIG_UPDATED';
  guildId: string;
  addonName: string;
  timestamp: number;
  data?: any;
}

export interface AddonBundle {
  id: string;
  name: string;
  displayName: string;
  description: string;
  addons: string[];
  price: number;
  discount: number; // discount percentage
  currency: string;
  popular: boolean;
}

// Predefined bundles
export const ADDON_BUNDLES: AddonBundle[] = [
  {
    id: 'starter',
    name: 'starter',
    displayName: 'Starter Pack',
    description: 'Perfect for small servers getting started',
    addons: ['tickets', 'forms', 'links'],
    price: 6.99,
    discount: 22, // 3 addons × $2.99 = $8.97, bundle = $6.99
    currency: 'USD',
    popular: false
  },
  {
    id: 'complete',
    name: 'complete',
    displayName: 'Complete Bundle',
    description: 'All addons included - Maximum value',
    addons: [
      'tickets', 'store', 'staff', 'forms', 'links', 
      'paste', 'music-pro', 'analytics-pro', 'ai-assistant'
    ],
    price: 19.99,
    discount: 25, // 9 addons × $2.99 = $26.91, bundle = $19.99
    currency: 'USD',
    popular: false
  }
];

export interface AddonUsageStats {
  guildId: string;
  addonName: string;
  commandsUsed: number;
  lastUsed: Date;
  monthlyUsage: number;
  features: Record<string, number>;
}