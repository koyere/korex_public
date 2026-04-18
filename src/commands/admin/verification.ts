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
        let emoji = rawEmoji.trim();
        if (emoji.startsWith(':') && emoji.endsWith(':')) emoji = emoji.slice(1, -1);
        const EMOJI_MAP: Record<string, string> = {
          white_check_mark: '✅', heavy_check_mark: '✔️', check: '✔️',
          x: '❌', thumbsup: '👍', thumbsdown: '👎', heart: '❤️',
          star: '⭐', fire: '🔥', wave: '👋',
        };
        emoji = EMOJI_MAP[emoji] ?? emoji;
        const embedTitle  = interaction.options.getString('title')       ?? i18n.t('verification.embed_title_default', lang);
        const embedDesc   = interaction.options.getString('description') ?? i18n.t('verification.embed_desc_default',  lang);

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
          await interaction.editReply({ content: `❌ Deploy failed: ${result.error}` });
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
            : `❌ ${result.error}`;
          await interaction.editReply({ content: msg });
          return;
        }

        const cfg = await svc.getConfig(guildId);
        await interaction.editReply({
          content: i18n.t('verification.redeployed', lang, { channel: `<#${cfg?.verificationChannel}>` }),
        });
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
              name: 'Status',
              value: cfg?.verificationEnabled
                ? `🟢 ${i18n.t('verification.status_enabled', lang)}`
                : `🔴 ${i18n.t('verification.status_disabled', lang)}`,
              inline: true,
            },
            { name: i18n.t('verification.status_channel', lang), value: cfg?.verificationChannel ? `<#${cfg.verificationChannel}>` : '—', inline: true },
            { name: i18n.t('verification.status_role',    lang), value: cfg?.verificationRole    ? `<@&${cfg.verificationRole}>`   : '—', inline: true },
            { name: i18n.t('verification.status_type',    lang), value: cfg?.verificationType    ?? 'button',                         inline: true },
            { name: i18n.t('verification.status_emoji',   lang), value: cfg?.verificationEmoji   ?? '✅',                            inline: true },
          );

        await interaction.editReply({ embeds: [embed] });
        break;
      }
    }
  }
}
