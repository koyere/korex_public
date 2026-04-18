import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  TextChannel
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { botConfig } from '../../config/bot.config';
import type { Suggestion, SuggestionService } from '../../services/SuggestionService';

export default class SuggestionsCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'suggestions',
      description: 'Manage the suggestions system',
      category: 'admin',
      permissions: {
        user: [PermissionFlagsBits.ManageGuild],
        bot: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageChannels]
      }
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription(i18n.t(`commands.${this.name}.description`, 'global'))
      .addSubcommand(subcommand =>
        subcommand
          .setName('config')
          .setDescription(i18n.t(`commands.${this.name}.config.description`, 'global'))
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('setup')
          .setDescription(i18n.t(`commands.${this.name}.setup.description`, 'global'))
          .addChannelOption(option =>
            option
              .setName('channel')
              .setDescription(i18n.t(`commands.${this.name}.setup.options.channel`, 'global'))
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('view')
          .setDescription(i18n.t(`commands.${this.name}.view.description`, 'global'))
          .addStringOption(option =>
            option
              .setName('status')
              .setDescription(i18n.t(`commands.${this.name}.view.options.status`, 'global'))
              .addChoices(
                { name: 'New', value: 'new' },
                { name: 'Reviewing', value: 'reviewing' },
                { name: 'Approved', value: 'approved' },
                { name: 'Rejected', value: 'rejected' },
                { name: 'Considering', value: 'considering' },
                { name: 'In Progress', value: 'in_progress' },
                { name: 'Completed', value: 'completed' }
              )
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('stats')
          .setDescription(i18n.t(`commands.${this.name}.stats.description`, 'global'))
      ) as SlashCommandBuilder;
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const subcommand = interaction.options.data[0]?.name;

    const suggestionService = this.client.suggestionService;

    if (!suggestionService) {
      await interaction.reply({
        content: i18n.t('suggestions.errors.service_unavailable', guildId),
        ephemeral: true
      });

      return;
    }

    switch (subcommand) {
      case 'config':
        await this.handleConfig(interaction, suggestionService);
        break;
      case 'setup':
        await this.handleSetup(interaction, suggestionService);
        break;
      case 'view':
        await this.handleView(interaction, suggestionService);
        break;
      case 'stats':
        await this.handleStats(interaction, suggestionService);
        break;
      default:
        await this.handleConfig(interaction, suggestionService);
    }
  }

  private async handleConfig(interaction: ChatInputCommandInteraction, suggestionService: SuggestionService): Promise<void> {
    const guildId = interaction.guildId!;
    const config = await suggestionService.getConfig(guildId);

    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.primary)
      .setTitle(i18n.t('suggestions.config.title', guildId))
      .setDescription(i18n.t('suggestions.config.description', guildId))
      .addFields(
        {
          name: i18n.t('suggestions.config.enabled', guildId),
          value: config.enabled ? '✅ Enabled' : '❌ Disabled',
          inline: true
        },
        {
          name: i18n.t('suggestions.config.channel', guildId),
          value: config.channelId ? `<#${config.channelId}>` : i18n.t('common.none', guildId),
          inline: true
        },
        {
          name: i18n.t('suggestions.config.cooldown', guildId),
          value: `${config.cooldown} seconds`,
          inline: true
        },
        {
          name: i18n.t('suggestions.config.auto_threads', guildId),
          value: config.autoCreateThreads ? '✅ Yes' : '❌ No',
          inline: true
        },
        {
          name: i18n.t('suggestions.config.vote_threshold', guildId),
          value: config.voteThreshold.toString(),
          inline: true
        },
        {
          name: i18n.t('suggestions.config.notify_author', guildId),
          value: config.notifyAuthor ? '✅ Yes' : '❌ No',
          inline: true
        }
      )
      .setTimestamp();

    const buttons = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('suggestions_toggle')
          .setLabel(config.enabled ? 'Disable' : 'Enable')
          .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
          .setEmoji(config.enabled ? '❌' : '✅'),
        new ButtonBuilder()
          .setCustomId('suggestions_settings')
          .setLabel('Settings')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('⚙️'),
        new ButtonBuilder()
          .setCustomId('suggestions_roles')
          .setLabel('Manage Roles')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('👥')
      );

    await interaction.reply({
      embeds: [embed],
      components: [buttons],
      ephemeral: true
    });
  }

  private async handleSetup(interaction: ChatInputCommandInteraction, suggestionService: SuggestionService): Promise<void> {
    const guildId = interaction.guildId!;
    const channel = interaction.options.get('channel')?.channel;

    if (!channel) {
      await interaction.reply({
        content: i18n.t('suggestions.setup.invalid_channel', guildId),
        ephemeral: true
      });

      return;
    }

    try {
      await suggestionService.updateConfig(guildId, {
        enabled: true,
        channelId: channel.id
      });

      // Send panel to the suggestions channel
      const textChannel = interaction.guild!.channels.cache.get(channel.id) as TextChannel;
      if (textChannel?.isTextBased()) {
        const panelEmbed = new EmbedBuilder()
          .setColor(botConfig.colors.primary)
          .setTitle(i18n.t('suggestions.setup.panel.title', guildId))
          .setDescription(i18n.t('suggestions.setup.panel.description', guildId))
          .addFields(
            {
              name: i18n.t('suggestions.setup.panel.how_it_works', guildId),
              value: i18n.t('suggestions.setup.panel.how_it_works_value', guildId)
            },
            {
              name: i18n.t('suggestions.setup.panel.voting', guildId),
              value: i18n.t('suggestions.setup.panel.voting_value', guildId)
            }
          )
          .setFooter({ text: i18n.t('suggestions.setup.panel.footer', guildId) })
          .setTimestamp();

        const suggestButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId('suggestion_open_form')
            .setLabel('/suggest')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('💡')
        );

        await textChannel.send({ embeds: [panelEmbed], components: [suggestButton] });
      }

      // Confirm to admin (ephemeral)
      const confirmEmbed = new EmbedBuilder()
        .setColor(botConfig.colors.success)
        .setTitle(i18n.t('suggestions.setup.success.title', guildId))
        .setDescription(i18n.t('suggestions.setup.success.description', guildId, {
          channel: channel.toString()
        }))
        .addFields(
          {
            name: i18n.t('suggestions.setup.next_steps', guildId),
            value: i18n.t('suggestions.setup.next_steps_description', guildId)
          }
        )
        .setTimestamp();

      await interaction.reply({
        embeds: [confirmEmbed],
        ephemeral: true
      });

    } catch (error) {
      this.client.logger.error('Error setting up suggestions:', error);
      await interaction.reply({
        content: i18n.t('suggestions.setup.error', guildId),
        ephemeral: true
      });
    }
  }

  private async handleView(interaction: ChatInputCommandInteraction, suggestionService: SuggestionService): Promise<void> {
    const guildId = interaction.guildId!;
    const status = interaction.options.get('status')?.value as Suggestion['status'] | undefined;

    const suggestions = status 
      ? suggestionService.getSuggestionsByStatus(guildId, status)
      : suggestionService.getSuggestionsByGuild(guildId);

    if (suggestions.length === 0) {
      await interaction.reply({
        content: i18n.t('suggestions.view.no_suggestions', guildId),
        ephemeral: true
      });

      return;
    }

    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.primary)
      .setTitle(i18n.t('suggestions.view.title', guildId))
      .setDescription(i18n.t('suggestions.view.description', guildId, {
        count: suggestions.length.toString(),
        status: status ? i18n.t(`suggestions.statuses.${status}`, guildId) : 'All'
      }))
      .setTimestamp();

    // Show first 10 suggestions
    const displaySuggestions = suggestions.slice(0, 10);

    for (const suggestion of displaySuggestions) {
      embed.addFields({
        name: `${suggestion.title} (ID: ${suggestion.id})`,
        value: `**Status:** ${i18n.t(`suggestions.statuses.${suggestion.status}`, guildId)}\n` +
               `**Category:** ${i18n.t(`suggestions.categories.${suggestion.category}`, guildId)}\n` +
               `**Votes:** 👍 ${suggestion.votes.upvotes.length} | 👎 ${suggestion.votes.downvotes.length} | 🤷 ${suggestion.votes.neutral.length}\n` +
               `**Created:** <t:${Math.floor(suggestion.createdAt.getTime() / 1000)}:R>`,
        inline: false
      });
    }

    if (suggestions.length > 10) {
      embed.setFooter({
        text: i18n.t('suggestions.view.footer', guildId, {
          shown: '10',
          total: suggestions.length.toString()
        })
      });
    }

    await interaction.reply({
      embeds: [embed],
      ephemeral: true
    });
  }

  private async handleStats(interaction: ChatInputCommandInteraction, suggestionService: SuggestionService): Promise<void> {
    const guildId = interaction.guildId!;
    const suggestions = suggestionService.getSuggestionsByGuild(guildId);

    if (suggestions.length === 0) {
      await interaction.reply({
        content: i18n.t('suggestions.stats.no_data', guildId),
        ephemeral: true
      });

      return;
    }

    const stats = {
      total: suggestions.length,
      new: suggestions.filter((s: Suggestion) => s.status === 'new').length,
      reviewing: suggestions.filter((s: Suggestion) => s.status === 'reviewing').length,
      approved: suggestions.filter((s: Suggestion) => s.status === 'approved').length,
      rejected: suggestions.filter((s: Suggestion) => s.status === 'rejected').length,
      considering: suggestions.filter((s: Suggestion) => s.status === 'considering').length,
      inProgress: suggestions.filter((s: Suggestion) => s.status === 'in_progress').length,
      completed: suggestions.filter((s: Suggestion) => s.status === 'completed').length
    };

    const totalVotes = suggestions.reduce((total: number, s: Suggestion) => 
      total + s.votes.upvotes.length + s.votes.downvotes.length + s.votes.neutral.length, 0
    );

    const averageVotes = suggestions.length > 0 ? (totalVotes / suggestions.length).toFixed(1) : '0';

    // Most active categories
    const categoryCount = suggestions.reduce((acc: Record<string, number>, s: Suggestion) => {
      acc[s.category] = (acc[s.category] || 0) + 1;

      return acc;
    }, {});

    const topCategory = Object.entries(categoryCount)
      .sort(([,a], [,b]) => (b as number) - (a as number))[0];

    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.primary)
      .setTitle(i18n.t('suggestions.stats.title', guildId))
      .setDescription(i18n.t('suggestions.stats.description', guildId))
      .addFields(
        {
          name: i18n.t('suggestions.stats.overview', guildId),
          value: `**Total:** ${stats.total}\n` +
                 `**Average Votes:** ${averageVotes}\n` +
                 `**Most Popular Category:** ${topCategory ? i18n.t(`suggestions.categories.${topCategory[0]}`, guildId) : 'None'}`,
          inline: false
        },
        {
          name: i18n.t('suggestions.stats.by_status', guildId),
          value: `🆕 **New:** ${stats.new}\n` +
                 `🔍 **Reviewing:** ${stats.reviewing}\n` +
                 `✅ **Approved:** ${stats.approved}\n` +
                 `❌ **Rejected:** ${stats.rejected}`,
          inline: true
        },
        {
          name: '\u200b',
          value: `🤔 **Considering:** ${stats.considering}\n` +
                 `🔨 **In Progress:** ${stats.inProgress}\n` +
                 `✔️ **Completed:** ${stats.completed}`,
          inline: true
        }
      )
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      ephemeral: true
    });
  }
}
