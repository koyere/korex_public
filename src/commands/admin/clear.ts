import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  Colors,
  TextChannel,
  User,
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class ClearCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'clear',
      description: 'Clear messages from the channel',
      category: 'admin',
      permissions: {
        user: [PermissionFlagsBits.ManageMessages],
        bot: [PermissionFlagsBits.ManageMessages],
      },
      cooldown: 5,
      guildOnly: true,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('clear')
      .setDescription('Clear messages from the channel')
      .addIntegerOption((option) =>
        option
          .setName('amount')
          .setDescription('Number of messages to delete (1-100)')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(100)
      )
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('Only delete messages from this user')
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName('reason')
          .setDescription('Reason for clearing messages')
          .setRequired(false)
          .setMaxLength(500)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const guild = interaction.guild!;
      const guildId = guild.id;
      const amount = interaction.options.getInteger('amount', true);
      const targetUser = interaction.options.getUser('user');
      
      // Get language from database
      const lang = await i18n.getGuildLanguageAsync(this.client.database.prisma, guildId);
      
      const reason =
        interaction.options.getString('reason') ||
        i18n.t('clear.no_reason', lang);

      const channel = interaction.channel as TextChannel;

      // Check bot permissions
      if (!channel.permissionsFor(guild.members.me!)?.has(PermissionFlagsBits.ManageMessages)) {
        await interaction.reply({
          content: i18n.t('clear.no_permissions', lang),
          ephemeral: true
        });

        return;
      }

      // Defer reply since this might take a moment
      await interaction.deferReply({ ephemeral: true });

      try {
        // Fetch messages (add 1 to account for potential command message)
        const fetchLimit = Math.min(amount + 10, 100);
        const messages = await channel.messages.fetch({ limit: fetchLimit });

        if (messages.size === 0) {
          await interaction.editReply({
            content: i18n.t('clear.no_messages', lang),
          });

          return;
        }

        let messagesToDelete = Array.from(messages.values());
        
        // Filter out messages that can't be deleted (system messages, pinned, etc)
        messagesToDelete = messagesToDelete.filter(msg => {
          // Can't delete pinned messages
          if (msg.pinned) return false;
          // Can't delete system messages
          if (msg.system) return false;
          // Check if message is deletable
          if (!msg.deletable) return false;

          return true;
        });

        // Filter by user if specified
        if (targetUser) {
          messagesToDelete = messagesToDelete.filter((msg) => msg.author.id === targetUser.id);

          if (messagesToDelete.length === 0) {
            await interaction.editReply({
              content: i18n.t('clear.no_messages_from_user', lang, { user: targetUser.tag }),
            });

            return;
          }
        }

        // Limit to requested amount
        messagesToDelete = messagesToDelete.slice(0, amount);

        if (messagesToDelete.length === 0) {
          await interaction.editReply({
            content: '❌ No deletable messages found.',
          });

          return;
        }

        // Filter out messages older than 14 days (Discord limitation)
        const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
        const recentMessages = messagesToDelete.filter((msg) => msg.createdTimestamp > twoWeeksAgo);
        const oldMessages = messagesToDelete.length - recentMessages.length;

        if (recentMessages.length === 0) {
          await interaction.editReply({
            content: i18n.t('clear.messages_too_old', lang),
          });

          return;
        }

        // Bulk delete messages
        let deletedCount = 0;
        
        if (recentMessages.length === 1) {
          // Single message - use delete instead of bulkDelete
          await recentMessages[0].delete();
          deletedCount = 1;
        } else {
          // Multiple messages - use bulkDelete
          const deleted = await channel.bulkDelete(recentMessages, true);

          deletedCount = deleted.size;
        }

        // Success response
        const embed = new EmbedBuilder()
          .setTitle(i18n.t('clear.success_title', lang))
          .setColor(Colors.Green)
          .setDescription(
            i18n.t('clear.success_description', lang, {
              count: deletedCount.toString(),
              channel: channel.toString(),
            })
          )
          .addFields(
            {
              name: i18n.t('clear.moderator', lang),
              value: interaction.user.toString(),
              inline: true,
            },
            {
              name: i18n.t('clear.channel', lang),
              value: channel.toString(),
              inline: true,
            },
            {
              name: i18n.t('clear.reason', lang),
              value: reason,
              inline: false,
            }
          )
          .setFooter({
            text: i18n.t('clear.footer', lang),
            iconURL: interaction.user.displayAvatarURL(),
          })
          .setTimestamp();

        if (targetUser) {
          embed.addFields({
            name: i18n.t('clear.target_user', lang),
            value: targetUser.toString(),
            inline: true,
          });
        }

        if (oldMessages > 0) {
          embed.addFields({
            name: i18n.t('clear.old_messages_warning', lang),
            value: i18n.t('clear.old_messages_count', lang, { count: oldMessages.toString() }),
            inline: false,
          });
          embed.setColor(Colors.Yellow);
        }

        await interaction.editReply({ embeds: [embed] });

        // Log the action to moderation logs
        try {
          const config = await this.client.moderation.getModerationConfig(guildId);

          if (config.logChannelId) {
            const logChannel = guild.channels.cache.get(config.logChannelId) as TextChannel;

            if (logChannel && logChannel.id !== channel.id) {
              const logEmbed = new EmbedBuilder()
                .setTitle('🧹 Messages Cleared')
                .setColor(Colors.Blue)
                .setDescription(`${deletedCount} messages cleared in ${channel.toString()}`)
                .addFields(
                  {
                    name: 'Moderator',
                    value: `${interaction.user.toString()} (${interaction.user.tag})`,
                    inline: true,
                  },
                  {
                    name: 'Channel',
                    value: channel.toString(),
                    inline: true,
                  },
                  {
                    name: 'Reason',
                    value: reason,
                    inline: false,
                  }
                )
                .setTimestamp();

              if (targetUser) {
                logEmbed.addFields({
                  name: 'Target User',
                  value: `${targetUser.toString()} (${targetUser.tag})`,
                  inline: true,
                });
              }

              await logChannel.send({ embeds: [logEmbed] }).catch(err => {
                this.client.logger.warn('Could not send log to moderation channel:', err.message);
              });
            }
          }
        } catch (logError: any) {
          this.client.logger.warn('Error sending moderation log:', logError.message);
        }
      } catch (error: any) {
        this.client.logger.error('Error in clear command:', error);
        
        if (error.code === 50013) {
          await interaction.editReply({
            content: i18n.t('clear.no_permissions', lang),
          });
        } else if (error.code === 50034) {
          await interaction.editReply({
            content: i18n.t('clear.messages_too_old', lang),
          });
        } else {
          await interaction.editReply({
            content: `❌ Error deleting messages: ${error.message}`,
          });
        }
      }
    } catch (error) {
      await this.client.errorHandler.handleCommandError(error as Error, interaction, {
        command: 'clear',
      });
    }
  }
}
