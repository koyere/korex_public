import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  Colors,
  ChannelType,
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { checkSelfAssignableRole } from '../../utils/roleSafety';
import { VerificationService, CAPTCHA_LIMITS } from '../../services/VerificationService';
import { i18n } from '../../utils/i18n';

export default class VerificationCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'verification',
      description: 'Manage the server verification system',
      category: 'admin',
      permissions: {
        user: [PermissionFlagsBits.ManageGuild],
        bot:  [PermissionFlagsBits.ManageRoles, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AddReactions],
      },
      guildOnly: true,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('verification')
      .setDescription(i18n.t('verification.cmd_description', 'global'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand(sub =>
        sub
          .setName('setup')
          .setDescription(i18n.t('verification.cmd_setup_desc', 'global'))
          .addChannelOption(opt =>
            opt.setName('channel')
              .setDescription(i18n.t('verification.cmd_setup_channel', 'global'))
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true)
          )
          .addRoleOption(opt =>
            opt.setName('role')
              .setDescription(i18n.t('verification.cmd_setup_role', 'global'))
              .setRequired(true)
          )
          .addStringOption(opt =>
            opt.setName('type')
              .setDescription(i18n.t('verification.cmd_setup_type', 'global'))
              .addChoices(
                { name: 'Button (recommended)', value: 'button' },
                { name: 'Reaction',             value: 'reaction' },
                { name: 'Captcha (image code)', value: 'captcha' },
              )
          )
          .addStringOption(opt =>
            opt.setName('emoji')
              .setDescription(i18n.t('verification.cmd_setup_emoji', 'global'))
          )
          .addStringOption(opt =>
            opt.setName('title')
              .setDescription(i18n.t('verification.cmd_setup_title', 'global'))
          )
          .addStringOption(opt =>
            opt.setName('description')
              .setDescription(i18n.t('verification.cmd_setup_desc_opt', 'global'))
          )
      )
      .addSubcommand(sub =>
        sub
          .setName('redeploy')
          .setDescription(i18n.t('verification.cmd_redeploy_desc', 'global'))
      )
      .addSubcommand(sub =>
        sub
          .setName('disable')
          .setDescription(i18n.t('verification.cmd_disable_desc', 'global'))
      )
      .addSubcommand(sub =>
        sub
          .setName('captcha')
          .setDescription(i18n.t('verification.cmd_captcha_desc', 'global'))
          .addIntegerOption(opt =>
            opt.setName('attempts')
              .setDescription(i18n.t('verification.cmd_captcha_attempts', 'global'))
              .setMinValue(CAPTCHA_LIMITS.maxAttempts.min)
              .setMaxValue(CAPTCHA_LIMITS.maxAttempts.max)
          )
          .addIntegerOption(opt =>
            opt.setName('cooldown')
              .setDescription(i18n.t('verification.cmd_captcha_cooldown', 'global'))
              .setMinValue(CAPTCHA_LIMITS.cooldown.min)
              .setMaxValue(CAPTCHA_LIMITS.cooldown.max)
          )
          .addStringOption(opt =>
            opt.setName('fail_action')
              .setDescription(i18n.t('verification.cmd_captcha_fail_action', 'global'))
              .addChoices(
                { name: 'Do nothing', value: 'none' },
                { name: 'Kick',       value: 'kick' },
              )
          )
      )
      .addSubcommand(sub =>
        sub
          .setName('timeout')
          .setDescription(i18n.t('verification.cmd_timeout_desc', 'global'))
          .addIntegerOption(opt =>
            opt.setName('minutes')
              .setDescription(i18n.t('verification.cmd_timeout_minutes', 'global'))
              .setMinValue(CAPTCHA_LIMITS.timeoutMinutes.min)
              .setMaxValue(CAPTCHA_LIMITS.timeoutMinutes.max)
              .setRequired(true)
          )
      )
      .addSubcommand(sub =>
        sub
          .setName('status')
          .setDescription(i18n.t('verification.cmd_status_desc', 'global'))
      ) as SlashCommandBuilder;
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId    = interaction.guildId!;
    const lang       = i18n.getGuildLanguage(guildId);
    const subcommand = interaction.options.getSubcommand();
    const svc        = (this.client as any).verificationService;

    await interaction.deferReply({ ephemeral: true });

    switch (subcommand) {
      case 'setup': {
        const channel     = interaction.options.getChannel('channel', true);
        const role        = interaction.options.getRole('role', true);
        const type        = interaction.options.getString('type')        ?? 'button';
        const rawEmoji    = interaction.options.getString('emoji')       ?? '✅';
        // Normalize emoji input
        const emoji = VerificationService.normalizeEmoji(rawEmoji);
        // Anyone who presses "Verify" gets this role: it must be safe
        const actor = await interaction.guild!.members.fetch(interaction.user.id).catch(() => null);
        const roleCheck = checkSelfAssignableRole(interaction.guild!, role.id, actor);
        if (!roleCheck.ok) {
          await interaction.editReply({
            content: i18n.t(`autorole.wizard.role_${roleCheck.problem}`, lang, { role: `<@&${role.id}>` }),
          });
          return;
        }

        const embedTitle  = interaction.options.getString('title')       ?? i18n.t('verification.embed_title_default', lang);
        const embedDesc   = interaction.options.getString('description') ?? i18n.t('verification.embed_desc_default',  lang);

        // Without the web dashboard, the channel can only change here: remove the
        // previous panel from the old channel so it does not stay orphaned.
        const prev = await svc.getConfig(guildId);
        if (prev?.verificationMessageId && prev.verificationChannel && prev.verificationChannel !== channel.id) {
          const oldChannel = await interaction.guild!.channels.fetch(prev.verificationChannel).catch(() => null);
          if (oldChannel?.isTextBased()) {
            const oldMsg = await oldChannel.messages.fetch(prev.verificationMessageId).catch(() => null);
            await oldMsg?.delete().catch(() => {});
          }
        }

        await svc.saveConfig(guildId, {
          verificationEnabled:    true,
          verificationChannel:    channel.id,
          verificationRole:       role.id,
          verificationType:       type,
          verificationEmoji:      emoji,
          verificationEmbedTitle: embedTitle,
          verificationEmbedDesc:  embedDesc,
        });

        const result = await svc.deploy(guildId);

        if (!result.success) {
          await interaction.editReply({ content: i18n.t(`verification.deploy_errors.${result.error}`, lang) });
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle(`✅ ${i18n.t('verification.setup_success', lang)}`)
          .setColor(Colors.Green)
          .addFields(
            { name: i18n.t('verification.setup_channel', lang), value: `<#${channel.id}>`, inline: true },
            { name: i18n.t('verification.setup_role',    lang), value: `<@&${role.id}>`,   inline: true },
            { name: i18n.t('verification.setup_type',    lang), value: type,               inline: true },
            { name: i18n.t('verification.setup_emoji',   lang), value: emoji,              inline: true },
          );

        await interaction.editReply({ embeds: [embed] });
        break;
      }

      case 'redeploy': {
        const result = await svc.deploy(guildId);

        if (!result.success) {
          const msg = result.error === 'not_configured'
            ? i18n.t('verification.not_configured', lang)
            : i18n.t(`verification.deploy_errors.${result.error}`, lang);
          await interaction.editReply({ content: msg });
          return;
        }

        const cfg = await svc.getConfig(guildId);
        await interaction.editReply({
          content: i18n.t('verification.redeployed', lang, { channel: `<#${cfg?.verificationChannel}>` }),
        });
        break;
      }

      case 'captcha': {
        const attempts   = interaction.options.getInteger('attempts');
        const cooldown   = interaction.options.getInteger('cooldown');
        const failAction = interaction.options.getString('fail_action');

        const data: Record<string, unknown> = {};
        if (attempts !== null)   data.verificationCaptchaMaxAttempts = attempts;
        if (cooldown !== null)   data.verificationCaptchaCooldown    = cooldown;
        if (failAction !== null) data.verificationCaptchaFailAction  = failAction === 'kick' ? 'kick' : 'none';

        if (Object.keys(data).length > 0) await svc.saveConfig(guildId, data);
        const cfg = await svc.getConfig(guildId);

        const lines = [
          `✅ ${i18n.t('verification.captcha_saved', lang)}`,
          `• ${i18n.t('verification.status_captcha_attempts', lang)}: **${cfg?.verificationCaptchaMaxAttempts ?? 3}**`,
          `• ${i18n.t('verification.status_captcha_cooldown', lang)}: **${i18n.t('verification.minutes', lang, { count: String(cfg?.verificationCaptchaCooldown ?? 10) })}**`,
          `• ${i18n.t('verification.status_captcha_fail_action', lang)}: **${i18n.t(`verification.fail_action.${cfg?.verificationCaptchaFailAction === 'kick' ? 'kick' : 'none'}`, lang)}**`,
        ];
        if (cfg?.verificationType !== 'captcha') lines.push(`ℹ️ ${i18n.t('verification.captcha_type_hint', lang)}`);
        if (cfg?.verificationCaptchaFailAction === 'kick' && !interaction.guild!.members.me?.permissions.has(PermissionFlagsBits.KickMembers)) {
          lines.push(`⚠️ ${i18n.t('verification.kick_permission_warning', lang)}`);
        }
        await interaction.editReply({ content: lines.join('\n'), allowedMentions: { parse: [] } });
        break;
      }

      case 'timeout': {
        const minutes = interaction.options.getInteger('minutes', true);
        await svc.saveConfig(guildId, { verificationTimeoutMinutes: minutes });

        const lines = [minutes > 0
          ? `✅ ${i18n.t('verification.timeout_saved', lang, { minutes: String(minutes) })}`
          : `✅ ${i18n.t('verification.timeout_disabled', lang)}`];
        if (minutes > 0 && !interaction.guild!.members.me?.permissions.has(PermissionFlagsBits.KickMembers)) {
          lines.push(`⚠️ ${i18n.t('verification.kick_permission_warning', lang)}`);
        }
        await interaction.editReply({ content: lines.join('\n'), allowedMentions: { parse: [] } });
        break;
      }

      case 'disable': {
        await svc.saveConfig(guildId, { verificationEnabled: false });
        await interaction.editReply({ content: `🔴 ${i18n.t('verification.disabled', lang)}` });
        break;
      }

      case 'status': {
        const cfg = await svc.getConfig(guildId);

        const embed = new EmbedBuilder()
          .setTitle(i18n.t('verification.status_title', lang))
          .setColor(cfg?.verificationEnabled ? Colors.Green : Colors.Red)
          .addFields(
            {
              name: i18n.t('verification.status_label', lang),
              value: cfg?.verificationEnabled
                ? `🟢 ${i18n.t('verification.status_enabled', lang)}`
                : `🔴 ${i18n.t('verification.status_disabled', lang)}`,
              inline: true,
            },
            { name: i18n.t('verification.status_channel', lang), value: cfg?.verificationChannel ? `<#${cfg.verificationChannel}>` : '—', inline: true },
            { name: i18n.t('verification.status_role',    lang), value: cfg?.verificationRole    ? `<@&${cfg.verificationRole}>`   : '—', inline: true },
            { name: i18n.t('verification.status_type',    lang), value: cfg?.verificationType    ?? 'button',                         inline: true },
            { name: i18n.t('verification.status_emoji',   lang), value: cfg?.verificationEmoji   ?? '✅',                            inline: true },
            {
              name: i18n.t('verification.status_timeout', lang),
              value: (cfg?.verificationTimeoutMinutes ?? 0) > 0
                ? i18n.t('verification.minutes', lang, { count: String(cfg.verificationTimeoutMinutes) })
                : i18n.t('verification.status_disabled', lang),
              inline: true,
            },
          );
        if (cfg?.verificationType === 'captcha') {
          embed.addFields(
            { name: i18n.t('verification.status_captcha_attempts',    lang), value: String(cfg.verificationCaptchaMaxAttempts ?? 3), inline: true },
            { name: i18n.t('verification.status_captcha_cooldown',    lang), value: i18n.t('verification.minutes', lang, { count: String(cfg.verificationCaptchaCooldown ?? 10) }), inline: true },
            { name: i18n.t('verification.status_captcha_fail_action', lang), value: i18n.t(`verification.fail_action.${cfg.verificationCaptchaFailAction === 'kick' ? 'kick' : 'none'}`, lang), inline: true },
          );
        }

        await interaction.editReply({ embeds: [embed] });
        break;
      }
    }
  }
}
