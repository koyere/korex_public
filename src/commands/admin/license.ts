import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class LicenseCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'license',
      description: 'Manage addon licenses',
      category: 'admin',
      permissions: {
        user: [PermissionFlagsBits.Administrator],
      },
      cooldown: 5,
      guildOnly: true,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('license')
      .setDescription('Manage addon licenses')
      .addSubcommand((subcommand) =>
        subcommand
          .setName('check')
          .setDescription('Check addon license')
          .addStringOption((option) =>
            option.setName('addon').setDescription('Addon ID to check').setRequired(true)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand.setName('list').setDescription('List all server licenses')
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('create')
          .setDescription('Create new license')
          .addStringOption((option) =>
            option.setName('addon').setDescription('Addon ID').setRequired(true)
          )
          .addStringOption((option) =>
            option
              .setName('type')
              .setDescription('License type')
              .setRequired(true)
              .addChoices(
                { name: 'Free', value: 'FREE' },
                { name: 'Premium', value: 'PREMIUM' },
                { name: 'Enterprise', value: 'ENTERPRISE' }
              )
          )
          .addStringOption((option) =>
            option.setName('features').setDescription('Comma-separated features').setRequired(true)
          )
          .addIntegerOption((option) =>
            option
              .setName('duration')
              .setDescription('Duration in days (optional)')
              .setRequired(false)
          )
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const subcommand = interaction.options.getSubcommand();
      const guildId = interaction.guild!.id;
      const lang = i18n.getGuildLanguage(guildId);

      switch (subcommand) {
        case 'check':
          await this.handleCheck(interaction, lang);
          break;
        case 'list':
          await this.handleList(interaction, lang);
          break;
        case 'create':
          await this.handleCreate(interaction, lang);
          break;
        default:
          await interaction.reply({
            content: '❌ Unknown subcommand.',
            ephemeral: true,
          });
      }
    } catch (error) {
      await this.client.errorHandler.handleCommandError(error as Error, interaction, {
        command: 'license',
        subcommand: interaction.options.getSubcommand(),
      });
    }
  }

  private async handleCheck(interaction: ChatInputCommandInteraction, lang: string): Promise<void> {
    const addonId = interaction.options.getString('addon', true);
    const guildId = interaction.guild!.id;

    const validation = await this.client.licenses.validateLicense(addonId, guildId);

    const embed = new EmbedBuilder()
      .setTitle(`🔐 License Check: ${addonId}`)
      .setColor(validation.valid ? Colors.Green : Colors.Red)
      .addFields(
        {
          name: 'Status',
          value: validation.valid ? '✅ Valid' : '❌ Invalid',
          inline: true,
        },
        {
          name: 'Type',
          value: validation.license?.type || 'N/A',
          inline: true,
        }
      );

    if (validation.license?.expiresAt) {
      embed.addFields({
        name: 'Expires',
        value: `<t:${Math.floor(validation.license.expiresAt.getTime() / 1000)}:R>`,
        inline: true,
      });
    }

    if (validation.license?.features.length) {
      embed.addFields({
        name: 'Features',
        value: validation.license.features.join(', '),
        inline: false,
      });
    }

    if (!validation.valid && validation.reason) {
      embed.addFields({
        name: 'Reason',
        value: validation.reason,
        inline: false,
      });
    }

    await interaction.reply({ embeds: [embed] });
  }

  private async handleList(interaction: ChatInputCommandInteraction, lang: string): Promise<void> {
    const guildId = interaction.guild!.id;
    const licenses = await this.client.licenses.getGuildLicenses(guildId);

    if (licenses.length === 0) {
      await interaction.reply({
        content: '📝 No licenses found for this server.',
        ephemeral: true,
      });

      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('🔐 Server Licenses')
      .setColor(Colors.Blue)
      .setDescription(`Found ${licenses.length} license(s)`);

    for (const license of licenses.slice(0, 10)) {
      const status = license.isActive ? '✅' : '❌';
      const expiry = license.expiresAt
        ? `<t:${Math.floor(license.expiresAt.getTime() / 1000)}:R>`
        : 'Never';

      embed.addFields({
        name: `${status} ${license.addonId}`,
        value: `Type: ${license.type}\nExpires: ${expiry}`,
        inline: true,
      });
    }

    if (licenses.length > 10) {
      embed.setFooter({ text: `Showing 10 of ${licenses.length} licenses` });
    }

    await interaction.reply({ embeds: [embed] });
  }

  private async handleCreate(
    interaction: ChatInputCommandInteraction,
    lang: string
  ): Promise<void> {
    const addonId = interaction.options.getString('addon', true);
    const type = interaction.options.getString('type', true) as 'FREE' | 'PREMIUM' | 'ENTERPRISE';
    const featuresStr = interaction.options.getString('features', true);
    const duration = interaction.options.getInteger('duration');
    const guildId = interaction.guild!.id;

    // Validate inputs
    if (!['FREE', 'PREMIUM', 'ENTERPRISE'].includes(type)) {
      await interaction.reply({
        content: '❌ Invalid license type. Must be FREE, PREMIUM, or ENTERPRISE.',
        ephemeral: true,
      });

      return;
    }

    const features = featuresStr
      .split(',')
      .map((f: string) => f.trim())
      .filter((f: string) => f.length > 0);

    if (features.length === 0) {
      await interaction.reply({
        content: '❌ At least one feature must be specified.',
        ephemeral: true,
      });

      return;
    }

    try {
      const expiresAt = duration
        ? new Date(Date.now() + duration * 24 * 60 * 60 * 1000)
        : undefined;

      const license = await this.client.licenses.createLicense(
        addonId,
        guildId,
        type,
        features,
        expiresAt
      );

      const embed = new EmbedBuilder()
        .setTitle('✅ License Created')
        .setColor(Colors.Green)
        .addFields(
          { name: 'Addon', value: addonId, inline: true },
          { name: 'Type', value: type, inline: true },
          { name: 'Features', value: features.join(', '), inline: false }
        );

      if (expiresAt) {
        embed.addFields({
          name: 'Expires',
          value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`,
          inline: true,
        });
      }

      await interaction.reply({ embeds: [embed] });

      this.client.logger.info(
        `License created for addon ${addonId} in guild ${interaction.guild!.name} by ${interaction.user.tag}`
      );
    } catch (error) {
      this.client.logger.error('Error creating license:', error);
      await interaction.reply({
        content: '❌ Failed to create license. Please try again.',
        ephemeral: true,
      });
    }
  }
}
