import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  GuildMember,
  MessageReaction,
  ButtonInteraction,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { createHash } from 'crypto';
import { KorexClient } from '../client/KorexClient';
import { checkSelfAssignableRole } from '../utils/roleSafety';
import { i18n } from '../utils/i18n';
import { logger } from '../utils/Logger';
import { CAPTCHA_LENGTH, generateCaptchaCode, normalizeCaptchaInput, renderCaptchaImage } from '../utils/captchaImage';

/** customId of the "Enter code" button and of the captcha modal */
export const CAPTCHA_BUTTON_ID = 'verify:captcha';
export const CAPTCHA_MODAL_ID  = 'verify:captcha_modal';
const CAPTCHA_INPUT_ID = 'code';

export const VERIFICATION_TYPES = ['button', 'reaction', 'captcha'] as const;
export const CAPTCHA_FAIL_ACTIONS = ['none', 'kick'] as const;

/** Config limits (shared by the command and the API) */
export const CAPTCHA_LIMITS = {
  maxAttempts:    { min: 1, max: 10 },
  cooldown:       { min: 1, max: 1440 },   // minutes
  timeoutMinutes: { min: 0, max: 10080 },  // 0 = disabled; max 7 days
} as const;

const CAPTCHA_TTL_SECONDS      = 5 * 60;   // lifetime of a code
const CAPTCHA_ATTEMPTS_WINDOW  = 30 * 60;  // failures accumulate even if another code is requested
const CAPTCHA_ISSUE_LIMIT      = 5;        // new codes per user...
const CAPTCHA_ISSUE_WINDOW     = 10 * 60;  // ...within this window (s)
const DEADLINE_SWEEP_MS        = 60_000;

/**
 * Atomic check of an attempt: active lockout, expired/consumed code,
 * success (consumed: single use) or failure (counted; when exhausted, lockout).
 * Returns {status, value}: 1 ok · 0 failure (remaining) · -1 expired · -2 locked (ttl) · -3 just locked (ttl)
 */
export const CAPTCHA_CHECK_LUA = `
if redis.call('EXISTS', KEYS[3]) == 1 then return {-2, redis.call('TTL', KEYS[3])} end
local stored = redis.call('GET', KEYS[1])
if not stored then return {-1, 0} end
if stored == ARGV[1] then
  redis.call('DEL', KEYS[1], KEYS[2])
  return {1, 0}
end
local n = redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[4]))
local max = tonumber(ARGV[2])
if n >= max then
  redis.call('DEL', KEYS[1], KEYS[2])
  redis.call('SET', KEYS[3], '1', 'EX', tonumber(ARGV[3]))
  return {-3, tonumber(ARGV[3])}
end
return {0, max - n}
`;

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
        verificationCaptchaMaxAttempts: true,
        verificationCaptchaCooldown:    true,
        verificationCaptchaFailAction:  true,
        verificationTimeoutMinutes:     true,
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
    verificationCaptchaMaxAttempts?: number;
    verificationCaptchaCooldown?:    number;
    verificationCaptchaFailAction?:  string;
    verificationTimeoutMinutes?:     number;
  }) {
    return this.client.database.prisma.welcomeConfig.upsert({
      where:  { guildId },
      update: data,
      create: { guildId, ...data },
    });
  }

  /** ":white_check_mark:" / "white_check_mark" → "✅"; anything else is left unchanged */
  static normalizeEmoji(raw: string): string {
    let emoji = (raw || '✅').trim();
    if (emoji.startsWith(':') && emoji.endsWith(':')) emoji = emoji.slice(1, -1);
    const EMOJI_MAP: Record<string, string> = {
      white_check_mark: '✅', heavy_check_mark: '✔️', check: '✔️',
      x: '❌', thumbsup: '👍', thumbsdown: '👎', heart: '❤️',
      star: '⭐', fire: '🔥', wave: '👋',
    };
    return EMOJI_MAP[emoji] ?? emoji;
  }

  /** Build the verification embed + component row */
  buildMessage(lang: string, opts: {
    title: string;
    description: string;
    color: string;
    type: string;
    emoji: string;
  }) {
    const parsed = parseInt((opts.color || '').replace('#', ''), 16);
    const hex = /^#?[0-9a-fA-F]{6}$/.test(opts.color || '') && !Number.isNaN(parsed) ? parsed : 0x5865F2;
    // setTitle/setDescription throw on an empty string: use the default texts
    const title = opts.title?.trim() || i18n.t('verification.embed_title_default', lang);
    const description = opts.description?.trim() || i18n.t('verification.embed_desc_default', lang);

    const embed = new EmbedBuilder()
      .setTitle(title.slice(0, 256))
      .setDescription(
        (opts.type === 'reaction'
          ? `${description}\n\n${i18n.t('verification.reaction_instruction', lang, { emoji: opts.emoji })}`
          : description).slice(0, 4096)
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

      // Delete the previous message (if the channel changed, the PATCH already deleted it from the old channel)
      if (cfg.verificationMessageId) {
        const old = await channel.messages.fetch(cfg.verificationMessageId).catch(() => null);
        await old?.delete().catch(() => {});
      }
      // Clear the stored ID before sending so a crash/retry doesn't leave orphans
      await this.saveConfig(guildId, { verificationMessageId: null });

      const components = row ? [row] : [];
      const msg = await channel.send({ embeds: [embed], components });

      // Add reaction if reaction type
      if (cfg.verificationType === 'reaction') {
        const emojiToReact = VerificationService.normalizeEmoji(cfg.verificationEmoji);
        await msg.react(emojiToReact);
      }

      await this.saveConfig(guildId, { verificationMessageId: msg.id, verificationEnabled: true });
      return { success: true };
    } catch (err) {
      logger.error('VerificationService.deploy error:', err);
      const code = (err as any)?.code;
      if (code === 50013) return { success: false, error: 'missing_permissions' };
      if (code === 50001) return { success: false, error: 'no_access' };
      return { success: false, error: 'deploy_failed' };
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

      // Older configs may have saved a role with dangerous permissions
      if (!checkSelfAssignableRole(interaction.guild!, role.id).ok) {
        await interaction.reply({ content: i18n.t('autorole.button.cannot_assign', lang), ephemeral: true });
        return;
      }

      // Captcha mode: the button hands out a code instead of the role
      if (cfg.verificationType === 'captcha') {
        await this.startCaptcha(interaction, lang);
        return;
      }

      await member.roles.add(role, 'Verification');
      await this.clearDeadline(guildId, member.id);
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

      // Unicode ("✅") or custom ("<:name:id>", "<a:name:id>", name or id)
      const { name, id } = reaction.emoji;
      const candidates = [name, id, id && `<:${name}:${id}>`, id && `<a:${name}:${id}>`].filter(Boolean);
      if (!candidates.includes(cfg.verificationEmoji)) return;

      if (member.roles.cache.has(cfg.verificationRole)) return;

      const role = member.guild.roles.cache.get(cfg.verificationRole);
      if (!role || !checkSelfAssignableRole(member.guild, role.id).ok) return;

      await member.roles.add(role, 'Verification');
      await this.clearDeadline(guildId, member.id);
      logger.info(`[Verification] ${member.user.tag} verified via reaction in guild ${guildId}`);
    } catch (err) {
      logger.error('VerificationService.handleReaction error:', err);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // CAPTCHA
  // ═══════════════════════════════════════════════════════════════

  private redisReady(): boolean {
    const redis = (this.client as any).redis;
    return !!redis && typeof redis.isConnected === 'function' && redis.isConnected();
  }

  private redisKey(kind: string, guildId: string, userId: string): string {
    return `${process.env.REDIS_PREFIX || 'korex:'}verify:captcha:${kind}:${guildId}:${userId}`;
  }

  /** The code is never stored in plain text: hash bound to server + user */
  private hashCode(guildId: string, userId: string, code: string): string {
    return createHash('sha256').update(`${guildId}:${userId}:${code}`).digest('hex');
  }

  private static clampInt(value: unknown, min: number, max: number, fallback: number): number {
    const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
    return Math.min(Math.max(n, min), max);
  }

  /** Step 1: generates a new code and shows it (ephemeral) with the button to enter it */
  private async startCaptcha(interaction: ButtonInteraction, lang: string): Promise<void> {
    const guildId = interaction.guildId!;
    const userId  = interaction.user.id;

    if (!this.redisReady()) {
      await interaction.reply({ content: i18n.t('verification.captcha.unavailable', lang), ephemeral: true });
      return;
    }
    const redis = this.client.redis.getClient();

    const cooldownTtl = await redis.ttl(this.redisKey('cooldown', guildId, userId));
    if (cooldownTtl > 0) {
      await interaction.reply({
        content: i18n.t('verification.captcha.cooldown', lang, { time: `<t:${Math.floor(Date.now() / 1000) + cooldownTtl}:R>` }),
        ephemeral: true,
      });
      return;
    }

    // Limit of new codes per user (prevents forcing regenerations)
    const issueKey = this.redisKey('issued', guildId, userId);
    const issued = await redis.incr(issueKey);
    if (issued === 1) await redis.expire(issueKey, CAPTCHA_ISSUE_WINDOW);
    if (issued > CAPTCHA_ISSUE_LIMIT) {
      await interaction.reply({ content: i18n.t('verification.captcha.rate_limited', lang), ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const codeKey = this.redisKey('code', guildId, userId);
    let image: Buffer;
    const code = generateCaptchaCode();
    try {
      image = renderCaptchaImage(code);
    } catch (err) {
      logger.error('VerificationService.startCaptcha image error:', err);
      await interaction.editReply({ content: i18n.t('verification.captcha.unavailable', lang) });
      return;
    }
    // A new code invalidates the previous one (the key is overwritten)
    await redis.set(codeKey, this.hashCode(guildId, userId, code), 'EX', CAPTCHA_TTL_SECONDS);

    const expires = Math.floor(Date.now() / 1000) + CAPTCHA_TTL_SECONDS;
    const embed = new EmbedBuilder()
      .setTitle(i18n.t('verification.captcha.title', lang))
      .setDescription(i18n.t('verification.captcha.description', lang, {
        length: String(CAPTCHA_LENGTH),
        time: `<t:${expires}:R>`,
      }))
      .setImage('attachment://captcha.png')
      .setColor(0x5865F2);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(CAPTCHA_BUTTON_ID)
        .setLabel(i18n.t('verification.captcha.button_enter', lang))
        .setEmoji('⌨️')
        .setStyle(ButtonStyle.Primary),
    );

    await interaction.editReply({
      embeds: [embed],
      components: [row],
      files: [new AttachmentBuilder(image, { name: 'captcha.png' })],
    });
  }

  /** Step 2: opens the modal to type the code */
  async handleCaptchaButton(interaction: ButtonInteraction): Promise<void> {
    const lang = i18n.getGuildLanguage(interaction.guildId!);
    try {
      const modal = new ModalBuilder()
        .setCustomId(CAPTCHA_MODAL_ID)
        .setTitle(i18n.t('verification.captcha.modal_title', lang).slice(0, 45))
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId(CAPTCHA_INPUT_ID)
              .setLabel(i18n.t('verification.captcha.modal_label', lang).slice(0, 45))
              .setPlaceholder(i18n.t('verification.captcha.modal_placeholder', lang).slice(0, 100))
              .setStyle(TextInputStyle.Short)
              .setMinLength(1)
              .setMaxLength(16)
              .setRequired(true),
          ),
        );
      await interaction.showModal(modal);
    } catch (err) {
      logger.error('VerificationService.handleCaptchaButton error:', err);
      await interaction.reply({ content: i18n.t('common.error', lang), ephemeral: true }).catch(() => {});
    }
  }

  /** Step 3: checks the code (case-insensitive, single use, limited attempts) */
  async handleCaptchaModal(interaction: ModalSubmitInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const userId  = interaction.user.id;
    const lang    = i18n.getGuildLanguage(guildId);

    try {
      await interaction.deferReply({ ephemeral: true });

      const cfg = await this.getConfig(guildId);
      if (!cfg?.verificationEnabled || !cfg.verificationRole || cfg.verificationType !== 'captcha') {
        await interaction.editReply({ content: i18n.t('verification.not_configured', lang) });
        return;
      }
      const guild  = interaction.guild!;
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        await interaction.editReply({ content: i18n.t('common.error', lang) });
        return;
      }
      if (member.roles.cache.has(cfg.verificationRole)) {
        await interaction.editReply({ content: i18n.t('verification.already_verified', lang) });
        return;
      }
      if (!this.redisReady()) {
        await interaction.editReply({ content: i18n.t('verification.captcha.unavailable', lang) });
        return;
      }

      const maxAttempts = VerificationService.clampInt(cfg.verificationCaptchaMaxAttempts, CAPTCHA_LIMITS.maxAttempts.min, CAPTCHA_LIMITS.maxAttempts.max, 3);
      const cooldownSec = VerificationService.clampInt(cfg.verificationCaptchaCooldown, CAPTCHA_LIMITS.cooldown.min, CAPTCHA_LIMITS.cooldown.max, 10) * 60;
      const input = normalizeCaptchaInput(interaction.fields.getTextInputValue(CAPTCHA_INPUT_ID));

      const result = await this.client.redis.getClient().eval(
        CAPTCHA_CHECK_LUA, 3,
        this.redisKey('code', guildId, userId),
        this.redisKey('attempts', guildId, userId),
        this.redisKey('cooldown', guildId, userId),
        this.hashCode(guildId, userId, input),
        String(maxAttempts),
        String(cooldownSec),
        String(CAPTCHA_ATTEMPTS_WINDOW),
      ) as [number, number];
      const status = Number(result?.[0]);
      const value  = Number(result?.[1]);
      const until  = `<t:${Math.floor(Date.now() / 1000) + Math.max(value, 0)}:R>`;

      if (status === -2) {
        await interaction.editReply({ content: i18n.t('verification.captcha.cooldown', lang, { time: until }) });
        return;
      }
      if (status === -1) {
        await interaction.editReply({ content: i18n.t('verification.captcha.expired', lang) });
        return;
      }
      if (status === 0) {
        await interaction.editReply({ content: i18n.t('verification.captcha.wrong', lang, { remaining: String(value) }) });
        return;
      }
      if (status === -3) {
        await interaction.editReply({ content: i18n.t('verification.captcha.locked', lang, { time: until }) });
        logger.info(`[Verification] Captcha attempts exhausted by ${userId} in guild ${guildId}`);
        if (cfg.verificationCaptchaFailAction === 'kick') {
          await this.kickUnverified(member, i18n.t('verification.captcha.kick_reason', lang), 'captcha');
        }
        return;
      }
      if (status !== 1) {
        await interaction.editReply({ content: i18n.t('common.error', lang) });
        return;
      }

      // Success: assign the role with the same safeguards as button mode
      const check = checkSelfAssignableRole(guild, cfg.verificationRole);
      if (!check.ok || !check.role) {
        await interaction.editReply({
          content: check.problem === 'not_found'
            ? i18n.t('verification.role_not_found', lang)
            : i18n.t('autorole.button.cannot_assign', lang),
        });
        return;
      }
      await member.roles.add(check.role, 'Verification (captcha)');
      await this.clearDeadline(guildId, userId);
      await interaction.editReply({ content: i18n.t('verification.verified', lang) });
      logger.info(`[Verification] ${member.user.tag} verified via captcha in guild ${guildId}`);
    } catch (err) {
      logger.error('VerificationService.handleCaptchaModal error:', err);
      const content = (err as any)?.code === 50013
        ? i18n.t('verification.no_permission', lang)
        : i18n.t('common.error', lang);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content }).catch(() => {});
      } else {
        await interaction.reply({ content, ephemeral: true }).catch(() => {});
      }
    }
  }

  /** Kicks an unverified member if the bot is able to (notifies via DM first) */
  private async kickUnverified(member: GuildMember, reason: string, cause: 'captcha' | 'timeout'): Promise<boolean> {
    const me = member.guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.KickMembers) || !member.kickable) {
      logger.warn(`[Verification] Cannot kick ${member.id} in guild ${member.guild.id} (${cause}): missing permission or hierarchy`);
      return false;
    }
    const lang = i18n.getGuildLanguage(member.guild.id);
    await member.send({
      content: i18n.t(`verification.kick_dm.${cause}`, lang, { server: member.guild.name }),
      allowedMentions: { parse: [] },
    }).catch(() => {});
    const ok = await member.kick(reason.slice(0, 512)).then(() => true).catch((err) => {
      logger.warn(`[Verification] Kick failed for ${member.id} in guild ${member.guild.id}:`, err);
      return false;
    });
    await this.clearDeadline(member.guild.id, member.id);
    return ok;
  }

  // ═══════════════════════════════════════════════════════════════
  // VERIFICATION DEADLINE (persisted in Redis: survives restarts)
  // ═══════════════════════════════════════════════════════════════

  private deadlinesKey(): string {
    return `${process.env.REDIS_PREFIX || 'korex:'}verify:deadlines`;
  }

  /** On join: schedules a kick if not verified in time (only if enabled) */
  async scheduleDeadline(member: GuildMember): Promise<void> {
    if (member.user.bot || !this.redisReady()) return;
    const cfg = await this.getConfig(member.guild.id);
    if (!cfg?.verificationEnabled || !cfg.verificationRole) return;
    const minutes = VerificationService.clampInt(cfg.verificationTimeoutMinutes, CAPTCHA_LIMITS.timeoutMinutes.min, CAPTCHA_LIMITS.timeoutMinutes.max, 0);
    if (minutes <= 0 || member.roles.cache.has(cfg.verificationRole)) return;
    await this.client.redis.getClient().zadd(this.deadlinesKey(), Date.now() + minutes * 60_000, `${member.guild.id}:${member.id}`);
  }

  async clearDeadline(guildId: string, userId: string): Promise<void> {
    if (!this.redisReady()) return;
    await this.client.redis.getClient().zrem(this.deadlinesKey(), `${guildId}:${userId}`).catch(() => {});
  }

  /** Processes expired deadlines for the servers of this process/shard */
  async processDueDeadlines(): Promise<number> {
    if (!this.redisReady()) return 0;
    const redis = this.client.redis.getClient();
    const key = this.deadlinesKey();
    const due = await redis.zrangebyscore(key, '-inf', String(Date.now()), 'LIMIT', 0, 500);
    let kicked = 0;
    for (const entry of due) {
      const [guildId, userId] = entry.split(':');
      if (!guildId || !userId) { await redis.zrem(key, entry); continue; }
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) {
        // Without sharding, a missing server is one the bot has left
        if (!this.client.shard) await redis.zrem(key, entry);
        continue;
      }
      // Atomic claim: if another process already took it, skip
      if ((await redis.zrem(key, entry)) !== 1) continue;
      try {
        const cfg = await this.getConfig(guildId);
        if (!cfg?.verificationEnabled || !cfg.verificationRole || !(cfg.verificationTimeoutMinutes > 0)) continue;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member || member.user.bot || member.roles.cache.has(cfg.verificationRole)) continue;
        const lang = i18n.getGuildLanguage(guildId);
        if (await this.kickUnverified(member, i18n.t('verification.timeout_kick_reason', lang), 'timeout')) kicked++;
      } catch (err) {
        logger.error('VerificationService.processDueDeadlines error:', err);
      }
    }
    return kicked;
  }

  private deadlineWorker: NodeJS.Timeout | null = null;

  /** Starts the verification deadline sweep (every 60 s). Idempotent. */
  startDeadlineWorker(): void {
    if (this.deadlineWorker) return;
    const run = () => {
      this.processDueDeadlines()
        .then(n => { if (n > 0) logger.info(`[Verification] Kicked ${n} member(s) for not verifying in time`); })
        .catch(() => {});
    };
    run();
    this.deadlineWorker = setInterval(run, DEADLINE_SWEEP_MS);
  }
}
