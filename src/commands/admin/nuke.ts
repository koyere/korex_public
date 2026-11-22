import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  Colors,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  TextChannel,
  VoiceChannel,
  CategoryChannel,
  ChannelType,
  OverwriteResolvable
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { memberCanInChannel } from '../../utils/permissions';
import { remapChannelReferences } from '../../services/ChannelReferenceRemap';

export default class NukeCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'nuke',
      description: 'Delete and recreate a channel (nuclear option)',
      category: 'admin',
      cooldown: 30,
      // The permission is required in the channel being deleted, not the invoking one (G·BOT-02)
      permissionScope: 'channel',
      permissions: {
        user: [PermissionFlagsBits.ManageChannels],
        bot: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]
      }
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription('Delete and recreate a channel (nuclear option)')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription('Channel to nuke (defaults to current channel)')
          .setRequired(false)
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildVoice,
            ChannelType.GuildAnnouncement,
            ChannelType.GuildStageVoice,
            ChannelType.GuildForum
          )
      )
      .addStringOption(option =>
        option
          .setName('reason')
          .setDescription('Reason for nuking the channel')
          .setMaxLength(500)
      )
      .addBooleanOption(option =>
        option
          .setName('confirm')
          .setDescription('Skip confirmation dialog (dangerous!)')
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
    const reason = interaction.options.getString('reason') || i18n.t('nuke.default_reason', interaction.guild!.id);
    const skipConfirm = interaction.options.getBoolean('confirm') || false;
    const guildId = interaction.guild!.id;

    // Validate channel (simplified)
    if (!targetChannel) {
      await interaction.reply({
        content: i18n.t('nuke.invalid_channel', guildId),
        ephemeral: true
      });

      return;
    }

    // The user must be able to manage THAT channel (only the invoking one used to be checked)
    const canManageTarget = await memberCanInChannel(interaction, targetChannel as any, [PermissionFlagsBits.ManageChannels]);

    if (!canManageTarget) {
      await interaction.reply({
        content: i18n.t('nuke.no_permission', guildId),
        ephemeral: true
      });

      return;
    }

    // Skip confirmation if requested
    if (skipConfirm) {
      await this.executeNuke(interaction, targetChannel as any, reason);

      return;
    }

    // Show confirmation dialog
    await this.showConfirmation(interaction, targetChannel as any, reason);
  }

  private async showConfirmation(
    interaction: ChatInputCommandInteraction,
    targetChannel: TextChannel | VoiceChannel,
    reason: string
  ): Promise<void> {
    const guildId = interaction.guild!.id;

    const embed = new EmbedBuilder()
      .setColor(Colors.Red)
      .setTitle(i18n.t('nuke.confirmation.title', guildId))
      .setDescription(i18n.t('nuke.confirmation.description', guildId, {
        channel: targetChannel.name,
        type: this.getChannelTypeName(targetChannel.type, guildId)
      }))
      .addFields(
        {
          name: i18n.t('nuke.confirmation.channel', guildId),
          value: `${targetChannel} (${targetChannel.name})`,
          inline: true
        },
        {
          name: i18n.t('nuke.confirmation.reason', guildId),
          value: reason,
          inline: true
        },
        {
          name: i18n.t('nuke.confirmation.warning', guildId),
          value: i18n.t('nuke.confirmation.warning_text', guildId),
          inline: false
        }
      )
      .setFooter({ text: i18n.t('nuke.confirmation.footer', guildId) })
      .setTimestamp();

    const confirmButton = new ButtonBuilder()
      .setCustomId('nuke_confirm')
      .setLabel(i18n.t('nuke.buttons.confirm', guildId))
      .setStyle(ButtonStyle.Danger)
      .setEmoji('💥');

    const cancelButton = new ButtonBuilder()
      .setCustomId('nuke_cancel')
      .setLabel(i18n.t('nuke.buttons.cancel', guildId))
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('❌');

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(confirmButton, cancelButton);

    const response = await interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: true,
      fetchReply: true
    });

    // Handle button interactions with proper filter
    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (i) => i.user.id === interaction.user.id,
      time: 30000 // 30 seconds
    });

    collector.on('collect', async (buttonInteraction) => {
      if (buttonInteraction.customId === 'nuke_confirm') {
        await buttonInteraction.update({
          content: '💥 Nuking channel...',
          embeds: [],
          components: []
        });
        await this.executeNuke(interaction, targetChannel, reason);
        collector.stop();
      } else if (buttonInteraction.customId === 'nuke_cancel') {
        await buttonInteraction.update({
          content: i18n.t('nuke.cancelled', guildId),
          embeds: [],
          components: []
        });
        collector.stop();
      }
    });

    collector.on('end', async (collected) => {
      if (collected.size === 0) {
        await interaction.editReply({
          content: i18n.t('nuke.timeout', guildId),
          embeds: [],
          components: []
        }).catch(() => {});
      }
    });
  }

  /**
   * Recreates the channel: the new one is created first and the old one is deleted
   * only if that succeeds (if deleting fails, the creation is undone); settings that
   * pointed at the old channel are moved to the new one; the interaction is always
   * answered and the action is recorded in the log channel.
   */
  private async executeNuke(
    interaction: ChatInputCommandInteraction,
    targetChannel: TextChannel | VoiceChannel,
    reason: string
  ): Promise<void> {
    const guild = interaction.guild!;
    const guildId = guild.id;
    const isCurrent = interaction.channelId === targetChannel.id;
    const respond = async (content: string) => {
      try {
        if (interaction.replied || interaction.deferred) await interaction.editReply({ content, embeds: [], components: [] });
        else await interaction.reply({ content, ephemeral: true });
      } catch { /* the interaction may have expired or its channel may no longer exist */ }
    };
    if (!interaction.replied && !interaction.deferred) await interaction.deferReply({ ephemeral: true }).catch(() => undefined);

    const createOptions: any = {
      name: targetChannel.name,
      type: targetChannel.type,
      position: targetChannel.position,
      parent: targetChannel.parent?.id || null,
      permissionOverwrites: Array.from(targetChannel.permissionOverwrites.cache.values()).map(o => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny })),
      reason: `Channel nuked by ${interaction.user.tag}: ${reason}`.slice(0, 500),
    };
    const kind = targetChannel.type as ChannelType;
    if (kind === ChannelType.GuildText || kind === ChannelType.GuildAnnouncement) {
      const text = targetChannel as TextChannel;
      if (text.topic) createOptions.topic = text.topic;
      createOptions.nsfw = text.nsfw || false;
      if (text.rateLimitPerUser) createOptions.rateLimitPerUser = text.rateLimitPerUser;
    } else if (kind === ChannelType.GuildVoice || kind === ChannelType.GuildStageVoice) {
      const voice = targetChannel as VoiceChannel;
      if (voice.bitrate) createOptions.bitrate = voice.bitrate;
      if (voice.userLimit) createOptions.userLimit = voice.userLimit;
    }

    // 1) Create the new channel BEFORE deleting anything
    let newChannel: any;
    try {
      newChannel = await guild.channels.create(createOptions);
    } catch (error: any) {
      this.client.logger.warn(`[nuke] No se pudo crear el canal de reemplazo en ${guildId}: ${error?.message}`);
      await respond(i18n.t('nuke.recreate_failed', guildId, { error: String(error?.message ?? error).slice(0, 200) }));
      return;
    }

    // 2) Delete the old one; if that fails, undo the creation
    const oldId = targetChannel.id;
    try {
      await targetChannel.delete(reason.slice(0, 500));
    } catch (error: any) {
      await newChannel.delete('Nuke aborted: the original channel could not be deleted').catch(() => undefined);
      await respond(i18n.t('nuke.delete_failed', guildId, { error: String(error?.message ?? error).slice(0, 200) }));
      return;
    }
    await newChannel.setPosition(createOptions.position).catch(() => undefined);

    // 3) Settings that pointed at the old channel → new channel
    const remapped = await remapChannelReferences((this.client as any).db, guildId, oldId, newChannel.id).catch(() => 0);

    // 4) Confirmation in the new channel, reply to the requester and log entry
    if (newChannel.isTextBased?.()) {
      const successEmbed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle(i18n.t('nuke.recreated.title', guildId))
        .setDescription(i18n.t('nuke.recreated.description', guildId, { user: interaction.user.toString() }))
        .addFields(
          { name: i18n.t('moderation.log.reason', guildId), value: reason.slice(0, 1024), inline: true },
          { name: i18n.t('moderation.log.time', guildId), value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
        )
        .setFooter({ text: i18n.t('nuke.recreated.footer', guildId) })
        .setTimestamp();
      await newChannel.send({ embeds: [successEmbed], allowedMentions: { parse: [] } }).catch(() => undefined);
    }
    if (!isCurrent) await respond(i18n.t('nuke.done', guildId, { channel: `<#${newChannel.id}>`, count: String(remapped) }));

    try {
      const cfg = await (this.client as any).db.loggingConfig.findUnique({ where: { guildId }, select: { moderationLogChannel: true } });
      const logChannel = cfg?.moderationLogChannel ? guild.channels.cache.get(cfg.moderationLogChannel) as TextChannel | undefined : undefined;
      if (logChannel?.isTextBased()) {
        await logChannel.send({
          embeds: [new EmbedBuilder()
            .setColor(Colors.Orange)
            .setTitle(i18n.t('nuke.log_title', guildId))
            .setDescription(i18n.t('nuke.log_desc', guildId, {
              user: interaction.user.toString(), channel: `<#${newChannel.id}>`, name: targetChannel.name, count: String(remapped),
            }))
            .addFields({ name: i18n.t('moderation.log.reason', guildId), value: reason.slice(0, 1024) })
            .setTimestamp()],
          allowedMentions: { parse: [] },
        });
      }
    } catch { /* el registro es best-effort */ }

    this.client.logger.info(`Channel nuked: ${targetChannel.name} (${oldId} → ${newChannel.id}) by ${interaction.user.tag}; ${remapped} config references moved`);
  }

  private getChannelTypeName(type: ChannelType, guildId: string): string {
    switch (type) {
      case ChannelType.GuildText:
        return i18n.t('nuke.channel_types.text', guildId);
      case ChannelType.GuildVoice:
        return i18n.t('nuke.channel_types.voice', guildId);
      case ChannelType.GuildAnnouncement:
        return i18n.t('nuke.channel_types.announcement', guildId);
      case ChannelType.GuildStageVoice:
        return i18n.t('nuke.channel_types.stage', guildId);
      case ChannelType.GuildForum:
        return i18n.t('nuke.channel_types.forum', guildId);
      default:
        return i18n.t('nuke.channel_types.unknown', guildId);
    }
  }
}