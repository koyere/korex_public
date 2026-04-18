import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { botConfig } from '../../config/bot.config';

export default class MassBanCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'massban',
      description: 'Ban multiple users at once',
      category: 'moderation',
      cooldown: 10,
      permissions: {
        user: [PermissionFlagsBits.BanMembers],
        bot: [PermissionFlagsBits.BanMembers]
      }
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription(i18n.t(`commands.${this.name}.description`, 'global'))
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addStringOption(option =>
        option
          .setName('reason')
          .setDescription(i18n.t(`commands.${this.name}.reason_option`, 'global'))
          .setRequired(false)
          .setMaxLength(500)
      )
      .addIntegerOption(option =>
        option
          .setName('delete_days')
          .setDescription(i18n.t(`commands.${this.name}.delete_days_option`, 'global'))
          .setMinValue(0)
          .setMaxValue(7)
          .setRequired(false)
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const reason = interaction.options.getString('reason') || i18n.t('commands.massban.no_reason', guildId);
    const deleteDays = interaction.options.getInteger('delete_days') || 0;

    // Show modal to input user IDs
    const modal = new ModalBuilder()
      .setCustomId('massban_users')
      .setTitle(i18n.t('commands.massban.modal_title', guildId));

    const userIdsInput = new TextInputBuilder()
      .setCustomId('user_ids')
      .setLabel(i18n.t('commands.massban.user_ids_label', guildId))
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder(i18n.t('commands.massban.user_ids_placeholder', guildId))
      .setRequired(true)
      .setMaxLength(2000);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(userIdsInput));

    await interaction.showModal(modal);

    // Wait for modal submission
    try {
      const modalSubmission = await interaction.awaitModalSubmit({ time: 300000 }); // 5 minutes

      await modalSubmission.deferReply({ ephemeral: true });

      const userIdsText = modalSubmission.fields.getTextInputValue('user_ids');
      const userIds = this.parseUserIds(userIdsText);

      if (userIds.length === 0) {
        const embed = new EmbedBuilder()
          .setColor(botConfig.colors.error)
          .setTitle(`❌ ${i18n.t('commands.massban.error_title', guildId)}`)
          .setDescription(i18n.t('commands.massban.no_valid_ids', guildId))
          .setTimestamp();

        await modalSubmission.editReply({ embeds: [embed] });

        return;
      }

      if (userIds.length > 50) {
        const embed = new EmbedBuilder()
          .setColor(botConfig.colors.error)
          .setTitle(`❌ ${i18n.t('commands.massban.error_title', guildId)}`)
          .setDescription(i18n.t('commands.massban.too_many_users', guildId, { max: '50' }))
          .setTimestamp();

        await modalSubmission.editReply({ embeds: [embed] });

        return;
      }

      // Show confirmation
      const confirmEmbed = new EmbedBuilder()
        .setColor(botConfig.colors.warning)
        .setTitle(`⚠️ ${i18n.t('commands.massban.confirm_title', guildId)}`)
        .setDescription(i18n.t('commands.massban.confirm_desc', guildId, { 
          count: userIds.length.toString(),
          reason
        }))
        .addFields(
          { name: i18n.t('commands.massban.user_count', guildId), value: userIds.length.toString(), inline: true },
          { name: i18n.t('commands.massban.delete_days', guildId), value: deleteDays.toString(), inline: true },
          { name: i18n.t('commands.massban.reason', guildId), value: reason, inline: false }
        )
        .setTimestamp();

      const confirmRow = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('massban_confirm')
            .setLabel(i18n.t('commands.massban.confirm_button', guildId))
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🔨'),
          new ButtonBuilder()
            .setCustomId('massban_cancel')
            .setLabel(i18n.t('commands.massban.cancel_button', guildId))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('❌')
        );

      await modalSubmission.editReply({ embeds: [confirmEmbed], components: [confirmRow] });

      // Wait for confirmation
      const confirmInteraction = await interaction.followUp({ 
        embeds: [confirmEmbed], 
        components: [confirmRow],
        ephemeral: true,
        fetchReply: true
      }).then(msg => msg.awaitMessageComponent({ time: 60000 }));

      if (confirmInteraction.customId === 'massban_cancel') {
        const cancelEmbed = new EmbedBuilder()
          .setColor(botConfig.colors.warning)
          .setTitle(`❌ ${i18n.t('commands.massban.cancelled_title', guildId)}`)
          .setDescription(i18n.t('commands.massban.cancelled_desc', guildId))
          .setTimestamp();

        await confirmInteraction.update({ embeds: [cancelEmbed], components: [] });

        return;
      }

      // Proceed with mass ban
      await confirmInteraction.update({ 
        embeds: [confirmEmbed.setDescription(i18n.t('commands.massban.processing', guildId))], 
        components: [] 
      });

      const results = await this.performMassBan(userIds, reason, deleteDays, interaction.guild!, interaction.user);

      // Create result embed
      const resultEmbed = new EmbedBuilder()
        .setColor(results.failed.length > 0 ? botConfig.colors.warning : botConfig.colors.success)
        .setTitle(`🔨 ${i18n.t('commands.massban.result_title', guildId)}`)
        .setDescription(i18n.t('commands.massban.result_desc', guildId, {
          successful: results.successful.length.toString(),
          failed: results.failed.length.toString(),
          total: userIds.length.toString()
        }))
        .addFields(
          { name: i18n.t('commands.massban.moderator', guildId), value: interaction.user.toString(), inline: true },
          { name: i18n.t('commands.massban.reason', guildId), value: reason, inline: true }
        )
        .setTimestamp();

      if (results.failed.length > 0) {
        const failedList = results.failed.slice(0, 10).map(f => `${f.id}: ${f.reason}`).join('\n');
        const failedText = results.failed.length > 10 ? 
          `${failedList}\n... and ${results.failed.length - 10} more` : 
          failedList;

        resultEmbed.addFields({
          name: i18n.t('commands.massban.failed_bans', guildId),
          value: failedText,
          inline: false
        });
      }

      await modalSubmission.editReply({ embeds: [resultEmbed] });

      // Log the action
      this.client.logger.info(`Mass ban executed by ${interaction.user.tag} in ${interaction.guild!.name}: ${results.successful.length}/${userIds.length} successful`);

    } catch (error: any) {
      if (error?.code === 'InteractionCollectorError') {
        // Timeout
        return;
      }

      this.client.logger.error('Error in mass ban command:', error);
    }
  }

  private parseUserIds(text: string): string[] {
    // Extract user IDs from various formats
    const idRegex = /\d{17,19}/g;
    const matches = text.match(idRegex) || [];
    
    // Remove duplicates
    return [...new Set(matches)];
  }

  private async performMassBan(
    userIds: string[], 
    reason: string, 
    deleteDays: number, 
    guild: any, 
    moderator: any
  ): Promise<{ successful: string[], failed: { id: string, reason: string }[] }> {
    const successful: string[] = [];
    const failed: { id: string, reason: string }[] = [];

    for (const userId of userIds) {
      try {
        // Check if user is already banned
        const existingBan = await guild.bans.fetch(userId).catch(() => null);

        if (existingBan) {
          failed.push({ id: userId, reason: 'Already banned' });
          continue;
        }

        // Check if user is in guild and hierarchy
        const member = await guild.members.fetch(userId).catch(() => null);

        if (member) {
          // Check hierarchy
          const moderatorMember = await guild.members.fetch(moderator.id);

          if (member.roles.highest.position >= moderatorMember.roles.highest.position) {
            failed.push({ id: userId, reason: 'Higher or equal role' });
            continue;
          }

          // Can't ban guild owner
          if (member.id === guild.ownerId) {
            failed.push({ id: userId, reason: 'Guild owner' });
            continue;
          }
        }

        // Perform ban
        await guild.members.ban(userId, { 
          reason: `Mass ban by ${moderator.tag}: ${reason}`,
          deleteMessageDays: deleteDays
        });

        successful.push(userId);

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error: any) {
        failed.push({ id: userId, reason: error?.message || 'Unknown error' });
      }
    }

    return { successful, failed };
  }
}