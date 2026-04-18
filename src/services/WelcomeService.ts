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
   * Handle member join - send welcome message and assign auto-role
   */
  public async handleMemberJoin(member: GuildMember): Promise<void> {
    try {
      const config = await this.getWelcomeConfig(member.guild.id);

      if (!config.enabled) {
        return;
      }

      // Send welcome message to channel
      if (config.channelId) {
        await this.sendWelcomeMessage(member, config);
      }

      // Send DM to user
      if (config.dmEnabled && config.dmMessage) {
        await this.sendWelcomeDM(member, config);
      }

      // Assign auto-role
      if (config.roleId) {
        await this.assignAutoRole(member, config.roleId);
      }

      this.logger.info(`Welcome message sent for ${member.user.tag} in ${member.guild.name}`);
    } catch (error) {
      this.logger.error('Error handling member join:', error);
    }
  }

  /**
   * Handle member leave - send goodbye message
   */
  public async handleMemberLeave(member: GuildMember): Promise<void> {
    try {
      const config = await this.getGoodbyeConfig(member.guild.id);

      if (!config.enabled || !config.channelId) {
        return;
      }

      const channel = member.guild.channels.cache.get(config.channelId) as TextChannel;

      if (!channel) {
        return;
      }

      if (config.embedEnabled) {
        const embed = new EmbedBuilder()
          .setColor((config.embedColor as any) || Colors.Red)
          .setTitle(this.replacePlaceholders(config.embedTitle, member))
          .setDescription(this.replacePlaceholders(config.embedDescription, member))
          .setTimestamp();

        await channel.send({ embeds: [embed] });
      } else {
        const message = this.replacePlaceholders(config.message, member);

        await channel.send(message);
      }

      this.logger.info(`Goodbye message sent for ${member.user.tag} in ${member.guild.name}`);
    } catch (error) {
      this.logger.error('Error handling member leave:', error);
    }
  }

  /**
   * Send welcome message to channel
   */
  private async sendWelcomeMessage(member: GuildMember, config: WelcomeConfig): Promise<void> {
    try {
      const channel = member.guild.channels.cache.get(config.channelId!) as TextChannel;

      if (!channel) {
        return;
      }

      const messageOptions: any = {};

      if (config.embedEnabled) {
        const embed = new EmbedBuilder()
          .setColor((config.embedColor as any) || Colors.Green)
          .setTitle(this.replacePlaceholders(config.embedTitle, member))
          .setDescription(this.replacePlaceholders(config.embedDescription, member))
          .setTimestamp();

        if (config.embedThumbnail) {
          embed.setThumbnail(member.user.displayAvatarURL());
        }

        if (config.embedFooter) {
          embed.setFooter({ text: this.replacePlaceholders(config.embedFooter, member) });
        }

        messageOptions.embeds = [embed];
      } else {
        messageOptions.content = this.replacePlaceholders(config.message, member);
      }

      // Add buttons if enabled
      if (config.buttonsEnabled && config.buttons.length > 0) {
        const row = new ActionRowBuilder<ButtonBuilder>();

        for (const buttonConfig of config.buttons.slice(0, 5)) {
          // Max 5 buttons per row
          const button = new ButtonBuilder()
            .setLabel(buttonConfig.label)
            .setStyle(this.getButtonStyle(buttonConfig.style));

          if (buttonConfig.emoji) {
            button.setEmoji(buttonConfig.emoji);
          }

          if (buttonConfig.action === 'LINK' && buttonConfig.url) {
            button.setURL(buttonConfig.url);
          } else {
            button.setCustomId(
              `welcome_${buttonConfig.action.toLowerCase()}_${buttonConfig.roleId || 'action'}`
            );
          }

          row.addComponents(button);
        }

        messageOptions.components = [row];
      }

      // Generate welcome image if enabled (URL takes precedence over template)
      if (config.imageEnabled) {
        try {
          const backgroundUrl = config.imageUrl || undefined;
          const welcomeImage = await this.imageService.generateWelcomeImage(
            member,
            config.imageTemplate || 'modern-dark',
            backgroundUrl
          );

          if (welcomeImage) {
            messageOptions.files = [welcomeImage];

            // If using embed, attach image to it
            if (config.embedEnabled && messageOptions.embeds) {
              messageOptions.embeds[0].setImage(`attachment://${welcomeImage.name}`);
            }
          }
        } catch (error) {
          this.logger.warn('Failed to generate welcome image:', error);
        }
      }

      await channel.send(messageOptions);
    } catch (error) {
      this.logger.error('Error sending welcome message:', error);
    }
  }

  /**
   * Send welcome DM to user
   */
  private async sendWelcomeDM(member: GuildMember, config: WelcomeConfig): Promise<void> {
    try {
      const message = this.replacePlaceholders(config.dmMessage, member);

      const embed = new EmbedBuilder()
        .setColor(Colors.Blue)
        .setTitle(i18n.t('welcome.dm_title', member.guild.id, { server: member.guild.name }))
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
  private async assignAutoRole(member: GuildMember, roleId: string): Promise<void> {
    try {
      const role = member.guild.roles.cache.get(roleId);

      if (!role) {
        this.logger.warn(`Auto-role ${roleId} not found in ${member.guild.name}`);

        return;
      }

      // Check if bot can assign this role
      const botMember = member.guild.members.me;

      if (!botMember || role.position >= botMember.roles.highest.position) {
        this.logger.warn(`Cannot assign auto-role ${role.name} - insufficient permissions`);

        return;
      }

      await member.roles.add(role, 'Auto-role on join');
      this.logger.info(`Assigned auto-role ${role.name} to ${member.user.tag}`);
    } catch (error) {
      this.logger.error('Error assigning auto-role:', error);
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
    if (!guild || guild.enabledAddons.length === 0) return true;
    return guild.enabledAddons.includes(moduleName);
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
      if (templateId) updates.imageTemplate = templateId;
      await this.updateWelcomeConfig(guildId, updates);
      this.logger.info(`Updated welcome image settings for guild ${guildId}: enabled=${enabled}, template=${templateId}`);
    } catch (error) {
      this.logger.error('Error updating welcome image settings:', error);
      throw new Error('Failed to update welcome image settings');
    }
  }
}
