import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  StringSelectMenuInteraction,
  TextChannel,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  ComponentType,
  Role,
  Colors,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  RoleSelectMenuBuilder,
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class AutoRolesCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'autoroles',
      description: 'Configure automatic role assignment system',
      category: 'admin',
      cooldown: 5,
      permissions: {
        user: [PermissionFlagsBits.ManageRoles],
        bot: [PermissionFlagsBits.ManageRoles]
      }
    });
  }

  data(): SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription('Configure automatic role assignment system')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addSubcommand(subcommand =>
        subcommand
          .setName('setup')
          .setDescription('Setup auto-roles with interactive wizard')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('join')
          .setDescription('Configure roles given on server join')
          .addRoleOption(option =>
            option
              .setName('role')
              .setDescription('Role to add/remove from join roles')
              .setRequired(true)
          )
          .addStringOption(option =>
            option
              .setName('action')
              .setDescription('Add or remove the role')
              .setRequired(true)
              .addChoices(
                { name: 'Add', value: 'add' },
                { name: 'Remove', value: 'remove' }
              )
          )
          .addIntegerOption(option =>
            option
              .setName('delay')
              .setDescription('Delay in minutes before assigning role (0 = immediate)')
              .setMinValue(0)
              .setMaxValue(10080) // 1 week
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('reaction')
          .setDescription('Create reaction role message')
          .addChannelOption(option =>
            option
              .setName('channel')
              .setDescription('Channel to send the reaction role message')
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('button')
          .setDescription('Create button role message')
          .addChannelOption(option =>
            option
              .setName('channel')
              .setDescription('Channel to send the button role message')
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('level')
          .setDescription('Configure level-based role rewards')
          .addRoleOption(option =>
            option
              .setName('role')
              .setDescription('Role to assign at specific level')
              .setRequired(true)
          )
          .addIntegerOption(option =>
            option
              .setName('level')
              .setDescription('Level required to get this role')
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(1000)
          )
          .addStringOption(option =>
            option
              .setName('action')
              .setDescription('Add or remove the level role')
              .setRequired(true)
              .addChoices(
                { name: 'Add', value: 'add' },
                { name: 'Remove', value: 'remove' }
              )
          )
          .addBooleanOption(option =>
            option
              .setName('remove_others')
              .setDescription('Remove other level roles when assigning this one')
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('booster')
          .setDescription('Configure roles for server boosters')
          .addRoleOption(option =>
            option
              .setName('role')
              .setDescription('Role to add/remove for boosters')
              .setRequired(true)
          )
          .addStringOption(option =>
            option
              .setName('action')
              .setDescription('Add or remove the booster role')
              .setRequired(true)
              .addChoices(
                { name: 'Add', value: 'add' },
                { name: 'Remove', value: 'remove' }
              )
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('list')
          .setDescription('View current auto-role configuration')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('toggle')
          .setDescription('Enable or disable the auto-role system')
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'setup':
        await this.handleSetup(interaction, this.client);
        break;
      case 'join':
        await this.handleJoinRoles(interaction, this.client);
        break;
      case 'reaction':
        await this.handleReactionRoles(interaction, this.client);
        break;
      case 'button':
        await this.handleButtonRoles(interaction, this.client);
        break;
      case 'level':
        await this.handleLevelRoles(interaction, this.client);
        break;
      case 'booster':
        await this.handleBoosterRoles(interaction, this.client);
        break;
      case 'list':
        await this.handleList(interaction, this.client);
        break;
      case 'toggle':
        await this.handleToggle(interaction, this.client);
        break;
    }
  }

  private async handleSetup(interaction: ChatInputCommandInteraction, client: KorexClient): Promise<void> {
    const guildId = interaction.guild!.id;

    const embed = new EmbedBuilder()
      .setColor(Colors.Purple)
      .setTitle(i18n.t('autoroles.setup.title', guildId))
      .setDescription(i18n.t('autoroles.setup.description', guildId))
      .addFields(
        {
          name: i18n.t('autoroles.setup.features.join.name', guildId),
          value: i18n.t('autoroles.setup.features.join.value', guildId),
          inline: true
        },
        {
          name: i18n.t('autoroles.setup.features.reaction.name', guildId),
          value: i18n.t('autoroles.setup.features.reaction.value', guildId),
          inline: true
        },
        {
          name: i18n.t('autoroles.setup.features.button.name', guildId),
          value: i18n.t('autoroles.setup.features.button.value', guildId),
          inline: true
        },
        {
          name: i18n.t('autoroles.setup.features.level.name', guildId),
          value: i18n.t('autoroles.setup.features.level.value', guildId),
          inline: true
        },
        {
          name: i18n.t('autoroles.setup.features.booster.name', guildId),
          value: i18n.t('autoroles.setup.features.booster.value', guildId),
          inline: true
        },
        {
          name: i18n.t('autoroles.setup.features.invite.name', guildId),
          value: i18n.t('autoroles.setup.features.invite.value', guildId),
          inline: true
        }
      );

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('autoroles_setup_select')
      .setPlaceholder(i18n.t('autoroles.setup.select_placeholder', guildId))
      .addOptions(
        {
          label: i18n.t('autoroles.setup.options.join.label', guildId),
          description: i18n.t('autoroles.setup.options.join.description', guildId),
          value: 'join',
          emoji: '👋'
        },
        {
          label: i18n.t('autoroles.setup.options.reaction.label', guildId),
          description: i18n.t('autoroles.setup.options.reaction.description', guildId),
          value: 'reaction',
          emoji: '⭐'
        },
        {
          label: i18n.t('autoroles.setup.options.button.label', guildId),
          description: i18n.t('autoroles.setup.options.button.description', guildId),
          value: 'button',
          emoji: '🔘'
        },
        {
          label: i18n.t('autoroles.setup.options.level.label', guildId),
          description: i18n.t('autoroles.setup.options.level.description', guildId),
          value: 'level',
          emoji: '📈'
        },
        {
          label: i18n.t('autoroles.setup.options.booster.label', guildId),
          description: i18n.t('autoroles.setup.options.booster.description', guildId),
          value: 'booster',
          emoji: '💎'
        }
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    await interaction.reply({
      embeds: [embed],
      components: [row],
      flags: MessageFlags.Ephemeral,
    });

    const response = await interaction.fetchReply();

    // Handle select menu interaction with proper filter
    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      filter: (i) => i.customId === 'autoroles_setup_select' && i.user.id === interaction.user.id,
      time: 300000 // 5 minutes
    });

    collector.on('collect', async (selectInteraction) => {
      const value = selectInteraction.values[0];

      try {
        await this.handleSetupOption(selectInteraction, client, value);
      } catch (err) {
        client.logger.error('AutoRoles handleSetupOption error:', err);
      }
    });

    collector.on('end', async () => {
      // Disable components after timeout
      const disabledRow = new ActionRowBuilder<StringSelectMenuBuilder>()
        .addComponents(selectMenu.setDisabled(true));
      
      await interaction.editReply({ components: [disabledRow] }).catch(() => {});
    });
  }

  private async handleSetupOption(interaction: StringSelectMenuInteraction, client: KorexClient, option: string): Promise<void> {
    switch (option) {
      case 'join':
        await this.showJoinRoleSetup(interaction, client);
        break;
      case 'reaction':
        await this.showReactionRoleSetup(interaction, client);
        break;
      case 'button':
        await this.showButtonRoleSetup(interaction, client);
        break;
      case 'level':
        await this.showLevelRoleSetup(interaction, client);
        break;
      case 'booster':
        await this.showBoosterRoleSetup(interaction, client);
        break;
    }
  }

  private async handleJoinRoles(interaction: ChatInputCommandInteraction, client: KorexClient): Promise<void> {
    const role = interaction.options.getRole('role', true) as Role;
    const action = interaction.options.getString('action', true);
    const delay = interaction.options.getInteger('delay') || 0;
    const guildId = interaction.guild!.id;

    const autoRoleService = client.autoRole;

    if (!autoRoleService) {
      await interaction.reply({
        content: i18n.t('common.errors.service_unavailable', guildId),
        ephemeral: true
      });

      return;
    }

    try {
      if (action === 'add') {
        await autoRoleService.addJoinRole(guildId, role.id, delay);
        await interaction.reply({
          content: i18n.t('autoroles.join.added', guildId, {
            role: role.name,
            delay: delay > 0 ? i18n.t('autoroles.join.delay_minutes', guildId, { minutes: delay.toString() }) : i18n.t('autoroles.join.immediate', guildId)
          }),
          ephemeral: true
        });
      } else {
        await autoRoleService.removeJoinRole(guildId, role.id);
        await interaction.reply({
          content: i18n.t('autoroles.join.removed', guildId, { role: role.name }),
          ephemeral: true
        });
      }
    } catch (error) {
      await interaction.reply({
        content: i18n.t('common.errors.generic', guildId),
        ephemeral: true
      });
    }
  }

  private async handleLevelRoles(interaction: ChatInputCommandInteraction, client: KorexClient): Promise<void> {
    const role = interaction.options.getRole('role', true) as Role;
    const level = interaction.options.getInteger('level', true);
    const action = interaction.options.getString('action', true);
    const removeOthers = interaction.options.getBoolean('remove_others') || false;
    const guildId = interaction.guild!.id;

    const autoRoleService = client.autoRole;

    if (!autoRoleService) {
      await interaction.reply({
        content: i18n.t('common.errors.service_unavailable', guildId),
        ephemeral: true
      });

      return;
    }

    try {
      if (action === 'add') {
        await autoRoleService.addLevelRole(guildId, level, role.id, removeOthers);
        await interaction.reply({
          content: i18n.t('autoroles.level.added', guildId, { 
            role: role.name, 
            level: level.toString(),
            removeOthers: removeOthers ? i18n.t('autoroles.level.remove_others_yes', guildId) : i18n.t('autoroles.level.remove_others_no', guildId)
          }),
          ephemeral: true
        });
      } else {
        await autoRoleService.removeLevelRole(guildId, level, role.id);
        await interaction.reply({
          content: i18n.t('autoroles.level.removed', guildId, { role: role.name, level: level.toString() }),
          ephemeral: true
        });
      }
    } catch (error) {
      await interaction.reply({
        content: i18n.t('common.errors.generic', guildId),
        ephemeral: true
      });
    }
  }

  private async handleBoosterRoles(interaction: ChatInputCommandInteraction, client: KorexClient): Promise<void> {
    const role = interaction.options.getRole('role', true) as Role;
    const action = interaction.options.getString('action', true);
    const guildId = interaction.guild!.id;

    const autoRoleService = client.autoRole;

    if (!autoRoleService) {
      await interaction.reply({
        content: i18n.t('common.errors.service_unavailable', guildId),
        ephemeral: true
      });

      return;
    }

    try {
      if (action === 'add') {
        await autoRoleService.addBoosterRole(guildId, role.id);
        await interaction.reply({
          content: i18n.t('autoroles.booster.added', guildId, { role: role.name }),
          ephemeral: true
        });
      } else {
        await autoRoleService.removeBoosterRole(guildId, role.id);
        await interaction.reply({
          content: i18n.t('autoroles.booster.removed', guildId, { role: role.name }),
          ephemeral: true
        });
      }
    } catch (error) {
      await interaction.reply({
        content: i18n.t('common.errors.generic', guildId),
        ephemeral: true
      });
    }
  }

  private async handleReactionRoles(interaction: ChatInputCommandInteraction, client: KorexClient): Promise<void> {
    const channel = interaction.options.getChannel('channel', true) as TextChannel;

    // Show reaction role creation wizard
    await this.showReactionRoleWizard(interaction, client, channel);
  }

  private async handleButtonRoles(interaction: ChatInputCommandInteraction, client: KorexClient): Promise<void> {
    const channel = interaction.options.getChannel('channel', true) as TextChannel;

    // Show button role creation wizard
    await this.showButtonRoleWizard(interaction, client, channel);
  }

  private async handleList(interaction: ChatInputCommandInteraction, client: KorexClient): Promise<void> {
    const guildId = interaction.guild!.id;
    const autoRoleService = client.autoRole;

    if (!autoRoleService) {
      await interaction.reply({
        content: i18n.t('common.errors.service_unavailable', guildId),
        ephemeral: true
      });

      return;
    }

    try {
      const config = await autoRoleService.getAutoRoleConfig(guildId);
      
      const embed = new EmbedBuilder()
        .setColor(config.enabled ? Colors.Green : Colors.Red)
        .setTitle(i18n.t('autoroles.list.title', guildId))
        .setDescription(i18n.t('autoroles.list.status', guildId, { 
          status: config.enabled ? i18n.t('common.enabled', guildId) : i18n.t('common.disabled', guildId)
        }));

      // Join roles
      if (config.joinRoles.length > 0) {
        const joinDelays = await autoRoleService.getJoinRoleDelays(guildId);
        const joinRoleNames = config.joinRoles
          .map(roleId => {
            const name = interaction.guild!.roles.cache.get(roleId)?.name || i18n.t('common.unknown_role', guildId);
            const minutes = joinDelays[roleId] ?? 0;
            return minutes > 0
              ? `${name} (${i18n.t('autoroles.join.delay_minutes', guildId, { minutes: minutes.toString() })})`
              : name;
          })
          .join(', ');

        embed.addFields({
          name: i18n.t('autoroles.list.join_roles', guildId),
          value: joinRoleNames,
          inline: false
        });
      }

      // Level roles
      if (config.levelRoles.length > 0) {
        const levelRoleText = config.levelRoles
          .map(lr => {
            const role = interaction.guild!.roles.cache.get(lr.roleId);

            return `${i18n.t('autoroles.list.level', guildId)} ${lr.level}: ${role?.name || i18n.t('common.unknown_role', guildId)}`;
          })
          .join('\n');

        embed.addFields({
          name: i18n.t('autoroles.list.level_roles', guildId),
          value: levelRoleText,
          inline: false
        });
      }

      // Booster roles
      if (config.boostRoles.length > 0) {
        const boosterRoleNames = config.boostRoles
          .map(roleId => interaction.guild!.roles.cache.get(roleId)?.name || i18n.t('common.unknown_role', guildId))
          .join(', ');

        embed.addFields({
          name: i18n.t('autoroles.list.booster_roles', guildId),
          value: boosterRoleNames,
          inline: false
        });
      }

      // Reaction roles count
      const reactionRoleCount = await autoRoleService.getReactionRoleCount(guildId);

      if (reactionRoleCount > 0) {
        embed.addFields({
          name: i18n.t('autoroles.list.reaction_roles', guildId),
          value: i18n.t('autoroles.list.reaction_count', guildId, { count: reactionRoleCount.toString() }),
          inline: false
        });
      }

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (error) {
      await interaction.reply({
        content: i18n.t('common.errors.generic', guildId),
        ephemeral: true
      });
    }
  }

  private async handleToggle(interaction: ChatInputCommandInteraction, client: KorexClient): Promise<void> {
    const guildId = interaction.guild!.id;
    const autoRoleService = client.autoRole;

    if (!autoRoleService) {
      await interaction.reply({
        content: i18n.t('common.errors.service_unavailable', guildId),
        ephemeral: true
      });

      return;
    }

    try {
      const newStatus = await autoRoleService.toggleAutoRoles(guildId);

      await interaction.reply({
        content: i18n.t('autoroles.toggle.success', guildId, { 
          status: newStatus ? i18n.t('common.enabled', guildId) : i18n.t('common.disabled', guildId)
        }),
        ephemeral: true
      });
    } catch (error) {
      await interaction.reply({
        content: i18n.t('common.errors.generic', guildId),
        ephemeral: true
      });
    }
  }

  private async showJoinRoleSetup(interaction: StringSelectMenuInteraction, client: KorexClient): Promise<void> {
    const gid = interaction.guildId!;
    const modal = new ModalBuilder()
      .setCustomId('autoroles_join_setup_modal')
      .setTitle(i18n.t('autoroles.wizard.join_modal_title', gid));

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('role')
          .setLabel(i18n.t('autoroles.wizard.role_input_label', gid))
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(i18n.t('autoroles.wizard.join_role_placeholder', gid))
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('delay')
          .setLabel(i18n.t('autoroles.wizard.delay_input_label', gid))
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('0')
          .setRequired(false)
          .setMaxLength(5)
      ),
    );

    await interaction.showModal(modal);

    try {
      const submit = await interaction.awaitModalSubmit({
        time: 120_000,
        filter: i => i.user.id === interaction.user.id,
      });

      const roleRaw = submit.fields.getTextInputValue('role').trim();
      const delayRaw = submit.fields.getTextInputValue('delay').trim();
      const delay = Math.max(0, Math.min(10080, parseInt(delayRaw) || 0));
      const guildId = interaction.guild!.id;

      const roleId = roleRaw.match(/^<@&(\d+)>$/)?.[1] ?? (roleRaw.match(/^\d+$/) ? roleRaw : null);
      if (!roleId) {
        await submit.reply({ content: i18n.t('autoroles.wizard.invalid_role', guildId), ephemeral: true });
        return;
      }

      const role = interaction.guild!.roles.cache.get(roleId);
      if (!role) {
        await submit.reply({ content: i18n.t('autoroles.wizard.role_not_in_guild', guildId), ephemeral: true });
        return;
      }

      await client.autoRole!.addJoinRole(guildId, roleId, delay);
      await submit.reply({
        content: i18n.t('autoroles.join.added', guildId, {
          role: role.name,
          delay: delay > 0 ? i18n.t('autoroles.join.delay_minutes', guildId, { minutes: delay.toString() }) : i18n.t('autoroles.join.immediate', guildId),
        }),
        ephemeral: true,
      });
    } catch {
      // Modal cerrado sin enviar
    }
  }

  private async showReactionRoleSetup(interaction: StringSelectMenuInteraction, client: KorexClient): Promise<void> {
    const gid = interaction.guildId!;
    const channelSelect = new ChannelSelectMenuBuilder()
      .setCustomId('autoroles_reaction_channel_select')
      .setPlaceholder(i18n.t('autoroles.wizard.channel_placeholder', gid))
      .addChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1);

    const row = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(channelSelect);

    const channelInteractionPromise = this.awaitInteraction(
      client, 'autoroles_reaction_channel_select', interaction.user.id, interaction.guildId!, 'isChannelSelectMenu'
    );

    await interaction.reply({
      content: i18n.t('autoroles.wizard.reaction_channel_prompt', gid),
      components: [row],
      flags: MessageFlags.Ephemeral,
    });

    try {
      const channelInteraction = await channelInteractionPromise;
      const channel = channelInteraction.channels.first() as TextChannel;
      await this.showReactionRoleWizard(channelInteraction, client, channel);
    } catch (err: any) {
      if (err?.message !== 'timeout') client.logger.error('[AutoRoles] reactionRoleWizard error:', err);
    }
  }

  private async showButtonRoleSetup(interaction: StringSelectMenuInteraction, client: KorexClient): Promise<void> {
    const gid = interaction.guildId!;
    const channelSelect = new ChannelSelectMenuBuilder()
      .setCustomId('autoroles_button_channel_select')
      .setPlaceholder(i18n.t('autoroles.wizard.channel_placeholder', gid))
      .addChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1);

    const row = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(channelSelect);

    const channelInteractionPromise = this.awaitInteraction(
      client, 'autoroles_button_channel_select', interaction.user.id, interaction.guildId!, 'isChannelSelectMenu'
    );

    await interaction.reply({
      content: i18n.t('autoroles.wizard.button_channel_prompt', gid),
      components: [row],
      flags: MessageFlags.Ephemeral,
    });

    try {
      const channelInteraction = await channelInteractionPromise;
      const channel = channelInteraction.channels.first() as TextChannel;
      await this.showButtonRoleWizard(channelInteraction, client, channel);
    } catch {
      // Timeout
    }
  }

  private async showLevelRoleSetup(interaction: StringSelectMenuInteraction, client: KorexClient): Promise<void> {
    const gid = interaction.guildId!;
    const modal = new ModalBuilder()
      .setCustomId('autoroles_level_setup_modal')
      .setTitle(i18n.t('autoroles.wizard.level_modal_title', gid));

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('level')
          .setLabel(i18n.t('autoroles.wizard.level_input_label', gid))
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('10')
          .setRequired(true)
          .setMaxLength(4)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('role')
          .setLabel(i18n.t('autoroles.wizard.role_input_label', gid))
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(i18n.t('autoroles.wizard.level_role_placeholder', gid))
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('remove_others')
          .setLabel(i18n.t('autoroles.wizard.remove_others_label', gid))
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(i18n.t('autoroles.wizard.remove_others_placeholder', gid))
          .setRequired(false)
          .setMaxLength(3)
      ),
    );

    await interaction.showModal(modal);

    try {
      const submit = await interaction.awaitModalSubmit({
        time: 120_000,
        filter: i => i.user.id === interaction.user.id,
      });

      const levelRaw = submit.fields.getTextInputValue('level').trim();
      const roleRaw = submit.fields.getTextInputValue('role').trim();
      const removeOthersRaw = submit.fields.getTextInputValue('remove_others').trim().toLowerCase();
      const guildId = interaction.guild!.id;

      const level = parseInt(levelRaw);
      if (isNaN(level) || level < 1 || level > 1000) {
        await submit.reply({ content: i18n.t('autoroles.wizard.invalid_level', guildId), ephemeral: true });
        return;
      }

      const roleId = roleRaw.match(/^<@&(\d+)>$/)?.[1] ?? (roleRaw.match(/^\d+$/) ? roleRaw : null);
      if (!roleId) {
        await submit.reply({ content: i18n.t('autoroles.wizard.invalid_role', guildId), ephemeral: true });
        return;
      }

      const role = interaction.guild!.roles.cache.get(roleId);
      if (!role) {
        await submit.reply({ content: i18n.t('autoroles.wizard.role_not_in_guild', guildId), ephemeral: true });
        return;
      }

      const yesWords = ['si', 'sí', 's', 'yes', 'y', i18n.t('common.yes', guildId).toLowerCase()];
      const removeOthers = yesWords.includes(removeOthersRaw);
      await client.autoRole!.addLevelRole(guildId, level, roleId, removeOthers);
      await submit.reply({
        content: i18n.t('autoroles.level.added', guildId, {
          role: role.name,
          level: level.toString(),
          removeOthers: removeOthers
            ? i18n.t('autoroles.level.remove_others_yes', guildId)
            : i18n.t('autoroles.level.remove_others_no', guildId),
        }),
        ephemeral: true,
      });
    } catch {
      // Modal cerrado sin enviar
    }
  }

  private async showBoosterRoleSetup(interaction: StringSelectMenuInteraction, client: KorexClient): Promise<void> {
    const gid = interaction.guildId!;
    const modal = new ModalBuilder()
      .setCustomId('autoroles_booster_setup_modal')
      .setTitle(i18n.t('autoroles.wizard.booster_modal_title', gid));

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('role')
          .setLabel(i18n.t('autoroles.wizard.booster_role_input_label', gid))
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(i18n.t('autoroles.wizard.booster_role_placeholder', gid))
          .setRequired(true)
      ),
    );

    await interaction.showModal(modal);

    try {
      const submit = await interaction.awaitModalSubmit({
        time: 120_000,
        filter: i => i.user.id === interaction.user.id,
      });

      const roleRaw = submit.fields.getTextInputValue('role').trim();
      const guildId = interaction.guild!.id;

      const roleId = roleRaw.match(/^<@&(\d+)>$/)?.[1] ?? (roleRaw.match(/^\d+$/) ? roleRaw : null);
      if (!roleId) {
        await submit.reply({ content: i18n.t('autoroles.wizard.invalid_role', guildId), ephemeral: true });
        return;
      }

      const role = interaction.guild!.roles.cache.get(roleId);
      if (!role) {
        await submit.reply({ content: i18n.t('autoroles.wizard.role_not_in_guild', guildId), ephemeral: true });
        return;
      }

      await client.autoRole!.addBoosterRole(guildId, roleId);
      await submit.reply({
        content: i18n.t('autoroles.booster.added', guildId, { role: role.name }),
        ephemeral: true,
      });
    } catch {
      // Modal cerrado sin enviar
    }
  }

  private async showReactionRoleWizard(interaction: ChatInputCommandInteraction | any, client: KorexClient, channel: TextChannel): Promise<void> {
    const gid = interaction.guildId!;
    // Step 1: Role select
    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId('rrwizard_role_select')
      .setPlaceholder(i18n.t('autoroles.wizard.roles_placeholder', gid))
      .setMinValues(1)
      .setMaxValues(10);

    const roleRow = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(roleSelect);

    const rolePromise = this.awaitInteraction(client, 'rrwizard_role_select', interaction.user.id, interaction.guildId!, 'isRoleSelectMenu');

    await interaction.reply({
      content: i18n.t('autoroles.wizard.reaction_step1', gid),
      components: [roleRow],
      flags: MessageFlags.Ephemeral,
    });

    let roleInteraction: any;
    try {
      roleInteraction = await rolePromise;
    } catch { return; }

    const selectedRoles = [...roleInteraction.roles.values()] as Role[];

    // Step 2: Type select
    const typeSelect = new StringSelectMenuBuilder()
      .setCustomId('rrwizard_type_select')
      .setPlaceholder(i18n.t('autoroles.wizard.type_placeholder', gid))
      .addOptions(
        { label: i18n.t('autoroles.wizard.type_multiple_label', gid), description: i18n.t('autoroles.wizard.type_multiple_description', gid), value: 'MULTIPLE', emoji: '📋' },
        { label: i18n.t('autoroles.wizard.type_single_label', gid), description: i18n.t('autoroles.wizard.type_single_description', gid), value: 'SINGLE', emoji: '1️⃣' },
        { label: i18n.t('autoroles.wizard.type_unique_label', gid), description: i18n.t('autoroles.wizard.type_unique_description', gid), value: 'UNIQUE', emoji: '🔒' },
      );

    const typeRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(typeSelect);

    const typePromise = this.awaitInteraction(client, 'rrwizard_type_select', interaction.user.id, interaction.guildId!, 'isStringSelectMenu');

    await roleInteraction.update({
      content: i18n.t('autoroles.wizard.reaction_step2', gid, { roles: selectedRoles.map(r => r.name).join(', ') }),
      components: [typeRow],
    });

    let typeInteraction: any;
    try {
      typeInteraction = await typePromise;
    } catch (err) {
      client.logger.error('[AutoRoles] typePromise error:', err);
      return;
    }

    const type = typeInteraction.values[0] as 'MULTIPLE' | 'SINGLE' | 'UNIQUE';
    const roleNames = selectedRoles.map(r => r.name);
    client.logger.info(`[AutoRoles] Step 3: type=${type}, roles=${roleNames.join(',')}, count=${selectedRoles.length}`);

    // Step 3: Modal for title, description, emojis, color
    const modal = new ModalBuilder()
      .setCustomId(`rrwizard_reaction_${channel.id}`)
      .setTitle(i18n.t('autoroles.wizard.reaction_modal_title', gid));

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel(i18n.t('autoroles.wizard.title_label', gid))
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(i18n.t('autoroles.wizard.title_placeholder', gid))
          .setRequired(true)
          .setMaxLength(256)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('description')
          .setLabel(i18n.t('autoroles.wizard.description_label', gid))
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder(i18n.t('autoroles.wizard.reaction_description_placeholder', gid))
          .setRequired(true)
          .setMaxLength(1024)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('emojis')
          .setLabel(i18n.t('autoroles.wizard.emojis_label', gid))
          .setStyle(TextInputStyle.Paragraph)
          .setValue(roleNames.map((n, i) => `${i + 1}. [emoji] = ${n}`).join('\n'))
          .setRequired(true)
          .setMaxLength(500)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('color')
          .setLabel(i18n.t('autoroles.wizard.color_label', gid))
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('#5865F2')
          .setRequired(false)
          .setMaxLength(7)
      ),
    );

    // Store selected data for the modal handler
    const wizardKey = `rrwizard_reaction_${channel.id}`;
    AutoRolesCommand.wizardData.set(wizardKey, { roles: selectedRoles, type, channelId: channel.id });

    try {
      await typeInteraction.showModal(modal);
      client.logger.info('[AutoRoles] showModal sent successfully');
    } catch (err) {
      client.logger.error('[AutoRoles] showModal error:', err);
    }
  }

  // Temporary storage for wizard state between steps and modal
  private static wizardData = new Map<string, { roles: Role[]; type: string; channelId: string }>();

  public static getWizardData(key: string) {
    const data = AutoRolesCommand.wizardData.get(key);
    if (data) AutoRolesCommand.wizardData.delete(key);
    return data;
  }

  private awaitInteraction(client: KorexClient, customId: string, userId: string, guildId: string, typeCheck: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        client.removeListener('interactionCreate', handler);
        reject(new Error('timeout'));
      }, 120_000);

      const handler = (i: any) => {
        if (
          i[typeCheck]?.() &&
          i.customId === customId &&
          i.user.id === userId &&
          i.guildId === guildId
        ) {
          clearTimeout(timer);
          client.removeListener('interactionCreate', handler);
          resolve(i);
        }
      };

      client.on('interactionCreate', handler);
    });
  }

  private async showButtonRoleWizard(interaction: ChatInputCommandInteraction | any, _client: KorexClient, channel: TextChannel): Promise<void> {
    const gid = interaction.guildId!;
    const modal = new ModalBuilder()
      .setCustomId(`rrwizard_button_${channel.id}`)
      .setTitle(i18n.t('autoroles.wizard.button_modal_title', gid));

    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel(i18n.t('autoroles.wizard.title_label', gid))
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(i18n.t('autoroles.wizard.title_placeholder', gid))
      .setRequired(true)
      .setMaxLength(256);

    const descInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel(i18n.t('autoroles.wizard.description_label', gid))
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder(i18n.t('autoroles.wizard.button_description_placeholder', gid))
      .setRequired(true)
      .setMaxLength(1024);

    const rolesInput = new TextInputBuilder()
      .setCustomId('roles')
      .setLabel(i18n.t('autoroles.wizard.button_roles_label', gid))
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder(i18n.t('autoroles.wizard.button_roles_placeholder', gid))
      .setRequired(true)
      .setMaxLength(500);

    const colorInput = new TextInputBuilder()
      .setCustomId('color')
      .setLabel(i18n.t('autoroles.wizard.color_label', gid))
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('#5865F2')
      .setRequired(false)
      .setMaxLength(7);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(descInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(rolesInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(colorInput),
    );

    await interaction.showModal(modal);
  }
}
