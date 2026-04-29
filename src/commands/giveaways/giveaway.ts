import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  TextChannel,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  SlashCommandSubcommandsOnlyBuilder
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { botConfig } from '../../config/bot.config';

export default class GiveawayCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'giveaway',
      description: 'Manage server giveaways',
      category: 'giveaways',
      cooldown: 10,
      permissions: {
        user: [PermissionFlagsBits.ManageMessages],
        bot: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]
      }
    });
  }

  data(): SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription(i18n.t(`commands.${this.name}.description`, 'global'))
      .addSubcommand(subcommand =>
        subcommand
          .setName('create')
          .setDescription(i18n.t('commands.giveaway.create.description', 'global'))
          .addStringOption(option =>
            option
              .setName('prize')
              .setDescription(i18n.t('commands.giveaway.create.options.prize', 'global'))
              .setRequired(true)
              .setMaxLength(100)
          )
          .addIntegerOption(option =>
            option
              .setName('duration')
              .setDescription(i18n.t('commands.giveaway.create.options.duration', 'global'))
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(168) // 1 week max
          )
          .addChannelOption(option =>
            option
              .setName('channel')
              .setDescription(i18n.t('commands.giveaway.create.options.channel', 'global'))
              .addChannelTypes(ChannelType.GuildText)
          )
          .addIntegerOption(option =>
            option
              .setName('winners')
              .setDescription(i18n.t('commands.giveaway.create.options.winners', 'global'))
              .setMinValue(1)
              .setMaxValue(10)
          )
          .addStringOption(option =>
            option
              .setName('title')
              .setDescription(i18n.t('commands.giveaway.create.options.title', 'global'))
              .setMaxLength(100)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('end')
          .setDescription(i18n.t('commands.giveaway.end.description', 'global'))
          .addStringOption(option =>
            option
              .setName('id')
              .setDescription(i18n.t('commands.giveaway.end.options.id', 'global'))
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('reroll')
          .setDescription(i18n.t('commands.giveaway.reroll.description', 'global'))
          .addStringOption(option =>
            option
              .setName('id')
              .setDescription(i18n.t('commands.giveaway.reroll.options.id', 'global'))
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('list')
          .setDescription(i18n.t('commands.giveaway.list.description', 'global'))
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('info')
          .setDescription(i18n.t('commands.giveaway.info.description', 'global'))
          .addStringOption(option =>
            option
              .setName('id')
              .setDescription(i18n.t('commands.giveaway.info.options.id', 'global'))
              .setRequired(true)
          )
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const subcommand = interaction.options.data[0]?.name;

    switch (subcommand) {
      case 'create':
        await this.handleCreate(interaction);
        break;
      case 'end':
        await this.handleEnd(interaction);
        break;
      case 'reroll':
        await this.handleReroll(interaction);
        break;
      case 'list':
        await this.handleList(interaction);
        break;
      case 'info':
        await this.handleInfo(interaction);
        break;
      default:
        await interaction.reply({
          content: i18n.t('errors.invalid_subcommand', guildId),
          ephemeral: true
        });
    }
  }

  private async handleCreate(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const guild = interaction.guild!;
    const member = interaction.member!;

    // Get options
    const prize = interaction.options.get('prize')?.value as string;
    const duration = interaction.options.get('duration')?.value as number; // hours
    const channel = (interaction.options.get('channel')?.channel as TextChannel) || interaction.channel as TextChannel;
    const winners = (interaction.options.get('winners')?.value as number) || 1;
    const title = (interaction.options.get('title')?.value as string) || i18n.t('giveaways.default_title', guildId);

    // Get requirement options
    const requiredRole = interaction.options.get('required_role')?.role;
    const requiredLevel = interaction.options.get('required_level')?.value as number | undefined;
    const requiredInvites = interaction.options.get('required_invites')?.value as number | undefined;
    const requiredBalance = interaction.options.get('required_balance')?.value as number | undefined;

    // Build requirements array
    const requirements: { type: string; value: string | number; operator?: string }[] = [];

    if (requiredRole) requirements.push({ type: 'role', value: requiredRole.id });
    if (requiredLevel) requirements.push({ type: 'level', value: requiredLevel, operator: 'gte' });
    if (requiredInvites) requirements.push({ type: 'invites', value: requiredInvites, operator: 'gte' });
    if (requiredBalance) requirements.push({ type: 'balance', value: requiredBalance, operator: 'gte' });

    // Check if channel is valid
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: i18n.t('commands.giveaway.create.errors.invalid_channel', guildId),
        ephemeral: true
      });

      return;
    }

    // Check bot permissions in target channel
    const botPermissions = channel.permissionsFor(guild.members.me!);

    if (!botPermissions?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      await interaction.reply({
        content: i18n.t('commands.giveaway.create.errors.no_permissions', guildId),
        ephemeral: true
      });

      return;
    }

    // Check active giveaway limit
    const activeCount = await this.client.giveawayService.getActiveGiveawayCount(guildId);

    if (activeCount >= botConfig.limits.giveaways) {
      await interaction.reply({
        content: i18n.t('commands.giveaway.create.errors.limit_reached', guildId, { 
          limit: botConfig.limits.giveaways.toString()
        }),
        ephemeral: true
      });

      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      // Show setup wizard
      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.primary)
        .setTitle(i18n.t('commands.giveaway.create.wizard.title', guildId))
        .setDescription(i18n.t('commands.giveaway.create.wizard.description', guildId))
        .addFields(
          {
            name: i18n.t('giveaways.embed.prize', guildId),
            value: prize,
            inline: true
          },
          {
            name: i18n.t('giveaways.embed.duration', guildId),
            value: i18n.t('giveaways.duration_hours', guildId, { hours: duration.toString() }),
            inline: true
          },
          {
            name: i18n.t('giveaways.embed.winners', guildId),
            value: winners.toString(),
            inline: true
          },
          {
            name: i18n.t('giveaways.embed.channel', guildId),
            value: channel.toString(),
            inline: true
          }
        );

      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`giveaway_setup_requirements_${interaction.user.id}`)
            .setLabel(i18n.t('commands.giveaway.create.wizard.add_requirements', guildId))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⚙️'),
          new ButtonBuilder()
            .setCustomId(`giveaway_setup_bonus_${interaction.user.id}`)
            .setLabel(i18n.t('commands.giveaway.create.wizard.add_bonus', guildId))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⭐'),
          new ButtonBuilder()
            .setCustomId(`giveaway_create_confirm_${interaction.user.id}`)
            .setLabel(i18n.t('commands.giveaway.create.wizard.create', guildId))
            .setStyle(ButtonStyle.Success)
            .setEmoji('🎉'),
          new ButtonBuilder()
            .setCustomId(`giveaway_create_cancel_${interaction.user.id}`)
            .setLabel(i18n.t('buttons.cancel', guildId))
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌')
        );

      await interaction.editReply({
        embeds: [embed],
        components: [row]
      });

      // Store giveaway data temporarily
      await this.client.cache.setTempData(`giveaway_setup_${interaction.user.id}`, {
        prize,
        duration: duration * 60 * 60 * 1000, // Convert to milliseconds
        channel: channel.id,
        winners,
        title,
        requirements,
        bonusEntries: [],
        hostId: interaction.user.id
      }, 300); // 5 minutes

    } catch (error) {
      await interaction.editReply({
        content: i18n.t('commands.giveaway.create.errors.failed', guildId)
      });
    }
  }

  private async handleEnd(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const giveawayId = interaction.options.get('id')?.value as string;

    await interaction.deferReply({ ephemeral: true });

    const success = await this.client.giveawayService.endGiveaway(giveawayId, true);

    if (success) {
      await interaction.editReply({
        content: i18n.t('commands.giveaway.end.success', guildId, { id: giveawayId })
      });
    } else {
      await interaction.editReply({
        content: i18n.t('commands.giveaway.end.error', guildId)
      });
    }
  }

  private async handleReroll(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const giveawayId = interaction.options.get('id')?.value as string;

    await interaction.reply({
      content: i18n.t('commands.giveaway.reroll.not_implemented', guildId),
      ephemeral: true
    });
  }

  private async handleList(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;

    await interaction.deferReply({ ephemeral: true });

    const giveaways = await this.client.giveawayService.getGuildGiveaways(guildId);

    if (giveaways.length === 0) {
      await interaction.editReply({
        content: i18n.t('commands.giveaway.list.no_giveaways', guildId)
      });

      return;
    }

    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.primary)
      .setTitle(i18n.t('commands.giveaway.list.title', guildId))
      .setDescription(
        giveaways.map(g => 
          `**${g.id}** - ${g.prize} (${g.ended ? 
            i18n.t('giveaways.status.ended', guildId) : 
            i18n.t('giveaways.status.active', guildId)
          })`
        ).join('\n')
      );

    if (this.client.user?.displayAvatarURL()) {
      embed.setFooter({
        text: i18n.t('commands.giveaway.list.footer', guildId, { count: giveaways.length.toString() }),
        iconURL: this.client.user.displayAvatarURL()
      });
    } else {
      embed.setFooter({
        text: i18n.t('commands.giveaway.list.footer', guildId, { count: giveaways.length.toString() })
      });
    }

    await interaction.editReply({ embeds: [embed] });
  }

  private async handleInfo(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const giveawayId = interaction.options.get('id')?.value as string;

    await interaction.reply({
      content: i18n.t('commands.giveaway.info.not_implemented', guildId),
      ephemeral: true
    });
  }
}