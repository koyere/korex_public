import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  GuildMember,
  MessageReaction,
  ButtonInteraction,
  TextChannel,
} from 'discord.js';
import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';
import { logger } from '../utils/Logger';

export class VerificationService {
  private client: KorexClient;

  constructor(client: KorexClient) {
    this.client = client;
  }

  /** Get verification config for a guild (via WelcomeConfig) */
  async getConfig(guildId: string) {
    return this.client.database.prisma.welcomeConfig.findUnique({
      where: { guildId },
      select: {
        verificationEnabled:    true,
        verificationChannel:    true,
        verificationMessageId:  true,
        verificationRole:       true,
        verificationType:       true,
        verificationEmoji:      true,
        verificationEmbedTitle: true,
        verificationEmbedDesc:  true,
        verificationEmbedColor: true,
      },
    });
  }

  /** Save/update verification config */
  async saveConfig(guildId: string, data: {
    verificationEnabled?:    boolean;
    verificationChannel?:    string | null;
    verificationMessageId?:  string | null;
    verificationRole?:       string | null;
    verificationType?:       string;
    verificationEmoji?:      string;
    verificationEmbedTitle?: string;
    verificationEmbedDesc?:  string;
    verificationEmbedColor?: string;
  }) {
    return this.client.database.prisma.welcomeConfig.upsert({
      where:  { guildId },
      update: data,
      create: { guildId, ...data },
    });
  }

  /** Build the verification embed + component row */
  buildMessage(lang: string, opts: {
    title: string;
    description: string;
    color: string;
    type: string;
    emoji: string;
  }) {
    const hex = opts.color.startsWith('#') ? parseInt(opts.color.replace('#', ''), 16) : 0x5865F2;

    const embed = new EmbedBuilder()
      .setTitle(opts.title)
      .setDescription(
        opts.type === 'reaction'
          ? `${opts.description}\n\n${i18n.t('verification.reaction_instruction', lang, { emoji: opts.emoji })}`
          : opts.description
      )
      .setColor(hex)
      .setTimestamp();

    if (opts.type !== 'reaction') {
      const btn = new ButtonBuilder()
        .setCustomId('verify')
        .setLabel(`${opts.emoji} ${i18n.t('verification.button_label', lang)}`)
        .setStyle(ButtonStyle.Success);
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(btn);
      return { embed, row };
    }

    return { embed, row: null };
  }

  /** Deploy (or redeploy) the verification message to the configured channel */
  async deploy(guildId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const cfg = await this.getConfig(guildId);
      if (!cfg?.verificationChannel || !cfg.verificationRole) {
        return { success: false, error: 'not_configured' };
      }

      const guild = await this.client.guilds.fetch(guildId);
      const lang  = i18n.getGuildLanguage(guildId);
      const channel = await guild.channels.fetch(cfg.verificationChannel) as TextChannel | null;

      if (!channel?.isTextBased()) {
        return { success: false, error: 'channel_not_found' };
      }

      const { embed, row } = this.buildMessage(lang, {
        title:       cfg.verificationEmbedTitle,
        description: cfg.verificationEmbedDesc,
        color:       cfg.verificationEmbedColor,
        type:        cfg.verificationType,
        emoji:       cfg.verificationEmoji,
      });

      // Delete previous message if exists
      if (cfg.verificationMessageId) {
        try {
          const old = await channel.messages.fetch(cfg.verificationMessageId);
          await old.delete();
        } catch { /* message already deleted */ }
      }

      const components = row ? [row] : [];
      const msg = await channel.send({ embeds: [embed], components });

      // Add reaction if reaction type
      if (cfg.verificationType === 'reaction') {
        // Normalize emoji: strip :colons: and resolve common names to unicode
        let emojiToReact = cfg.verificationEmoji.trim();
        // Strip surrounding colons e.g. :white_check_mark: → white_check_mark
        if (emojiToReact.startsWith(':') && emojiToReact.endsWith(':')) {
          emojiToReact = emojiToReact.slice(1, -1);
        }
        // Map common text names to unicode
        const EMOJI_MAP: Record<string, string> = {
          white_check_mark: '✅', heavy_check_mark: '✔️', check: '✔️',
          x: '❌', thumbsup: '👍', thumbsdown: '👎', heart: '❤️',
          star: '⭐', fire: '🔥', wave: '👋',
        };
        emojiToReact = EMOJI_MAP[emojiToReact] ?? emojiToReact;
        await msg.react(emojiToReact);
      }

      await this.saveConfig(guildId, { verificationMessageId: msg.id, verificationEnabled: true });
      return { success: true };
    } catch (err) {
      logger.error('VerificationService.deploy error:', err);
      return { success: false, error: String(err) };
    }
  }

  /** Handle a button interaction on the verification message */
  async handleButton(interaction: ButtonInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const lang    = i18n.getGuildLanguage(guildId);

    try {
      const cfg = await this.getConfig(guildId);
      if (!cfg?.verificationEnabled || !cfg.verificationRole) {
        await interaction.reply({ content: i18n.t('verification.not_configured', lang), ephemeral: true });
        return;
      }

      const member = interaction.member as GuildMember;
      if (member.roles.cache.has(cfg.verificationRole)) {
        await interaction.reply({ content: i18n.t('verification.already_verified', lang), ephemeral: true });
        return;
      }

      const role = interaction.guild!.roles.cache.get(cfg.verificationRole);
      if (!role) {
        await interaction.reply({ content: i18n.t('verification.role_not_found', lang), ephemeral: true });
        return;
      }

      await member.roles.add(role);
      await interaction.reply({ content: i18n.t('verification.verified', lang), ephemeral: true });

      logger.info(`[Verification] ${member.user.tag} verified in guild ${guildId}`);
    } catch (err) {
      logger.error('VerificationService.handleButton error:', err);
      await interaction.reply({ content: i18n.t('common.error', lang), ephemeral: true }).catch(() => {});
    }
  }

  /** Handle a reaction on the verification message */
  async handleReaction(reaction: MessageReaction, member: GuildMember): Promise<void> {
    const guildId = member.guild.id;
    const lang    = i18n.getGuildLanguage(guildId);

    try {
      const cfg = await this.getConfig(guildId);
      if (
        !cfg?.verificationEnabled ||
        !cfg.verificationRole ||
        cfg.verificationType !== 'reaction' ||
        cfg.verificationMessageId !== reaction.message.id
      ) return;

      const emoji = reaction.emoji.name ?? reaction.emoji.id;
      if (emoji !== cfg.verificationEmoji) return;

      if (member.roles.cache.has(cfg.verificationRole)) return;

      const role = member.guild.roles.cache.get(cfg.verificationRole);
      if (!role) return;

      await member.roles.add(role);
      logger.info(`[Verification] ${member.user.tag} verified via reaction in guild ${guildId}`);
    } catch (err) {
      logger.error('VerificationService.handleReaction error:', err);
    }
  }
}
