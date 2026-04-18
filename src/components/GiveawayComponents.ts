import {
  ButtonInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalSubmitInteraction,
  StringSelectMenuInteraction
} from 'discord.js';
import { Component } from '../client/structures/Component';
import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';
import { botConfig } from '../config/bot.config';

export default class GiveawayComponents extends Component {
  constructor(client: KorexClient) {
    super(client, {
      customId: 'giveaway_*',
      type: 'button'
    });
  }

  async execute(interaction: ButtonInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const customId = interaction.customId;

    // Parse custom ID
    const parts = customId.split('_');
    const action = parts[1]; // join, leave, info, setup, create
    const target = parts[2]; // giveaway ID or setup type
    const userId = parts[3]; // for setup actions

    // Check if user is authorized for setup actions
    if (['setup', 'create'].includes(action) && userId !== interaction.user.id) {
      await interaction.reply({
        content: i18n.t('errors.not_authorized', guildId),
        ephemeral: true
      });

      return;
    }

    switch (action) {
      case 'join':
        await this.handleJoin(interaction, target);
        break;
      case 'leave':
        await this.handleLeave(interaction, target);
        break;
      case 'info':
        await this.handleInfo(interaction, target);
        break;
      case 'setup':
        await this.handleSetup(interaction, target, userId);
        break;
      case 'create':
        await this.handleCreateConfirm(interaction, target, userId);
        break;
      default:
        await interaction.reply({
          content: i18n.t('errors.unknown_action', guildId),
          ephemeral: true
        });
    }
  }

  private async handleJoin(interaction: ButtonInteraction, giveawayId: string): Promise<void> {
    const guildId = interaction.guildId!;
    const member = interaction.member!;

    await interaction.deferReply({ ephemeral: true });

    const result = await this.client.giveawayService.joinGiveaway(
      giveawayId,
      interaction.user,
      member as any
    );

    if (result.success) {
      const entriesText = result.entries === 1 
        ? i18n.t('giveaways.join.success_single', guildId)
        : i18n.t('giveaways.join.success_multiple', guildId, { entries: (result.entries || 1).toString() });

      await interaction.editReply({
        content: `✅ ${entriesText}`
      });
    } else {
      let errorMessage: string;
      
      switch (result.reason) {
        case 'Already participating':
          errorMessage = i18n.t('giveaways.join.already_participating', guildId);
          break;
        case 'Giveaway has ended':
          errorMessage = i18n.t('giveaways.join.ended', guildId);
          break;
        case 'Missing required role':
          errorMessage = i18n.t('giveaways.join.missing_role', guildId);
          break;
        default:
          errorMessage = i18n.t('giveaways.join.requirements_not_met', guildId);
      }

      await interaction.editReply({
        content: `❌ ${errorMessage}`
      });
    }
  }

  private async handleLeave(interaction: ButtonInteraction, giveawayId: string): Promise<void> {
    const guildId = interaction.guildId!;
    const member = interaction.member!;

    await interaction.deferReply({ ephemeral: true });

    const result = await this.client.giveawayService.leaveGiveaway(
      giveawayId,
      interaction.user,
      member as any
    );

    if (result.success) {
      await interaction.editReply({
        content: `✅ ${i18n.t('giveaways.leave.success', guildId)}`
      });
    } else {
      let errorMessage: string;
      
      switch (result.reason) {
        case 'Not participating':
          errorMessage = i18n.t('giveaways.leave.not_participating', guildId);
          break;
        case 'Giveaway has ended':
          errorMessage = i18n.t('giveaways.leave.ended', guildId);
          break;
        default:
          errorMessage = i18n.t('giveaways.leave.error', guildId);
      }

      await interaction.editReply({
        content: `❌ ${errorMessage}`
      });
    }
  }

  private async handleInfo(interaction: ButtonInteraction, giveawayId: string): Promise<void> {
    const guildId = interaction.guildId!;

    await interaction.reply({
      content: i18n.t('giveaways.info.not_implemented', guildId),
      ephemeral: true
    });
  }

  private async handleSetup(interaction: ButtonInteraction, setupType: string, userId: string): Promise<void> {
    const guildId = interaction.guildId!;

    // Get stored giveaway data
    const giveawayData = await this.client.cache.getTempData(`giveaway_setup_${userId}`);

    if (!giveawayData) {
      await interaction.reply({
        content: i18n.t('giveaways.setup.expired', guildId),
        ephemeral: true
      });

      return;
    }

    switch (setupType) {
      case 'requirements':
        await this.showRequirementsModal(interaction, userId);
        break;
      case 'bonus':
        await this.showBonusModal(interaction, userId);
        break;
      default:
        await interaction.reply({
          content: i18n.t('errors.unknown_setup_type', guildId),
          ephemeral: true
        });
    }
  }

  private async handleCreateConfirm(interaction: ButtonInteraction, action: string, userId: string): Promise<void> {
    const guildId = interaction.guildId!;
    const guild = interaction.guild!;

    if (action === 'cancel') {
      await this.client.cache.deleteTempData(`giveaway_setup_${userId}`);
      await interaction.update({
        content: i18n.t('giveaways.setup.cancelled', guildId),
        embeds: [],
        components: []
      });

      return;
    }

    // Get stored giveaway data
    const giveawayData = await this.client.cache.getTempData(`giveaway_setup_${userId}`);

    if (!giveawayData) {
      await interaction.reply({
        content: i18n.t('giveaways.setup.expired', guildId),
        ephemeral: true
      });

      return;
    }

    await interaction.deferUpdate();

    try {
      const channel = guild.channels.cache.get((giveawayData as any).channel);

      if (!channel || !channel.isTextBased()) {
        await interaction.editReply({
          content: i18n.t('giveaways.setup.invalid_channel', guildId),
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

      // Create the giveaway
      const giveaway = await this.client.giveawayService.createGiveaway(
        guild,
        channel as any,
        member,
        giveawayData as any
      );

      if (giveaway) {
        await interaction.editReply({
          content: i18n.t('giveaways.setup.created', guildId, { 
            id: giveaway.id,
            channel: channel.toString()
          }),
          embeds: [],
          components: []
        });

        // Clean up cache
        await this.client.cache.deleteTempData(`giveaway_setup_${userId}`);
      } else {
        await interaction.editReply({
          content: i18n.t('giveaways.setup.failed', guildId),
          embeds: [],
          components: []
        });
      }

    } catch (error) {
      await interaction.editReply({
        content: i18n.t('giveaways.setup.error', guildId),
        embeds: [],
        components: []
      });
    }
  }

  private async showRequirementsModal(interaction: ButtonInteraction, userId: string): Promise<void> {
    const guildId = interaction.guildId!;

    const modal = new ModalBuilder()
      .setCustomId(`giveaway_requirements_${userId}`)
      .setTitle(i18n.t('giveaways.modals.requirements.title', guildId));

    const roleInput = new TextInputBuilder()
      .setCustomId('required_roles')
      .setLabel(i18n.t('giveaways.modals.requirements.roles_label', guildId))
      .setPlaceholder(i18n.t('giveaways.modals.requirements.roles_placeholder', guildId))
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    const levelInput = new TextInputBuilder()
      .setCustomId('required_level')
      .setLabel(i18n.t('giveaways.modals.requirements.level_label', guildId))
      .setPlaceholder(i18n.t('giveaways.modals.requirements.level_placeholder', guildId))
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    const messagesInput = new TextInputBuilder()
      .setCustomId('required_messages')
      .setLabel(i18n.t('giveaways.modals.requirements.messages_label', guildId))
      .setPlaceholder(i18n.t('giveaways.modals.requirements.messages_placeholder', guildId))
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    const balanceInput = new TextInputBuilder()
      .setCustomId('required_balance')
      .setLabel(i18n.t('giveaways.modals.requirements.balance_label', guildId))
      .setPlaceholder(i18n.t('giveaways.modals.requirements.balance_placeholder', guildId))
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(roleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(levelInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(messagesInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(balanceInput)
    );

    await interaction.showModal(modal);
  }

  private async showBonusModal(interaction: ButtonInteraction, userId: string): Promise<void> {
    const guildId = interaction.guildId!;

    const modal = new ModalBuilder()
      .setCustomId(`giveaway_bonus_${userId}`)
      .setTitle(i18n.t('giveaways.modals.bonus.title', guildId));

    const bonusInput = new TextInputBuilder()
      .setCustomId('bonus_roles')
      .setLabel(i18n.t('giveaways.modals.bonus.roles_label', guildId))
      .setPlaceholder(i18n.t('giveaways.modals.bonus.roles_placeholder', guildId))
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(bonusInput)
    );

    await interaction.showModal(modal);
  }
}

// Modal handler for requirements
export class GiveawayRequirementsModal extends Component {
  constructor(client: KorexClient) {
    super(client, {
      customId: 'giveaway_requirements',
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

    // Get stored giveaway data
    const giveawayData = await this.client.cache.getTempData(`giveaway_setup_${userId}`);

    if (!giveawayData) {
      await interaction.reply({
        content: i18n.t('giveaways.setup.expired', guildId),
        ephemeral: true
      });

      return;
    }

    // Parse requirements
    const requirements: any[] = [];
    
    const requiredRoles = interaction.fields.getTextInputValue('required_roles');
    const requiredLevel = interaction.fields.getTextInputValue('required_level');
    const requiredMessages = interaction.fields.getTextInputValue('required_messages');
    const requiredBalance = interaction.fields.getTextInputValue('required_balance');

    if (requiredRoles) {
      const roleIds = requiredRoles.match(/\d{17,19}/g) || [];

      roleIds.forEach(roleId => {
        requirements.push({ type: 'role', value: roleId });
      });
    }

    if (requiredLevel && !isNaN(parseInt(requiredLevel))) {
      requirements.push({ type: 'level', value: parseInt(requiredLevel) });
    }

    if (requiredMessages && !isNaN(parseInt(requiredMessages))) {
      requirements.push({ type: 'messages', value: parseInt(requiredMessages) });
    }

    if (requiredBalance && !isNaN(parseInt(requiredBalance))) {
      requirements.push({ type: 'balance', value: parseInt(requiredBalance) });
    }

    // Update giveaway data
    const updatedData = { ...(giveawayData as any), requirements };

    await this.client.cache.setTempData(`giveaway_setup_${userId}`, updatedData, 300);

    await interaction.reply({
      content: i18n.t('giveaways.setup.requirements_added', guildId, { count: requirements.length.toString() }),
      ephemeral: true
    });
  }
}

// Modal handler for bonus entries
export class GiveawayBonusModal extends Component {
  constructor(client: KorexClient) {
    super(client, {
      customId: 'giveaway_bonus',
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

    // Get stored giveaway data
    const giveawayData = await this.client.cache.getTempData(`giveaway_setup_${userId}`);

    if (!giveawayData) {
      await interaction.reply({
        content: i18n.t('giveaways.setup.expired', guildId),
        ephemeral: true
      });

      return;
    }

    // Parse bonus entries
    const bonusEntries: any[] = [];
    const bonusRoles = interaction.fields.getTextInputValue('bonus_roles');

    if (bonusRoles) {
      const lines = bonusRoles.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        const match = line.match(/(<@&)?(\d{17,19})>?\s*[:\-=]\s*(\d+)/);

        if (match) {
          const roleId = match[2];
          const entries = parseInt(match[3]);
          
          if (!isNaN(entries) && entries > 0) {
            bonusEntries.push({ roleId, entries });
          }
        }
      }
    }

    // Update giveaway data
    const updatedData = { ...(giveawayData as any), bonusEntries };

    await this.client.cache.setTempData(`giveaway_setup_${userId}`, updatedData, 300);

    await interaction.reply({
      content: i18n.t('giveaways.setup.bonus_added', guildId, { count: bonusEntries.length.toString() }),
      ephemeral: true
    });
  }
}