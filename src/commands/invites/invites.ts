import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandSubcommandsOnlyBuilder,
  User
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { botConfig } from '../../config/bot.config';

export default class InvitesCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'invites',
      description: 'Manage and view invite statistics',
      category: 'utility',
      cooldown: 5,
      permissions: {
        user: [],
        bot: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]
      }
    });
  }

  data(): SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription(i18n.t(`commands.${this.name}.description`, 'global'))
      .addSubcommand(subcommand =>
        subcommand
          .setName('me')
          .setDescription(i18n.t('commands.invites.me.description', 'global'))
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('user')
          .setDescription(i18n.t('commands.invites.user.description', 'global'))
          .addUserOption(option =>
            option
              .setName('target')
              .setDescription(i18n.t('commands.invites.user.options.target', 'global'))
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('leaderboard')
          .setDescription(i18n.t('commands.invites.leaderboard.description', 'global'))
          .addIntegerOption(option =>
            option
              .setName('page')
              .setDescription(i18n.t('commands.invites.leaderboard.options.page', 'global'))
              .setMinValue(1)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('add')
          .setDescription(i18n.t('commands.invites.add.description', 'global'))
          .addUserOption(option =>
            option
              .setName('user')
              .setDescription(i18n.t('commands.invites.add.options.user', 'global'))
              .setRequired(true)
          )
          .addIntegerOption(option =>
            option
              .setName('amount')
              .setDescription(i18n.t('commands.invites.add.options.amount', 'global'))
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(1000)
          )
          .addStringOption(option =>
            option
              .setName('reason')
              .setDescription(i18n.t('commands.invites.add.options.reason', 'global'))
              .setMaxLength(200)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('remove')
          .setDescription(i18n.t('commands.invites.remove.description', 'global'))
          .addUserOption(option =>
            option
              .setName('user')
              .setDescription(i18n.t('commands.invites.remove.options.user', 'global'))
              .setRequired(true)
          )
          .addIntegerOption(option =>
            option
              .setName('amount')
              .setDescription(i18n.t('commands.invites.remove.options.amount', 'global'))
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(1000)
          )
          .addStringOption(option =>
            option
              .setName('reason')
              .setDescription(i18n.t('commands.invites.remove.options.reason', 'global'))
              .setMaxLength(200)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('config')
          .setDescription(i18n.t('commands.invites.config.description', 'global'))
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'me':
        await this.handleMe(interaction);
        break;
      case 'user':
        await this.handleUser(interaction);
        break;
      case 'leaderboard':
        await this.handleLeaderboard(interaction);
        break;
      case 'add':
        await this.handleAdd(interaction);
        break;
      case 'remove':
        await this.handleRemove(interaction);
        break;
      case 'config':
        await this.handleConfig(interaction);
        break;
      default:
        await interaction.reply({
          content: i18n.t('errors.invalid_subcommand', guildId),
          ephemeral: true
        });
    }
  }

  private async handleMe(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;

    await interaction.deferReply();

    try {
      const inviteInfo = await this.client.inviteService.getUserInviteInfo(userId, guildId);
      
      if (!inviteInfo.stats) {
        await interaction.editReply({
          content: i18n.t('commands.invites.me.no_invites', guildId)
        });

        return;
      }

      const embed = this.createInviteStatsEmbed(interaction.user, inviteInfo, guildId);
      
      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      await interaction.editReply({
        content: i18n.t('commands.invites.me.error', guildId)
      });
    }
  }

  private async handleUser(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const targetUser = interaction.options.getUser('target', true);

    await interaction.deferReply();

    try {
      const inviteInfo = await this.client.inviteService.getUserInviteInfo(targetUser.id, guildId);
      
      if (!inviteInfo.stats) {
        await interaction.editReply({
          content: i18n.t('commands.invites.user.no_invites', guildId, { user: targetUser.tag })
        });

        return;
      }

      const embed = this.createInviteStatsEmbed(targetUser, inviteInfo, guildId);
      
      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      await interaction.editReply({
        content: i18n.t('commands.invites.user.error', guildId)
      });
    }
  }

  private async handleLeaderboard(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const page = interaction.options.getInteger('page') || 1;

    await interaction.deferReply();

    try {
      const leaderboard = await this.client.inviteService.getInviteLeaderboard(guildId, 100);
      
      if (leaderboard.length === 0) {
        await interaction.editReply({
          content: i18n.t('commands.invites.leaderboard.empty', guildId)
        });

        return;
      }

      const itemsPerPage = 10;
      const startIndex = (page - 1) * itemsPerPage;
      const endIndex = startIndex + itemsPerPage;
      const pageData = leaderboard.slice(startIndex, endIndex);
      
      if (pageData.length === 0) {
        await interaction.editReply({
          content: i18n.t('commands.invites.leaderboard.invalid_page', guildId)
        });

        return;
      }

      const embed = await this.createLeaderboardEmbed(pageData, page, leaderboard.length, guildId);
      
      const row = new ActionRowBuilder<ButtonBuilder>();
      
      if (page > 1) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`invites_leaderboard_${page - 1}`)
            .setLabel(i18n.t('buttons.previous', guildId))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('◀️')
        );
      }
      
      if (endIndex < leaderboard.length) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`invites_leaderboard_${page + 1}`)
            .setLabel(i18n.t('buttons.next', guildId))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('▶️')
        );
      }

      const components = row.components.length > 0 ? [row] : [];
      
      await interaction.editReply({ embeds: [embed], components });

    } catch (error) {
      await interaction.editReply({
        content: i18n.t('commands.invites.leaderboard.error', guildId)
      });
    }
  }

  private async handleAdd(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const targetUser = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);
    const reason = interaction.options.getString('reason');

    // Check permissions
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: i18n.t('errors.no_permission', guildId),
        ephemeral: true
      });

      return;
    }

    await interaction.deferReply();

    try {
      const success = await this.client.inviteService.addBonusInvites(
        targetUser.id, 
        guildId, 
        amount, 
        reason || `Added by ${interaction.user.tag}`
      );

      if (success) {
        await interaction.editReply({
          content: i18n.t('commands.invites.add.success', guildId, {
            amount: amount.toString(),
            user: targetUser.tag
          })
        });
      } else {
        await interaction.editReply({
          content: i18n.t('commands.invites.add.error', guildId)
        });
      }

    } catch (error) {
      await interaction.editReply({
        content: i18n.t('commands.invites.add.error', guildId)
      });
    }
  }

  private async handleRemove(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const targetUser = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);
    const reason = interaction.options.getString('reason');

    // Check permissions
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: i18n.t('errors.no_permission', guildId),
        ephemeral: true
      });

      return;
    }

    await interaction.deferReply();

    try {
      const success = await this.client.inviteService.removeInvites(
        targetUser.id, 
        guildId, 
        amount, 
        reason || `Removed by ${interaction.user.tag}`
      );

      if (success) {
        await interaction.editReply({
          content: i18n.t('commands.invites.remove.success', guildId, {
            amount: amount.toString(),
            user: targetUser.tag
          })
        });
      } else {
        await interaction.editReply({
          content: i18n.t('commands.invites.remove.error', guildId)
        });
      }

    } catch (error) {
      await interaction.editReply({
        content: i18n.t('commands.invites.remove.error', guildId)
      });
    }
  }

  private async handleConfig(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;

    // Check permissions
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: i18n.t('errors.no_permission', guildId),
        ephemeral: true
      });

      return;
    }

    await interaction.reply({
      content: i18n.t('commands.invites.config.not_implemented', guildId),
      ephemeral: true
    });
  }

  private createInviteStatsEmbed(user: User, inviteInfo: any, guildId: string): EmbedBuilder {
    const stats = inviteInfo.stats;
    const totalInvites = stats.validInvites + stats.bonusInvites;

    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.primary)
      .setTitle(i18n.t('invites.stats.title', guildId, { user: user.tag }))
      .setThumbnail(user.displayAvatarURL())
      .addFields(
        {
          name: i18n.t('invites.stats.total', guildId),
          value: totalInvites.toString(),
          inline: true
        },
        {
          name: i18n.t('invites.stats.valid', guildId),
          value: stats.validInvites.toString(),
          inline: true
        },
        {
          name: i18n.t('invites.stats.bonus', guildId),
          value: stats.bonusInvites.toString(),
          inline: true
        },
        {
          name: i18n.t('invites.stats.fake', guildId),
          value: stats.fakeInvites.toString(),
          inline: true
        },
        {
          name: i18n.t('invites.stats.left', guildId),
          value: stats.leftInvites.toString(),
          inline: true
        },
        {
          name: i18n.t('invites.stats.rank', guildId),
          value: inviteInfo.rank > 0 ? `#${inviteInfo.rank}` : i18n.t('invites.stats.unranked', guildId),
          inline: true
        }
      )
      .setTimestamp();

    if (inviteInfo.nextReward) {
      const remaining = inviteInfo.nextReward.requiredInvites - totalInvites;

      embed.addFields({
        name: i18n.t('invites.stats.next_reward', guildId),
        value: i18n.t('invites.stats.next_reward_desc', guildId, {
          remaining: remaining.toString(),
          reward: inviteInfo.nextReward.description
        }),
        inline: false
      });
    }

    return embed;
  }

  private async createLeaderboardEmbed(
    leaderboard: any[], 
    page: number, 
    total: number, 
    guildId: string
  ): Promise<EmbedBuilder> {
    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.primary)
      .setTitle(i18n.t('invites.leaderboard.title', guildId))
      .setDescription(i18n.t('invites.leaderboard.description', guildId));

    let description = '';
    const startRank = (page - 1) * 10;

    for (let i = 0; i < leaderboard.length; i++) {
      const stats = leaderboard[i];
      const rank = startRank + i + 1;
      const user = await this.client.users.fetch(stats.userId).catch(() => null);
      const username = user ? user.tag : i18n.t('invites.leaderboard.unknown_user', guildId);
      const totalInvites = stats.validInvites + stats.bonusInvites;

      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `**${rank}.**`;
      
      description += `${medal} ${username} - ${totalInvites} ${i18n.t('invites.leaderboard.invites', guildId)}\n`;
    }

    embed.setDescription(description);

    const totalPages = Math.ceil(total / 10);

    embed.setFooter({
      text: i18n.t('invites.leaderboard.footer', guildId, {
        page: page.toString(),
        totalPages: totalPages.toString(),
        total: total.toString()
      })
    });

    return embed;
  }
}