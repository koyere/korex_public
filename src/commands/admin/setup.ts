import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  Colors,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType,
  ChannelType,
  Role,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { readWarnEscalation, WarnEscalationStep } from '../../utils/warnEscalation';

export default class SetupCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'setup',
      description: 'Initial bot configuration for the server',
      category: 'admin',
      permissions: {
        user: [PermissionFlagsBits.Administrator],
      },
      cooldown: 10,
      guildOnly: true,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('setup')
      .setDescription('Initial bot configuration for the server')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const guild = interaction.guild!;
      const guildId = guild.id;
      const lang = i18n.getGuildLanguage(guildId);

      const embed = new EmbedBuilder()
        .setTitle(i18n.t('setup.title', lang))
        .setColor(Colors.Blue)
        .setDescription(i18n.t('setup.description', lang))
        .addFields(
          {
            name: i18n.t('commands.setup.menu.moderation_name', guildId),
            value: i18n.t('commands.setup.menu.moderation_value', guildId),
            inline: true,
          },
          {
            name: i18n.t('commands.setup.menu.logging_name', guildId),
            value: i18n.t('commands.setup.menu.logging_value', guildId),
            inline: true,
          },
          {
            name: i18n.t('commands.setup.menu.music_name', guildId),
            value: i18n.t('commands.setup.menu.music_value', guildId),
            inline: true,
          },
          {
            name: i18n.t('commands.setup.menu.economy_name', guildId),
            value: i18n.t('commands.setup.menu.economy_value', guildId),
            inline: true,
          },
          {
            name: i18n.t('commands.setup.menu.levels_name', guildId),
            value: i18n.t('commands.setup.menu.levels_value', guildId),
            inline: true,
          },
          {
            name: i18n.t('commands.setup.menu.welcome_name', guildId),
            value: i18n.t('commands.setup.menu.welcome_value', guildId),
            inline: true,
          }
        )
        .setFooter({
          text: i18n.t('commands.setup.menu.footer', guildId),
          iconURL: this.client.user!.displayAvatarURL(),
        });

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('setup_menu')
        .setPlaceholder(i18n.t('commands.setup.menu.placeholder', guildId))
        .addOptions([
          {
            label: i18n.t('commands.setup.menu.option_moderation_label', guildId),
            description: i18n.t('commands.setup.menu.option_moderation_description', guildId),
            value: 'moderation',
            emoji: '🛡️',
          },
          {
            label: i18n.t('commands.setup.menu.option_logging_label', guildId),
            description: i18n.t('commands.setup.menu.option_logging_description', guildId),
            value: 'logging',
            emoji: '📝',
          },
          {
            label: i18n.t('commands.setup.menu.option_autoroles_label', guildId),
            description: i18n.t('commands.setup.menu.option_autoroles_description', guildId),
            value: 'autoroles',
            emoji: '🎭',
          },
          {
            label: i18n.t('commands.setup.menu.option_welcome_label', guildId),
            description: i18n.t('commands.setup.menu.option_welcome_description', guildId),
            value: 'welcome',
            emoji: '👋',
          },
          {
            label: i18n.t('commands.setup.menu.option_check_label', guildId),
            description: i18n.t('commands.setup.menu.option_check_description', guildId),
            value: 'check',
            emoji: '🔍',
          },
        ]);

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

      const response = await interaction.reply({
        embeds: [embed],
        components: [row],
      });

      // Handle selection
      const collector = response.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        time: 300000, // 5 minutes
      });

      collector.on('collect', async (selectInteraction) => {
        if (selectInteraction.user.id !== interaction.user.id) {
          await selectInteraction.reply({
            content: i18n.t('errors.no_permission', guild.id),
            ephemeral: true,
          });

          return;
        }

        const selectedValue = selectInteraction.values[0];

        switch (selectedValue) {
          case 'moderation':
            await this.setupModeration(selectInteraction);
            break;
          case 'logging':
            await this.setupLogging(selectInteraction);
            break;
          case 'autoroles':
            await this.setupAutoRoles(selectInteraction);
            break;
          case 'welcome':
            await this.setupWelcome(selectInteraction);
            break;
          case 'check':
            await this.checkConfiguration(selectInteraction);
            break;
        }
      });

      // Botón del escalado por avisos (resultado de la opción Moderación)
      const buttonCollector = response.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 300000,
      });
      buttonCollector.on('collect', async (btn) => {
        if (btn.user.id !== interaction.user.id) {
          await btn.reply({ content: i18n.t('errors.no_permission', guild.id), flags: MessageFlags.Ephemeral }).catch(() => {});
          return;
        }
        if (btn.customId !== 'setup_escalation_on' && btn.customId !== 'setup_escalation_off') return;
        await this.toggleEscalation(btn, btn.customId === 'setup_escalation_on');
      });

      collector.on('end', async () => {
        try {
          await interaction.editReply({
            components: [],
          });
        } catch (error) {
          // Ignore edit errors
        }
      });
    } catch (error) {
      await this.client.errorHandler.handleCommandError(error as Error, interaction, {
        command: 'setup',
      });
    }
  }

  private dashboardUrl(): string {
    return process.env.DASHBOARD_URL || 'https://panel.korex.dev';
  }

  private async setupModeration(interaction: any): Promise<void> {
    await interaction.deferUpdate();

    const guild = interaction.guild!;
    const embed = new EmbedBuilder()
      .setColor(Colors.Orange)
      .setTitle(i18n.t('commands.setup.moderation.title', guild.id))
      .setDescription(i18n.t('commands.setup.moderation.configuring', guild.id))
      .setTimestamp();

    // 1. Create or find mute role
    let muteRole = guild.roles.cache.find(
      (role: Role) =>
        role.name.toLowerCase().includes('mute') || role.name.toLowerCase().includes('silencio')
    );

    if (!muteRole) {
      try {
        muteRole = await guild.roles.create({
          name: 'Muted',
          color: 0x818386,
          permissions: [],
          reason: 'Mute role created by KOREX',
        });

        // Configure permissions in all channels
        for (const channel of guild.channels.cache.values()) {
          if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildVoice) {
            try {
              await channel.permissionOverwrites.create(muteRole, {
                SendMessages: false,
                Speak: false,
                AddReactions: false,
                CreatePublicThreads: false,
                CreatePrivateThreads: false,
                SendMessagesInThreads: false,
              });
            } catch (error) {
              // Ignore permission errors
            }
          }
        }
      } catch (error) {
        embed.addFields({
          name: `❌ ${i18n.t('common.error', guild.id)}`,
          value: i18n.t('commands.setup.moderation.error_mute_role', guild.id),
          inline: false,
        });
      }
    }

    // 2. Create or find log channel
    let logChannel = guild.channels.cache.find(
      (channel: any) =>
        channel.name.includes('mod-log') ||
        channel.name.includes('moderacion') ||
        channel.name.includes('logs')
    );

    if (!logChannel) {
      try {
        logChannel = await guild.channels.create({
          name: 'mod-logs',
          type: ChannelType.GuildText,
          topic: i18n.t('commands.setup.moderation.log_channel_topic', guild.id),
          reason: 'Log channel created by KOREX',
        });
      } catch (error) {
        embed.addFields({
          name: `❌ ${i18n.t('common.error', guild.id)}`,
          value: i18n.t('commands.setup.moderation.error_log_channel', guild.id),
          inline: false,
        });
      }
    }

    // 3. Update configuration in database
    try {
      await this.client.db.guildConfig.upsert({
        where: { guildId: guild.id },
        update: {
          autoModEnabled: true,
          logChannelId: logChannel?.id,
          muteRoleId: muteRole?.id,
          maxWarnings: 3,
          warningExpireDays: 30,
        },
        create: {
          guildId: guild.id,
          autoModEnabled: true,
          logChannelId: logChannel?.id,
          muteRoleId: muteRole?.id,
          maxWarnings: 3,
          warningExpireDays: 30,
        },
      });

      // El AutoMod y los logs de moderación leen estas tablas (las mismas que el dashboard)
      const modConfig = await this.client.db.moderationConfig.upsert({
        where: { guildId: guild.id },
        update: { autoModEnabled: true },
        create: { guildId: guild.id, autoModEnabled: true },
      });
      if (logChannel) {
        await this.client.db.loggingConfig.upsert({
          where: { guildId: guild.id },
          update: { moderationLogChannel: logChannel.id },
          create: { guildId: guild.id, moderationLogChannel: logChannel.id },
        });
      }
      this.client.autoMod.clearCache(guild.id);

      const escalation = await this.getEscalationState(guild.id);
      const notConfigured = `❌ ${i18n.t('commands.setup.not_configured', guild.id)}`;
      const escalationAction = { timeout: 'TIMEOUT', kick: 'KICK', ban: 'BAN' }[modConfig.warnAction] ?? 'TIMEOUT';

      embed.setColor(Colors.Green);
      embed.setDescription(i18n.t('commands.setup.moderation.success', guild.id));
      embed.addFields(
        {
          name: i18n.t('commands.setup.moderation.configuration', guild.id),
          value: [
            `**${i18n.t('commands.setup.moderation.mute_role', guild.id)}:** ${muteRole ? muteRole.toString() : notConfigured}`,
            `**${i18n.t('commands.setup.moderation.log_channel', guild.id)}:** ${logChannel ? logChannel.toString() : notConfigured}`,
            `**${i18n.t('commands.setup.moderation.auto_mod', guild.id)}:** ✅ ${i18n.t('common.enabled', guild.id)}`,
            `**${i18n.t('commands.setup.moderation.max_warnings', guild.id)}:** 3`,
            `**${i18n.t('commands.setup.moderation.warning_expiry', guild.id)}:** ${i18n.t('commands.setup.days', guild.id, { days: '30' })}`,
          ].join('\n'),
          inline: false,
        },
        {
          name: i18n.t('commands.setup.moderation.auto_actions', guild.id),
          value: i18n.t('commands.setup.moderation.auto_action_current', guild.id, {
            count: String(modConfig.warnThreshold),
            action: i18n.t(`moderation.action_types.${escalationAction}`, guild.id),
          }),
          inline: false,
        },
        this.escalationField(guild.id, escalation.enabled, escalation.steps),
      );
      await interaction.editReply({ embeds: [embed], components: [this.escalationRow(guild.id, escalation.enabled)] });
      return;
    } catch (error) {
      embed.setColor(Colors.Red);
      this.client.logger.error('Error saving setup moderation config:', error);
      embed.setDescription(`❌ ${i18n.t('commands.setup.save_error', guild.id)}`);
    }

    await interaction.editReply({ embeds: [embed], components: [] });
  }

  // ── Escalado por avisos (3 → silencio, 5 → expulsión, 7 → baneo; desactivado por defecto) ──

  private async getEscalationState(guildId: string): Promise<{ enabled: boolean; steps: WarnEscalationStep[] }> {
    // Columnas aditivas de moderation_configs: acceso sin tipar
    const cfg: any = await (this.client.db as any).moderationConfig.findUnique({ where: { guildId } }).catch(() => null);
    return { enabled: cfg?.warnEscalationEnabled === true, steps: readWarnEscalation(cfg?.warnEscalationSteps) };
  }

  private escalationField(guildId: string, enabled: boolean, steps: WarnEscalationStep[]) {
    const lines = steps.map(step => {
      const action = i18n.t(`commands.setup.moderation.escalation_action_${step.action}`, guildId, {
        minutes: String(step.duration ?? 0),
      });
      return i18n.t('commands.setup.moderation.escalation_step', guildId, { count: String(step.warnings), action });
    });
    return {
      name: i18n.t('commands.setup.moderation.escalation_title', guildId),
      value: [
        enabled ? `✅ ${i18n.t('common.enabled', guildId)}` : `❌ ${i18n.t('commands.setup.moderation.escalation_off', guildId)}`,
        ...lines,
        i18n.t('commands.setup.moderation.escalation_hint', guildId),
      ].join('\n').slice(0, 1024),
      inline: false,
    };
  }

  private escalationRow(guildId: string, enabled: boolean) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(enabled ? 'setup_escalation_off' : 'setup_escalation_on')
        .setStyle(enabled ? ButtonStyle.Secondary : ButtonStyle.Primary)
        .setLabel(i18n.t(enabled ? 'commands.setup.moderation.escalation_disable' : 'commands.setup.moderation.escalation_enable', guildId)),
    );
  }

  private async toggleEscalation(interaction: any, enable: boolean): Promise<void> {
    const guild = interaction.guild!;
    try {
      await (this.client.db as any).moderationConfig.upsert({
        where: { guildId: guild.id },
        update: { warnEscalationEnabled: enable },
        create: { guildId: guild.id, warnEscalationEnabled: enable },
      });
    } catch (error) {
      this.client.logger.error('Error toggling warn escalation:', error);
      await interaction.reply({ content: `❌ ${i18n.t('commands.setup.save_error', guild.id)}`, flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    const state = await this.getEscalationState(guild.id);
    const embed = EmbedBuilder.from(interaction.message.embeds[0]);
    const fields = (embed.data.fields ?? []).filter(f => f.name !== i18n.t('commands.setup.moderation.escalation_title', guild.id));
    embed.setFields(...fields, this.escalationField(guild.id, state.enabled, state.steps));
    await interaction.update({ embeds: [embed], components: [this.escalationRow(guild.id, state.enabled)] });
  }

  private async setupLogging(interaction: any): Promise<void> {
    await interaction.deferUpdate();

    const guild = interaction.guild!;
    const embed = new EmbedBuilder()
      .setColor(Colors.Blue)
      .setTitle(i18n.t('commands.setup.logging.title', guild.id))
      .setDescription(i18n.t('commands.setup.logging.dashboard_hint', guild.id, { url: this.dashboardUrl() }))
      .setTimestamp();

    await interaction.editReply({ embeds: [embed], components: [] });
  }

  private async setupAutoRoles(interaction: any): Promise<void> {
    await interaction.deferUpdate();

    const guild = interaction.guild!;
    const embed = new EmbedBuilder()
      .setColor(Colors.Purple)
      .setTitle(i18n.t('commands.setup.autoroles.title', guild.id))
      .setDescription(i18n.t('commands.setup.autoroles.dashboard_hint', guild.id, { url: this.dashboardUrl() }))
      .setTimestamp();

    await interaction.editReply({ embeds: [embed], components: [] });
  }

  private async setupWelcome(interaction: any): Promise<void> {
    await interaction.deferUpdate();

    const guild = interaction.guild!;
    const embed = new EmbedBuilder()
      .setColor(Colors.Gold)
      .setTitle(i18n.t('commands.setup.welcome.title', guild.id))
      .setDescription(i18n.t('commands.setup.welcome.dashboard_hint', guild.id, { url: this.dashboardUrl() }))
      .setTimestamp();

    await interaction.editReply({ embeds: [embed], components: [] });
  }

  private async checkConfiguration(interaction: any): Promise<void> {
    await interaction.deferUpdate();

    const guild = interaction.guild!;
    const config = await this.client.moderation.getModerationConfig(guild.id);
    const notConfigured = `❌ ${i18n.t('commands.setup.not_configured', guild.id)}`;

    const embed = new EmbedBuilder()
      .setColor(Colors.Blurple)
      .setTitle(i18n.t('commands.setup.check.title', guild.id))
      .setDescription(i18n.t('commands.setup.check.description', guild.id, { server: guild.name }))
      .addFields(
        {
          name: `🛡️ ${i18n.t('commands.setup.moderation.title', guild.id).replace('🛡️ ', '')}`,
          value: [
            `**${i18n.t('commands.setup.check.status', guild.id)}:** ${config.autoModEnabled ? `✅ ${i18n.t('common.enabled', guild.id)}` : `❌ ${i18n.t('common.disabled', guild.id)}`}`,
            `**${i18n.t('commands.setup.moderation.log_channel', guild.id)}:** ${config.logChannelId ? `<#${config.logChannelId}>` : notConfigured}`,
            `**${i18n.t('commands.setup.moderation.mute_role', guild.id)}:** ${config.muteRoleId ? `<@&${config.muteRoleId}>` : notConfigured}`,
            `**${i18n.t('commands.setup.moderation.max_warnings', guild.id)}:** ${config.maxWarnings}`,
            `**${i18n.t('commands.setup.moderation.warning_expiry', guild.id)}:** ${i18n.t('commands.setup.days', guild.id, { days: String(config.warningExpireDays) })}`,
          ].join('\n'),
          inline: true,
        },
        {
          name: i18n.t('commands.setup.check.bot_info', guild.id),
          value: [
            `**${i18n.t('commands.setup.check.commands', guild.id)}:** ${this.client.commands.commands.size}`,
            `**${i18n.t('commands.setup.check.events', guild.id)}:** ${this.client.events.events.size}`,
            `**${i18n.t('commands.setup.check.addons', guild.id)}:** ${this.client.addons.addons.size}`,
            `**${i18n.t('commands.setup.check.uptime', guild.id)}:** <t:${Math.floor((Date.now() - this.client.uptime!) / 1000)}:R>`,
            `**${i18n.t('commands.setup.check.latency', guild.id)}:** ${this.client.ws.ping}ms`,
          ].join('\n'),
          inline: true,
        },
        {
          name: i18n.t('commands.setup.check.server_stats', guild.id),
          value: [
            `**${i18n.t('commands.setup.check.members', guild.id)}:** ${guild.memberCount}`,
            `**${i18n.t('commands.setup.check.channels', guild.id)}:** ${guild.channels.cache.size}`,
            `**${i18n.t('commands.setup.check.roles', guild.id)}:** ${guild.roles.cache.size}`,
            `**${i18n.t('commands.setup.check.emojis', guild.id)}:** ${guild.emojis.cache.size}`,
            `**${i18n.t('commands.setup.check.boost_level', guild.id)}:** ${guild.premiumTier}`,
          ].join('\n'),
          inline: true,
        }
      )
      .setTimestamp();

    // Check bot permissions
    const botMember = guild.members.cache.get(this.client.user!.id);

    if (botMember) {
      const missingPerms: string[] = [];
      const requiredPerms = [
        'ManageRoles',
        'ManageChannels',
        'BanMembers',
        'KickMembers',
        'ModerateMembers',
        'ManageMessages',
      ];

      for (const perm of requiredPerms) {
        if (!botMember.permissions.has(perm as any)) {
          missingPerms.push(perm);
        }
      }

      if (missingPerms.length > 0) {
        embed.addFields({
          name: i18n.t('commands.setup.check.missing_permissions', guild.id),
          value:
            `${i18n.t('commands.setup.check.permissions_warning', guild.id) 
            }\n${ 
            missingPerms.map((p) => `• ${p}`).join('\n')}`,
          inline: false,
        });
        embed.setColor(Colors.Yellow);
      }
    }

    await interaction.editReply({ embeds: [embed], components: [] });
  }
}
