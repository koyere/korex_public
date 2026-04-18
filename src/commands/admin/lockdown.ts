import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  Colors,
  TextChannel,
  VoiceChannel,
  CategoryChannel,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  OverwriteResolvable
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

interface LockdownData {
  channelId: string;
  guildId: string;
  type: 'channel' | 'server';
  originalPermissions: Map<string, any>;
  timestamp: number;
  moderator: string;
  reason: string;
}

export default class LockdownCommand extends Command {
  private lockdowns: Map<string, LockdownData> = new Map();

  constructor(client: KorexClient) {
    super(client, {
      name: 'lockdown',
      description: 'Lock or unlock channels/server to prevent user activity',
      category: 'admin',
      cooldown: 10,
      permissions: {
        user: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.Administrator],
        bot: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]
      }
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription('Lock or unlock channels/server to prevent user activity')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .addSubcommand(subcommand =>
        subcommand
          .setName('channel')
          .setDescription('Lock or unlock a specific channel')
          .addStringOption(option =>
            option
              .setName('action')
              .setDescription('Action to perform')
              .setRequired(true)
              .addChoices(
                { name: 'Lock', value: 'lock' },
                { name: 'Unlock', value: 'unlock' }
              )
          )
          .addChannelOption(option =>
            option
              .setName('channel')
              .setDescription('Channel to lock/unlock (defaults to current)')
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
              .setDescription('Reason for lockdown')
              .setMaxLength(500)
          )
          .addBooleanOption(option =>
            option
              .setName('silent')
              .setDescription('Perform lockdown silently (no announcement)')
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('server')
          .setDescription('Lock or unlock entire server')
          .addStringOption(option =>
            option
              .setName('action')
              .setDescription('Action to perform')
              .setRequired(true)
              .addChoices(
                { name: 'Lock', value: 'lock' },
                { name: 'Unlock', value: 'unlock' }
              )
          )
          .addStringOption(option =>
            option
              .setName('reason')
              .setDescription('Reason for server lockdown')
              .setMaxLength(500)
          )
          .addBooleanOption(option =>
            option
              .setName('silent')
              .setDescription('Perform lockdown silently (no announcement)')
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('status')
          .setDescription('Check lockdown status of channels/server')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('list')
          .setDescription('List all active lockdowns in this server')
      ) as SlashCommandBuilder;
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'channel':
        await this.handleChannel(interaction);
        break;
      case 'server':
        await this.handleServer(interaction);
        break;
      case 'status':
        await this.handleStatus(interaction);
        break;
      case 'list':
        await this.handleList(interaction);
        break;
    }
  }

  private async handleChannel(interaction: ChatInputCommandInteraction): Promise<void> {
    const action = interaction.options.getString('action', true) as 'lock' | 'unlock';
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
    const reason = interaction.options.getString('reason') || i18n.t('lockdown.default_reason', interaction.guild!.id);
    const silent = interaction.options.getBoolean('silent') || false;
    const guildId = interaction.guild!.id;

    await interaction.deferReply({ ephemeral: true });

    if (!targetChannel || !('permissionOverwrites' in targetChannel)) {
      await interaction.editReply({
        content: i18n.t('lockdown.channel.invalid_channel', guildId)
      });

      return;
    }

    try {
      if (action === 'lock') {
        await this.lockChannel(interaction, targetChannel as any, reason, silent);
      } else {
        await this.unlockChannel(interaction, targetChannel as any, reason, silent);
      }
    } catch (error) {
      this.client.logger.error('Error in channel lockdown:', error);
      await interaction.editReply({
        content: i18n.t('lockdown.channel.error', guildId)
      });
    }
  }

  private async handleServer(interaction: ChatInputCommandInteraction): Promise<void> {
    const action = interaction.options.getString('action', true) as 'lock' | 'unlock';
    const reason = interaction.options.getString('reason') || i18n.t('lockdown.default_reason', interaction.guild!.id);
    const silent = interaction.options.getBoolean('silent') || false;
    const guildId = interaction.guild!.id;

    await interaction.deferReply({ ephemeral: true });

    // Show confirmation for server lockdown
    if (!silent) {
      const confirmEmbed = new EmbedBuilder()
        .setColor(action === 'lock' ? Colors.Red : Colors.Green)
        .setTitle(i18n.t(`lockdown.server.${action}.confirm_title`, guildId))
        .setDescription(i18n.t(`lockdown.server.${action}.confirm_description`, guildId))
        .addFields(
          {
            name: i18n.t('lockdown.server.confirm.reason', guildId),
            value: reason,
            inline: true
          },
          {
            name: i18n.t('lockdown.server.confirm.affected', guildId),
            value: i18n.t('lockdown.server.confirm.all_channels', guildId),
            inline: true
          }
        )
        .setFooter({ text: i18n.t('lockdown.server.confirm.warning', guildId) });

      const confirmButton = new ButtonBuilder()
        .setCustomId(`lockdown_server_${action}_confirm`)
        .setLabel(i18n.t('lockdown.buttons.confirm', guildId))
        .setStyle(action === 'lock' ? ButtonStyle.Danger : ButtonStyle.Success)
        .setEmoji(action === 'lock' ? '🔒' : '🔓');

      const cancelButton = new ButtonBuilder()
        .setCustomId('lockdown_cancel')
        .setLabel(i18n.t('lockdown.buttons.cancel', guildId))
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('❌');

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);

      await interaction.editReply({
        embeds: [confirmEmbed],
        components: [row]
      });

      // Handle confirmation
      const collector = interaction.channel?.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 30000
      });

      collector?.on('collect', async (buttonInteraction) => {
        if (buttonInteraction.user.id !== interaction.user.id) {
          await buttonInteraction.reply({
            content: i18n.t('common.errors.not_your_interaction', guildId),
            ephemeral: true
          });

          return;
        }

        if (buttonInteraction.customId === `lockdown_server_${action}_confirm`) {
          await buttonInteraction.deferUpdate();
          if (action === 'lock') {
            await this.lockServer(interaction, reason);
          } else {
            await this.unlockServer(interaction, reason);
          }
          collector.stop();
        } else if (buttonInteraction.customId === 'lockdown_cancel') {
          await buttonInteraction.update({
            content: i18n.t('lockdown.cancelled', guildId),
            embeds: [],
            components: []
          });
          collector.stop();
        }
      });

      collector?.on('end', (collected) => {
        if (collected.size === 0) {
          interaction.editReply({
            content: i18n.t('lockdown.timeout', guildId),
            embeds: [],
            components: []
          }).catch(() => {});
        }
      });
    } else {
      // Execute immediately if silent
      try {
        if (action === 'lock') {
          await this.lockServer(interaction, reason);
        } else {
          await this.unlockServer(interaction, reason);
        }
      } catch (error) {
        this.client.logger.error('Error in server lockdown:', error);
        await interaction.editReply({
          content: i18n.t('lockdown.server.error', guildId)
        });
      }
    }
  }

  private async lockChannel(
    interaction: ChatInputCommandInteraction,
    channel: TextChannel | VoiceChannel,
    reason: string,
    silent: boolean
  ): Promise<void> {
    const guildId = interaction.guild!.id;
    const channelId = channel.id;

    // Check if already locked
    if (this.lockdowns.has(channelId)) {
      await interaction.editReply({
        content: i18n.t('lockdown.channel.already_locked', guildId)
      });

      return;
    }

    // Store original permissions
    const originalPermissions = new Map();

    for (const [id, overwrite] of channel.permissionOverwrites.cache) {
      originalPermissions.set(id, {
        allow: overwrite.allow.bitfield.toString(),
        deny: overwrite.deny.bitfield.toString()
      });
    }

    // Lock the channel by denying permissions for @everyone
    const everyoneRole = interaction.guild!.roles.everyone;
    
    // Handle text-based channels
    if (channel.isTextBased()) {
      await channel.permissionOverwrites.edit(everyoneRole, {
        SendMessages: false,
        AddReactions: false,
        CreatePublicThreads: false,
        CreatePrivateThreads: false,
        SendMessagesInThreads: false
      });
    }
    
    // Handle voice-based channels
    if (channel.isVoiceBased && channel.isVoiceBased()) {
      await channel.permissionOverwrites.edit(everyoneRole, {
        Connect: false,
        Speak: false,
        Stream: false
      });
    }

    // Store lockdown data
    this.lockdowns.set(channelId, {
      channelId,
      guildId,
      type: 'channel',
      originalPermissions,
      timestamp: Date.now(),
      moderator: interaction.user.id,
      reason
    });

    // Send announcement if not silent
    if (!silent && channel.isTextBased()) {
      const lockEmbed = new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle(i18n.t('lockdown.channel.lock.announcement.title', guildId))
        .setDescription(i18n.t('lockdown.channel.lock.announcement.description', guildId))
        .addFields(
          {
            name: i18n.t('lockdown.channel.lock.announcement.reason', guildId),
            value: reason,
            inline: true
          },
          {
            name: i18n.t('lockdown.channel.lock.announcement.moderator', guildId),
            value: `${interaction.user}`,
            inline: true
          }
        )
        .setFooter({ text: i18n.t('lockdown.channel.lock.announcement.footer', guildId) })
        .setTimestamp();

      await channel.send({ embeds: [lockEmbed] });
    }

    // Success response
    const successEmbed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle(i18n.t('lockdown.channel.lock.success.title', guildId))
      .setDescription(i18n.t('lockdown.channel.lock.success.description', guildId, { channel: channel.toString() }))
      .addFields(
        {
          name: i18n.t('lockdown.channel.lock.success.reason', guildId),
          value: reason,
          inline: true
        },
        {
          name: i18n.t('lockdown.channel.lock.success.timestamp', guildId),
          value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
          inline: true
        }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [successEmbed] });

    // Log the action (simplified)
    this.client.logger.info(`Channel locked: ${channel.name} by ${interaction.user.tag}`);
  }

  private async unlockChannel(
    interaction: ChatInputCommandInteraction,
    channel: TextChannel | VoiceChannel,
    reason: string,
    silent: boolean
  ): Promise<void> {
    const guildId = interaction.guild!.id;
    const channelId = channel.id;

    const lockdownData = this.lockdowns.get(channelId);

    if (!lockdownData) {
      await interaction.editReply({
        content: i18n.t('lockdown.channel.not_locked', guildId)
      });

      return;
    }

    // Restore original permissions
    const everyoneRole = interaction.guild!.roles.everyone;
    const originalOverwrite = lockdownData.originalPermissions.get(everyoneRole.id);

    // Restore original permissions (simplified)
    await channel.permissionOverwrites.delete(everyoneRole);

    // Remove lockdown data
    this.lockdowns.delete(channelId);

    // Send announcement if not silent
    if (!silent && channel.isTextBased()) {
      const unlockEmbed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle(i18n.t('lockdown.channel.unlock.announcement.title', guildId))
        .setDescription(i18n.t('lockdown.channel.unlock.announcement.description', guildId))
        .addFields(
          {
            name: i18n.t('lockdown.channel.unlock.announcement.reason', guildId),
            value: reason,
            inline: true
          },
          {
            name: i18n.t('lockdown.channel.unlock.announcement.moderator', guildId),
            value: `${interaction.user}`,
            inline: true
          }
        )
        .setFooter({ text: i18n.t('lockdown.channel.unlock.announcement.footer', guildId) })
        .setTimestamp();

      await channel.send({ embeds: [unlockEmbed] });
    }

    // Success response
    const successEmbed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle(i18n.t('lockdown.channel.unlock.success.title', guildId))
      .setDescription(i18n.t('lockdown.channel.unlock.success.description', guildId, { channel: channel.toString() }))
      .addFields(
        {
          name: i18n.t('lockdown.channel.unlock.success.duration', guildId),
          value: this.formatDuration(Date.now() - lockdownData.timestamp, guildId),
          inline: true
        },
        {
          name: i18n.t('lockdown.channel.unlock.success.reason', guildId),
          value: reason,
          inline: true
        }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [successEmbed] });

    // Log the action (simplified)
    this.client.logger.info(`Channel unlocked: ${channel.name} by ${interaction.user.tag}`);
  }

  private async lockServer(interaction: ChatInputCommandInteraction, reason: string): Promise<void> {
    const guildId = interaction.guild!.id;
    let lockedChannels = 0;
    let failedChannels = 0;

    const channels = interaction.guild!.channels.cache.filter(channel => {
      const type = channel.type;

      return type === ChannelType.GuildText || 
             type === ChannelType.GuildVoice ||
             type === ChannelType.GuildAnnouncement ||
             type === ChannelType.GuildStageVoice;
    });

    for (const [, channel] of channels) {
      try {
        if (this.lockdowns.has(channel.id)) continue; // Skip already locked channels

        // Store original permissions
        const originalPermissions = new Map();

        for (const [id, overwrite] of (channel as any).permissionOverwrites.cache) {
          originalPermissions.set(id, {
            allow: overwrite.allow.bitfield.toString(),
            deny: overwrite.deny.bitfield.toString()
          });
        }

        const everyoneRole = interaction.guild!.roles.everyone;
        
        // Handle text-based channels
        if ((channel as any).isTextBased && (channel as any).isTextBased()) {
          await (channel as TextChannel).permissionOverwrites.edit(everyoneRole, {
            SendMessages: false,
            AddReactions: false,
            CreatePublicThreads: false,
            CreatePrivateThreads: false,
            SendMessagesInThreads: false
          });
        }
        
        // Handle voice-based channels  
        if ((channel as any).isVoiceBased && (channel as any).isVoiceBased()) {
          await (channel as VoiceChannel).permissionOverwrites.edit(everyoneRole, {
            Connect: false,
            Speak: false,
            Stream: false
          });
        }

        // Store lockdown data
        this.lockdowns.set(channel.id, {
          channelId: channel.id,
          guildId,
          type: 'server',
          originalPermissions,
          timestamp: Date.now(),
          moderator: interaction.user.id,
          reason
        });

        lockedChannels++;
      } catch (error) {
        this.client.logger.error(`Failed to lock channel ${channel.name}:`, error);
        failedChannels++;
      }
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.Red)
      .setTitle(i18n.t('lockdown.server.lock.success.title', guildId))
      .setDescription(i18n.t('lockdown.server.lock.success.description', guildId))
      .addFields(
        {
          name: i18n.t('lockdown.server.lock.success.locked', guildId),
          value: lockedChannels.toString(),
          inline: true
        },
        {
          name: i18n.t('lockdown.server.lock.success.failed', guildId),
          value: failedChannels.toString(),
          inline: true
        },
        {
          name: i18n.t('lockdown.server.lock.success.reason', guildId),
          value: reason,
          inline: false
        }
      )
      .setFooter({ text: i18n.t('lockdown.server.lock.success.footer', guildId) })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    // Log the action (simplified)
    this.client.logger.info(`Server locked: ${lockedChannels} channels by ${interaction.user.tag}`);
  }

  private async unlockServer(interaction: ChatInputCommandInteraction, reason: string): Promise<void> {
    const guildId = interaction.guild!.id;
    let unlockedChannels = 0;
    let failedChannels = 0;

    // Get all lockdowns for this server
    const serverLockdowns = Array.from(this.lockdowns.values()).filter(lockdown => lockdown.guildId === guildId);

    for (const lockdownData of serverLockdowns) {
      try {
        const channel = interaction.guild!.channels.cache.get(lockdownData.channelId);

        if (!channel || !('permissionOverwrites' in channel)) continue;

        // Restore original permissions
        const everyoneRole = interaction.guild!.roles.everyone;
        const originalOverwrite = lockdownData.originalPermissions.get(everyoneRole.id);

        if (originalOverwrite) {
          await (channel as any).permissionOverwrites.edit(everyoneRole, {
            allow: BigInt(originalOverwrite.allow),
            deny: BigInt(originalOverwrite.deny)
          });
        } else {
          await (channel as any).permissionOverwrites.delete(everyoneRole);
        }

        this.lockdowns.delete(lockdownData.channelId);
        unlockedChannels++;
      } catch (error) {
        this.client.logger.error(`Failed to unlock channel ${lockdownData.channelId}:`, error);
        failedChannels++;
      }
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle(i18n.t('lockdown.server.unlock.success.title', guildId))
      .setDescription(i18n.t('lockdown.server.unlock.success.description', guildId))
      .addFields(
        {
          name: i18n.t('lockdown.server.unlock.success.unlocked', guildId),
          value: unlockedChannels.toString(),
          inline: true
        },
        {
          name: i18n.t('lockdown.server.unlock.success.failed', guildId),
          value: failedChannels.toString(),
          inline: true
        },
        {
          name: i18n.t('lockdown.server.unlock.success.reason', guildId),
          value: reason,
          inline: false
        }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    // Log the action (simplified)
    this.client.logger.info(`Server unlocked: ${unlockedChannels} channels by ${interaction.user.tag}`);
  }

  private async handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guild!.id;

    const guildLockdowns = Array.from(this.lockdowns.values()).filter(lockdown => lockdown.guildId === guildId);

    if (guildLockdowns.length === 0) {
      await interaction.reply({
        content: i18n.t('lockdown.status.no_lockdowns', guildId),
        ephemeral: true
      });

      return;
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.Orange)
      .setTitle(i18n.t('lockdown.status.title', guildId, { count: guildLockdowns.length.toString() }))
      .setDescription(i18n.t('lockdown.status.description', guildId));

    for (const lockdown of guildLockdowns.slice(0, 10)) { // Limit to 10
      const channel = interaction.guild!.channels.cache.get(lockdown.channelId);
      const moderator = await this.client.users.fetch(lockdown.moderator).catch(() => null);
      
      if (channel) {
        embed.addFields({
          name: `#${channel.name}`,
          value: i18n.t('lockdown.status.field_value', guildId, {
            type: i18n.t(`lockdown.types.${lockdown.type}`, guildId),
            duration: this.formatDuration(Date.now() - lockdown.timestamp, guildId),
            moderator: moderator?.tag || 'Unknown',
            reason: lockdown.reason.length > 50 ? `${lockdown.reason.substring(0, 50)}...` : lockdown.reason
          }),
          inline: false
        });
      }
    }

    if (guildLockdowns.length > 10) {
      embed.setFooter({ text: i18n.t('lockdown.status.footer_more', guildId, { more: (guildLockdowns.length - 10).toString() }) });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  private async handleList(interaction: ChatInputCommandInteraction): Promise<void> {
    await this.handleStatus(interaction); // Same functionality
  }

  private formatDuration(ms: number, guildId: string): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return i18n.t('lockdown.duration.days', guildId, { days: days.toString() });
    } else if (hours > 0) {
      return i18n.t('lockdown.duration.hours', guildId, { hours: hours.toString() });
    } else if (minutes > 0) {
      return i18n.t('lockdown.duration.minutes', guildId, { minutes: minutes.toString() });
    } else {
      return i18n.t('lockdown.duration.seconds', guildId, { seconds: seconds.toString() });
    }
  }
}