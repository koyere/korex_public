import {
  ActionRowBuilder,
  ButtonInteraction,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  RoleSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { Component, ComponentInteraction } from '../client/structures/Component';
import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';
import {
  buildSuggestionConfigButtons,
  buildSuggestionConfigEmbed,
  buildSuggestionRolesPanel,
  buildSuggestionSettingsPanel
} from '../utils/suggestionConfigPanel';

/**
 * Buttons of the /suggestions config panel:
 *  - suggestions_toggle   → enable/disable (re-enables in the last used channel)
 *  - suggestions_settings → settings panel (threads, author notification, cooldown)
 *  - suggestions_roles    → staff and voter roles panel
 *  - suggestions_cfg_*    → settings panel actions
 * All require Manage Server permission and operate on the real config (SuggestionService).
 */
export class SuggestionConfigButtons extends Component {
  constructor(client: KorexClient) {
    super(client, {
      customId: 'suggestions_*',
      type: 'button',
      guildOnly: true,
      permissions: [PermissionFlagsBits.ManageGuild]
    });
  }

  async execute(interaction: ComponentInteraction): Promise<void> {
    if (!interaction.isButton() || !interaction.guild) return;

    const btn = interaction as ButtonInteraction;
    const guildId = interaction.guild.id;
    const service = this.client.suggestionService;

    if (!service) {
      await btn.reply({ content: i18n.t('suggestions.errors.service_unavailable', guildId), flags: MessageFlags.Ephemeral });
      return;
    }

    const config = await service.getConfig(guildId);

    switch (btn.customId) {
      case 'suggestions_toggle': {
        if (config.enabled) {
          const updated = await service.updateConfig(guildId, { enabled: false });
          await btn.update({ embeds: [buildSuggestionConfigEmbed(guildId, updated)], components: [buildSuggestionConfigButtons(guildId, updated)] });
          await btn.followUp({ content: i18n.t('suggestions.config.toggled_off', guildId), flags: MessageFlags.Ephemeral });
          return;
        }

        // Re-enable in the last channel, if it still exists and is a text channel
        const channelId = config.lastChannelId;
        const channel = channelId ? interaction.guild.channels.cache.get(channelId) : null;
        if (!channel || channel.type !== ChannelType.GuildText) {
          await btn.reply({ content: i18n.t('suggestions.config.no_channel', guildId), flags: MessageFlags.Ephemeral });
          return;
        }

        const updated = await service.updateConfig(guildId, { enabled: true, channelId: channel.id });
        await btn.update({ embeds: [buildSuggestionConfigEmbed(guildId, updated)], components: [buildSuggestionConfigButtons(guildId, updated)] });
        await btn.followUp({ content: i18n.t('suggestions.config.toggled_on', guildId, { channel: `<#${channel.id}>` }), flags: MessageFlags.Ephemeral });
        return;
      }

      case 'suggestions_settings':
        await btn.reply({ ...buildSuggestionSettingsPanel(guildId, config), flags: MessageFlags.Ephemeral });
        return;

      case 'suggestions_roles':
        await btn.reply({ ...buildSuggestionRolesPanel(interaction.guild, config), flags: MessageFlags.Ephemeral });
        return;

      case 'suggestions_cfg_threads': {
        const updated = await service.updateConfig(guildId, { autoCreateThreads: !config.autoCreateThreads });
        await btn.update(buildSuggestionSettingsPanel(guildId, updated));
        return;
      }

      case 'suggestions_cfg_notify': {
        const updated = await service.updateConfig(guildId, { notifyAuthor: !config.notifyAuthor });
        await btn.update(buildSuggestionSettingsPanel(guildId, updated));
        return;
      }

      case 'suggestions_cfg_cooldown': {
        const modal = new ModalBuilder()
          .setCustomId('suggestions_cooldown_modal')
          .setTitle(i18n.t('suggestions.config.cooldown_modal_title', guildId))
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('cooldown')
                .setLabel(i18n.t('suggestions.config.cooldown_label', guildId))
                .setStyle(TextInputStyle.Short)
                .setValue(String(config.cooldown))
                .setRequired(true)
                .setMaxLength(5)
            )
          );
        await btn.showModal(modal);
        return;
      }
    }
  }
}

/** Cooldown modal (seconds between suggestions, 0–86400, same as the API) */
export class SuggestionCooldownModal extends Component {
  constructor(client: KorexClient) {
    super(client, {
      customId: 'suggestions_cooldown_modal',
      type: 'modal',
      guildOnly: true,
      permissions: [PermissionFlagsBits.ManageGuild]
    });
  }

  async execute(interaction: ComponentInteraction): Promise<void> {
    if (!interaction.isModalSubmit() || !interaction.guildId) return;

    const modal = interaction as ModalSubmitInteraction;
    const guildId = interaction.guildId;
    const raw = modal.fields.getTextInputValue('cooldown').trim();
    const seconds = /^\d+$/.test(raw) ? Number(raw) : NaN;

    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 86_400) {
      await modal.reply({ content: i18n.t('suggestions.config.invalid_cooldown', guildId), flags: MessageFlags.Ephemeral });
      return;
    }

    const updated = await this.client.suggestionService.updateConfig(guildId, { cooldown: seconds });

    if (modal.isFromMessage()) {
      await modal.update(buildSuggestionSettingsPanel(guildId, updated));
    } else {
      await modal.reply({ content: i18n.t('suggestions.config.updated', guildId), flags: MessageFlags.Ephemeral });
    }
  }
}

/** Staff and voter role selectors */
export class SuggestionRoleSelect extends Component {
  constructor(client: KorexClient) {
    super(client, {
      customId: 'suggestions_roleselect_*',
      type: 'selectMenu',
      guildOnly: true,
      permissions: [PermissionFlagsBits.ManageGuild]
    });
  }

  async execute(interaction: ComponentInteraction): Promise<void> {
    if (!interaction.isRoleSelectMenu() || !interaction.guild) return;

    const select = interaction as RoleSelectMenuInteraction;
    const guildId = interaction.guild.id;
    // Only real server roles (no @everyone or integration-managed roles)
    const roleIds = [...new Set(select.values)].filter(id => {
      const role = interaction.guild!.roles.cache.get(id);
      return !!role && role.id !== guildId && !role.managed;
    });

    const field = select.customId === 'suggestions_roleselect_staff' ? 'staffRoleIds'
      : select.customId === 'suggestions_roleselect_voter' ? 'voterRoleIds'
        : null;
    if (!field) return;

    const updated = await this.client.suggestionService.updateConfig(guildId, { [field]: roleIds });
    await select.update(buildSuggestionRolesPanel(interaction.guild, updated));
  }
}

// The ComponentManager only registers the default export
export default [SuggestionConfigButtons, SuggestionCooldownModal, SuggestionRoleSelect];
