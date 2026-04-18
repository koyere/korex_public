import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  TextChannel,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  SlashCommandSubcommandsOnlyBuilder
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { botConfig } from '../../config/bot.config';
import { buildTypeSelectRow } from '../../utils/pollHelpers';

export default class PollCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'poll',
      description: 'Create and manage polls',
      category: 'utility',
      cooldown: 10,
      permissions: {
        user: [PermissionFlagsBits.SendMessages],
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
          .setName('create')
          .setDescription(i18n.t('commands.poll.create.description', 'global'))
          .addChannelOption(option =>
            option
              .setName('channel')
              .setDescription(i18n.t('commands.poll.create.options.channel', 'global'))
              .addChannelTypes(ChannelType.GuildText)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('end')
          .setDescription(i18n.t('commands.poll.end.description', 'global'))
          .addStringOption(option =>
            option
              .setName('id')
              .setDescription(i18n.t('commands.poll.end.options.id', 'global'))
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('results')
          .setDescription(i18n.t('commands.poll.results.description', 'global'))
          .addStringOption(option =>
            option
              .setName('id')
              .setDescription(i18n.t('commands.poll.results.options.id', 'global'))
              .setRequired(true)
          )
          .addStringOption(option =>
            option
              .setName('format')
              .setDescription(i18n.t('commands.poll.results.options.format', 'global'))
              .addChoices(
                { name: 'JSON', value: 'json' },
                { name: 'CSV', value: 'csv' },
                { name: 'Text', value: 'text' }
              )
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('list')
          .setDescription(i18n.t('commands.poll.list.description', 'global'))
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('info')
          .setDescription(i18n.t('commands.poll.info.description', 'global'))
          .addStringOption(option =>
            option
              .setName('id')
              .setDescription(i18n.t('commands.poll.info.options.id', 'global'))
              .setRequired(true)
          )
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'create':
        await this.handleCreate(interaction);
        break;
      case 'end':
        await this.handleEnd(interaction);
        break;
      case 'results':
        await this.handleResults(interaction);
        break;
      case 'list':
        await this.handleList(interaction);
        break;
      case 'info':
        await this.handleInfo(interaction);
        break;
      default:
        await interaction.reply({
          content: i18n.t('errors.invalid_subcommand', guildId),
          ephemeral: true
        });
    }
  }

  private async handleCreate(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const guild = interaction.guild!;
    const channel = (interaction.options.getChannel('channel') as TextChannel) || interaction.channel as TextChannel;

    if (!channel?.isTextBased()) {
      await interaction.reply({ content: i18n.t('commands.poll.create.errors.invalid_channel', guildId), flags: MessageFlags.Ephemeral });
      return;
    }

    const botPermissions = channel.permissionsFor(guild.members.me!);
    if (!botPermissions?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      await interaction.reply({ content: i18n.t('commands.poll.create.errors.no_permissions', guildId), flags: MessageFlags.Ephemeral });
      return;
    }

    const activeCount = await this.client.pollService.getActivePollCount(guildId);
    if (activeCount >= botConfig.limits.polls) {
      await interaction.reply({ content: i18n.t('commands.poll.create.errors.limit_reached', guildId, { limit: botConfig.limits.polls.toString() }), flags: MessageFlags.Ephemeral });
      return;
    }

    // Store channel before showing modal (modal can't carry extra data)
    await this.client.cache.setTempData(`poll_setup_init_${interaction.user.id}`, { channelId: channel.id }, 300);

    const modal = new ModalBuilder()
      .setCustomId(`poll_create_modal_${interaction.user.id}`)
      .setTitle(i18n.t('polls.wizard.modal_title', guildId));

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel(i18n.t('polls.wizard.title_label', guildId))
          .setPlaceholder(i18n.t('polls.wizard.title_placeholder', guildId))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(100)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('description')
          .setLabel(i18n.t('polls.wizard.description_label', guildId))
          .setPlaceholder(i18n.t('polls.wizard.description_placeholder', guildId))
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(500)
          .setRequired(false)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('options')
          .setLabel(i18n.t('polls.wizard.options_label', guildId))
          .setPlaceholder(i18n.t('polls.wizard.options_placeholder', guildId))
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setRequired(true)
      )
    );

    await interaction.showModal(modal);
  }

  private async handleEnd(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const pollId = interaction.options.getString('id', true);

    await interaction.deferReply({ ephemeral: true });

    const success = await this.client.pollService.endPoll(pollId, true);

    if (success) {
      await interaction.editReply({
        content: i18n.t('commands.poll.end.success', guildId, { id: pollId })
      });
    } else {
      await interaction.editReply({
        content: i18n.t('commands.poll.end.error', guildId)
      });
    }
  }

  private async handleResults(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const pollId = interaction.options.getString('id', true);
    const format = interaction.options.getString('format') || 'json';

    await interaction.deferReply({ ephemeral: true });

    try {
      const results = await this.client.pollService.exportPollResults(pollId, format as any);

      if (!results) {
        await interaction.editReply({
          content: i18n.t('commands.poll.results.not_found', guildId)
        });

        return;
      }

      // Send results as file if too long, otherwise as code block
      if (results.length > 1900) {
        const buffer = Buffer.from(results, 'utf-8');
        const filename = `poll_${pollId}_results.${format}`;

        await interaction.editReply({
          content: i18n.t('commands.poll.results.exported', guildId, { format }),
          files: [{
            attachment: buffer,
            name: filename
          }]
        });
      } else {
        await interaction.editReply({
          content: `\`\`\`${format}\n${results}\n\`\`\``
        });
      }

    } catch (error) {
      await interaction.editReply({
        content: i18n.t('commands.poll.results.error', guildId)
      });
    }
  }

  private async handleList(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;

    await interaction.deferReply({ ephemeral: true });

    const polls = await this.client.pollService.getGuildPolls(guildId);

    if (polls.length === 0) {
      await interaction.editReply({
        content: i18n.t('commands.poll.list.no_polls', guildId)
      });

      return;
    }

    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.primary)
      .setTitle(i18n.t('commands.poll.list.title', guildId))
      .setDescription(
        polls.map(p => 
          `**${p.id}** - ${p.title} (${p.ended ? 
            i18n.t('polls.status.ended', guildId) : 
            i18n.t('polls.status.active', guildId)
          })`
        ).join('\n')
      );

    if (this.client.user?.displayAvatarURL()) {
      embed.setFooter({
        text: i18n.t('commands.poll.list.footer', guildId, { count: polls.length.toString() }),
        iconURL: this.client.user.displayAvatarURL()
      });
    } else {
      embed.setFooter({
        text: i18n.t('commands.poll.list.footer', guildId, { count: polls.length.toString() })
      });
    }

    await interaction.editReply({ embeds: [embed] });
  }

  private async handleInfo(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const pollId = interaction.options.getString('id', true);

    await interaction.reply({
      content: i18n.t('commands.poll.info.not_implemented', guildId),
      ephemeral: true
    });
  }

  /**
   * Parse poll options from text
   */
  private parseOptions(optionsText: string): Array<{ id: string; text: string; emoji?: string }> {
    const lines = optionsText.split('\n').filter(line => line.trim());
    const options: Array<{ id: string; text: string; emoji?: string }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (!line) continue;

      // Check for emoji at the start
      const emojiMatch = line.match(/^(\p{Emoji})\s*(.+)$/u);
      
      if (emojiMatch) {
        options.push({
          id: `option_${i}`,
          text: emojiMatch[2].trim(),
          emoji: emojiMatch[1]
        });
      } else {
        options.push({
          id: `option_${i}`,
          text: line
        });
      }
    }

    return options;
  }
}