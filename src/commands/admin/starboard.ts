import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  Colors,
  ChannelType,
  TextChannel,
  Role,
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class StarboardCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'starboard',
      description: 'Configure the starboard system',
      category: 'admin',
      cooldown: 5,
      permissions: {
        user: [PermissionFlagsBits.ManageGuild],
        bot: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageMessages],
      },
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('starboard')
      .setDescription('Configure the starboard system')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand(sub =>
        sub.setName('setup')
          .setDescription('Set up the starboard channel')
          .addChannelOption(o =>
            o.setName('channel')
              .setDescription('Channel for starboard posts')
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true)
          )
      )
      .addSubcommand(sub =>
        sub.setName('config')
          .setDescription('Configure starboard settings')
          .addStringOption(o =>
            o.setName('emoji')
              .setDescription('Emoji to use as the star (default: ⭐)')
              .setRequired(false)
          )
          .addIntegerOption(o =>
            o.setName('threshold')
              .setDescription('Minimum reactions to post (default: 3)')
              .setMinValue(1)
              .setMaxValue(50)
              .setRequired(false)
          )
          .addBooleanOption(o =>
            o.setName('self_star')
              .setDescription('Allow users to star their own messages (default: false)')
              .setRequired(false)
          )
          .addBooleanOption(o =>
            o.setName('ignore_nsfw')
              .setDescription('Ignore NSFW channels (default: true)')
              .setRequired(false)
          )
          .addBooleanOption(o =>
            o.setName('ignore_bots')
              .setDescription('Ignore messages from bots (default: true)')
              .setRequired(false)
          )
      )
      .addSubcommand(sub =>
        sub.setName('ignore')
          .setDescription('Add or remove a channel from the ignore list')
          .addChannelOption(o =>
            o.setName('channel')
              .setDescription('Channel to toggle')
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
              .setRequired(true)
          )
      )
      .addSubcommand(sub =>
        sub.setName('stats')
          .setDescription('View starboard statistics')
      )
      .addSubcommand(sub =>
        sub.setName('disable')
          .setDescription('Disable the starboard system')
      ) as SlashCommandBuilder;
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild!.id;

    switch (sub) {
      case 'setup':   return this.handleSetup(interaction, guildId);
      case 'config':  return this.handleConfig(interaction, guildId);
      case 'ignore':  return this.handleIgnore(interaction, guildId);
      case 'stats':   return this.handleStats(interaction, guildId);
      case 'disable': return this.handleDisable(interaction, guildId);
    }
  }

  private async handleSetup(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    await interaction.deferReply({ ephemeral: true });
    const channel = interaction.options.getChannel('channel', true) as TextChannel;

    await this.client.db.starboardConfig.upsert({
      where: { guildId },
      create: { guildId, channelId: channel.id, enabled: true },
      update: { channelId: channel.id, enabled: true },
    });
    this.client.starboard.invalidateCache(interaction.guildId!);

    const embed = new EmbedBuilder()
      .setColor(Colors.Yellow)
      .setTitle(i18n.t('starboard.setup.success.title', guildId))
      .setDescription(i18n.t('starboard.setup.success.desc', guildId, { channel: channel.toString() }))
      .addFields(
        { name: i18n.t('starboard.setup.success.emoji', guildId), value: '⭐', inline: true },
        { name: i18n.t('starboard.setup.success.threshold', guildId), value: '3', inline: true },
      );

    await interaction.editReply({ embeds: [embed] });
  }

  private async handleConfig(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const config = await this.client.db.starboardConfig.findUnique({ where: { guildId } });
    if (!config) {
      await interaction.editReply({ content: i18n.t('starboard.errors.not_configured', guildId) });
      return;
    }

    const emoji     = interaction.options.getString('emoji') ?? config.emoji;
    const threshold = interaction.options.getInteger('threshold') ?? config.threshold;
    const selfStar  = interaction.options.getBoolean('self_star') ?? config.selfStar;
    const ignoreNsfw = interaction.options.getBoolean('ignore_nsfw') ?? config.ignoreNsfw;
    const ignoreBots = interaction.options.getBoolean('ignore_bots') ?? config.ignoreBots;

    await this.client.db.starboardConfig.update({
      where: { guildId },
      data: { emoji, threshold, selfStar, ignoreNsfw, ignoreBots },
    });
    this.client.starboard.invalidateCache(interaction.guildId!);

    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle(i18n.t('starboard.config.updated.title', guildId))
      .addFields(
        { name: i18n.t('starboard.config.updated.emoji', guildId), value: emoji, inline: true },
        { name: i18n.t('starboard.config.updated.threshold', guildId), value: String(threshold), inline: true },
        { name: i18n.t('starboard.config.updated.self_star', guildId), value: selfStar ? '✅' : '❌', inline: true },
        { name: i18n.t('starboard.config.updated.ignore_nsfw', guildId), value: ignoreNsfw ? '✅' : '❌', inline: true },
        { name: i18n.t('starboard.config.updated.ignore_bots', guildId), value: ignoreBots ? '✅' : '❌', inline: true },
      );

    await interaction.editReply({ embeds: [embed] });
  }

  private async handleIgnore(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const config = await this.client.db.starboardConfig.findUnique({ where: { guildId } });
    if (!config) {
      await interaction.editReply({ content: i18n.t('starboard.errors.not_configured', guildId) });
      return;
    }

    const channel = interaction.options.getChannel('channel', true);
    const ignored = config.ignoredChannels;
    const isIgnored = ignored.includes(channel.id);
    const updated = isIgnored
      ? ignored.filter(id => id !== channel.id)
      : [...ignored, channel.id];

    await this.client.db.starboardConfig.update({
      where: { guildId },
      data: { ignoredChannels: updated },
    });
    this.client.starboard.invalidateCache(interaction.guildId!);

    await interaction.editReply({
      content: isIgnored
        ? i18n.t('starboard.ignore.removed', guildId, { channel: channel.toString() })
        : i18n.t('starboard.ignore.added', guildId, { channel: channel.toString() }),
    });
  }

  private async handleStats(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    await interaction.deferReply({ ephemeral: false });

    const config = await this.client.db.starboardConfig.findUnique({ where: { guildId } });
    if (!config) {
      await interaction.editReply({ content: i18n.t('starboard.errors.not_configured', guildId) });
      return;
    }

    const stats = await this.client.starboard.getStats(guildId);
    const topUser = stats.topAuthorId
      ? await this.client.users.fetch(stats.topAuthorId).catch(() => null)
      : null;

    const embed = new EmbedBuilder()
      .setColor(Colors.Yellow)
      .setTitle(i18n.t('starboard.stats.title', guildId))
      .addFields(
        { name: i18n.t('starboard.stats.total', guildId), value: String(stats.total), inline: true },
        { name: i18n.t('starboard.stats.channel', guildId), value: `<#${config.channelId}>`, inline: true },
        { name: i18n.t('starboard.stats.emoji', guildId), value: config.emoji, inline: true },
        { name: i18n.t('starboard.stats.threshold', guildId), value: String(config.threshold), inline: true },
        {
          name: i18n.t('starboard.stats.top_author', guildId),
          value: topUser ? `${topUser.tag} (${stats.topAuthorStars} ⭐)` : i18n.t('common.none', guildId),
          inline: true,
        },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }

  private async handleDisable(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    await this.client.db.starboardConfig.updateMany({
      where: { guildId },
      data: { enabled: false },
    });
    this.client.starboard.invalidateCache(interaction.guildId!);

    await interaction.editReply({ content: i18n.t('starboard.disabled', guildId) });
  }
}
