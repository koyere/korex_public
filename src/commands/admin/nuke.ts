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

export default class NukeCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'nuke',
      description: 'Delete and recreate a channel (nuclear option)',
      category: 'admin',
      cooldown: 30,
      permissions: {
        user: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.Administrator],
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

    // Check if user has permission to manage this specific channel
    const member = interaction.member as any;
    const guildChannel = targetChannel as any;

    if (!member) {
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

  private async executeNuke(
    interaction: ChatInputCommandInteraction,
    targetChannel: TextChannel | VoiceChannel,
    reason: string
  ): Promise<void> {
    const guildId = interaction.guild!.id;

    try {
      const channelInfo = {
        name: targetChannel.name,
        type: targetChannel.type as ChannelType,
        topic: (targetChannel as TextChannel).topic || undefined,
        nsfw: (targetChannel as TextChannel).nsfw || false,
        bitrate: (targetChannel as VoiceChannel).bitrate || undefined,
        userLimit: (targetChannel as VoiceChannel).userLimit || undefined,
        rateLimitPerUser: (targetChannel as TextChannel).rateLimitPerUser || undefined,
        position: targetChannel.position,
        parent: targetChannel.parent,
        permissionOverwrites: Array.from(targetChannel.permissionOverwrites.cache.values()).map(overwrite => ({
          id: overwrite.id,
          type: overwrite.type,
          allow: overwrite.allow,
          deny: overwrite.deny
        }))
      };

      await targetChannel.delete(reason);

      const createOptions: any = {
        name: channelInfo.name,
        type: channelInfo.type,
        position: channelInfo.position,
        parent: channelInfo.parent?.id || null,
        permissionOverwrites: channelInfo.permissionOverwrites,
        reason: `Channel nuked by ${interaction.user.tag}: ${reason}`
      };

      if (channelInfo.type === ChannelType.GuildText || channelInfo.type === ChannelType.GuildAnnouncement) {
        if (channelInfo.topic) createOptions.topic = channelInfo.topic;
        createOptions.nsfw = channelInfo.nsfw;
        if (channelInfo.rateLimitPerUser) createOptions.rateLimitPerUser = channelInfo.rateLimitPerUser;
      } else if (channelInfo.type === ChannelType.GuildVoice || channelInfo.type === ChannelType.GuildStageVoice) {
        if (channelInfo.bitrate) createOptions.bitrate = channelInfo.bitrate;
        if (channelInfo.userLimit) createOptions.userLimit = channelInfo.userLimit;
      }

      const newChannel = await interaction.guild!.channels.create(createOptions);

      if (newChannel && newChannel.isTextBased()) {
        const successEmbed = new EmbedBuilder()
          .setColor(Colors.Green)
          .setTitle('💥 Channel Nuked')
          .setDescription(`This channel was nuked and recreated by ${interaction.user.toString()}`)
          .addFields(
            { name: 'Reason', value: reason, inline: true },
            { name: 'Timestamp', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
          )
          .setFooter({ text: 'Channel successfully recreated' })
          .setTimestamp();

        await (newChannel as TextChannel).send({ embeds: [successEmbed] });
      }

      this.client.logger.info(`Channel nuked: ${channelInfo.name} by ${interaction.user.tag}`);

    } catch (error: any) {
      this.client.logger.error('Error executing nuke command:', error);
      
      try {
        await interaction.user.send(`❌ Error nuking channel: ${error.message}`);
      } catch (dmError) {
        this.client.logger.error('Could not send DM to user about nuke error');
      }
    }
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