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
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

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
            name: '🛡️ Moderation',
            value: 'Configure moderation settings',
            inline: true,
          },
          {
            name: '📝 Logging',
            value: 'Set up log channels',
            inline: true,
          },
          {
            name: '🎵 Music',
            value: 'Configure music settings',
            inline: true,
          },
          {
            name: '💰 Economy',
            value: 'Set up economy system',
            inline: true,
          },
          {
            name: '📊 Levels',
            value: 'Configure leveling system',
            inline: true,
          },
          {
            name: '🎉 Welcome',
            value: 'Set up welcome messages',
            inline: true,
          }
        )
        .setFooter({
          text: 'Use individual commands to configure each module',
          iconURL: this.client.user!.displayAvatarURL(),
        });

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('setup_menu')
        .setPlaceholder('Select a module to configure')
        .addOptions([
          {
            label: 'Moderation',
            description: 'Configure moderation settings',
            value: 'moderation',
            emoji: '🛡️',
          },
          {
            label: 'Logging',
            description: 'Set up log channels',
            value: 'logging',
            emoji: '📝',
          },
          {
            label: 'Auto-Roles',
            description: 'Configure auto-roles',
            value: 'autoroles',
            emoji: '🎭',
          },
          {
            label: 'Welcome',
            description: 'Configure welcome messages',
            value: 'welcome',
            emoji: '👋',
          },
          {
            label: 'Check Configuration',
            description: 'Review all current configuration',
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
          topic: 'Moderation logs channel - KOREX',
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
          autoActions: [
            { warnings: 3, action: 'MUTE', duration: 60 },
            { warnings: 5, action: 'KICK' },
            { warnings: 7, action: 'BAN', duration: 1440 },
          ],
        },
      });

      embed.setColor(Colors.Green);
      embed.setDescription(i18n.t('commands.setup.moderation.success', guild.id));
      embed.addFields(
        {
          name: i18n.t('commands.setup.moderation.configuration', guild.id),
          value: [
            `**${i18n.t('commands.setup.moderation.mute_role', guild.id)}:** ${muteRole ? muteRole.toString() : '❌ Not configured'}`,
            `**${i18n.t('commands.setup.moderation.log_channel', guild.id)}:** ${logChannel ? logChannel.toString() : '❌ Not configured'}`,
            `**${i18n.t('commands.setup.moderation.auto_mod', guild.id)}:** ✅ ${i18n.t('common.enabled', guild.id)}`,
            `**${i18n.t('commands.setup.moderation.max_warnings', guild.id)}:** 3`,
            `**${i18n.t('commands.setup.moderation.warning_expiry', guild.id)}:** 30 days`,
          ].join('\n'),
          inline: false,
        },
        {
          name: i18n.t('commands.setup.moderation.auto_actions', guild.id),
          value: [
            i18n.t('commands.setup.moderation.action_3_warnings', guild.id),
            i18n.t('commands.setup.moderation.action_5_warnings', guild.id),
            i18n.t('commands.setup.moderation.action_7_warnings', guild.id),
          ].join('\n'),
          inline: false,
        }
      );
    } catch (error) {
      embed.setColor(Colors.Red);
      embed.setDescription('❌ Error saving configuration to database');
    }

    await interaction.editReply({ embeds: [embed], components: [] });
  }

  private async setupLogging(interaction: any): Promise<void> {
    await interaction.deferUpdate();

    const guild = interaction.guild!;
    const embed = new EmbedBuilder()
      .setColor(Colors.Blue)
      .setTitle(i18n.t('commands.setup.logging.title', guild.id))
      .setDescription('This feature will be available when LoggingService is implemented.')
      .addFields({
        name: i18n.t('commands.setup.logging.in_development', guild.id),
        value: i18n.t('commands.setup.logging.description', guild.id),
        inline: false,
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed], components: [] });
  }

  private async setupAutoRoles(interaction: any): Promise<void> {
    await interaction.deferUpdate();

    const guild = interaction.guild!;
    const embed = new EmbedBuilder()
      .setColor(Colors.Purple)
      .setTitle(i18n.t('commands.setup.autoroles.title', guild.id))
      .setDescription('This feature will be available when auto-roles system is implemented.')
      .addFields({
        name: i18n.t('commands.setup.autoroles.in_development', guild.id),
        value: i18n.t('commands.setup.autoroles.description', guild.id),
        inline: false,
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed], components: [] });
  }

  private async setupWelcome(interaction: any): Promise<void> {
    await interaction.deferUpdate();

    const guild = interaction.guild!;
    const embed = new EmbedBuilder()
      .setColor(Colors.Gold)
      .setTitle(i18n.t('commands.setup.welcome.title', guild.id))
      .setDescription('This feature will be available when WelcomeService is implemented.')
      .addFields({
        name: i18n.t('commands.setup.welcome.in_development', guild.id),
        value: i18n.t('commands.setup.welcome.description', guild.id),
        inline: false,
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed], components: [] });
  }

  private async checkConfiguration(interaction: any): Promise<void> {
    await interaction.deferUpdate();

    const guild = interaction.guild!;
    const config = await this.client.moderation.getModerationConfig(guild.id);

    const embed = new EmbedBuilder()
      .setColor(Colors.Blurple)
      .setTitle(i18n.t('commands.setup.check.title', guild.id))
      .setDescription(i18n.t('commands.setup.check.description', guild.id, { server: guild.name }))
      .addFields(
        {
          name: `🛡️ ${i18n.t('commands.setup.moderation.title', guild.id).replace('🛡️ ', '')}`,
          value: [
            `**Status:** ${config.autoModEnabled ? `✅ ${i18n.t('common.enabled', guild.id)}` : `❌ ${i18n.t('common.disabled', guild.id)}`}`,
            `**${i18n.t('commands.setup.moderation.log_channel', guild.id)}:** ${config.logChannelId ? `<#${config.logChannelId}>` : '❌ Not configured'}`,
            `**${i18n.t('commands.setup.moderation.mute_role', guild.id)}:** ${config.muteRoleId ? `<@&${config.muteRoleId}>` : '❌ Not configured'}`,
            `**${i18n.t('commands.setup.moderation.max_warnings', guild.id)}:** ${config.maxWarnings}`,
            `**${i18n.t('commands.setup.moderation.warning_expiry', guild.id)}:** ${config.warningExpireDays} days`,
          ].join('\n'),
          inline: true,
        },
        {
          name: i18n.t('commands.setup.check.bot_info', guild.id),
          value: [
            `**Commands:** ${this.client.commands.commands.size}`,
            `**Events:** ${this.client.events.events.size}`,
            `**Addons:** ${this.client.addons.addons.size}`,
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
