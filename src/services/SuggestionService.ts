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
  channelId?: string;
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
  // Último canal usado: permite reactivar el sistema (botón de /suggestions config) tras desactivarlo
  lastChannelId?: string;
}

export class SuggestionService {
  private client: KorexClient;
  private configs: Map<string, SuggestionConfig> = new Map();
  private cooldowns: Map<string, number> = new Map();
  // Serializa votos/acciones por sugerencia (evita perder votos con clics simultáneos)
  private locks = new Map<string, Promise<unknown>>();

  constructor(client: KorexClient) {
    this.client = client;
    this.initialize();
  }

  async initialize(): Promise<void> {
    await this.loadConfigurations();
  }

  private async loadConfigurations(): Promise<void> {
    try {
      const rows = await this.client.db.guildConfig.findMany({
        where: { suggestionChannelId: { not: null } },
        select: { guildId: true, suggestionChannelId: true, suggestionSettings: true }
      });

      for (const row of rows) {
        this.configs.set(row.guildId, this.buildConfig(row.guildId, row.suggestionChannelId!, row.suggestionSettings));
      }
    } catch (error) {
      console.error('Error loading suggestion configurations:', error);
    }
  }

  private defaultConfig(guildId: string, channelId?: string): SuggestionConfig {
    return {
      guildId,
      enabled: !!channelId,
      channelId,
      staffRoleIds: [],
      voterRoleIds: [],
      cooldown: 300,
      requireApproval: false,
      autoCreateThreads: true,
      voteThreshold: 10,
      notifyAuthor: true
    };
  }

  private withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(fn);
    this.locks.set(id, run);
    run.finally(() => { if (this.locks.get(id) === run) this.locks.delete(id); }).catch(() => undefined);
    return run;
  }

  // ─── Persistencia (la BD es la fuente de verdad) ──────────────────────────

  private rowToSuggestion(row: any): Suggestion {
    const meta = (row.meta && typeof row.meta === 'object' ? row.meta : {}) as {
      votes?: { up?: string[]; down?: string[]; neutral?: string[] };
      priority?: Suggestion['priority'];
      displayStatus?: Suggestion['status'];
    };
    const [firstLine, ...rest] = String(row.content ?? '').split('\n');
    return {
      id: row.id,
      guildId: row.guildId,
      authorId: row.authorId,
      title: firstLine,
      description: rest.join('\n').trim() || firstLine,
      category: (row.category as Suggestion['category']) || 'other',
      priority: meta.priority || 'medium',
      status: meta.displayStatus || this.mapDbStatus(row.status),
      votes: {
        upvotes: meta.votes?.up ?? [],
        downvotes: meta.votes?.down ?? [],
        neutral: meta.votes?.neutral ?? [],
      },
      staffNotes: row.response ?? undefined,
      assignedTo: row.responderId ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      messageId: row.messageId ?? undefined,
      channelId: row.channelId || undefined,
    };
  }

  private async loadSuggestion(id: string, guildId?: string): Promise<Suggestion | null> {
    const row = await this.client.db.suggestion.findUnique({ where: { id } });
    if (!row || (guildId && row.guildId !== guildId)) return null;
    return this.rowToSuggestion(row);
  }

  private async persist(suggestion: Suggestion, extra: Record<string, unknown> = {}): Promise<void> {
    const dbStatus = { approved: 'APPROVED', rejected: 'DENIED', completed: 'IMPLEMENTED' }[suggestion.status as string] ?? 'PENDING';
    await this.client.db.suggestion.update({
      where: { id: suggestion.id },
      data: {
        upvotes: suggestion.votes.upvotes.length,
        downvotes: suggestion.votes.downvotes.length,
        status: dbStatus as any,
        meta: {
          votes: { up: suggestion.votes.upvotes, down: suggestion.votes.downvotes, neutral: suggestion.votes.neutral },
          priority: suggestion.priority,
          // Estados sin equivalente en la BD (p. ej. "en consideración")
          displayStatus: ['considering', 'reviewing', 'in_progress'].includes(suggestion.status) ? suggestion.status : undefined,
        } as any,
        ...extra,
      },
    });
  }

  getCooldown(key: string): number | undefined {
    return this.cooldowns.get(key);
  }

  async getConfig(guildId: string): Promise<SuggestionConfig> {
    if (!this.configs.has(guildId)) {
      try {
        const row = await this.client.db.guildConfig.findUnique({
          where: { guildId },
          select: { suggestionChannelId: true, suggestionSettings: true }
        });
        this.configs.set(guildId, this.buildConfig(guildId, row?.suggestionChannelId ?? undefined, row?.suggestionSettings));
      } catch {
        // Fallo de BD: no se cachea, se reintenta en la siguiente llamada
        return this.defaultConfig(guildId);
      }
    }

    return this.configs.get(guildId)!;
  }

  /** Config efectiva: canal (suggestionChannelId) + ajustes guardados en suggestionSettings. */
  private buildConfig(guildId: string, channelId: string | undefined, raw: unknown): SuggestionConfig {
    const settings = (raw && typeof raw === 'object' ? raw : {}) as Partial<SuggestionConfig>;
    const base = this.defaultConfig(guildId, channelId);
    return {
      ...base,
      staffRoleIds: Array.isArray(settings.staffRoleIds) ? settings.staffRoleIds.map(String) : base.staffRoleIds,
      voterRoleIds: Array.isArray(settings.voterRoleIds) ? settings.voterRoleIds.map(String) : base.voterRoleIds,
      cooldown: Number.isInteger(settings.cooldown) ? Number(settings.cooldown) : base.cooldown,
      autoCreateThreads: typeof settings.autoCreateThreads === 'boolean' ? settings.autoCreateThreads : base.autoCreateThreads,
      notifyAuthor: typeof settings.notifyAuthor === 'boolean' ? settings.notifyAuthor : base.notifyAuthor,
      lastChannelId: channelId ?? (typeof settings.lastChannelId === 'string' ? settings.lastChannelId : undefined),
    };
  }

  async updateConfig(guildId: string, config: Partial<SuggestionConfig>): Promise<SuggestionConfig> {
    const currentConfig = await this.getConfig(guildId);
    const updated = { ...currentConfig, ...config };
    const suggestionChannelId = updated.enabled ? (updated.channelId ?? null) : null;
    const suggestionSettings = {
      staffRoleIds: updated.staffRoleIds,
      voterRoleIds: updated.voterRoleIds,
      cooldown: updated.cooldown,
      autoCreateThreads: updated.autoCreateThreads,
      notifyAuthor: updated.notifyAuthor,
      lastChannelId: updated.channelId ?? updated.lastChannelId,
    };

    await this.client.db.guildConfig.upsert({
      where: { guildId },
      update: { suggestionChannelId, suggestionSettings: suggestionSettings as any },
      create: { guildId, suggestionChannelId, suggestionSettings: suggestionSettings as any },
    });

    const effective = this.buildConfig(guildId, suggestionChannelId ?? undefined, suggestionSettings);
    this.configs.set(guildId, effective);
    return effective;
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
      votes: { upvotes: [], downvotes: [], neutral: [] },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.cooldowns.set(cooldownKey, Date.now());

    try {
      await this.client.db.suggestion.create({
        data: {
          id: suggestion.id,
          guildId: suggestion.guildId,
          channelId: config.channelId ?? '',
          authorId: suggestion.authorId,
          content: title ? `${title}\n${description}` : description,
          category: suggestion.category,
          status: 'PENDING',
          upvotes: 0,
          downvotes: 0,
          meta: { votes: { up: [], down: [], neutral: [] }, priority } as any,
        }
      });
    } catch (error) {
      console.error('Error saving suggestion to DB:', error);
      return null;
    }

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

    const { embed, components } = await this.buildMessage(guild, suggestion);

    const message = await channel.send({
      embeds: [embed],
      components
    });

    suggestion.messageId = message.id;
    suggestion.channelId = channel.id;

    // Update messageId and channelId in DB
    try {
      await this.client.db.suggestion.update({
        where: { id: suggestion.id },
        data: { messageId: message.id, channelId: channel.id }
      });
    } catch (error) {
      console.error('Error updating suggestion messageId in DB:', error);
    }

    // Crear thread si está habilitado
    if (config.autoCreateThreads) {
      try {
        const thread = await message.startThread({
          name: `💬 ${suggestion.title.substring(0, 90)}`,
          autoArchiveDuration: 1440 // 24 horas
        });
        suggestion.threadId = thread.id;
      } catch {
        // Thread creation is optional — suggestion is already posted
      }
    }

  }

  /** Embed + botones de una sugerencia (publicación y actualizaciones). */
  private async buildMessage(guild: Guild, suggestion: Suggestion) {
    const author = await this.client.users.fetch(suggestion.authorId).catch(() => null);
    const t = (key: string, vars?: Record<string, string>) => i18n.t(key, guild.id, vars);

    const embed = new EmbedBuilder()
      .setColor(this.getStatusColor(suggestion.status))
      .setTitle(`💡 ${suggestion.title}`.slice(0, 256))
      .setFooter({ text: t('suggestions.embed.footer', { id: suggestion.id }) })
      .setTimestamp(suggestion.createdAt);
    if (suggestion.description && suggestion.description !== suggestion.title) {
      embed.setDescription(suggestion.description.slice(0, 4096));
    }
    embed.addFields(
      { name: t('suggestions.embed.category'), value: t(`suggestions.categories.${suggestion.category}`), inline: true },
      { name: t('suggestions.embed.priority'), value: t(`suggestions.priorities.${suggestion.priority}`), inline: true },
      { name: t('suggestions.embed.status'), value: t(`suggestions.statuses.${suggestion.status}`), inline: true },
    );
    if (author) embed.setAuthor({ name: author.tag, iconURL: author.displayAvatarURL() });
    if (suggestion.staffNotes) {
      embed.addFields({ name: t('suggestions.embed.staff_notes'), value: suggestion.staffNotes.slice(0, 1024) });
    }

    const voteRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`suggestion_vote_up_${suggestion.id}`).setLabel(`👍 ${suggestion.votes.upvotes.length}`).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`suggestion_vote_down_${suggestion.id}`).setLabel(`👎 ${suggestion.votes.downvotes.length}`).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`suggestion_vote_neutral_${suggestion.id}`).setLabel(`🤷 ${suggestion.votes.neutral.length}`).setStyle(ButtonStyle.Secondary),
    );
    const staffRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`suggestion_approve_${suggestion.id}`).setLabel(t('suggestions.buttons.approve')).setStyle(ButtonStyle.Success).setEmoji('✅'),
      new ButtonBuilder().setCustomId(`suggestion_reject_${suggestion.id}`).setLabel(t('suggestions.buttons.reject')).setStyle(ButtonStyle.Danger).setEmoji('❌'),
      new ButtonBuilder().setCustomId(`suggestion_consider_${suggestion.id}`).setLabel(t('suggestions.buttons.consider')).setStyle(ButtonStyle.Secondary).setEmoji('🤔'),
    );

    return { embed, components: [voteRow, staffRow] };
  }

  async handleVote(interaction: ButtonInteraction): Promise<void> {
    const [, , voteType, suggestionId] = interaction.customId.split('_');
    const guildId = interaction.guildId!;
    const config = await this.getConfig(guildId);

    if (!this.canVote(interaction.member!, config)) {
      await interaction.reply({ content: i18n.t('suggestions.errors.no_permission_vote', guildId), ephemeral: true });
      return;
    }

    const updated = await this.withLock(suggestionId, async () => {
      const suggestion = await this.loadSuggestion(suggestionId, guildId);
      if (!suggestion) return null;

      // Pulsar el mismo voto otra vez lo retira; uno distinto lo cambia
      const lists = { up: suggestion.votes.upvotes, down: suggestion.votes.downvotes, neutral: suggestion.votes.neutral };
      const target = lists[voteType as keyof typeof lists];
      if (!target) return null;
      const alreadyThere = target.includes(interaction.user.id);
      this.removeUserVote(suggestion, interaction.user.id);
      if (!alreadyThere) {
        const fresh = { up: suggestion.votes.upvotes, down: suggestion.votes.downvotes, neutral: suggestion.votes.neutral };
        fresh[voteType as keyof typeof fresh].push(interaction.user.id);
      }

      await this.persist(suggestion);
      await this.updateSuggestionMessage(interaction.guild!, suggestion);
      return { removed: alreadyThere };
    });

    if (!updated) {
      await interaction.reply({ content: i18n.t('suggestions.errors.not_found', guildId), ephemeral: true });
      return;
    }
    await interaction.reply({
      content: i18n.t(updated.removed ? 'suggestions.vote_removed' : 'suggestions.vote_recorded', guildId),
      ephemeral: true
    });
  }

  async handleStaffAction(interaction: ButtonInteraction): Promise<void> {
    const [, action, suggestionId] = interaction.customId.split('_');
    const guildId = interaction.guildId!;
    const suggestion = await this.loadSuggestion(suggestionId, guildId);

    if (!suggestion) {
      await interaction.reply({ content: i18n.t('suggestions.errors.not_found', guildId), ephemeral: true });
      return;
    }

    const config = await this.getConfig(guildId);

    if (!this.isStaffMember(interaction.guild!, interaction.user.id, config)) {
      await interaction.reply({ content: i18n.t('suggestions.errors.no_permission_staff', guildId), ephemeral: true });
      return;
    }

    // Mostrar modal para razón
    const modal = new ModalBuilder()
      .setCustomId(`suggestion_${action}_modal_${suggestionId}`)
      .setTitle(i18n.t(`suggestions.modals.${action}.title`, guildId));

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel(i18n.t('suggestions.modals.reason_label', guildId))
      .setPlaceholder(i18n.t('suggestions.modals.reason_placeholder', guildId))
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(1000)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));

    await interaction.showModal(modal);
  }

  async handleStaffModal(interaction: ModalSubmitInteraction): Promise<void> {
    const [, action, , suggestionId] = interaction.customId.split('_');
    const guildId = interaction.guildId!;
    const reason = interaction.fields.getTextInputValue('reason');
    const config = await this.getConfig(guildId);

    if (!this.isStaffMember(interaction.guild!, interaction.user.id, config)) {
      await interaction.reply({ content: i18n.t('suggestions.errors.no_permission_staff', guildId), ephemeral: true });
      return;
    }

    const suggestion = await this.withLock(suggestionId, async () => {
      const s = await this.loadSuggestion(suggestionId, guildId);
      if (!s) return null;
      const status = ({ approve: 'approved', reject: 'rejected', consider: 'considering' } as const)[action as 'approve' | 'reject' | 'consider'];
      if (!status) return null;
      s.status = status;
      s.staffNotes = reason;
      s.assignedTo = interaction.user.id;
      await this.persist(s, { response: reason, responderId: interaction.user.id });
      await this.updateSuggestionMessage(interaction.guild!, s);
      return s;
    });

    if (!suggestion) {
      await interaction.reply({ content: i18n.t('suggestions.errors.not_found', guildId), ephemeral: true });
      return;
    }

    if (config.notifyAuthor) {
      await this.notifyAuthor(suggestion, reason);
    }

    await interaction.reply({
      content: i18n.t('suggestions.staff_action_success', guildId, { action: i18n.t(`suggestions.statuses.${suggestion.status}`, guildId) }),
      ephemeral: true
    });
  }

  private async updateSuggestionMessage(guild: Guild, suggestion: Suggestion): Promise<void> {
    // Canal donde se publicó (aunque después se haya cambiado el canal de sugerencias)
    const config = await this.getConfig(guild.id);
    const channelId = suggestion.channelId || config.channelId;
    const channel = channelId ? guild.channels.cache.get(channelId) as TextChannel : undefined;

    if (!channel || !suggestion.messageId) return;

    try {
      const message = await channel.messages.fetch(suggestion.messageId);
      const { embed, components } = await this.buildMessage(guild, suggestion);
      await message.edit({ embeds: [embed], components });
    } catch (error) {
      console.error('Error updating suggestion message:', error);
    }
  }

  private async notifyAuthor(suggestion: Suggestion, reason: string): Promise<void> {
    try {
      const author = await this.client.users.fetch(suggestion.authorId);
      const guild = this.client.guilds.cache.get(suggestion.guildId);

      if (!guild) return;
      const t = (key: string, vars?: Record<string, string>) => i18n.t(key, guild.id, vars);

      const embed = new EmbedBuilder()
        .setColor(this.getStatusColor(suggestion.status))
        .setTitle(t('suggestions.notification.title'))
        .setDescription(t('suggestions.notification.description', {
          title: suggestion.title,
          server: guild.name,
          status: t(`suggestions.statuses.${suggestion.status}`)
        }))
        .setTimestamp();
      if (reason) embed.addFields({ name: t('suggestions.notification.reason'), value: reason.slice(0, 1024) });

      await author.send({ embeds: [embed] });
    } catch (error) {
      // DMs cerrados
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

  async getSuggestion(id: string, guildId?: string): Promise<Suggestion | null> {
    return this.loadSuggestion(id, guildId);
  }

  async getSuggestionsByGuild(guildId: string, limit = 100): Promise<Suggestion[]> {
    const rows = await this.client.db.suggestion.findMany({
      where: { guildId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.rowToSuggestion(r));
  }

  async getSuggestionsByStatus(guildId: string, status: Suggestion['status']): Promise<Suggestion[]> {
    return (await this.getSuggestionsByGuild(guildId, 500)).filter(s => s.status === status);
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

  /**
   * Cambio de estado desde el dashboard: actualiza el mensaje (conservando los
   * votos) y avisa al autor si cambió el estado.
   */
  async syncSuggestionMessage(suggestionId: string, opts: { notify?: boolean } = {}): Promise<void> {
    const row = await this.client.db.suggestion.findUnique({ where: { id: suggestionId } });
    if (!row) return;

    // El estado del dashboard sustituye a "en consideración"
    const meta = (row.meta && typeof row.meta === 'object' ? row.meta : {}) as Record<string, unknown>;
    if (meta.displayStatus) {
      await this.client.db.suggestion.update({
        where: { id: suggestionId },
        data: { meta: { ...meta, displayStatus: undefined } as any },
      });
      delete meta.displayStatus;
    }
    const suggestion = this.rowToSuggestion({ ...row, meta });

    const guild = this.client.guilds.cache.get(row.guildId);
    if (guild) {
      await this.updateSuggestionMessage(guild, suggestion);
      const config = await this.getConfig(guild.id);
      if (opts.notify && config.notifyAuthor) await this.notifyAuthor(suggestion, row.response ?? '');
    }
  }
}
