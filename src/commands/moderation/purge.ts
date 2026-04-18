import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  TextChannel,
  User
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { botConfig } from '../../config/bot.config';

export default class PurgeCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'purge',
      description: 'Advanced message purging with multiple filters',
      category: 'moderation',
      cooldown: 5,
      permissions: {
        user: [PermissionFlagsBits.ManageMessages],
        bot: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory]
      }
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription(i18n.t(`commands.${this.name}.description`, 'global'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addIntegerOption(option =>
        option
          .setName('amount')
          .setDescription(i18n.t(`commands.${this.name}.amount_option`, 'global'))
          .setMinValue(1)
          .setMaxValue(100)
          .setRequired(true)
      )
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription(i18n.t(`commands.${this.name}.user_option`, 'global'))
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('filter')
          .setDescription(i18n.t(`commands.${this.name}.filter_option`, 'global'))
          .addChoices(
            { name: 'All messages', value: 'all' },
            { name: 'Bot messages only', value: 'bots' },
            { name: 'Human messages only', value: 'humans' },
            { name: 'Messages with attachments', value: 'attachments' },
            { name: 'Messages with embeds', value: 'embeds' },
            { name: 'Messages with links', value: 'links' },
            { name: 'Messages with mentions', value: 'mentions' }
          )
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('contains')
          .setDescription(i18n.t(`commands.${this.name}.contains_option`, 'global'))
          .setRequired(false)
          .setMaxLength(100)
      )
      .addStringOption(option =>
        option
          .setName('reason')
          .setDescription(i18n.t(`commands.${this.name}.reason_option`, 'global'))
          .setRequired(false)
          .setMaxLength(500)
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const amount = interaction.options.getInteger('amount', true);
    const targetUser = interaction.options.getUser('user');
    const filter = interaction.options.getString('filter') || 'all';
    const contains = interaction.options.getString('contains');
    const reason = interaction.options.getString('reason') || i18n.t('commands.purge.no_reason', guildId);

    if (!interaction.channel || !interaction.channel.isTextBased()) {
      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.error)
        .setTitle(`❌ ${i18n.t('commands.purge.error_title', guildId)}`)
        .setDescription(i18n.t('commands.purge.invalid_channel', guildId))
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });

      return;
    }

    const channel = interaction.channel as TextChannel;

    await interaction.deferReply({ ephemeral: true });

    try {
      // Fetch messages
      const messages = await channel.messages.fetch({ limit: Math.min(amount + 50, 100) });
      
      // Filter messages based on criteria
      const messagesToDelete = messages.filter(message => {
        // Skip messages older than 14 days (Discord limitation)
        if (Date.now() - message.createdTimestamp > 14 * 24 * 60 * 60 * 1000) {
          return false;
        }

        // User filter
        if (targetUser && message.author.id !== targetUser.id) {
          return false;
        }

        // Content filter
        if (contains && !message.content.toLowerCase().includes(contains.toLowerCase())) {
          return false;
        }

        // Type filter
        switch (filter) {
          case 'bots':
            if (!message.author.bot) return false;
            break;
          case 'humans':
            if (message.author.bot) return false;
            break;
          case 'attachments':
            if (message.attachments.size === 0) return false;
            break;
          case 'embeds':
            if (message.embeds.length === 0) return false;
            break;
          case 'links':
            if (!this.containsLinks(message.content)) return false;
            break;
          case 'mentions':
            if (message.mentions.users.size === 0 && message.mentions.roles.size === 0 && message.mentions.everyone === false) return false;
            break;
        }

        return true;
      });

      // Limit to requested amount
      const finalMessages = Array.from(messagesToDelete.values()).slice(0, amount);

      if (finalMessages.length === 0) {
        const embed = new EmbedBuilder()
          .setColor(botConfig.colors.warning)
          .setTitle(`⚠️ ${i18n.t('commands.purge.no_messages_title', guildId)}`)
          .setDescription(i18n.t('commands.purge.no_messages_desc', guildId))
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        return;
      }

      // Delete messages
      let deletedCount = 0;
      let oldMessagesCount = 0;

      // Bulk delete messages newer than 14 days
      const recentMessages = finalMessages.filter(msg => Date.now() - msg.createdTimestamp <= 14 * 24 * 60 * 60 * 1000);

      if (recentMessages.length > 0) {
        if (recentMessages.length === 1) {
          await recentMessages[0].delete();
          deletedCount = 1;
        } else {
          const deleted = await channel.bulkDelete(recentMessages, true);

          deletedCount = deleted.size;
        }
      }

      // Count old messages that couldn't be deleted
      oldMessagesCount = finalMessages.length - deletedCount;

      // Create success embed
      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.success)
        .setTitle(`🧹 ${i18n.t('commands.purge.success_title', guildId)}`)
        .setDescription(i18n.t('commands.purge.success_desc', guildId, { 
          count: deletedCount.toString(),
          channel: channel.toString()
        }))
        .addFields(
          { name: i18n.t('commands.purge.moderator', guildId), value: interaction.user.toString(), inline: true },
          { name: i18n.t('commands.purge.channel', guildId), value: channel.toString(), inline: true },
          { name: i18n.t('commands.purge.reason', guildId), value: reason, inline: false }
        )
        .setTimestamp();

      // Add filter information
      const filterInfo = this.getFilterInfo(filter, targetUser, contains, guildId);

      if (filterInfo) {
        embed.addFields({ name: i18n.t('commands.purge.filters', guildId), value: filterInfo, inline: false });
      }

      // Add warning about old messages
      if (oldMessagesCount > 0) {
        embed.addFields({
          name: i18n.t('commands.purge.old_messages_warning', guildId),
          value: i18n.t('commands.purge.old_messages_count', guildId, { count: oldMessagesCount.toString() }),
          inline: false
        });
        embed.setColor(botConfig.colors.warning);
      }

      await interaction.editReply({ embeds: [embed] });

      // Log the action
      this.client.logger.info(`Purge executed by ${interaction.user.tag} in ${channel.name}: ${deletedCount} messages deleted`);

    } catch (error) {
      this.client.logger.error('Error purging messages:', error);

      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.error)
        .setTitle(`❌ ${i18n.t('commands.purge.error_title', guildId)}`)
        .setDescription(i18n.t('commands.purge.error_desc', guildId))
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  }

  private containsLinks(content: string): boolean {
    const urlRegex = /(https?:\/\/[^\s]+)/g;

    return urlRegex.test(content);
  }

  private getFilterInfo(filter: string, user: User | null, contains: string | null, guildId: string): string | null {
    const filters: string[] = [];

    if (user) {
      filters.push(i18n.t('commands.purge.filter_user', guildId, { user: user.toString() }));
    }

    if (contains) {
      filters.push(i18n.t('commands.purge.filter_contains', guildId, { text: contains }));
    }

    switch (filter) {
      case 'bots':
        filters.push(i18n.t('commands.purge.filter_bots', guildId));
        break;
      case 'humans':
        filters.push(i18n.t('commands.purge.filter_humans', guildId));
        break;
      case 'attachments':
        filters.push(i18n.t('commands.purge.filter_attachments', guildId));
        break;
      case 'embeds':
        filters.push(i18n.t('commands.purge.filter_embeds', guildId));
        break;
      case 'links':
        filters.push(i18n.t('commands.purge.filter_links', guildId));
        break;
      case 'mentions':
        filters.push(i18n.t('commands.purge.filter_mentions', guildId));
        break;
    }

    return filters.length > 0 ? filters.join('\n') : null;
  }
}