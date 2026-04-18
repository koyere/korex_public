import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  PermissionFlagsBits
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { botConfig } from '../../config/bot.config';
import { AutoResponseTrigger } from '../../services/AutoResponseService';

export default class AutoResponseCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'autoresponse',
      description: 'Manage automatic responses to messages',
      category: 'admin',
      cooldown: 3,
      permissions: {
        user: [PermissionFlagsBits.ManageGuild],
        bot: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]
      }
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription(i18n.t(`commands.${this.name}.description`, 'global'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand(subcommand =>
        subcommand
          .setName('list')
          .setDescription(i18n.t(`commands.${this.name}.list.description`, 'global'))
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('create')
          .setDescription(i18n.t(`commands.${this.name}.create.description`, 'global'))
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('edit')
          .setDescription(i18n.t(`commands.${this.name}.edit.description`, 'global'))
          .addStringOption(option =>
            option
              .setName('id')
              .setDescription(i18n.t(`commands.${this.name}.edit.id_option`, 'global'))
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('delete')
          .setDescription(i18n.t(`commands.${this.name}.delete.description`, 'global'))
          .addStringOption(option =>
            option
              .setName('id')
              .setDescription(i18n.t(`commands.${this.name}.delete.id_option`, 'global'))
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('toggle')
          .setDescription(i18n.t(`commands.${this.name}.toggle.description`, 'global'))
          .addStringOption(option =>
            option
              .setName('id')
              .setDescription(i18n.t(`commands.${this.name}.toggle.id_option`, 'global'))
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('test')
          .setDescription(i18n.t(`commands.${this.name}.test.description`, 'global'))
          .addStringOption(option =>
            option
              .setName('id')
              .setDescription(i18n.t(`commands.${this.name}.test.id_option`, 'global'))
              .setRequired(true)
          )
          .addStringOption(option =>
            option
              .setName('message')
              .setDescription(i18n.t(`commands.${this.name}.test.message_option`, 'global'))
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('stats')
          .setDescription(i18n.t(`commands.${this.name}.stats.description`, 'global'))
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'list':
        await this.handleList(interaction, guildId);
        break;
      case 'create':
        await this.handleCreate(interaction, guildId);
        break;
      case 'edit':
        await this.handleEdit(interaction, guildId);
        break;
      case 'delete':
        await this.handleDelete(interaction, guildId);
        break;
      case 'toggle':
        await this.handleToggle(interaction, guildId);
        break;
      case 'test':
        await this.handleTest(interaction, guildId);
        break;
      case 'stats':
        await this.handleStats(interaction, guildId);
        break;
    }
  }

  private async handleList(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    const autoResponses = await this.client.autoResponseService.getGuildAutoResponses(guildId);

    if (!autoResponses.length) {
      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.warning)
        .setTitle(`📝 ${i18n.t('commands.autoresponse.list.no_responses', guildId)}`)
        .setDescription(i18n.t('commands.autoresponse.list.no_responses_desc', guildId))
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      return;
    }

    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.primary)
      .setTitle(`📝 ${i18n.t('commands.autoresponse.list.title', guildId)}`)
      .setDescription(i18n.t('commands.autoresponse.list.list_description', guildId, { count: autoResponses.length.toString() }))
      .setTimestamp();

    // Add fields for each auto-response (limit to 10)
    const displayResponses = autoResponses.slice(0, 10);

    for (const response of displayResponses) {
      const status = response.enabled ? '✅' : '❌';
      const triggers = response.triggers.slice(0, 3).join(', ');
      const triggerText = response.triggers.length > 3 ? 
        `${triggers}... (+${response.triggers.length - 3} more)` : 
        triggers;

      embed.addFields({
        name: `${status} ${response.name} (ID: ${response.id})`,
        value: `**Triggers:** ${triggerText}\n**Type:** ${response.triggerType}\n**Usage:** ${response.usageCount}`,
        inline: true
      });
    }

    if (autoResponses.length > 10) {
      embed.setFooter({ 
        text: i18n.t('commands.autoresponse.list.showing_limited', guildId, { 
          shown: '10', 
          total: autoResponses.length.toString() 
        })
      });
    }

    await interaction.reply({ embeds: [embed] });
  }

  private async handleCreate(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    const modal = new ModalBuilder()
      .setCustomId('autoresponse_create')
      .setTitle(i18n.t('commands.autoresponse.create.modal_title', guildId));

    const nameInput = new TextInputBuilder()
      .setCustomId('name')
      .setLabel(i18n.t('commands.autoresponse.create.name_label', guildId))
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(i18n.t('commands.autoresponse.create.name_placeholder', guildId))
      .setRequired(true)
      .setMaxLength(50);

    const triggersInput = new TextInputBuilder()
      .setCustomId('triggers')
      .setLabel(i18n.t('commands.autoresponse.create.triggers_label', guildId))
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder(i18n.t('commands.autoresponse.create.triggers_placeholder', guildId))
      .setRequired(true)
      .setMaxLength(500);

    const responseInput = new TextInputBuilder()
      .setCustomId('response')
      .setLabel(i18n.t('commands.autoresponse.create.response_label', guildId))
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder(i18n.t('commands.autoresponse.create.response_placeholder', guildId))
      .setRequired(true)
      .setMaxLength(1000);

    const typeInput = new TextInputBuilder()
      .setCustomId('type')
      .setLabel(i18n.t('commands.autoresponse.create.type_label', guildId))
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('contains, exact, starts, ends, regex')
      .setRequired(false)
      .setMaxLength(20);

    const cooldownInput = new TextInputBuilder()
      .setCustomId('cooldown')
      .setLabel(i18n.t('commands.autoresponse.create.cooldown_label', guildId))
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('5')
      .setRequired(false)
      .setMaxLength(3);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(triggersInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(responseInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(typeInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(cooldownInput)
    );

    await interaction.showModal(modal);
  }

  private async handleEdit(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    const id = interaction.options.getString('id', true);
    const autoResponse = await this.findById(guildId, id);

    if (!autoResponse) {
      await interaction.reply({
        content: i18n.t('commands.autoresponse.edit.id_not_found', guildId, { id }),
        ephemeral: true
      });

      return;
    }

    const firstTextAction = autoResponse.responses.find(action => action.type === 'text');
    const responseContent = firstTextAction?.content || '';

    const modal = new ModalBuilder()
      .setCustomId(`autoresponse_edit_${id}`)
      .setTitle(i18n.t('commands.autoresponse.edit.modal_title', guildId));

    const nameInput = new TextInputBuilder()
      .setCustomId('name')
      .setLabel(i18n.t('commands.autoresponse.create.name_label', guildId))
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(50)
      .setValue(autoResponse.name);

    const triggersInput = new TextInputBuilder()
      .setCustomId('triggers')
      .setLabel(i18n.t('commands.autoresponse.create.triggers_label', guildId))
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(500)
      .setValue(autoResponse.triggers.join('\n'));

    const responseInput = new TextInputBuilder()
      .setCustomId('response')
      .setLabel(i18n.t('commands.autoresponse.create.response_label', guildId))
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1000)
      .setValue(responseContent.substring(0, 1000));

    const typeInput = new TextInputBuilder()
      .setCustomId('type')
      .setLabel(i18n.t('commands.autoresponse.create.type_label', guildId))
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(20)
      .setValue(autoResponse.triggerType);

    const cooldownInput = new TextInputBuilder()
      .setCustomId('cooldown')
      .setLabel(i18n.t('commands.autoresponse.create.cooldown_label', guildId))
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(3)
      .setValue(autoResponse.cooldown.toString());

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(triggersInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(responseInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(typeInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(cooldownInput)
    );

    await interaction.showModal(modal);
  }

  private async handleDelete(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    const id = interaction.options.getString('id', true);
    const autoResponse = await this.findById(guildId, id);

    if (!autoResponse) {
      await interaction.reply({
        content: i18n.t('commands.autoresponse.delete.id_not_found', guildId, { id }),
        ephemeral: true
      });

      return;
    }

    const deleted = await this.client.autoResponseService.deleteAutoResponse(id);

    if (!deleted) {
      await interaction.reply({
        content: i18n.t('common.errors.generic', guildId),
        ephemeral: true
      });

      return;
    }

    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.success)
      .setTitle(i18n.t('commands.autoresponse.delete.success_title', guildId))
      .setDescription(i18n.t('commands.autoresponse.delete.success_desc', guildId, { id }))
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  private async handleToggle(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    const id = interaction.options.getString('id', true);
    const autoResponse = await this.findById(guildId, id);

    if (!autoResponse) {
      await interaction.reply({
        content: i18n.t('commands.autoresponse.toggle.id_not_found', guildId, { id }),
        ephemeral: true
      });

      return;
    }

    const enabled = !autoResponse.enabled;
    const updated = await this.client.autoResponseService.updateAutoResponse(id, { enabled });

    if (!updated) {
      await interaction.reply({
        content: i18n.t('common.errors.generic', guildId),
        ephemeral: true
      });

      return;
    }

    const statusLabel = enabled ? i18n.t('common.enabled', guildId) : i18n.t('common.disabled', guildId);
    const embed = new EmbedBuilder()
      .setColor(enabled ? botConfig.colors.success : botConfig.colors.warning)
      .setTitle(
        i18n.t(
          enabled ? 'commands.autoresponse.toggle.enabled_title' : 'commands.autoresponse.toggle.disabled_title',
          guildId
        )
      )
      .setDescription(i18n.t('commands.autoresponse.toggle.toggle_desc', guildId, {
        name: autoResponse.name,
        id,
        status: statusLabel
      }))
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  private async handleTest(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    const id = interaction.options.getString('id', true);
    const message = interaction.options.getString('message', true);

    const autoResponse = await this.findById(guildId, id);

    if (!autoResponse) {
      await interaction.reply({
        content: i18n.t('commands.autoresponse.toggle.id_not_found', guildId, { id }),
        ephemeral: true
      });

      return;
    }

    const isMatch = this.matchesTrigger(message, autoResponse);
    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.info)
      .setTitle(`🧪 ${i18n.t('commands.autoresponse.test.title', guildId)}`)
      .setDescription(i18n.t('commands.autoresponse.test.testing', guildId, { id, message }))
      .addFields(
        {
          name: i18n.t('commands.autoresponse.test.result', guildId),
          value: i18n.t(
            isMatch ? 'commands.autoresponse.test.match' : 'commands.autoresponse.test.no_match',
            guildId
          )
        }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  private async handleStats(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    const stats = await this.client.autoResponseService.getGuildStats(guildId);

    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.primary)
      .setTitle(`📊 ${i18n.t('commands.autoresponse.stats.title', guildId)}`)
      .setDescription(i18n.t('commands.autoresponse.stats.stats_description', guildId))
      .addFields(
        { 
          name: i18n.t('commands.autoresponse.stats.general', guildId), 
          value: i18n.t('commands.autoresponse.stats.general_value', guildId, {
            total: stats.total.toString(),
            enabled: stats.enabled.toString(),
            disabled: stats.disabled.toString()
          }),
          inline: true 
        },
        { 
          name: i18n.t('commands.autoresponse.stats.usage', guildId), 
          value: i18n.t('commands.autoresponse.stats.usage_value', guildId, {
            total: stats.totalUsage.toString(),
            average: (stats.total > 0 ? Math.round(stats.totalUsage / stats.total) : 0).toString()
          }),
          inline: true 
        }
      )
      .setTimestamp();

    if (stats.mostUsed) {
      embed.addFields({
        name: i18n.t('commands.autoresponse.stats.most_used', guildId),
        value: i18n.t('commands.autoresponse.stats.most_used_value', guildId, {
          name: stats.mostUsed.name,
          usage: stats.mostUsed.usageCount.toString()
        }),
        inline: false
      });
    }

    await interaction.reply({ embeds: [embed] });
  }

  private async findById(guildId: string, id: string): Promise<AutoResponseTrigger | undefined> {
    const autoResponses = await this.client.autoResponseService.getGuildAutoResponses(guildId);

    return autoResponses.find(response => response.id === id);
  }

  private matchesTrigger(content: string, autoResponse: AutoResponseTrigger): boolean {
    const messageContent = autoResponse.caseSensitive ? content : content.toLowerCase();

    for (const trigger of autoResponse.triggers) {
      const triggerText = autoResponse.caseSensitive ? trigger : trigger.toLowerCase();

      switch (autoResponse.triggerType) {
        case 'exact':
          if (messageContent === triggerText) return true;
          break;
        case 'contains':
          if (messageContent.includes(triggerText)) return true;
          break;
        case 'starts':
          if (messageContent.startsWith(triggerText)) return true;
          break;
        case 'ends':
          if (messageContent.endsWith(triggerText)) return true;
          break;
        case 'regex':
          try {
            const regex = new RegExp(triggerText, autoResponse.caseSensitive ? 'g' : 'gi');

            if (regex.test(messageContent)) return true;
          } catch {
            return false;
          }
          break;
      }
    }

    return false;
  }
}
