import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  Colors,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  SlashCommandSubcommandsOnlyBuilder
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class WelcomeImageCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'welcome-image',
      description: 'Configure welcome images with custom templates',
      category: 'admin',
      cooldown: 5,
      permissions: {
        user: [PermissionFlagsBits.ManageGuild],
        bot: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles]
      }
    });
  }

  data(): SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription('Configure welcome images with custom templates')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand(subcommand =>
        subcommand
          .setName('setup')
          .setDescription('Setup welcome images with template selection')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('templates')
          .setDescription('View all available image templates')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('preview')
          .setDescription('Preview a template with your profile')
          .addStringOption(option =>
            option
              .setName('template')
              .setDescription('Template ID to preview')
              .setRequired(true)
              .addChoices(
                { name: 'Modern Dark', value: 'modern-dark' },
                { name: 'Minimalist Light', value: 'minimalist-light' },
                { name: 'Gaming Neon', value: 'gaming-neon' },
                { name: 'Corporate Blue', value: 'corporate-blue' },
                { name: 'Anime Kawaii', value: 'anime-kawaii' },
                { name: 'Retro Synthwave', value: 'retro-synthwave' },
                { name: 'Nature Green', value: 'nature-green' },
                { name: 'Space Cosmic', value: 'space-cosmic' },
                { name: 'Elegant Purple', value: 'elegant-purple' },
                { name: 'Sunset Orange', value: 'sunset-orange' }
              )
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('set')
          .setDescription('Set the welcome image template for this server')
          .addStringOption(option =>
            option
              .setName('template')
              .setDescription('Template ID to use')
              .setRequired(true)
              .addChoices(
                { name: 'Modern Dark', value: 'modern-dark' },
                { name: 'Minimalist Light', value: 'minimalist-light' },
                { name: 'Gaming Neon', value: 'gaming-neon' },
                { name: 'Corporate Blue', value: 'corporate-blue' },
                { name: 'Anime Kawaii', value: 'anime-kawaii' },
                { name: 'Retro Synthwave', value: 'retro-synthwave' },
                { name: 'Nature Green', value: 'nature-green' },
                { name: 'Space Cosmic', value: 'space-cosmic' },
                { name: 'Elegant Purple', value: 'elegant-purple' },
                { name: 'Sunset Orange', value: 'sunset-orange' }
              )
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('toggle')
          .setDescription('Enable or disable welcome images')
          .addBooleanOption(option =>
            option
              .setName('enabled')
              .setDescription('Enable or disable welcome images')
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('status')
          .setDescription('View current welcome image configuration')
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild!.id;

    switch (subcommand) {
      case 'setup':
        await this.handleSetup(interaction);
        break;
      case 'templates':
        await this.handleTemplates(interaction);
        break;
      case 'preview':
        await this.handlePreview(interaction);
        break;
      case 'set':
        await this.handleSet(interaction);
        break;
      case 'toggle':
        await this.handleToggle(interaction);
        break;
      case 'status':
        await this.handleStatus(interaction);
        break;
    }
  }

  private async handleSetup(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guild!.id;

    const embed = new EmbedBuilder()
      .setColor(Colors.Purple)
      .setTitle(i18n.t('welcome_image.setup.title', guildId))
      .setDescription(i18n.t('welcome_image.setup.description', guildId))
      .addFields(
        {
          name: i18n.t('welcome_image.setup.features.templates.name', guildId),
          value: i18n.t('welcome_image.setup.features.templates.value', guildId),
          inline: true
        },
        {
          name: i18n.t('welcome_image.setup.features.variables.name', guildId),
          value: i18n.t('welcome_image.setup.features.variables.value', guildId),
          inline: true
        },
        {
          name: i18n.t('welcome_image.setup.features.customization.name', guildId),
          value: i18n.t('welcome_image.setup.features.customization.value', guildId),
          inline: true
        }
      );

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('welcome_image_setup_select')
      .setPlaceholder(i18n.t('welcome_image.setup.select_placeholder', guildId))
      .addOptions(
        {
          label: i18n.t('welcome_image.setup.options.view_templates.label', guildId),
          description: i18n.t('welcome_image.setup.options.view_templates.description', guildId),
          value: 'templates',
          emoji: '🎨'
        },
        {
          label: i18n.t('welcome_image.setup.options.preview.label', guildId),
          description: i18n.t('welcome_image.setup.options.preview.description', guildId),
          value: 'preview',
          emoji: '👀'
        },
        {
          label: i18n.t('welcome_image.setup.options.configure.label', guildId),
          description: i18n.t('welcome_image.setup.options.configure.description', guildId),
          value: 'configure',
          emoji: '⚙️'
        }
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    await interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: true
    });

    // Handle select menu interaction
    const collector = interaction.channel?.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 300000 // 5 minutes
    });

    collector?.on('collect', async (selectInteraction) => {
      if (selectInteraction.user.id !== interaction.user.id) {
        await selectInteraction.reply({
          content: i18n.t('common.errors.not_your_interaction', guildId),
          ephemeral: true
        });

        return;
      }

      const value = selectInteraction.values[0];

      await this.handleSetupOption(selectInteraction, value);
    });

    collector?.on('end', () => {
      // Disable components after timeout
      const disabledRow = new ActionRowBuilder<StringSelectMenuBuilder>()
        .addComponents(selectMenu.setDisabled(true));
      
      interaction.editReply({ components: [disabledRow] }).catch(() => {});
    });
  }

  private async handleSetupOption(interaction: any, option: string): Promise<void> {
    const guildId = interaction.guild!.id;

    switch (option) {
      case 'templates':
        await this.showTemplatesList(interaction);
        break;
      case 'preview':
        await this.showPreviewOptions(interaction);
        break;
      case 'configure':
        await this.showConfigurationOptions(interaction);
        break;
    }
  }

  private async handleTemplates(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guild!.id;
    const templates = this.client.welcome.getImageTemplates();

    const embed = new EmbedBuilder()
      .setColor(Colors.Blue)
      .setTitle(i18n.t('welcome_image.templates.title', guildId))
      .setDescription(i18n.t('welcome_image.templates.description', guildId, { count: templates.length.toString() }));

    // Add template information
    for (const template of templates.slice(0, 10)) { // Show first 10 templates
      embed.addFields({
        name: `${template.name} (${template.id})`,
        value: `${template.description}\n📐 ${template.width}x${template.height}px`,
        inline: true
      });
    }

    embed.setFooter({ 
      text: i18n.t('welcome_image.templates.footer', guildId) 
    });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  private async handlePreview(interaction: ChatInputCommandInteraction): Promise<void> {
    const templateId = interaction.options.getString('template', true);
    const guildId = interaction.guild!.id;

    await interaction.deferReply({ ephemeral: true });

    try {
      // Create a mock member for preview
      const member = interaction.member as any;
      
      const welcomeImage = await this.client.welcome.generateTestWelcomeImage(member, templateId);
      
      if (welcomeImage) {
        const embed = new EmbedBuilder()
          .setColor(Colors.Green)
          .setTitle(i18n.t('welcome_image.preview.title', guildId))
          .setDescription(i18n.t('welcome_image.preview.description', guildId, { template: templateId }))
          .setImage(`attachment://${welcomeImage.name}`)
          .setFooter({ 
            text: i18n.t('welcome_image.preview.footer', guildId) 
          });

        await interaction.editReply({
          embeds: [embed],
          files: [welcomeImage]
        });
      } else {
        await interaction.editReply({
          content: i18n.t('welcome_image.preview.error', guildId)
        });
      }
    } catch (error) {
      await interaction.editReply({
        content: i18n.t('welcome_image.preview.error', guildId)
      });
    }
  }

  private async handleSet(interaction: ChatInputCommandInteraction): Promise<void> {
    const templateId = interaction.options.getString('template', true);
    const guildId = interaction.guild!.id;

    try {
      await this.client.welcome.updateImageSettings(guildId, true, templateId);
      
      const template = this.client.welcome.getImageTemplate(templateId);
      
      await interaction.reply({
        content: i18n.t('welcome_image.set.success', guildId, { 
          template: template?.name || templateId 
        }),
        ephemeral: true
      });
    } catch (error) {
      await interaction.reply({
        content: i18n.t('welcome_image.set.error', guildId),
        ephemeral: true
      });
    }
  }

  private async handleToggle(interaction: ChatInputCommandInteraction): Promise<void> {
    const enabled = interaction.options.getBoolean('enabled', true);
    const guildId = interaction.guild!.id;

    try {
      await this.client.welcome.updateImageSettings(guildId, enabled);
      
      await interaction.reply({
        content: i18n.t('welcome_image.toggle.success', guildId, { 
          status: enabled ? i18n.t('common.enabled', guildId) : i18n.t('common.disabled', guildId)
        }),
        ephemeral: true
      });
    } catch (error) {
      await interaction.reply({
        content: i18n.t('welcome_image.toggle.error', guildId),
        ephemeral: true
      });
    }
  }

  private async handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guild!.id;

    try {
      const config = await this.client.welcome.getWelcomeConfig(guildId);
      
      const embed = new EmbedBuilder()
        .setColor(config.imageEnabled ? Colors.Green : Colors.Red)
        .setTitle(i18n.t('welcome_image.status.title', guildId))
        .addFields(
          {
            name: i18n.t('welcome_image.status.enabled', guildId),
            value: config.imageEnabled ? i18n.t('common.enabled', guildId) : i18n.t('common.disabled', guildId),
            inline: true
          },
          {
            name: i18n.t('welcome_image.status.template', guildId),
            value: config.imageTemplate || i18n.t('welcome_image.status.no_template', guildId),
            inline: true
          }
        );

      if (config.imageTemplate) {
        const template = this.client.welcome.getImageTemplate(config.imageTemplate);

        if (template) {
          embed.addFields({
            name: i18n.t('welcome_image.status.template_info', guildId),
            value: `**${template.name}**\n${template.description}\n📐 ${template.width}x${template.height}px`,
            inline: false
          });
        }
      }

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (error) {
      await interaction.reply({
        content: i18n.t('welcome_image.status.error', guildId),
        ephemeral: true
      });
    }
  }

  // Helper methods for setup wizard
  private async showTemplatesList(interaction: any): Promise<void> {
    await interaction.reply({
      content: i18n.t('welcome_image.setup.templates_info', interaction.guild.id),
      ephemeral: true
    });
  }

  private async showPreviewOptions(interaction: any): Promise<void> {
    await interaction.reply({
      content: i18n.t('welcome_image.setup.preview_info', interaction.guild.id),
      ephemeral: true
    });
  }

  private async showConfigurationOptions(interaction: any): Promise<void> {
    await interaction.reply({
      content: i18n.t('welcome_image.setup.configure_info', interaction.guild.id),
      ephemeral: true
    });
  }
}