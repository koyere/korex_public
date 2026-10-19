import {
  Guild,
  GuildMember,
  TextChannel,
  EmbedBuilder,
  Colors,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { logger } from '../utils/Logger';
import { DatabaseManager } from '../client/managers/DatabaseManager';
import { i18n } from '../utils/i18n';
import { WelcomeImageService } from './WelcomeImageService';
import { isCoreModuleEnabled } from '../config/coreModules';
import type { WelcomeConfig as WelcomeConfigRow } from '@prisma/client';

export interface WelcomeConfig {
  guildId: string;
  enabled: boolean;
  channelId: string | null;
  message: string;
  embedEnabled: boolean;
  embedColor: string;
  embedTitle: string;
  embedDescription: string;
  embedThumbnail: boolean;
  embedFooter: string;
  dmEnabled: boolean;
  dmMessage: string;
  roleId: string | null; // Auto-role on join (first role in autoRoles array)
  imageEnabled: boolean;
  imageTemplate: string;
  imageUrl: string | null;
  buttonsEnabled: boolean;
  buttons: WelcomeButton[];
}

export interface WelcomeButton {
  label: string;
  style: 'PRIMARY' | 'SECONDARY' | 'SUCCESS' | 'DANGER' | 'LINK';
  emoji?: string;
  url?: string;
  roleId?: string;
  action: 'ROLE' | 'LINK' | 'RULES' | 'VERIFY';
}

export interface GoodbyeConfig {
  guildId: string;
  enabled: boolean;
  channelId: string | null;
  message: string;
  embedEnabled: boolean;
  embedColor: string;
  embedTitle: string;
  embedDescription: string;
}

export class WelcomeService {
  private static instance: WelcomeService;
  private logger = logger;
  private db: DatabaseManager;
  private imageService: WelcomeImageService;

  private constructor(db: DatabaseManager) {
    this.db = db;
    this.imageService = WelcomeImageService.getInstance();
  }

  public static getInstance(db?: DatabaseManager): WelcomeService {
    if (!WelcomeService.instance) {
      if (!db) {
        throw new Error('DatabaseManager is required for first initialization');
      }
      WelcomeService.instance = new WelcomeService(db);
    }

    return WelcomeService.instance;
  }

  /**
   * Handle member join - send welcome message, DM and auto-roles
   */
  public async handleMemberJoin(member: GuildMember): Promise<void> {
    try {
      const [moduleEnabled, config] = await Promise.all([
        this.isGuildModuleEnabled(member.guild.id, 'welcome'),
        this.db.prisma.welcomeConfig.findUnique({ where: { guildId: member.guild.id } }),
      ]);

      if (!moduleEnabled || !config) {
        return;
      }

      if (config.welcomeEnabled) {
        const built = await this.buildMessage(member, 'welcome', config);
        if (built) await built.channel.send(built.options);

        if (config.welcomeDM && config.welcomeDMMessage) {
          await this.sendWelcomeDM(member, config.welcomeDMMessage);
        }
      }

      // Automatic roles (Welcome Autoroles tab): independent of the message
      if (config.autoRoleEnabled && config.autoRoles.length > 0) {
        await this.assignAutoRoles(member, config.autoRoles);
      }
    } catch (error) {
      this.logger.error('Error handling member join:', error);
    }
  }

  /**
   * Handle member leave - send goodbye message
   */
  public async handleMemberLeave(member: GuildMember): Promise<void> {
    try {
      const [moduleEnabled, config] = await Promise.all([
        this.isGuildModuleEnabled(member.guild.id, 'welcome'),
        this.db.prisma.welcomeConfig.findUnique({ where: { guildId: member.guild.id } }),
      ]);

      if (!moduleEnabled || !config?.goodbyeEnabled) {
        return;
      }

      const built = await this.buildMessage(member, 'goodbye', config);
      if (built) await built.channel.send(built.options);
    } catch (error) {
      this.logger.error('Error handling member leave:', error);
    }
  }

  /**
   * Builds the welcome or goodbye message. Used by the real event and by the
   * dashboard "Test" button, so the test matches exactly what gets sent.
   * Returns null if no text channel is configured.
   */
  public async buildMessage(
    member: GuildMember,
    kind: 'welcome' | 'goodbye',
    config: WelcomeConfigRow,
    opts: { test?: boolean } = {}
  ): Promise<{ channel: TextChannel; options: { content?: string; embeds?: EmbedBuilder[]; files?: any[] } } | null> {
    const guildId = member.guild.id;
    const channelId = kind === 'welcome' ? config.welcomeChannelId : config.goodbyeChannelId;
    if (!channelId) return null;

    const channel = (member.guild.channels.cache.get(channelId)
      ?? await member.guild.channels.fetch(channelId).catch(() => null)) as TextChannel | null;
    if (!channel?.isTextBased()) return null;

    const rawMessage = (kind === 'welcome' ? config.welcomeMessage : config.goodbyeMessage)
      || i18n.t(kind === 'welcome' ? 'welcome.default_message' : 'goodbye.default_message', guildId);
    const message = this.replacePlaceholders(rawMessage, member);
    const embedData = ((kind === 'welcome' ? config.welcomeEmbed : config.goodbyeEmbed) ?? {}) as Record<string, any>;
    const testPrefix = opts.test ? `**${i18n.t('welcome.test_prefix', guildId)}**` : undefined;

    const options: { content?: string; embeds?: EmbedBuilder[]; files?: any[] } = {};

    if (embedData.enabled) {
      const color = /^#[0-9a-fA-F]{6}$/.test(embedData.color ?? '')
        ? embedData.color
        : (kind === 'welcome' ? '#00ff00' : '#ff0000');
      const description = this.replacePlaceholders(embedData.description || rawMessage, member).slice(0, 4096);
      // setTitle/setDescription throw on empty strings: only used when there is text
      const embed = new EmbedBuilder().setColor(color as any).setTimestamp();
      if (description.trim()) embed.setDescription(description);
      if (embedData.title?.trim()) embed.setTitle(this.replacePlaceholders(embedData.title, member).slice(0, 256));
      if (embedData.footer?.trim()) embed.setFooter({ text: this.replacePlaceholders(embedData.footer, member).slice(0, 2048) });
      if (embedData.thumbnail !== false) embed.setThumbnail(member.user.displayAvatarURL());

      options.embeds = [embed];
      if (testPrefix) options.content = testPrefix;
    } else {
      options.content = testPrefix ? `${testPrefix}\n${message}` : message;
    }

    const imageEnabled = kind === 'welcome' ? config.welcomeImage : config.goodbyeImage;
    if (imageEnabled) {
      const image = await this.imageService.generateImage(
        member,
        kind,
        kind === 'welcome' ? config.welcomeImageTemplate : undefined,
        (kind === 'welcome' ? config.welcomeImageUrl : config.goodbyeImageUrl) || undefined
      );
      if (image) {
        options.files = [image];
        options.embeds?.[0]?.setImage(`attachment://${kind}.png`);
      }
    }

    return { channel, options };
  }

  /**
   * Send welcome DM to user
   */
  private async sendWelcomeDM(member: GuildMember, dmMessage: string): Promise<void> {
    try {
      const message = this.replacePlaceholders(dmMessage, member).slice(0, 4096);

      const embed = new EmbedBuilder()
        .setColor(Colors.Blue)
        .setTitle(i18n.t('welcome.dm_title', member.guild.id, { server: member.guild.name }).slice(0, 256))
        .setDescription(message)
        .setThumbnail(member.guild.iconURL())
        .setTimestamp();

      await member.send({ embeds: [embed] });
    } catch (error) {
      // User has DMs disabled
      this.logger.debug(`Could not send welcome DM to ${member.user.tag}`);
    }
  }


  /**
   * Assign auto-role to new member
   */
  private async assignAutoRoles(member: GuildMember, roleIds: string[]): Promise<void> {
    const botMember = member.guild.members.me;
    const assignable = roleIds
      .map((id) => member.guild.roles.cache.get(id))
      .filter((role): role is NonNullable<typeof role> =>
        !!role && !role.managed && !!botMember && role.comparePositionTo(botMember.roles.highest) < 0
      );

    if (assignable.length < roleIds.length) {
      this.logger.warn(`Some auto-roles in ${member.guild.name} are missing or above the bot`);
    }
    if (assignable.length === 0) return;

    try {
      await member.roles.add(assignable, 'Auto-role on join');
    } catch (error) {
      this.logger.error('Error assigning auto-roles:', error);
    }
  }


  /**
   * Replace placeholders in messages
   */
  private replacePlaceholders(text: string, member: GuildMember): string {
    return text
      .replace(/{user}/g, member.user.toString())
      .replace(/{username}/g, member.user.username)
      .replace(/{tag}/g, member.user.tag)
      .replace(/{server}/g, member.guild.name)
      .replace(/{memberCount}/g, member.guild.memberCount.toString())
      .replace(/{mention}/g, member.toString())
      .replace(/{id}/g, member.user.id)
      .replace(/{createdAt}/g, `<t:${Math.floor(member.user.createdTimestamp / 1000)}:F>`)
      .replace(/{joinedAt}/g, `<t:${Math.floor(Date.now() / 1000)}:F>`);
  }

  /**
   * Get button style enum
   */
  private getButtonStyle(style: string): ButtonStyle {
    switch (style) {
      case 'PRIMARY':
        return ButtonStyle.Primary;
      case 'SECONDARY':
        return ButtonStyle.Secondary;
      case 'SUCCESS':
        return ButtonStyle.Success;
      case 'DANGER':
        return ButtonStyle.Danger;
      case 'LINK':
        return ButtonStyle.Link;
      default:
        return ButtonStyle.Secondary;
    }
  }

  /**
   * Returns whether the 'welcome' module is enabled at the guild level.
   * An empty enabledAddons array (legacy guilds) is treated as "all enabled".
   */
  private async isGuildModuleEnabled(guildId: string, moduleName: string): Promise<boolean> {
    const guild = await this.db.prisma.guild.findUnique({
      where: { id: guildId },
      select: { enabledAddons: true },
    });
    return isCoreModuleEnabled(guild?.enabledAddons, moduleName);
  }

  /**
   * Get welcome configuration for a guild (reads from WelcomeConfig — source of truth for web dashboard)
   */
  public async getWelcomeConfig(guildId: string): Promise<WelcomeConfig> {
    try {
      const [moduleEnabled, config] = await Promise.all([
        this.isGuildModuleEnabled(guildId, 'welcome'),
        this.db.prisma.welcomeConfig.findUnique({ where: { guildId } }),
      ]);

      // Parse embed JSON if present
      const embedData = (config?.welcomeEmbed ?? {}) as Record<string, any>;

      const defaults = {
        guildId,
        enabled: false,
        channelId: null as string | null,
        message: i18n.t('welcome.default_message', guildId),
        embedEnabled: false,
        embedColor: '#00ff00',
        embedTitle: '',
        embedDescription: '',
        embedThumbnail: true,
        embedFooter: '',
        dmEnabled: false,
        dmMessage: i18n.t('welcome.default_dm', guildId),
        roleId: null as string | null,
        imageEnabled: false,
        imageTemplate: 'modern-dark',
        imageUrl: null as string | null,
        buttonsEnabled: false,
        buttons: [] as WelcomeButton[],
      };

      if (!config) return defaults;

      return {
        guildId: config.guildId,
        enabled: moduleEnabled ? config.welcomeEnabled : false,
        channelId: config.welcomeChannelId,
        message: config.welcomeMessage,
        embedEnabled: embedData.enabled ?? false,
        embedColor: embedData.color ?? '#00ff00',
        embedTitle: embedData.title ?? '',
        embedDescription: embedData.description ?? '',
        embedThumbnail: embedData.thumbnail ?? true,
        embedFooter: embedData.footer ?? '',
        dmEnabled: config.welcomeDM,
        dmMessage: config.welcomeDMMessage ?? '',
        roleId: config.autoRoles?.[0] ?? null,
        imageEnabled: config.welcomeImage,
        imageTemplate: config.welcomeImageTemplate ?? 'modern-dark',
        imageUrl: config.welcomeImageUrl,
        buttonsEnabled: false,
        buttons: [],
      };
    } catch (error) {
      this.logger.error('Error getting welcome config:', error);
      throw new Error('Failed to get welcome config');
    }
  }

  /**
   * Get goodbye configuration for a guild (reads from WelcomeConfig)
   */
  public async getGoodbyeConfig(guildId: string): Promise<GoodbyeConfig> {
    try {
      const [moduleEnabled, config] = await Promise.all([
        this.isGuildModuleEnabled(guildId, 'welcome'),
        this.db.prisma.welcomeConfig.findUnique({ where: { guildId } }),
      ]);

      const embedData = (config?.goodbyeEmbed ?? {}) as Record<string, any>;

      if (!config) {
        return {
          guildId,
          enabled: false,
          channelId: null,
          message: i18n.t('goodbye.default_message', guildId),
          embedEnabled: false,
          embedColor: '#ff0000',
          embedTitle: '',
          embedDescription: '',
        };
      }

      return {
        guildId: config.guildId,
        enabled: moduleEnabled ? config.goodbyeEnabled : false,
        channelId: config.goodbyeChannelId,
        message: config.goodbyeMessage,
        embedEnabled: embedData.enabled ?? false,
        embedColor: embedData.color ?? '#ff0000',
        embedTitle: embedData.title ?? '',
        embedDescription: embedData.description ?? '',
      };
    } catch (error) {
      this.logger.error('Error getting goodbye config:', error);
      throw new Error('Failed to get goodbye config');
    }
  }

  /**
   * Update welcome configuration (writes to WelcomeConfig)
   */
  public async updateWelcomeConfig(
    guildId: string,
    updates: Partial<WelcomeConfig>
  ): Promise<void> {
    try {
      // Read current embed JSON to merge embed fields
      const current = await this.db.prisma.welcomeConfig.findUnique({ where: { guildId } });
      const currentEmbed = (current?.welcomeEmbed ?? {}) as Record<string, any>;

      const updateData: any = {};
      const createData: any = { guildId };

      if (updates.enabled !== undefined) {
        updateData.welcomeEnabled = updates.enabled;
        createData.welcomeEnabled = updates.enabled;
      }
      if (updates.channelId !== undefined) {
        updateData.welcomeChannelId = updates.channelId;
        createData.welcomeChannelId = updates.channelId;
      }
      if (updates.message !== undefined) {
        updateData.welcomeMessage = updates.message;
        createData.welcomeMessage = updates.message;
      }
      if (updates.dmEnabled !== undefined) {
        updateData.welcomeDM = updates.dmEnabled;
        createData.welcomeDM = updates.dmEnabled;
      }
      if (updates.dmMessage !== undefined) {
        updateData.welcomeDMMessage = updates.dmMessage;
        createData.welcomeDMMessage = updates.dmMessage;
      }
      if (updates.imageEnabled !== undefined) {
        updateData.welcomeImage = updates.imageEnabled;
        createData.welcomeImage = updates.imageEnabled;
      }
      if (updates.imageTemplate !== undefined) {
        updateData.welcomeImageTemplate = updates.imageTemplate;
        createData.welcomeImageTemplate = updates.imageTemplate;
      }
      if (updates.roleId !== undefined) {
        // Store single roleId as first element of autoRoles array
        const roleArr = updates.roleId ? [updates.roleId] : [];
        updateData.autoRoles = roleArr;
        createData.autoRoles = roleArr;
      }

      // Merge embed fields into the JSON column
      const hasEmbedUpdate = [
        updates.embedEnabled, updates.embedColor, updates.embedTitle,
        updates.embedDescription, updates.embedThumbnail, updates.embedFooter,
      ].some(v => v !== undefined);

      if (hasEmbedUpdate) {
        const mergedEmbed = {
          ...currentEmbed,
          ...(updates.embedEnabled !== undefined && { enabled: updates.embedEnabled }),
          ...(updates.embedColor !== undefined && { color: updates.embedColor }),
          ...(updates.embedTitle !== undefined && { title: updates.embedTitle }),
          ...(updates.embedDescription !== undefined && { description: updates.embedDescription }),
          ...(updates.embedThumbnail !== undefined && { thumbnail: updates.embedThumbnail }),
          ...(updates.embedFooter !== undefined && { footer: updates.embedFooter }),
        };
        updateData.welcomeEmbed = mergedEmbed;
        createData.welcomeEmbed = mergedEmbed;
      }

      await this.db.prisma.welcomeConfig.upsert({
        where: { guildId },
        update: updateData,
        create: createData,
      });

      this.logger.info(`Updated welcome config for guild ${guildId}`);
    } catch (error) {
      this.logger.error('Error updating welcome config:', error);
      throw new Error('Failed to update welcome config');
    }
  }

  /**
   * Update goodbye configuration (writes to WelcomeConfig)
   */
  public async updateGoodbyeConfig(
    guildId: string,
    updates: Partial<GoodbyeConfig>
  ): Promise<void> {
    try {
      const current = await this.db.prisma.welcomeConfig.findUnique({ where: { guildId } });
      const currentEmbed = (current?.goodbyeEmbed ?? {}) as Record<string, any>;

      const updateData: any = {};
      const createData: any = { guildId };

      if (updates.enabled !== undefined) {
        updateData.goodbyeEnabled = updates.enabled;
        createData.goodbyeEnabled = updates.enabled;
      }
      if (updates.channelId !== undefined) {
        updateData.goodbyeChannelId = updates.channelId;
        createData.goodbyeChannelId = updates.channelId;
      }
      if (updates.message !== undefined) {
        updateData.goodbyeMessage = updates.message;
        createData.goodbyeMessage = updates.message;
      }

      const hasEmbedUpdate = [
        updates.embedEnabled, updates.embedColor, updates.embedTitle, updates.embedDescription,
      ].some(v => v !== undefined);

      if (hasEmbedUpdate) {
        const mergedEmbed = {
          ...currentEmbed,
          ...(updates.embedEnabled !== undefined && { enabled: updates.embedEnabled }),
          ...(updates.embedColor !== undefined && { color: updates.embedColor }),
          ...(updates.embedTitle !== undefined && { title: updates.embedTitle }),
          ...(updates.embedDescription !== undefined && { description: updates.embedDescription }),
        };
        updateData.goodbyeEmbed = mergedEmbed;
        createData.goodbyeEmbed = mergedEmbed;
      }

      await this.db.prisma.welcomeConfig.upsert({
        where: { guildId },
        update: updateData,
        create: createData,
      });

      this.logger.info(`Updated goodbye config for guild ${guildId}`);
    } catch (error) {
      this.logger.error('Error updating goodbye config:', error);
      throw new Error('Failed to update goodbye config');
    }
  }

  /**
   * Handle welcome button interactions
   */
  public async handleWelcomeButton(interaction: any, action: string, data: string): Promise<void> {
    try {
      const member = interaction.member as GuildMember;

      switch (action) {
        case 'role':
          const role = member.guild.roles.cache.get(data);

          if (role) {
            if (member.roles.cache.has(role.id)) {
              await member.roles.remove(role);
              await interaction.reply({
                content: i18n.t('welcome.role_removed', member.guild.id, { role: role.name }),
                ephemeral: true,
              });
            } else {
              await member.roles.add(role);
              await interaction.reply({
                content: i18n.t('welcome.role_added', member.guild.id, { role: role.name }),
                ephemeral: true,
              });
            }
          }
          break;

        case 'verify':
          // Delegate to VerificationService
          await (interaction.client as any).verificationService?.handleButton(interaction);
          break;

        case 'rules':
          // Show rules or redirect to rules channel
          await interaction.reply({
            content: i18n.t('welcome.rules_info', member.guild.id),
            ephemeral: true,
          });
          break;

        default:
          await interaction.reply({
            content: i18n.t('common.error', member.guild.id),
            ephemeral: true,
          });
      }
    } catch (error) {
      this.logger.error('Error handling welcome button:', error);
    }
  }

  /**
   * Get all available welcome image templates
   */
  public getImageTemplates() {
    return this.imageService.getTemplates();
  }

  /**
   * Get specific welcome image template
   */
  public getImageTemplate(templateId: string) {
    return this.imageService.getTemplate(templateId);
  }

  /**
   * Generate welcome image for testing
   */
  public async generateTestWelcomeImage(member: GuildMember, templateId: string = 'modern-dark') {
    return await this.imageService.generateWelcomeImage(member, templateId);
  }

  /**
   * Update welcome image settings (template-based, used by /welcome-image command)
   */
  public async updateImageSettings(guildId: string, enabled: boolean, templateId?: string): Promise<void> {
    try {
      const updates: Partial<WelcomeConfig> = { imageEnabled: enabled };
      if (templateId) {
        if (!this.imageService.getTemplate(templateId)) throw new Error(`Unknown template ${templateId}`);
        updates.imageTemplate = templateId;
      }
      await this.updateWelcomeConfig(guildId, updates);
      this.logger.info(`Updated welcome image settings for guild ${guildId}: enabled=${enabled}, template=${templateId}`);
    } catch (error) {
      this.logger.error('Error updating welcome image settings:', error);
      throw new Error('Failed to update welcome image settings');
    }
  }
}
