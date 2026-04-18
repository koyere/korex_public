import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { logger } from './Logger';

export interface LanguageData {
  [key: string]: string | LanguageData;
}

interface GuildLanguageEntity {
  id: string;
  language: string | null;
}

interface GuildModelLike {
  findUnique(args: {
    where: { id: string };
    select: { language: true };
  }): Promise<{ language: string | null } | null>;
  findMany(args: {
    select: { id: true; language: true };
  }): Promise<GuildLanguageEntity[]>;
}

interface PrismaLike {
  guild: GuildModelLike;
}

export class I18n {
  private static instance: I18n;
  private languages = new Map<string, LanguageData>();
  private defaultLanguage = 'en';
  private guildLanguages = new Map<string, string>();

  private constructor() {
    this.loadLanguages();
  }

  public static getInstance(): I18n {
    if (!I18n.instance) {
      I18n.instance = new I18n();
    }

    return I18n.instance;
  }

  /**
   * Load all language files from the languages directory
   */
  private loadLanguages(): void {
    // Try multiple possible locations for language files
    const possiblePaths = [
      join(__dirname, '../languages'),        // dist/languages (if copied)
      join(__dirname, '../../src/languages'), // src/languages (development/production)
      join(process.cwd(), 'src/languages'),   // absolute path to src/languages
    ];

    let languagesDir: string | null = null;

    // Find the first existing directory
    for (const path of possiblePaths) {
      if (existsSync(path)) {
        languagesDir = path;
        break;
      }
    }

    if (!languagesDir) {
      logger.error('Languages directory not found in any expected location');
      logger.debug('Searched paths:', possiblePaths);

      return;
    }

    logger.debug(`Loading languages from: ${languagesDir}`);

    try {
      const files = readdirSync(languagesDir);

      for (const file of files) {
        if (file.endsWith('.json')) {
          const langCode = file.replace('.json', '');
          const filePath = join(languagesDir, file);

          try {
            const content = readFileSync(filePath, 'utf8');
            const data = JSON.parse(content);

            this.languages.set(langCode, data);
            logger.debug(`Loaded language: ${langCode} (${Object.keys(data).length} top-level keys)`);
          } catch (error) {
            logger.error(`Error loading language file ${file}:`, error);
          }
        }
      }

      if (this.languages.size === 0) {
        logger.warn('No language files loaded, using fallback');
      } else {
        logger.info(`Successfully loaded ${this.languages.size} language(s): ${Array.from(this.languages.keys()).join(', ')}`);
      }
    } catch (error) {
      logger.error('Error loading languages:', error);
    }
  }

  /**
   * Set language for a guild
   */
  public setGuildLanguage(guildId: string, language: string): void {
    if (this.languages.has(language)) {
      this.guildLanguages.set(guildId, language);
      logger.debug(`Set guild ${guildId} language to ${language}`);
    } else {
      logger.warn(`Language ${language} not found, using default`);
    }
  }

  /**
   * Get language for a guild - reads from cache or returns default
   */
  public getGuildLanguage(guildId: string): string {
    return this.guildLanguages.get(guildId) || this.defaultLanguage;
  }

  /**
   * Get language for a guild - async version that checks DB
   */
  public async getGuildLanguageAsync(prisma: PrismaLike, guildId: string): Promise<string> {
    // Check cache first
    const cached = this.guildLanguages.get(guildId);

    if (cached) return cached;

    // Load from DB
    try {
      const guild = await prisma.guild.findUnique({
        where: { id: guildId },
        select: { language: true }
      });

      if (guild?.language && this.languages.has(guild.language)) {
        this.guildLanguages.set(guildId, guild.language);

        return guild.language;
      }
    } catch (error) {
      logger.error(`Error getting language for guild ${guildId}:`, error);
    }

    return this.defaultLanguage;
  }

  /**
   * Get translated text with comprehensive fallback search
   */
  public t(key: string, langOrGuildId?: string, replacements?: Record<string, string>): string {
    // Determinar el idioma: si es un código de idioma válido, usarlo directamente
    // Si no, tratarlo como guildId y buscar el idioma
    let language: string;

    if (langOrGuildId && this.languages.has(langOrGuildId)) {
      language = langOrGuildId;
    } else if (langOrGuildId) {
      language = this.getGuildLanguage(langOrGuildId);
    } else {
      language = this.defaultLanguage;
    }

    let text = this.getNestedValue(this.languages.get(language), key);

    // Comprehensive fallback search strategies for commands
    if (!text && key.startsWith('commands.')) {
      const commandKey = key.replace('commands.', '');
      const searchLocations = [
        `fun.${commandKey}`,           // Legacy fun commands
        `utility.${commandKey}`,      // Utility commands  
        `moderation.${commandKey}`,   // Moderation commands
        `admin.${commandKey}`,        // Admin commands
        `economy.${commandKey}`,      // Economy commands
        `music.${commandKey}`,        // Music commands
        `levels.${commandKey}`,       // Level commands
        commandKey                    // Direct key without prefix
      ];

      for (const location of searchLocations) {
        text = this.getNestedValue(this.languages.get(language), location);
        if (text) break;
      }
    }

    // Fallback to default language with same comprehensive search
    if (!text && language !== this.defaultLanguage) {
      text = this.getNestedValue(this.languages.get(this.defaultLanguage), key);
      
      if (!text && key.startsWith('commands.')) {
        const commandKey = key.replace('commands.', '');
        const searchLocations = [
          `fun.${commandKey}`,
          `utility.${commandKey}`,
          `moderation.${commandKey}`,
          `admin.${commandKey}`,
          `economy.${commandKey}`,
          `music.${commandKey}`,
          `levels.${commandKey}`,
          commandKey
        ];

        for (const location of searchLocations) {
          text = this.getNestedValue(this.languages.get(this.defaultLanguage), location);
          if (text) break;
        }
      }
    }

    // Fallback to key if still not found
    if (!text) {
      logger.warn(`Translation key not found: ${key}`);

      return key;
    }

    // Apply replacements
    if (replacements) {
      for (const [placeholder, value] of Object.entries(replacements)) {
        text = text.replace(new RegExp(`{${placeholder}}`, 'g'), value);
      }
    }

    return text;
  }

  /**
   * Get nested value from object using dot notation (strings only)
   */
  private getNestedValue(obj: LanguageData | undefined, key: string): string | undefined {
    if (!obj) return undefined;

    const keys = key.split('.');
    let current: unknown = obj;

    for (const k of keys) {
      if (current && typeof current === 'object' && k in current) {
        current = (current as Record<string, unknown>)[k];
      } else {
        return undefined;
      }
    }

    return typeof current === 'string' ? current : undefined;
  }

  /**
   * Get nested raw value from object using dot notation (any type)
   */
  private getNestedRaw(obj: LanguageData | undefined, key: string): unknown {
    if (!obj) return undefined;

    const keys = key.split('.');
    let current: unknown = obj;

    for (const k of keys) {
      if (current && typeof current === 'object' && k in (current as object)) {
        current = (current as Record<string, unknown>)[k];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Get a translated list (array of strings) by key.
   * Falls back to the default language if not found in the guild language.
   */
  public getList(key: string, langOrGuildId?: string): string[] {
    let language: string;

    if (langOrGuildId && this.languages.has(langOrGuildId)) {
      language = langOrGuildId;
    } else if (langOrGuildId) {
      language = this.getGuildLanguage(langOrGuildId);
    } else {
      language = this.defaultLanguage;
    }

    const value =
      this.getNestedRaw(this.languages.get(language), key) ??
      this.getNestedRaw(this.languages.get(this.defaultLanguage), key);

    if (Array.isArray(value)) return value as string[];

    return [];
  }

  /**
   * Get available languages
   */
  public getAvailableLanguages(): string[] {
    return Array.from(this.languages.keys());
  }

  /**
   * Reload language files
   */
  public reloadLanguages(): void {
    this.languages.clear();
    this.loadLanguages();
    logger.info('Language files reloaded');
  }

  /**
   * Load guild languages from database (call after DB connection)
   */
  public async loadGuildLanguagesFromDB(prisma: PrismaLike): Promise<void> {
    try {
      // Leer todos los guilds que tienen idioma configurado
      const guilds = await prisma.guild.findMany({
        select: {
          id: true,
          language: true
        }
      });

      let loaded = 0;

      for (const guild of guilds) {
        if (guild.language && this.languages.has(guild.language)) {
          this.guildLanguages.set(guild.id, guild.language);
          loaded++;
        }
      }

      if (loaded > 0) {
        logger.info(`Loaded ${loaded} guild language preference(s) from database`);
      }
    } catch (error) {
      logger.error('Error loading guild languages from database:', error);
    }
  }

  /**
   * Refresh language for a specific guild from database
   */
  public async refreshGuildLanguage(prisma: PrismaLike, guildId: string): Promise<void> {
    try {
      const guild = await prisma.guild.findUnique({
        where: { id: guildId },
        select: { language: true }
      });

      if (guild?.language && this.languages.has(guild.language)) {
        this.guildLanguages.set(guildId, guild.language);
      }
    } catch (error) {
      logger.error(`Error refreshing language for guild ${guildId}:`, error);
    }
  }

  /**
   * Check if language exists
   */
  public hasLanguage(language: string): boolean {
    return this.languages.has(language);
  }
}

// Export singleton instance
export const i18n = I18n.getInstance();
