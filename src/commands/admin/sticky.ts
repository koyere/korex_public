import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  Colors,
  TextChannel,
  Message,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

interface StickyMessage {
  channelId: string;
  messageId: string;
  content: string;
  embed?: any;
  lastMessageId?: string;
}

export default class StickyCommand extends Command {
  // Cache of the sticky_messages table (loaded once and kept up to date on every change)
  private stickyMessages: Map<string, StickyMessage> = new Map();
  private loaded: Promise<void> | null = null;
  // One repost at a time per channel; if more messages arrive meanwhile, it repeats once
  private reposting = new Set<string>();
  private pendingRepost = new Set<string>();

  constructor(client: KorexClient) {
    super(client, {
      name: 'sticky',
      description: 'Manage sticky messages in channels',
      category: 'admin',
      cooldown: 5,
      permissions: {
        user: [PermissionFlagsBits.ManageMessages],
        bot: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]
      }
    });

    // Listen for new messages to repost sticky
    this.client.on('messageCreate', (message) => {
      if (message.author.bot) return;
      void this.handleStickyRepost(message);
    });
  }

  private ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      this.loaded = this.client.db.stickyMessage.findMany().then((rows) => {
        for (const row of rows) {
          this.stickyMessages.set(row.channelId, {
            channelId: row.channelId,
            messageId: row.messageId ?? '',
            lastMessageId: row.messageId ?? undefined,
            content: row.content,
            embed: row.useEmbed ? { color: row.color ?? undefined } : undefined,
          });
        }
      }).catch((err) => {
        this.loaded = null;
        this.client.logger.error('Error loading sticky messages:', err);
      });
    }
    return this.loaded;
  }

  private async persist(guildId: string, sticky: StickyMessage): Promise<void> {
    await this.client.db.stickyMessage.upsert({
      where: { channelId: sticky.channelId },
      update: { content: sticky.content, useEmbed: !!sticky.embed, color: sticky.embed?.color ?? null, messageId: sticky.lastMessageId ?? sticky.messageId },
      create: { channelId: sticky.channelId, guildId, content: sticky.content, useEmbed: !!sticky.embed, color: sticky.embed?.color ?? null, messageId: sticky.messageId },
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription('Manage sticky messages in channels')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addSubcommand(subcommand =>
        subcommand
          .setName('set')
          .setDescription('Set a sticky message in current channel')
          .addStringOption(option =>
            option
              .setName('message')
              .setDescription('The message to make sticky')
              .setRequired(true)
              .setMaxLength(2000)
          )
          .addBooleanOption(option =>
            option
              .setName('embed')
              .setDescription('Send as embed (default: false)')
          )
          .addStringOption(option =>
            option
              .setName('color')
              .setDescription('Embed color (hex code, e.g., #FF0000)')
              .setMaxLength(7)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('remove')
          .setDescription('Remove sticky message from current channel')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('list')
          .setDescription('List all sticky messages in this server')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('edit')
          .setDescription('Edit the sticky message in current channel')
          .addStringOption(option =>
            option
              .setName('message')
              .setDescription('New message content')
              .setRequired(true)
              .setMaxLength(2000)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('info')
          .setDescription('Show information about sticky message in current channel')
      ) as SlashCommandBuilder;
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    await this.ensureLoaded();
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'set':
        await this.handleSet(interaction);
        break;
      case 'remove':
        await this.handleRemove(interaction);
        break;
      case 'list':
        await this.handleList(interaction);
        break;
      case 'edit':
        await this.handleEdit(interaction);
        break;
      case 'info':
        await this.handleInfo(interaction);
        break;
    }
  }

  private async handleSet(interaction: ChatInputCommandInteraction): Promise<void> {
    const message = interaction.options.getString('message', true);
    const useEmbed = interaction.options.getBoolean('embed') || false;
    const colorHex = interaction.options.getString('color');
    const guildId = interaction.guild!.id;
    const channelId = interaction.channel!.id;

    await interaction.deferReply({ ephemeral: true });

    try {
      // Validate color if provided
      let color = Colors.Blue;

      if (colorHex) {
        if (!/^#[0-9A-F]{6}$/i.test(colorHex)) {
          await interaction.editReply({
            content: i18n.t('sticky.set.invalid_color', guildId)
          });

          return;
        }
        color = parseInt(colorHex.slice(1), 16) as any;
      }

      // Remove existing sticky if any
      const existingSticky = this.stickyMessages.get(channelId);

      if (existingSticky) {
        try {
          const channel = interaction.channel as TextChannel;
          const oldMessage = await channel.messages.fetch(existingSticky.messageId);

          await oldMessage.delete();
        } catch (error) {
          // Message might already be deleted
        }
      }

      // Create new sticky message
      const channel = interaction.channel as TextChannel;
      let stickyMessage: Message;

      if (useEmbed) {
        const embed = new EmbedBuilder()
          .setDescription(message)
          .setColor(color)
          .setFooter({ text: i18n.t('sticky.footer', guildId) })
          .setTimestamp();

        stickyMessage = await channel.send({ embeds: [embed] });
      } else {
        stickyMessage = await channel.send({
          content: `📌 ${message}\n\n*${i18n.t('sticky.footer', guildId)}*`
        });
      }

      // Store sticky message info
      const sticky: StickyMessage = {
        channelId,
        messageId: stickyMessage.id,
        lastMessageId: stickyMessage.id,
        content: message,
        embed: useEmbed ? { color } : undefined
      };
      this.stickyMessages.set(channelId, sticky);
      await this.persist(guildId, sticky);

      const successEmbed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle(i18n.t('sticky.set.success.title', guildId))
        .setDescription(i18n.t('sticky.set.success.description', guildId))
        .addFields(
          {
            name: i18n.t('sticky.set.success.channel', guildId),
            value: `${channel}`,
            inline: true
          },
          {
            name: i18n.t('sticky.set.success.type', guildId),
            value: useEmbed ? i18n.t('sticky.types.embed', guildId) : i18n.t('sticky.types.text', guildId),
            inline: true
          },
          {
            name: i18n.t('sticky.set.success.preview', guildId),
            value: message.length > 100 ? `${message.substring(0, 100)}...` : message,
            inline: false
          }
        )
        .setFooter({ text: i18n.t('sticky.set.success.footer', guildId) })
        .setTimestamp();

      await interaction.editReply({ embeds: [successEmbed] });

      // Log the action (simplified)
      this.client.logger.info(`Sticky message set in ${channel.name} by ${interaction.user.tag}`);

    } catch (error) {
      this.client.logger.error('Error setting sticky message:', error);
      await interaction.editReply({
        content: i18n.t('sticky.set.error', guildId)
      });
    }
  }

  private async handleRemove(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guild!.id;
    const channelId = interaction.channel!.id;

    await interaction.deferReply({ ephemeral: true });

    const stickyMessage = this.stickyMessages.get(channelId);

    if (!stickyMessage) {
      await interaction.editReply({
        content: i18n.t('sticky.remove.not_found', guildId)
      });

      return;
    }

    try {
      // Delete the sticky message
      const channel = interaction.channel as TextChannel;

      try {
        const message = await channel.messages.fetch(stickyMessage.messageId);

        await message.delete();
      } catch (error) {
        // Message might already be deleted
      }

      // Remove from memory and database
      this.stickyMessages.delete(channelId);
      await this.client.db.stickyMessage.delete({ where: { channelId } }).catch(() => null);

      const embed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle(i18n.t('sticky.remove.success.title', guildId))
        .setDescription(i18n.t('sticky.remove.success.description', guildId, { channel: channel.toString() }))
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // Log the action (simplified)
      this.client.logger.info(`Sticky message removed from ${channel.name} by ${interaction.user.tag}`);

    } catch (error) {
      this.client.logger.error('Error removing sticky message:', error);
      await interaction.editReply({
        content: i18n.t('sticky.remove.error', guildId)
      });
    }
  }

  private async handleList(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guild!.id;

    await interaction.deferReply({ ephemeral: true });

    // Filter sticky messages for this guild
    const guildStickyMessages = Array.from(this.stickyMessages.values())
      .filter(sticky => {
        const channel = interaction.guild!.channels.cache.get(sticky.channelId);

        return channel !== undefined;
      });

    if (guildStickyMessages.length === 0) {
      await interaction.editReply({
        content: i18n.t('sticky.list.empty', guildId)
      });

      return;
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.Blue)
      .setTitle(i18n.t('sticky.list.title', guildId, { count: guildStickyMessages.length.toString() }))
      .setDescription(i18n.t('sticky.list.description', guildId));

    for (const sticky of guildStickyMessages.slice(0, 10)) { // Limit to 10 for embed limits
      const channel = interaction.guild!.channels.cache.get(sticky.channelId);

      if (channel) {
        const preview = sticky.content.length > 50 ? `${sticky.content.substring(0, 50)}...` : sticky.content;

        embed.addFields({
          name: `#${channel.name}`,
          value: `${preview}\n*${sticky.embed ? i18n.t('sticky.types.embed', guildId) : i18n.t('sticky.types.text', guildId)}*`,
          inline: false
        });
      }
    }

    if (guildStickyMessages.length > 10) {
      embed.setFooter({ text: i18n.t('sticky.list.footer_more', guildId, { more: (guildStickyMessages.length - 10).toString() }) });
    }

    await interaction.editReply({ embeds: [embed] });
  }

  private async handleEdit(interaction: ChatInputCommandInteraction): Promise<void> {
    const newMessage = interaction.options.getString('message', true);
    const guildId = interaction.guild!.id;
    const channelId = interaction.channel!.id;

    await interaction.deferReply({ ephemeral: true });

    const stickyMessage = this.stickyMessages.get(channelId);

    if (!stickyMessage) {
      await interaction.editReply({
        content: i18n.t('sticky.edit.not_found', guildId)
      });

      return;
    }

    try {
      const channel = interaction.channel as TextChannel;
      
      // Delete old message
      try {
        const oldMessage = await channel.messages.fetch(stickyMessage.messageId);

        await oldMessage.delete();
      } catch (error) {
        // Message might already be deleted
      }

      // Create new message with updated content
      let newStickyMessage: Message;

      if (stickyMessage.embed) {
        const embed = new EmbedBuilder()
          .setDescription(newMessage)
          .setColor(stickyMessage.embed.color || Colors.Blue)
          .setFooter({ text: i18n.t('sticky.footer', guildId) })
          .setTimestamp();

        newStickyMessage = await channel.send({ embeds: [embed] });
      } else {
        newStickyMessage = await channel.send({
          content: `📌 ${newMessage}\n\n*${i18n.t('sticky.footer', guildId)}*`
        });
      }

      // Update stored info
      stickyMessage.messageId = newStickyMessage.id;
      stickyMessage.lastMessageId = newStickyMessage.id;
      stickyMessage.content = newMessage;
      await this.persist(guildId, stickyMessage);

      const embed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle(i18n.t('sticky.edit.success.title', guildId))
        .setDescription(i18n.t('sticky.edit.success.description', guildId))
        .addFields({
          name: i18n.t('sticky.edit.success.new_content', guildId),
          value: newMessage.length > 100 ? `${newMessage.substring(0, 100)}...` : newMessage,
          inline: false
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // Log the action (simplified)
      this.client.logger.info(`Sticky message edited in ${channel.name} by ${interaction.user.tag}`);

    } catch (error) {
      this.client.logger.error('Error editing sticky message:', error);
      await interaction.editReply({
        content: i18n.t('sticky.edit.error', guildId)
      });
    }
  }

  private async handleInfo(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guild!.id;
    const channelId = interaction.channel!.id;

    const stickyMessage = this.stickyMessages.get(channelId);

    if (!stickyMessage) {
      await interaction.reply({
        content: i18n.t('sticky.info.not_found', guildId),
        ephemeral: true
      });

      return;
    }

    try {
      const channel = interaction.channel as TextChannel;
      let messageExists = true;
      
      try {
        await channel.messages.fetch(stickyMessage.messageId);
      } catch (error) {
        messageExists = false;
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.Blue)
        .setTitle(i18n.t('sticky.info.title', guildId))
        .addFields(
          {
            name: i18n.t('sticky.info.channel', guildId),
            value: `${channel}`,
            inline: true
          },
          {
            name: i18n.t('sticky.info.type', guildId),
            value: stickyMessage.embed ? i18n.t('sticky.types.embed', guildId) : i18n.t('sticky.types.text', guildId),
            inline: true
          },
          {
            name: i18n.t('sticky.info.status', guildId),
            value: messageExists ? i18n.t('sticky.status.active', guildId) : i18n.t('sticky.status.missing', guildId),
            inline: true
          },
          {
            name: i18n.t('sticky.info.content', guildId),
            value: stickyMessage.content.length > 500 ? `${stickyMessage.content.substring(0, 500)}...` : stickyMessage.content,
            inline: false
          }
        )
        .setTimestamp();

      const refreshButton = new ButtonBuilder()
        .setCustomId('sticky_refresh')
        .setLabel(i18n.t('sticky.info.refresh', guildId))
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🔄');

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(refreshButton);

      const reply = await interaction.reply({
        embeds: [embed],
        components: [row],
        ephemeral: true,
        fetchReply: true
      });

      // "Refresh" button: re-posts the sticky at the bottom of the channel
      const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 120_000,
        filter: (i) => i.user.id === interaction.user.id && i.customId === 'sticky_refresh',
      });
      collector.on('collect', async (i) => {
        await i.deferUpdate().catch(() => null);
        await this.repost(interaction.channel as TextChannel, guildId);
        await i.followUp({ content: i18n.t('sticky.info.refreshed', guildId), ephemeral: true }).catch(() => null);
      });

    } catch (error) {
      this.client.logger.error('Error getting sticky info:', error);
      await interaction.reply({
        content: i18n.t('sticky.info.error', guildId),
        ephemeral: true
      });
    }
  }

  private async handleStickyRepost(message: Message): Promise<void> {
    if (!message.guild || !message.channel.isTextBased()) return;
    await this.ensureLoaded();

    const channelId = message.channel.id;
    if (!this.stickyMessages.has(channelId)) return;

    if (this.reposting.has(channelId)) {
      this.pendingRepost.add(channelId);
      return;
    }
    this.reposting.add(channelId);
    try {
      do {
        this.pendingRepost.delete(channelId);
        await this.repost(message.channel as TextChannel, message.guild.id);
      } while (this.pendingRepost.has(channelId));
    } finally {
      this.reposting.delete(channelId);
    }
  }

  /** Deletes the previous sticky and re-posts it at the bottom of the channel. */
  private async repost(channel: TextChannel, guildId: string): Promise<void> {
    const stickyMessage = this.stickyMessages.get(channel.id);
    if (!stickyMessage) return;

    try {
      // Delete the old sticky message if it exists
      if (stickyMessage.lastMessageId) {
        const oldMessage = await channel.messages.fetch(stickyMessage.lastMessageId).catch(() => null);
        await oldMessage?.delete().catch(() => null);
      }

      // Wait a bit to avoid spam
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Repost the sticky message
      let newStickyMessage: Message;

      if (stickyMessage.embed) {
        const embed = new EmbedBuilder()
          .setDescription(stickyMessage.content)
          .setColor(stickyMessage.embed.color || Colors.Blue)
          .setFooter({ text: i18n.t('sticky.footer', guildId) })
          .setTimestamp();

        newStickyMessage = await channel.send({ embeds: [embed] });
      } else {
        newStickyMessage = await channel.send({
          content: `📌 ${stickyMessage.content}\n\n*${i18n.t('sticky.footer', guildId)}*`
        });
      }

      // Update the message ID
      stickyMessage.lastMessageId = newStickyMessage.id;
      stickyMessage.messageId = newStickyMessage.id;
      await this.client.db.stickyMessage.update({
        where: { channelId: channel.id },
        data: { messageId: newStickyMessage.id },
      }).catch(() => null);
    } catch (error) {
      this.client.logger.error('Error reposting sticky message:', error);
    }
  }
}
