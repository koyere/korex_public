import { 
  Guild, 
  TextChannel, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  User,
  ButtonInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalSubmitInteraction,
  ThreadChannel
} from 'discord.js';
import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';

export interface Suggestion {
  id: string;
  guildId: string;
  authorId: string;
  title: string;
  description: string;
  category: 'feature' | 'improvement' | 'bug' | 'other';
  priority: 'low' | 'medium' | 'high';
  status: 'new' | 'reviewing' | 'approved' | 'rejected' | 'considering' | 'in_progress' | 'completed';
  votes: {
    upvotes: string[];
    downvotes: string[];
    neutral: string[];
  };
  staffNotes?: string;
  assignedTo?: string;
  createdAt: Date;
  updatedAt: Date;
  messageId?: string;
  threadId?: string;
}

export interface SuggestionConfig {
  guildId: string;
  enabled: boolean;
  channelId?: string;
  staffRoleIds: string[];
  voterRoleIds: string[];
  cooldown: number; // en segundos
  requireApproval: boolean;
  autoCreateThreads: boolean;
  voteThreshold: number;
  notifyAuthor: boolean;
}

export class SuggestionService {
  private client: KorexClient;
  private suggestions: Map<string, Suggestion> = new Map();
  private configs: Map<string, SuggestionConfig> = new Map();
  private cooldowns: Map<string, number> = new Map();

  constructor(client: KorexClient) {
    this.client = client;
    this.initialize();
  }

  async initialize(): Promise<void> {
    // Load configurations and suggestions from database
    await this.loadConfigurations();
    await this.loadSuggestions();
    console.log('SuggestionService initialized');
  }

  private async loadConfigurations(): Promise<void> {
    try {
      const rows = await this.client.db.guildConfig.findMany({
        where: { suggestionChannelId: { not: null } },
        select: { guildId: true, suggestionChannelId: true }
      });

      for (const row of rows) {
        this.configs.set(row.guildId, {
          guildId: row.guildId,
          enabled: true,
          channelId: row.suggestionChannelId!,
          staffRoleIds: [],
          voterRoleIds: [],
          cooldown: 300,
          requireApproval: false,
          autoCreateThreads: true,
          voteThreshold: 10,
          notifyAuthor: true
        });
      }

      console.log(`SuggestionService: loaded ${rows.length} guild config(s) from database`);
    } catch (error) {
      console.error('Error loading suggestion configurations:', error);
    }
  }

  private async loadSuggestions(): Promise<void> {
    try {
      // Load active suggestions from database when implemented
      // For now, start with empty map
    } catch (error) {
      console.error('Error loading suggestions:', error);
    }
  }

  getCooldown(key: string): number | undefined {
    return this.cooldowns.get(key);
  }

  async getConfig(guildId: string): Promise<SuggestionConfig> {
    if (!this.configs.has(guildId)) {
      // Try loading from DB before returning default
      try {
        const row = await this.client.db.guildConfig.findUnique({
          where: { guildId },
          select: { suggestionChannelId: true }
        });

        const config: SuggestionConfig = {
          guildId,
          enabled: !!row?.suggestionChannelId,
          channelId: row?.suggestionChannelId ?? undefined,
          staffRoleIds: [],
          voterRoleIds: [],
          cooldown: 300,
          requireApproval: false,
          autoCreateThreads: true,
          voteThreshold: 10,
          notifyAuthor: true
        };

        this.configs.set(guildId, config);
      } catch {
        this.configs.set(guildId, {
          guildId,
          enabled: false,
          staffRoleIds: [],
          voterRoleIds: [],
          cooldown: 300,
          requireApproval: false,
          autoCreateThreads: true,
          voteThreshold: 10,
          notifyAuthor: true
        });
      }
    }

    return this.configs.get(guildId)!;
  }

  async updateConfig(guildId: string, config: Partial<SuggestionConfig>): Promise<void> {
    const currentConfig = await this.getConfig(guildId);
    const updatedConfig = { ...currentConfig, ...config };

    this.configs.set(guildId, updatedConfig);

    // Persist channelId to database
    try {
      await this.client.db.guildConfig.upsert({
        where: { guildId },
        update: { suggestionChannelId: updatedConfig.enabled ? (updatedConfig.channelId ?? null) : null },
        create: { guildId, suggestionChannelId: updatedConfig.enabled ? (updatedConfig.channelId ?? null) : null }
      });
    } catch (error) {
      console.error('Error saving suggestion config to database:', error);
    }
  }

  async createSuggestion(
    guild: Guild,
    author: User,
    title: string,
    description: string,
    category: Suggestion['category'],
    priority: Suggestion['priority']
  ): Promise<Suggestion | null> {
    const config = await this.getConfig(guild.id);
    
    if (!config.enabled) {
      return null;
    }

    // Verificar cooldown
    const cooldownKey = `${guild.id}-${author.id}`;
    const lastSuggestion = this.cooldowns.get(cooldownKey);

    if (lastSuggestion && Date.now() - lastSuggestion < config.cooldown * 1000) {
      return null;
    }

    const suggestion: Suggestion = {
      id: this.generateId(),
      guildId: guild.id,
      authorId: author.id,
      title,
      description,
      category,
      priority,
      status: 'new',
      votes: {
        upvotes: [],
        downvotes: [],
        neutral: []
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.suggestions.set(suggestion.id, suggestion);
    this.cooldowns.set(cooldownKey, Date.now());

    // Enviar al canal de sugerencias
    if (config.channelId) {
      await this.postSuggestion(guild, suggestion);
    }

    return suggestion;
  }

  private async postSuggestion(guild: Guild, suggestion: Suggestion): Promise<void> {
    const config = await this.getConfig(guild.id);
    const channel = guild.channels.cache.get(config.channelId!) as TextChannel;
    
    if (!channel) return;

    const author = await this.client.users.fetch(suggestion.authorId);
    
    const embed = new EmbedBuilder()
      .setColor(this.getStatusColor(suggestion.status))
      .setTitle(`💡 ${suggestion.title}`)
      .setDescription(suggestion.description)
      .addFields(
        { 
          name: i18n.t('suggestions.embed.category', guild.id), 
          value: i18n.t(`suggestions.categories.${suggestion.category}`, guild.id), 
          inline: true 
        },
        { 
          name: i18n.t('suggestions.embed.priority', guild.id), 
          value: i18n.t(`suggestions.priorities.${suggestion.priority}`, guild.id), 
          inline: true 
        },
        { 
          name: i18n.t('suggestions.embed.status', guild.id), 
          value: i18n.t(`suggestions.statuses.${suggestion.status}`, guild.id), 
          inline: true 
        }
      )
      .setAuthor({ 
        name: author.tag, 
        iconURL: author.displayAvatarURL() 
      })
      .setFooter({ 
        text: i18n.t('suggestions.embed.footer', guild.id, { id: suggestion.id }) 
      })
      .setTimestamp();

    const voteRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`suggestion_vote_up_${suggestion.id}`)
          .setLabel(`👍 ${suggestion.votes.upvotes.length}`)
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`suggestion_vote_down_${suggestion.id}`)
          .setLabel(`👎 ${suggestion.votes.downvotes.length}`)
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`suggestion_vote_neutral_${suggestion.id}`)
          .setLabel(`🤷 ${suggestion.votes.neutral.length}`)
          .setStyle(ButtonStyle.Secondary)
      );

    const staffRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`suggestion_approve_${suggestion.id}`)
          .setLabel(i18n.t('suggestions.buttons.approve', guild.id))
          .setStyle(ButtonStyle.Success)
          .setEmoji('✅'),
        new ButtonBuilder()
          .setCustomId(`suggestion_reject_${suggestion.id}`)
          .setLabel(i18n.t('suggestions.buttons.reject', guild.id))
          .setStyle(ButtonStyle.Danger)
          .setEmoji('❌'),
        new ButtonBuilder()
          .setCustomId(`suggestion_consider_${suggestion.id}`)
          .setLabel(i18n.t('suggestions.buttons.consider', guild.id))
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🤔')
      );

    const components = [voteRow, staffRow];

    const message = await channel.send({
      embeds: [embed],
      components
    });

    suggestion.messageId = message.id;

    // Crear thread si está habilitado
    if (config.autoCreateThreads) {
      const thread = await message.startThread({
        name: `💬 ${suggestion.title.substring(0, 90)}`,
        autoArchiveDuration: 1440 // 24 horas
      });

      suggestion.threadId = thread.id;
    }

    this.suggestions.set(suggestion.id, suggestion);
  }

  async handleVote(interaction: ButtonInteraction): Promise<void> {
    const [, , voteType, suggestionId] = interaction.customId.split('_');
    const suggestion = this.suggestions.get(suggestionId);
    
    if (!suggestion) {
      await interaction.reply({
        content: i18n.t('suggestions.errors.not_found', interaction.guildId!),
        ephemeral: true
      });

      return;
    }

    const config = await this.getConfig(interaction.guildId!);
    
    // Verificar permisos de voto
    if (!this.canVote(interaction.member!, config)) {
      await interaction.reply({
        content: i18n.t('suggestions.errors.no_permission_vote', interaction.guildId!),
        ephemeral: true
      });

      return;
    }

    // Remover voto anterior si existe
    this.removeUserVote(suggestion, interaction.user.id);

    // Agregar nuevo voto
    switch (voteType) {
      case 'up':
        suggestion.votes.upvotes.push(interaction.user.id);
        break;
      case 'down':
        suggestion.votes.downvotes.push(interaction.user.id);
        break;
      case 'neutral':
        suggestion.votes.neutral.push(interaction.user.id);
        break;
    }

    suggestion.updatedAt = new Date();
    await this.updateSuggestionMessage(interaction.guild!, suggestion);

    await interaction.reply({
      content: i18n.t('suggestions.vote_recorded', interaction.guildId!),
      ephemeral: true
    });
  }

  async handleStaffAction(interaction: ButtonInteraction): Promise<void> {
    const [, action, suggestionId] = interaction.customId.split('_');
    const suggestion = this.suggestions.get(suggestionId);
    
    if (!suggestion) {
      await interaction.reply({
        content: i18n.t('suggestions.errors.not_found', interaction.guildId!),
        ephemeral: true
      });

      return;
    }

    const config = await this.getConfig(interaction.guildId!);
    
    if (!this.isStaffMember(interaction.guild!, interaction.user.id, config)) {
      await interaction.reply({
        content: i18n.t('suggestions.errors.no_permission_staff', interaction.guildId!),
        ephemeral: true
      });

      return;
    }

    // Mostrar modal para razón
    const modal = new ModalBuilder()
      .setCustomId(`suggestion_${action}_modal_${suggestionId}`)
      .setTitle(i18n.t(`suggestions.modals.${action}.title`, interaction.guildId!));

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel(i18n.t('suggestions.modals.reason_label', interaction.guildId!))
      .setPlaceholder(i18n.t('suggestions.modals.reason_placeholder', interaction.guildId!))
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));

    await interaction.showModal(modal);
  }

  async handleStaffModal(interaction: ModalSubmitInteraction): Promise<void> {
    const [, action, , suggestionId] = interaction.customId.split('_');
    const suggestion = this.suggestions.get(suggestionId);
    const reason = interaction.fields.getTextInputValue('reason');
    
    if (!suggestion) {
      await interaction.reply({
        content: i18n.t('suggestions.errors.not_found', interaction.guildId!),
        ephemeral: true
      });

      return;
    }

    // Actualizar estado
    switch (action) {
      case 'approve':
        suggestion.status = 'approved';
        break;
      case 'reject':
        suggestion.status = 'rejected';
        break;
      case 'consider':
        suggestion.status = 'considering';
        break;
    }

    suggestion.staffNotes = reason;
    suggestion.assignedTo = interaction.user.id;
    suggestion.updatedAt = new Date();

    await this.updateSuggestionMessage(interaction.guild!, suggestion);

    // Notificar al autor
    const config = await this.getConfig(interaction.guildId!);

    if (config.notifyAuthor) {
      await this.notifyAuthor(suggestion, action, reason);
    }

    await interaction.reply({
      content: i18n.t('suggestions.staff_action_success', interaction.guildId!, { action }),
      ephemeral: true
    });
  }

  private async updateSuggestionMessage(guild: Guild, suggestion: Suggestion): Promise<void> {
    const config = await this.getConfig(guild.id);
    const channel = guild.channels.cache.get(config.channelId!) as TextChannel;
    
    if (!channel || !suggestion.messageId) return;

    try {
      const message = await channel.messages.fetch(suggestion.messageId);
      const author = await this.client.users.fetch(suggestion.authorId);
      
      const embed = new EmbedBuilder()
        .setColor(this.getStatusColor(suggestion.status))
        .setTitle(`💡 ${suggestion.title}`)
        .setDescription(suggestion.description)
        .addFields(
          { 
            name: i18n.t('suggestions.embed.category', guild.id), 
            value: i18n.t(`suggestions.categories.${suggestion.category}`, guild.id), 
            inline: true 
          },
          { 
            name: i18n.t('suggestions.embed.priority', guild.id), 
            value: i18n.t(`suggestions.priorities.${suggestion.priority}`, guild.id), 
            inline: true 
          },
          { 
            name: i18n.t('suggestions.embed.status', guild.id), 
            value: i18n.t(`suggestions.statuses.${suggestion.status}`, guild.id), 
            inline: true 
          }
        )
        .setAuthor({ 
          name: author.tag, 
          iconURL: author.displayAvatarURL() 
        })
        .setFooter({ 
          text: i18n.t('suggestions.embed.footer', guild.id, { id: suggestion.id }) 
        })
        .setTimestamp(suggestion.createdAt);

      if (suggestion.staffNotes) {
        embed.addFields({
          name: i18n.t('suggestions.embed.staff_notes', guild.id),
          value: suggestion.staffNotes
        });
      }

      const voteRow = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`suggestion_vote_up_${suggestion.id}`)
            .setLabel(`👍 ${suggestion.votes.upvotes.length}`)
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`suggestion_vote_down_${suggestion.id}`)
            .setLabel(`👎 ${suggestion.votes.downvotes.length}`)
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`suggestion_vote_neutral_${suggestion.id}`)
            .setLabel(`🤷 ${suggestion.votes.neutral.length}`)
            .setStyle(ButtonStyle.Secondary)
        );

      const staffRow = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`suggestion_approve_${suggestion.id}`)
            .setLabel(i18n.t('suggestions.buttons.approve', guild.id))
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅'),
          new ButtonBuilder()
            .setCustomId(`suggestion_reject_${suggestion.id}`)
            .setLabel(i18n.t('suggestions.buttons.reject', guild.id))
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌'),
          new ButtonBuilder()
            .setCustomId(`suggestion_consider_${suggestion.id}`)
            .setLabel(i18n.t('suggestions.buttons.consider', guild.id))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🤔')
        );

      await message.edit({
        embeds: [embed],
        components: [voteRow, staffRow]
      });
    } catch (error) {
      console.error('Error updating suggestion message:', error);
    }
  }

  private async notifyAuthor(suggestion: Suggestion, action: string, reason: string): Promise<void> {
    try {
      const author = await this.client.users.fetch(suggestion.authorId);
      const guild = this.client.guilds.cache.get(suggestion.guildId);
      
      if (!guild) return;

      const embed = new EmbedBuilder()
        .setColor(this.getStatusColor(suggestion.status))
        .setTitle(i18n.t('suggestions.notification.title', 'global'))
        .setDescription(i18n.t('suggestions.notification.description', 'global', {
          title: suggestion.title,
          server: guild.name,
          status: i18n.t(`suggestions.statuses.${suggestion.status}`, 'global')
        }))
        .addFields({
          name: i18n.t('suggestions.notification.reason', 'global'),
          value: reason
        })
        .setTimestamp();

      await author.send({ embeds: [embed] });
    } catch (error) {
      console.error('Error notifying suggestion author:', error);
    }
  }

  private removeUserVote(suggestion: Suggestion, userId: string): void {
    suggestion.votes.upvotes = suggestion.votes.upvotes.filter(id => id !== userId);
    suggestion.votes.downvotes = suggestion.votes.downvotes.filter(id => id !== userId);
    suggestion.votes.neutral = suggestion.votes.neutral.filter(id => id !== userId);
  }

  private canVote(member: any, config: SuggestionConfig): boolean {
    if (config.voterRoleIds.length === 0) return true;

    return config.voterRoleIds.some(roleId => member.roles.cache.has(roleId));
  }

  private isStaffMember(guild: Guild, userId: string, config: SuggestionConfig): boolean {
    const member = guild.members.cache.get(userId);

    if (!member) return false;
    
    return config.staffRoleIds.some(roleId => member.roles.cache.has(roleId)) ||
           member.permissions.has('Administrator');
  }

  private getStatusColor(status: Suggestion['status']): number {
    const colors = {
      new: 0x3498db,        // Azul
      reviewing: 0xf39c12,  // Naranja
      approved: 0x2ecc71,   // Verde
      rejected: 0xe74c3c,   // Rojo
      considering: 0x9b59b6, // Púrpura
      in_progress: 0xf1c40f, // Amarillo
      completed: 0x27ae60   // Verde oscuro
    };

    return colors[status] || 0x95a5a6;
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  getSuggestion(id: string): Suggestion | undefined {
    return this.suggestions.get(id);
  }

  getSuggestionsByGuild(guildId: string): Suggestion[] {
    return Array.from(this.suggestions.values()).filter(s => s.guildId === guildId);
  }

  getSuggestionsByStatus(guildId: string, status: Suggestion['status']): Suggestion[] {
    return this.getSuggestionsByGuild(guildId).filter(s => s.status === status);
  }

  private mapDbStatus(dbStatus: string): Suggestion['status'] {
    const map: Record<string, Suggestion['status']> = {
      'PENDING': 'new',
      'APPROVED': 'approved',
      'DENIED': 'rejected',
      'IMPLEMENTED': 'completed',
    };
    return map[dbStatus] ?? 'new';
  }

  async syncSuggestionMessage(suggestionId: string): Promise<void> {
    const dbSuggestion = await this.client.db.suggestion.findUnique({
      where: { id: suggestionId }
    });
    if (!dbSuggestion) return;

    // Rebuild internal Suggestion object from DB row
    const suggestion: Suggestion = {
      id: dbSuggestion.id,
      guildId: dbSuggestion.guildId,
      authorId: dbSuggestion.authorId,
      title: dbSuggestion.content,
      description: dbSuggestion.content,
      category: (dbSuggestion.category as any) || 'other',
      priority: 'medium',
      status: this.mapDbStatus(dbSuggestion.status),
      votes: { upvotes: [], downvotes: [], neutral: [] },
      staffNotes: dbSuggestion.response ?? undefined,
      createdAt: dbSuggestion.createdAt,
      updatedAt: dbSuggestion.updatedAt,
      messageId: dbSuggestion.messageId ?? undefined,
    };

    // Sync upvotes/downvotes counts
    const votesArr: string[] = [];
    for (let i = 0; i < dbSuggestion.upvotes; i++) votesArr.push(`__up_${i}`);
    suggestion.votes.upvotes = votesArr;
    const downArr: string[] = [];
    for (let i = 0; i < dbSuggestion.downvotes; i++) downArr.push(`__down_${i}`);
    suggestion.votes.downvotes = downArr;

    const guild = this.client.guilds.cache.get(dbSuggestion.guildId);
    if (guild) {
      await this.updateSuggestionMessage(guild, suggestion);
    }
  }
}