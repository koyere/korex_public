import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  Colors,
  TextChannel,
  VoiceChannel,
  Role,
  ChannelType,
  OverwriteResolvable,
  CategoryChannel
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class CloneCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'clone',
      description: 'Clone a channel or role with all its properties',
      category: 'admin',
      cooldown: 15,
      permissions: {
        user: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles],
        bot: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.SendMessages]
      }
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription('Clone a channel or role with all its properties')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .addSubcommand(subcommand =>
        subcommand
          .setName('channel')
          .setDescription('Clone a channel')
          .addChannelOption(option =>
            option
              .setName('source')
              .setDescription('Channel to clone')
              .setRequired(true)
              .addChannelTypes(
                ChannelType.GuildText,
                ChannelType.GuildVoice,
                ChannelType.GuildAnnouncement,
                ChannelType.GuildStageVoice,
                ChannelType.GuildForum,
                ChannelType.GuildCategory
              )
          )
          .addStringOption(option =>
            option
              .setName('name')
              .setDescription('Name for the cloned channel (optional)')
              .setMaxLength(100)
          )
          .addStringOption(option =>
            option
              .setName('reason')
              .setDescription('Reason for cloning')
              .setMaxLength(500)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('role')
          .setDescription('Clone a role')
          .addRoleOption(option =>
            option
              .setName('source')
              .setDescription('Role to clone')
              .setRequired(true)
          )
          .addStringOption(option =>
            option
              .setName('name')
              .setDescription('Name for the cloned role (optional)')
              .setMaxLength(100)
          )
          .addStringOption(option =>
            option
              .setName('reason')
              .setDescription('Reason for cloning')
              .setMaxLength(500)
          )
      ) as SlashCommandBuilder;
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'channel':
        await this.handleChannelClone(interaction);
        break;
      case 'role':
        await this.handleRoleClone(interaction);
        break;
    }
  }

  private async handleChannelClone(interaction: ChatInputCommandInteraction): Promise<void> {
    const sourceChannel = interaction.options.getChannel('source', true);
    const customName = interaction.options.getString('name');
    const reason = interaction.options.getString('reason') || i18n.t('clone.default_reason', interaction.guild!.id);
    const guildId = interaction.guild!.id;

    await interaction.deferReply({ ephemeral: true });

    try {
      // Validate permissions
      const guildChannel = sourceChannel as TextChannel | VoiceChannel | CategoryChannel;

      if (!guildChannel.permissionsFor || !guildChannel.permissionsFor(interaction.guild!.members.me!)?.has(PermissionFlagsBits.ViewChannel)) {
        await interaction.editReply({
          content: i18n.t('clone.channel.no_access', guildId)
        });

        return;
      }

      // Generate clone name
      const cloneName = customName || `${sourceChannel.name}-clone`;

      // Clone based on channel type
      let clonedChannel;

      if (sourceChannel.type === ChannelType.GuildCategory) {
        clonedChannel = await this.cloneCategory(sourceChannel as any, cloneName, reason, interaction);
      } else if (sourceChannel.type === ChannelType.GuildText || sourceChannel.type === ChannelType.GuildAnnouncement) {
        clonedChannel = await this.cloneTextChannel(sourceChannel as TextChannel, cloneName, reason, interaction);
      } else if (sourceChannel.type === ChannelType.GuildVoice || sourceChannel.type === ChannelType.GuildStageVoice) {
        clonedChannel = await this.cloneVoiceChannel(sourceChannel as VoiceChannel, cloneName, reason, interaction);
      } else if (sourceChannel.type === ChannelType.GuildForum) {
        clonedChannel = await this.cloneForumChannel(sourceChannel as any, cloneName, reason, interaction);
      } else {
        await interaction.editReply({
          content: i18n.t('clone.channel.unsupported_type', guildId)
        });

        return;
      }

      if (clonedChannel) {
        const embed = new EmbedBuilder()
          .setColor(Colors.Green)
          .setTitle(i18n.t('clone.channel.success.title', guildId))
          .setDescription(i18n.t('clone.channel.success.description', guildId, {
            original: sourceChannel.name || 'Unknown',
            clone: clonedChannel.name
          }))
          .addFields(
            {
              name: i18n.t('clone.channel.success.original', guildId),
              value: `${sourceChannel} (${sourceChannel.name})`,
              inline: true
            },
            {
              name: i18n.t('clone.channel.success.clone', guildId),
              value: `${clonedChannel} (${clonedChannel.name})`,
              inline: true
            },
            {
              name: i18n.t('clone.channel.success.type', guildId),
              value: this.getChannelTypeName(sourceChannel.type, guildId),
              inline: true
            }
          )
          .setFooter({ text: i18n.t('clone.channel.success.footer', guildId) })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        // Log the action (simplified)
        this.client.logger.info(`Channel cloned: ${sourceChannel.name || 'Unknown'} -> ${clonedChannel.name} by ${interaction.user.tag}`);
      }

    } catch (error) {
      this.client.logger.error('Error cloning channel:', error);
      await interaction.editReply({
        content: i18n.t('clone.channel.error', guildId)
      });
    }
  }

  private async handleRoleClone(interaction: ChatInputCommandInteraction): Promise<void> {
    const sourceRole = interaction.options.getRole('source', true) as Role;
    const customName = interaction.options.getString('name');
    const reason = interaction.options.getString('reason') || i18n.t('clone.default_reason', interaction.guild!.id);
    const guildId = interaction.guild!.id;

    await interaction.deferReply({ ephemeral: true });

    try {
      // Check if role is cloneable
      if (sourceRole.managed) {
        await interaction.editReply({
          content: i18n.t('clone.role.managed_role', guildId)
        });

        return;
      }

      // Check hierarchy
      const botMember = interaction.guild!.members.me!;

      if (sourceRole.position >= botMember.roles.highest.position) {
        await interaction.editReply({
          content: i18n.t('clone.role.hierarchy_error', guildId)
        });

        return;
      }

      // Generate clone name
      const cloneName = customName || `${sourceRole.name}-clone`;

      // Clone the role
      const clonedRole = await interaction.guild!.roles.create({
        name: cloneName,
        color: sourceRole.color,
        hoist: sourceRole.hoist,
        mentionable: sourceRole.mentionable,
        permissions: sourceRole.permissions,
        icon: sourceRole.icon,
        unicodeEmoji: sourceRole.unicodeEmoji,
        reason: `Role cloned by ${interaction.user.tag}: ${reason}`
      });

      // Try to position the cloned role near the original
      try {
        await clonedRole.setPosition(Math.max(0, sourceRole.position - 1));
      } catch (positionError) {
        // Position setting failed, but role was created successfully
        this.client.logger.warn('Failed to set cloned role position:', positionError);
      }

      const embed = new EmbedBuilder()
        .setColor(clonedRole.color || Colors.Blue)
        .setTitle(i18n.t('clone.role.success.title', guildId))
        .setDescription(i18n.t('clone.role.success.description', guildId, {
          original: sourceRole.name,
          clone: clonedRole.name
        }))
        .addFields(
          {
            name: i18n.t('clone.role.success.original', guildId),
            value: `${sourceRole} (${sourceRole.name})`,
            inline: true
          },
          {
            name: i18n.t('clone.role.success.clone', guildId),
            value: `${clonedRole} (${clonedRole.name})`,
            inline: true
          },
          {
            name: i18n.t('clone.role.success.properties', guildId),
            value: i18n.t('clone.role.success.properties_value', guildId, {
              color: sourceRole.hexColor,
              hoist: sourceRole.hoist ? i18n.t('common.yes', guildId) : i18n.t('common.no', guildId),
              mentionable: sourceRole.mentionable ? i18n.t('common.yes', guildId) : i18n.t('common.no', guildId),
              permissions: sourceRole.permissions.toArray().length.toString()
            }),
            inline: false
          }
        )
        .setFooter({ text: i18n.t('clone.role.success.footer', guildId) })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // Log the action (simplified)
      this.client.logger.info(`Role cloned: ${sourceRole.name} -> ${clonedRole.name} by ${interaction.user.tag}`);

    } catch (error) {
      this.client.logger.error('Error cloning role:', error);
      await interaction.editReply({
        content: i18n.t('clone.role.error', guildId)
      });
    }
  }

  private async cloneTextChannel(
    source: TextChannel,
    name: string,
    reason: string,
    interaction: ChatInputCommandInteraction
  ) {
    const createOptions: any = {
      name,
      type: source.type,
      nsfw: source.nsfw,
      rateLimitPerUser: source.rateLimitPerUser,
      position: source.position + 1,
      parent: source.parent,
      permissionOverwrites: source.permissionOverwrites.cache.map((overwrite: any) => ({
        id: overwrite.id,
        type: overwrite.type,
        allow: overwrite.allow,
        deny: overwrite.deny
      })),
      reason: `Channel cloned by ${interaction.user.tag}: ${reason}`
    };

    if (source.topic) {
      createOptions.topic = source.topic;
    }

    return await interaction.guild!.channels.create(createOptions);
  }

  private async cloneVoiceChannel(
    source: VoiceChannel,
    name: string,
    reason: string,
    interaction: ChatInputCommandInteraction
  ) {
    return await interaction.guild!.channels.create({
      name,
      type: source.type,
      bitrate: source.bitrate,
      userLimit: source.userLimit,
      position: source.position + 1,
      parent: source.parent,
      permissionOverwrites: source.permissionOverwrites.cache.map(overwrite => ({
        id: overwrite.id,
        type: overwrite.type,
        allow: overwrite.allow,
        deny: overwrite.deny
      })) as OverwriteResolvable[],
      reason: `Channel cloned by ${interaction.user.tag}: ${reason}`
    });
  }

  private async cloneCategory(
    source: CategoryChannel,
    name: string,
    reason: string,
    interaction: ChatInputCommandInteraction
  ) {
    return await interaction.guild!.channels.create({
      name,
      type: ChannelType.GuildCategory,
      position: source.position + 1,
      permissionOverwrites: source.permissionOverwrites.cache.map(overwrite => ({
        id: overwrite.id,
        type: overwrite.type,
        allow: overwrite.allow,
        deny: overwrite.deny
      })) as OverwriteResolvable[],
      reason: `Category cloned by ${interaction.user.tag}: ${reason}`
    });
  }

  private async cloneForumChannel(
    source: any,
    name: string,
    reason: string,
    interaction: ChatInputCommandInteraction
  ) {
    return await interaction.guild!.channels.create({
      name,
      type: ChannelType.GuildForum,
      topic: source.topic,
      nsfw: source.nsfw,
      rateLimitPerUser: source.rateLimitPerUser,
      position: source.position + 1,
      parent: source.parent,
      permissionOverwrites: source.permissionOverwrites.cache.map((overwrite: any) => ({
        id: overwrite.id,
        type: overwrite.type,
        allow: overwrite.allow,
        deny: overwrite.deny
      })) as OverwriteResolvable[],
      reason: `Forum channel cloned by ${interaction.user.tag}: ${reason}`
    });
  }

  private getChannelTypeName(type: ChannelType, guildId: string): string {
    switch (type) {
      case ChannelType.GuildText:
        return i18n.t('clone.channel_types.text', guildId);
      case ChannelType.GuildVoice:
        return i18n.t('clone.channel_types.voice', guildId);
      case ChannelType.GuildAnnouncement:
        return i18n.t('clone.channel_types.announcement', guildId);
      case ChannelType.GuildStageVoice:
        return i18n.t('clone.channel_types.stage', guildId);
      case ChannelType.GuildForum:
        return i18n.t('clone.channel_types.forum', guildId);
      case ChannelType.GuildCategory:
        return i18n.t('clone.channel_types.category', guildId);
      default:
        return i18n.t('clone.channel_types.unknown', guildId);
    }
  }
}