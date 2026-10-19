import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandSubcommandsOnlyBuilder,
  User,
  ChannelType,
  Guild
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { botConfig } from '../../config/bot.config';
import { MAX_INVITE_REWARD_TIERS, MAX_INVITE_REWARD_THRESHOLD, InviteRewardSettings } from '../../services/InviteRewardService';

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
          .addBooleanOption(option =>
            option
              .setName('enabled')
              .setDescription(i18n.t('commands.invites.config.options.enabled', 'global'))
          )
          .addBooleanOption(option =>
            option
              .setName('stack')
              .setDescription(i18n.t('commands.invites.config.options.stack', 'global'))
          )
          .addBooleanOption(option =>
            option
              .setName('remove_on_drop')
              .setDescription(i18n.t('commands.invites.config.options.remove_on_drop', 'global'))
          )
          .addChannelOption(option =>
            option
              .setName('announce_channel')
              .setDescription(i18n.t('commands.invites.config.options.announce_channel', 'global'))
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          )
          .addBooleanOption(option =>
            option
              .setName('announce_off')
              .setDescription(i18n.t('commands.invites.config.options.announce_off', 'global'))
          )
      )
      .addSubcommandGroup(group =>
        group
          .setName('rewards')
          .setDescription(i18n.t('commands.invites.rewards.description', 'global'))
          .addSubcommand(subcommand =>
            subcommand
              .setName('add')
              .setDescription(i18n.t('commands.invites.rewards.add.description', 'global'))
              .addIntegerOption(option =>
                option
                  .setName('invites')
                  .setDescription(i18n.t('commands.invites.rewards.add.options.invites', 'global'))
                  .setRequired(true)
                  .setMinValue(1)
                  .setMaxValue(MAX_INVITE_REWARD_THRESHOLD)
              )
              .addRoleOption(option =>
                option
                  .setName('role')
                  .setDescription(i18n.t('commands.invites.rewards.add.options.role', 'global'))
                  .setRequired(true)
              )
          )
          .addSubcommand(subcommand =>
            subcommand
              .setName('remove')
              .setDescription(i18n.t('commands.invites.rewards.remove.description', 'global'))
              .addIntegerOption(option =>
                option
                  .setName('invites')
                  .setDescription(i18n.t('commands.invites.rewards.remove.options.invites', 'global'))
                  .setMinValue(1)
                  .setMaxValue(MAX_INVITE_REWARD_THRESHOLD)
              )
              .addRoleOption(option =>
                option
                  .setName('role')
                  .setDescription(i18n.t('commands.invites.rewards.remove.options.role', 'global'))
              )
          )
          .addSubcommand(subcommand =>
            subcommand
              .setName('list')
              .setDescription(i18n.t('commands.invites.rewards.list.description', 'global'))
          )
          .addSubcommand(subcommand =>
            subcommand
              .setName('sync')
              .setDescription(i18n.t('commands.invites.rewards.sync.description', 'global'))
          )
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const subcommand = interaction.options.getSubcommand();

    if (interaction.options.getSubcommandGroup(false) === 'rewards') {
      await this.handleRewards(interaction, subcommand);

      return;
    }

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

    const guild = interaction.guild!;
    const enabled = interaction.options.getBoolean('enabled');
    const stack = interaction.options.getBoolean('stack');
    const removeOnDrop = interaction.options.getBoolean('remove_on_drop');
    const announceChannel = interaction.options.getChannel('announce_channel');
    const announceOff = interaction.options.getBoolean('announce_off');

    await interaction.deferReply({ ephemeral: true });

    try {
      const patch: Partial<InviteRewardSettings> = {};

      if (enabled !== null) patch.enabled = enabled;
      if (stack !== null) patch.stackRoles = stack;
      if (removeOnDrop !== null) patch.removeOnDrop = removeOnDrop;

      if (announceChannel) {
        if (!this.client.inviteService.rewards.isValidAnnounceChannel(guild, announceChannel.id)) {
          await interaction.editReply({
            content: i18n.t('commands.invites.config.invalid_channel', guildId, { channel: `<#${announceChannel.id}>` })
          });

          return;
        }
        patch.announceChannelId = announceChannel.id;
      } else if (announceOff) {
        patch.announceChannelId = null;
      }

      const changed = Object.keys(patch).length > 0;

      if (changed) {
        await this.client.inviteService.rewards.updateSettings(guildId, patch);
      }

      const embed = await this.createRewardsConfigEmbed(guild, changed);

      await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });

    } catch (error) {
      this.client.logger.error('Error in /invites config:', error);
      await interaction.editReply({
        content: i18n.t('commands.invites.config.error', guildId)
      });
    }
  }

  private async handleRewards(interaction: ChatInputCommandInteraction, subcommand: string): Promise<void> {
    const guildId = interaction.guildId!;
    const guild = interaction.guild!;

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: i18n.t('errors.no_permission', guildId),
        ephemeral: true
      });

      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const rewards = this.client.inviteService.rewards;

    try {
      switch (subcommand) {
        case 'add': {
          const required = interaction.options.getInteger('invites', true);
          const role = interaction.options.getRole('role', true);
          // Quien configura no puede repartir un rol igual o superior al suyo
          const actor = await guild.members.fetch(interaction.user.id).catch(() => null);
          const result = await rewards.addTier(guild, required, role.id, actor);

          if (result.ok === false) {
            const content = result.reason === 'role'
              ? i18n.t(`autorole.wizard.role_${result.problem}`, guildId, { role: `<@&${role.id}>` })
              : i18n.t(`commands.invites.rewards.add.${result.reason}`, guildId, {
                  invites: String(required),
                  role: `<@&${role.id}>`,
                  max: String(MAX_INVITE_REWARD_TIERS)
                });

            await interaction.editReply({ content, allowedMentions: { parse: [] } });

            return;
          }

          await interaction.editReply({
            content: i18n.t('commands.invites.rewards.add.success', guildId, {
              invites: String(required),
              role: `<@&${role.id}>`
            }),
            allowedMentions: { parse: [] }
          });

          return;
        }

        case 'remove': {
          const required = interaction.options.getInteger('invites');
          const role = interaction.options.getRole('role');

          if (required === null && !role) {
            await interaction.editReply({
              content: i18n.t('commands.invites.rewards.remove.missing_filter', guildId)
            });

            return;
          }

          const removed = await rewards.removeTier(guildId, {
            requiredInvites: required ?? undefined,
            roleId: role?.id
          });

          await interaction.editReply({
            content: removed > 0
              ? i18n.t('commands.invites.rewards.remove.success', guildId)
              : i18n.t('commands.invites.rewards.remove.not_found', guildId)
          });

          return;
        }

        case 'list': {
          const embed = await this.createRewardsConfigEmbed(guild, false);

          await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });

          return;
        }

        case 'sync': {
          await interaction.editReply({
            content: i18n.t('commands.invites.rewards.sync.started', guildId)
          });

          const result = await rewards.syncGuild(guild);

          if (result.ok === false) {
            await interaction.editReply({
              content: i18n.t(`commands.invites.rewards.sync.${result.reason}`, guildId, {
                minutes: String(Math.max(1, Math.ceil((result.retryAfter ?? 0) / 60)))
              })
            });

            return;
          }

          let content = i18n.t('commands.invites.rewards.sync.success', guildId, {
            processed: String(result.processed),
            added: String(result.added),
            removed: String(result.removed),
            failed: String(result.failed)
          });

          if (result.truncated) {
            content += `\n${i18n.t('commands.invites.rewards.sync.truncated', guildId)}`;
          }

          // El token de la interacción caduca a los 15 min: en servidores enormes puede fallar
          await interaction.editReply({ content }).catch(() => {});

          return;
        }

        default:
          await interaction.editReply({
            content: i18n.t('errors.invalid_subcommand', guildId)
          });
      }
    } catch (error) {
      this.client.logger.error('Error in /invites rewards:', error);
      await interaction.editReply({
        content: i18n.t('commands.invites.rewards.error', guildId)
      }).catch(() => {});
    }
  }

  private async createRewardsConfigEmbed(guild: Guild, updated: boolean): Promise<EmbedBuilder> {
    const guildId = guild.id;
    const { settings, tiers } = await this.client.inviteService.rewards.getSetup(guildId);
    const t = (key: string, vars?: Record<string, string>) => i18n.t(`commands.invites.config.${key}`, guildId, vars);

    const rewardLines = tiers.map(tier => t('reward_line', {
      invites: String(tier.requiredInvites),
      role: `<@&${tier.roleId}>`
    }));

    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.primary)
      .setTitle(t('title'))
      .addFields(
        { name: t('field_status'), value: settings.enabled ? t('status_on') : t('status_off'), inline: true },
        { name: t('field_mode'), value: settings.stackRoles ? t('mode_stack') : t('mode_highest'), inline: true },
        { name: t('field_drop'), value: settings.removeOnDrop ? t('drop_remove') : t('drop_keep'), inline: true },
        {
          name: t('field_channel'),
          value: settings.announceChannelId ? `<#${settings.announceChannelId}>` : t('channel_none'),
          inline: true
        }
      )
      .setFooter({ text: t('footer') })
      .setTimestamp();

    // Varios campos si hace falta (límite de 1024 caracteres por campo) sin cortar menciones
    const chunks: string[] = [];
    let current = '';

    for (const line of rewardLines) {
      if (current && current.length + line.length + 1 > 1024) {
        chunks.push(current);
        current = '';
      }
      current = current ? `${current}\n${line}` : line;
    }
    if (current) chunks.push(current);

    const rewardsTitle = t('field_rewards', { count: String(tiers.length), max: String(MAX_INVITE_REWARD_TIERS) });

    if (chunks.length === 0) {
      embed.addFields({ name: rewardsTitle, value: t('rewards_empty'), inline: false });
    } else {
      chunks.forEach((value, index) => {
        embed.addFields({ name: index === 0 ? rewardsTitle : '\u200b', value, inline: false });
      });
    }

    if (updated) {
      embed.setDescription(t('updated'));
    }

    return embed;
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