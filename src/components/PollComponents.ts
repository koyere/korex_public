import {
  ButtonInteraction,
  StringSelectMenuInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalSubmitInteraction
} from 'discord.js';
import { Component } from '../client/structures/Component';
import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';
import { botConfig } from '../config/bot.config';
import { buildConfirmPanel, PollSetupData } from '../utils/pollHelpers';

export default class PollComponents extends Component {
  constructor(client: KorexClient) {
    super(client, {
      customId: 'poll_*',
      type: 'button'
    });
  }

  async execute(interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const customId = interaction.customId;

    // Parse custom ID
    const parts = customId.split('_');
    const action = parts[1]; // vote, results, info, setup, create, dropdown
    const target = parts[2]; // poll ID or setup type
    const userId = parts[3]; // for setup actions

    // Check if user is authorized for setup actions
    if (['setup', 'create', 'toggle'].includes(action) && userId !== interaction.user.id) {
      await interaction.reply({
        content: i18n.t('errors.not_authorized', guildId),
        ephemeral: true
      });

      return;
    }

    switch (action) {
      case 'vote':
        if (interaction.isButton()) {
          const optionId = parts.slice(3).join('_'); // option IDs may contain underscores (e.g. option_0)
          await this.handleVote(interaction, target, optionId);
        }
        break;
      case 'dropdown':
        if (interaction.isStringSelectMenu()) {
          await this.handleDropdownVote(interaction, target);
        }
        break;
      case 'results':
        await this.handleResults(interaction, target);
        break;
      case 'info':
        await this.handleInfo(interaction, target);
        break;
      case 'setup':
        if (interaction.isButton()) {
          await this.handleSetup(interaction, target, userId);
        }
        break;
      case 'toggle':
        if (interaction.isButton()) {
          await this.handleToggle(interaction, target, userId);
        }
        break;
      case 'create':
        if (interaction.isButton()) {
          await this.handleCreateConfirm(interaction, target, userId);
        }
        break;
      default:
        await interaction.reply({
          content: i18n.t('errors.unknown_action', guildId),
          ephemeral: true
        });
    }
  }

  private async handleVote(interaction: ButtonInteraction, pollId: string, optionId: string): Promise<void> {
    const guildId = interaction.guildId!;
    const member = interaction.member!;

    await interaction.deferReply({ ephemeral: true });

    const result = await this.client.pollService.vote(
      pollId,
      interaction.user,
      member as any,
      [optionId]
    );

    if (result.success) {
      await interaction.editReply({
        content: `✅ ${i18n.t('polls.vote.success', guildId)}`
      });

      // Show results if configured
      if (result.results) {
        const resultsEmbed = this.createResultsEmbed(result.results, guildId);

        await interaction.followUp({
          embeds: [resultsEmbed],
          ephemeral: true
        });
      }
    } else {
      let errorMessage: string;
      
      switch (result.reason) {
        case 'Poll has ended':
          errorMessage = i18n.t('polls.vote.ended', guildId);
          break;
        case 'Vote change not allowed':
          errorMessage = i18n.t('polls.vote.change_not_allowed', guildId);
          break;
        case 'Missing required role':
          errorMessage = i18n.t('polls.vote.missing_role', guildId);
          break;
        case 'Invalid option selected':
        case 'No options selected':
          errorMessage = i18n.t('polls.vote.invalid_option', guildId);
          break;
        default:
          errorMessage = i18n.t('polls.vote.requirements_not_met', guildId);
      }

      await interaction.editReply({
        content: `❌ ${errorMessage}`
      });
    }
  }

  private async handleDropdownVote(interaction: StringSelectMenuInteraction, pollId: string): Promise<void> {
    const guildId = interaction.guildId!;
    const member = interaction.member!;
    const selectedOptions = interaction.values;

    await interaction.deferReply({ ephemeral: true });

    const result = await this.client.pollService.vote(
      pollId,
      interaction.user,
      member as any,
      selectedOptions
    );

    if (result.success) {
      const optionCount = selectedOptions.length;
      const message = optionCount === 1 
        ? i18n.t('polls.vote.success_single', guildId)
        : i18n.t('polls.vote.success_multiple', guildId, { count: optionCount.toString() });

      await interaction.editReply({
        content: `✅ ${message}`
      });

      // Show results if configured
      if (result.results) {
        const resultsEmbed = this.createResultsEmbed(result.results, guildId);

        await interaction.followUp({
          embeds: [resultsEmbed],
          ephemeral: true
        });
      }
    } else {
      let errorMessage: string;
      
      switch (result.reason) {
        case 'Poll has ended':
          errorMessage = i18n.t('polls.vote.ended', guildId);
          break;
        case 'Vote change not allowed':
          errorMessage = i18n.t('polls.vote.change_not_allowed', guildId);
          break;
        case 'Multiple choices not allowed':
          errorMessage = i18n.t('polls.vote.multiple_not_allowed', guildId);
          break;
        case 'Missing required role':
          errorMessage = i18n.t('polls.vote.missing_role', guildId);
          break;
        case 'Invalid option selected':
        case 'No options selected':
          errorMessage = i18n.t('polls.vote.invalid_option', guildId);
          break;
        default:
          errorMessage = i18n.t('polls.vote.requirements_not_met', guildId);
      }

      await interaction.editReply({
        content: `❌ ${errorMessage}`
      });
    }
  }

  private async handleResults(interaction: ButtonInteraction | StringSelectMenuInteraction, pollId: string): Promise<void> {
    const guildId = interaction.guildId!;

    await interaction.deferReply({ ephemeral: true });

    const results = await this.client.pollService.getPollResults(pollId);

    if (!results) {
      await interaction.editReply({
        content: i18n.t('polls.results.not_found', guildId)
      });

      return;
    }

    const embed = this.createResultsEmbed(results, guildId);

    await interaction.editReply({ embeds: [embed] });
  }

  private async handleInfo(interaction: ButtonInteraction | StringSelectMenuInteraction, pollId: string): Promise<void> {
    const guildId = interaction.guildId!;

    await interaction.reply({
      content: i18n.t('polls.info.not_implemented', guildId),
      ephemeral: true
    });
  }

  private async handleSetup(interaction: ButtonInteraction, setupType: string, userId: string): Promise<void> {
    const guildId = interaction.guildId!;

    // Get stored poll data
    const pollData = await this.client.cache.getTempData(`poll_setup_${userId}`);

    if (!pollData) {
      await interaction.reply({
        content: i18n.t('polls.setup.expired', guildId),
        ephemeral: true
      });

      return;
    }

    switch (setupType) {
      case 'restrictions':
        await this.showRestrictionsModal(interaction, userId);
        break;
      case 'settings':
        await this.showSettingsModal(interaction, userId);
        break;
      default:
        await interaction.reply({
          content: i18n.t('errors.unknown_setup_type', guildId),
          ephemeral: true
        });
    }
  }

  private async handleToggle(interaction: ButtonInteraction, setting: string, userId: string): Promise<void> {
    const guildId = interaction.guildId!;

    const setupData = await this.client.cache.getTempData(`poll_setup_${userId}`) as PollSetupData | null;

    if (!setupData) {
      await interaction.reply({
        content: i18n.t('polls.wizard.errors.session_expired', guildId),
        ephemeral: true
      });
      return;
    }

    if (setting === 'anon') {
      setupData.anonymous = !setupData.anonymous;
    } else if (setting === 'change') {
      setupData.allowChange = !setupData.allowChange;
    }

    await this.client.cache.setTempData(`poll_setup_${userId}`, setupData, 300);

    const panel = buildConfirmPanel(setupData, guildId);
    await interaction.update({ content: null, ...panel });
  }

  private async handleCreateConfirm(interaction: ButtonInteraction, action: string, userId: string): Promise<void> {
    const guildId = interaction.guildId!;
    const guild = interaction.guild!;

    if (action === 'cancel') {
      await this.client.cache.deleteTempData(`poll_setup_${userId}`);
      await this.client.cache.deleteTempData(`poll_setup_init_${userId}`);
      await interaction.update({
        content: i18n.t('polls.setup.cancelled', guildId),
        embeds: [],
        components: []
      });

      return;
    }

    // Get stored poll data
    const pollData = await this.client.cache.getTempData(`poll_setup_${userId}`) as PollSetupData | null;

    if (!pollData) {
      await interaction.reply({
        content: i18n.t('polls.setup.expired', guildId),
        ephemeral: true
      });

      return;
    }

    await interaction.deferUpdate();

    try {
      const channel = guild.channels.cache.get(pollData.channelId);

      if (!channel || !channel.isTextBased()) {
        await interaction.editReply({
          content: i18n.t('polls.setup.invalid_channel', guildId),
          embeds: [],
          components: []
        });

        return;
      }

      const member = guild.members.cache.get(userId);

      if (!member) {
        await interaction.editReply({
          content: i18n.t('errors.member_not_found', guildId),
          embeds: [],
          components: []
        });

        return;
      }

      // Create the poll — convert durationHours to endsAt since createPoll uses endsAt
      const pollCreateData: any = { ...pollData };
      if (pollData.durationHours && pollData.durationHours > 0) {
        pollCreateData.endsAt = new Date(Date.now() + pollData.durationHours * 60 * 60 * 1000);
      }

      const poll = await this.client.pollService.createPoll(
        guild,
        channel as any,
        member,
        pollCreateData
      );

      if (poll) {
        await interaction.editReply({
          content: i18n.t('polls.setup.created', guildId, {
            id: poll.id,
            channel: channel.toString()
          }),
          embeds: [],
          components: []
        });

        // Clean up cache
        await this.client.cache.deleteTempData(`poll_setup_${userId}`);
        await this.client.cache.deleteTempData(`poll_setup_init_${userId}`);
      } else {
        await interaction.editReply({
          content: i18n.t('polls.setup.failed', guildId),
          embeds: [],
          components: []
        });
      }

    } catch (error) {
      await interaction.editReply({
        content: i18n.t('polls.setup.error', guildId),
        embeds: [],
        components: []
      });
    }
  }

  private async showRestrictionsModal(interaction: ButtonInteraction, userId: string): Promise<void> {
    const guildId = interaction.guildId!;

    const modal = new ModalBuilder()
      .setCustomId(`poll_restrictions_${userId}`)
      .setTitle(i18n.t('polls.modals.restrictions.title', guildId));

    const roleInput = new TextInputBuilder()
      .setCustomId('required_roles')
      .setLabel(i18n.t('polls.modals.restrictions.roles_label', guildId))
      .setPlaceholder(i18n.t('polls.modals.restrictions.roles_placeholder', guildId))
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    const levelInput = new TextInputBuilder()
      .setCustomId('required_level')
      .setLabel(i18n.t('polls.modals.restrictions.level_label', guildId))
      .setPlaceholder(i18n.t('polls.modals.restrictions.level_placeholder', guildId))
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    const ageInput = new TextInputBuilder()
      .setCustomId('required_age')
      .setLabel(i18n.t('polls.modals.restrictions.age_label', guildId))
      .setPlaceholder(i18n.t('polls.modals.restrictions.age_placeholder', guildId))
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    const messagesInput = new TextInputBuilder()
      .setCustomId('required_messages')
      .setLabel(i18n.t('polls.modals.restrictions.messages_label', guildId))
      .setPlaceholder(i18n.t('polls.modals.restrictions.messages_placeholder', guildId))
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(roleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(levelInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(ageInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(messagesInput)
    );

    await interaction.showModal(modal);
  }

  private async showSettingsModal(interaction: ButtonInteraction, userId: string): Promise<void> {
    const guildId = interaction.guildId!;

    const modal = new ModalBuilder()
      .setCustomId(`poll_settings_${userId}`)
      .setTitle(i18n.t('polls.modals.settings.title', guildId));

    const showResultsInput = new TextInputBuilder()
      .setCustomId('show_results')
      .setLabel(i18n.t('polls.modals.settings.show_results_label', guildId))
      .setPlaceholder(i18n.t('polls.modals.settings.show_results_placeholder', guildId))
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(showResultsInput)
    );

    await interaction.showModal(modal);
  }

  private createResultsEmbed(results: any, guildId: string): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.primary)
      .setTitle(`📊 ${results.title}`)
      .setDescription(i18n.t('polls.results.description', guildId));

    // Add options with results
    const optionsText = results.options.map((option: any, index: number) => {
      const emoji = option.emoji || `${index + 1}️⃣`;
      const progressBar = this.createProgressBar(option.percentage);
      
      return `${emoji} **${option.text}**\n${progressBar} ${option.votes} votes (${option.percentage}%)`;
    }).join('\n\n');

    embed.addFields({
      name: i18n.t('polls.results.options', guildId),
      value: optionsText,
      inline: false
    });

    // Add statistics
    embed.addFields(
      {
        name: i18n.t('polls.results.total_votes', guildId),
        value: results.totalVotes.toString(),
        inline: true
      },
      {
        name: i18n.t('polls.results.participants', guildId),
        value: results.totalParticipants.toString(),
        inline: true
      }
    );

    // Add winner information
    if (results.winner) {
      if (results.winner.type === 'single') {
        embed.addFields({
          name: i18n.t('polls.results.winner', guildId),
          value: `🏆 ${results.winner.option.text}`,
          inline: false
        });
      } else if (results.winner.type === 'tie') {
        const winners = results.winner.options.map((opt: any) => opt.text).join(', ');

        embed.addFields({
          name: i18n.t('polls.results.tie', guildId),
          value: `🤝 ${winners}`,
          inline: false
        });
      }
    }

    if (results.ended) {
      embed.setColor(botConfig.colors.success);
      embed.addFields({
        name: i18n.t('polls.results.status', guildId),
        value: i18n.t('polls.status.ended', guildId),
        inline: false
      });
    }

    return embed;
  }

  private createProgressBar(percentage: number, length: number = 10): string {
    const filled = Math.round((percentage / 100) * length);
    const empty = length - filled;

    return '█'.repeat(filled) + '░'.repeat(empty);
  }
}

// Modal handler for restrictions
export class PollRestrictionsModal extends Component {
  constructor(client: KorexClient) {
    super(client, {
      customId: 'poll_restrictions',
      type: 'modal'
    });
  }

  async execute(interaction: ModalSubmitInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const userId = interaction.customId.split('_')[2];

    if (userId !== interaction.user.id) {
      await interaction.reply({
        content: i18n.t('errors.not_authorized', guildId),
        ephemeral: true
      });

      return;
    }

    // Get stored poll data
    const pollData = await this.client.cache.getTempData(`poll_setup_${userId}`);

    if (!pollData) {
      await interaction.reply({
        content: i18n.t('polls.setup.expired', guildId),
        ephemeral: true
      });

      return;
    }

    // Parse restrictions
    const restrictions: any[] = [];
    
    const requiredRoles = interaction.fields.getTextInputValue('required_roles');
    const requiredLevel = interaction.fields.getTextInputValue('required_level');
    const requiredAge = interaction.fields.getTextInputValue('required_age');
    const requiredMessages = interaction.fields.getTextInputValue('required_messages');

    if (requiredRoles) {
      const roleIds = requiredRoles.match(/\d{17,19}/g) || [];

      roleIds.forEach(roleId => {
        restrictions.push({ type: 'role', value: roleId });
      });
    }

    if (requiredLevel && !isNaN(parseInt(requiredLevel))) {
      restrictions.push({ type: 'level', value: parseInt(requiredLevel) });
    }

    if (requiredAge && !isNaN(parseInt(requiredAge))) {
      restrictions.push({ type: 'age', value: parseInt(requiredAge) });
    }

    if (requiredMessages && !isNaN(parseInt(requiredMessages))) {
      restrictions.push({ type: 'messages', value: parseInt(requiredMessages) });
    }

    // Update poll data
    const updatedData = { ...(pollData as any), restrictions };

    await this.client.cache.setTempData(`poll_setup_${userId}`, updatedData, 300);

    await interaction.reply({
      content: i18n.t('polls.setup.restrictions_added', guildId, { count: restrictions.length.toString() }),
      ephemeral: true
    });
  }
}

// Modal handler for settings
export class PollSettingsModal extends Component {
  constructor(client: KorexClient) {
    super(client, {
      customId: 'poll_settings',
      type: 'modal'
    });
  }

  async execute(interaction: ModalSubmitInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const userId = interaction.customId.split('_')[2];

    if (userId !== interaction.user.id) {
      await interaction.reply({
        content: i18n.t('errors.not_authorized', guildId),
        ephemeral: true
      });

      return;
    }

    // Get stored poll data
    const pollData = await this.client.cache.getTempData(`poll_setup_${userId}`);

    if (!pollData) {
      await interaction.reply({
        content: i18n.t('polls.setup.expired', guildId),
        ephemeral: true
      });

      return;
    }

    // Parse settings
    const showResults = interaction.fields.getTextInputValue('show_results');
    
    const settings = { ...(pollData as any).settings };
    
    if (showResults) {
      const validOptions = ['always', 'after_vote', 'after_end'];

      if (validOptions.includes(showResults.toLowerCase())) {
        settings.showResults = showResults.toLowerCase();
      }
    }

    // Update poll data
    const updatedData = { ...(pollData as any), settings };

    await this.client.cache.setTempData(`poll_setup_${userId}`, updatedData, 300);

    await interaction.reply({
      content: i18n.t('polls.setup.settings_updated', guildId),
      ephemeral: true
    });
  }
}