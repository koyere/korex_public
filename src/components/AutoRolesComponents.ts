import {
  ModalSubmitInteraction,
  ButtonInteraction,
  TextChannel,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} from 'discord.js';
import { Component, ComponentInteraction } from '../client/structures/Component';
import { KorexClient } from '../client/KorexClient';
import { ReactionRole } from '../services/AutoRoleService';
import { i18n } from '../utils/i18n';
import { checkSelfAssignableRole } from '../utils/roleSafety';

/**
 * Checks that every role in the panel is safe to be self-assigned by
 * any member (no moderation permissions, below the bot and the creator).
 * Returns the translated error message, or null if everything is valid.
 */
function validatePanelRoles(interaction: ModalSubmitInteraction, roleIds: string[]): string | null {
  const guild = interaction.guild!;
  const actor = interaction.member && 'roles' in interaction.member && !Array.isArray((interaction.member as any).roles)
    ? (interaction.member as any)
    : guild.members.cache.get(interaction.user.id) ?? null;
  if (new Set(roleIds).size !== roleIds.length) return i18n.t('autorole.wizard.duplicate_role', guild.id);
  for (const roleId of roleIds) {
    const check = checkSelfAssignableRole(guild, roleId, actor);
    if (!check.ok) {
      return i18n.t(`autorole.wizard.role_${check.problem}`, guild.id, { role: `<@&${roleId}>` });
    }
  }
  return null;
}

// ─── Reaction Role Wizard Modal ────────────────────────────────────────────────

export class AutoRolesReactionWizardModal extends Component {
  constructor(client: KorexClient) {
    super(client, {
      customId: 'rrwizard_reaction_*',
      type: 'modal',
      guildOnly: true,
      permissions: [PermissionFlagsBits.ManageRoles],
    });
  }

  async execute(interaction: ComponentInteraction): Promise<void> {
    if (!interaction.isModalSubmit()) return;
    await this.handleReactionModal(interaction);
  }

  private async handleReactionModal(interaction: ModalSubmitInteraction): Promise<void> {
    const guild = interaction.guild!;
    const channelId = interaction.customId.replace('rrwizard_reaction_', '');
    const channel = guild.channels.cache.get(channelId) as TextChannel | undefined;

    if (!channel || !channel.isTextBased()) {
      await interaction.reply({ content: i18n.t('autorole.wizard.channel_invalid', guild.id), ephemeral: true });
      return;
    }

    const title = interaction.fields.getTextInputValue('title').trim();
    const description = interaction.fields.getTextInputValue('description').trim();
    const colorRaw = interaction.fields.getTextInputValue('color').trim();
    const color = /^#[0-9a-fA-F]{6}$/.test(colorRaw) ? colorRaw : '#5865F2';

    // Try to get wizard data (from multi-step flow)
    const AutoRolesCommand = (await import('../commands/admin/autoroles')).default;
    const wizardData = AutoRolesCommand.getWizardData(interaction.customId);

    const roles: ReactionRole[] = [];

    if (wizardData) {
      // New flow: format "1. ⭐ = RoleName" — extract the emoji between ". " and " ="
      const emojisRaw = interaction.fields.getTextInputValue('emojis');
      const emojis = emojisRaw.split('\n').map(l => {
        const match = l.match(/^\d+\.\s*(.+?)\s*=\s*.+$/);
        return match ? match[1].trim() : l.trim().split(/\s+/)[0];
      }).filter(Boolean);

      for (let idx = 0; idx < wizardData.roles.length; idx++) {
        const role = wizardData.roles[idx];
        const emoji = emojis[idx];
        if (!emoji) continue;
        roles.push({ emoji, roleId: role.id, description: undefined, messageId: '', channelId: channel.id });
      }

      if (roles.length === 0) {
        await interaction.reply({ content: i18n.t('autorole.wizard.emoji_required', guild.id), ephemeral: true });
        return;
      }

      const type = (wizardData.type || 'MULTIPLE') as 'MULTIPLE' | 'SINGLE' | 'UNIQUE';

      const roleError = validatePanelRoles(interaction, roles.map((r) => r.roleId));
      if (roleError) {
        await interaction.reply({ content: roleError, ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        const autoRole = this.client.autoRole;
        if (!autoRole) throw new Error('AutoRole service unavailable');

        await autoRole.createReactionRoleMessage(guild, channel as TextChannel, {
          channelId: channel.id,
          title,
          description,
          color,
          type,
          roles,
        });

        await interaction.editReply({
          content: i18n.t('autorole.wizard.reaction_created', guild.id, { channel: `${channel}`, count: String(roles.length) }),
        });
      } catch (error) {
        this.client.logger.error('Error creating reaction role message:', error);
        await interaction.editReply({
          content: i18n.t('autorole.wizard.reaction_error', guild.id),
        });
      }
    } else {
      // Legacy fallback: parse roles from text
      const rolesRaw = interaction.fields.getTextInputValue('roles') ?? '';
      const typeRaw = (interaction.fields.getTextInputValue('type') ?? '').trim().toUpperCase();
      const validTypes = ['MULTIPLE', 'SINGLE', 'UNIQUE'];
      const type = (validTypes.includes(typeRaw) ? typeRaw : 'MULTIPLE') as 'MULTIPLE' | 'SINGLE' | 'UNIQUE';

      for (const line of rolesRaw.split('\n').slice(0, 10)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length < 2) continue;
        const emoji = parts[0];
        const rawRole = parts[1];
        const desc = parts.slice(2).join(' ') || undefined;
        const roleId = rawRole.match(/^<@&(\d+)>$/)?.[1] ?? (rawRole.match(/^\d+$/) ? rawRole : null);
        if (!roleId) continue;
        const role = guild.roles.cache.get(roleId);
        if (!role) continue;
        roles.push({ emoji, roleId: role.id, description: desc, messageId: '', channelId: channel.id });
      }

      if (roles.length === 0) {
        await interaction.reply({ content: i18n.t('autorole.wizard.no_valid_roles', guild.id), ephemeral: true });
        return;
      }

      const roleError = validatePanelRoles(interaction, roles.map((r) => r.roleId));
      if (roleError) {
        await interaction.reply({ content: roleError, ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        const autoRole = this.client.autoRole;
        if (!autoRole) throw new Error('AutoRole service unavailable');

        await autoRole.createReactionRoleMessage(guild, channel as TextChannel, {
          channelId: channel.id, title, description, color, type, roles,
        });

        await interaction.editReply({
          content: i18n.t('autorole.wizard.reaction_created', guild.id, { channel: `${channel}`, count: String(roles.length) }),
        });
      } catch (error) {
        this.client.logger.error('Error creating reaction role message:', error);
        await interaction.editReply({
          content: i18n.t('autorole.wizard.reaction_error', guild.id),
        });
      }
    }
  }
}

// ─── Button Role Wizard Modal ──────────────────────────────────────────────────

export class AutoRolesButtonWizardModal extends Component {
  constructor(client: KorexClient) {
    super(client, {
      customId: 'rrwizard_button_*',
      type: 'modal',
      guildOnly: true,
      permissions: [PermissionFlagsBits.ManageRoles],
    });
  }

  async execute(interaction: ComponentInteraction): Promise<void> {
    if (!interaction.isModalSubmit()) return;
    await this.handleButtonModal(interaction);
  }

  private async handleButtonModal(interaction: ModalSubmitInteraction): Promise<void> {
    const guild = interaction.guild!;
    const channelId = interaction.customId.replace('rrwizard_button_', '');
    const channel = guild.channels.cache.get(channelId) as TextChannel | undefined;

    if (!channel || !channel.isTextBased()) {
      await interaction.reply({ content: i18n.t('autorole.wizard.channel_invalid', guild.id), ephemeral: true });
      return;
    }

    const title = interaction.fields.getTextInputValue('title').trim();
    const description = interaction.fields.getTextInputValue('description').trim();
    const colorRaw = interaction.fields.getTextInputValue('color').trim();
    const rolesRaw = interaction.fields.getTextInputValue('roles');

    const color = /^#[0-9a-fA-F]{6}$/.test(colorRaw) ? colorRaw : '#5865F2';

    interface ButtonRoleEntry { emoji: string; label: string; roleId: string }
    const roleEntries: ButtonRoleEntry[] = [];

    for (const line of rolesRaw.split('\n').slice(0, 25)) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const parts = trimmed.split(/\s+/);
      if (parts.length < 3) continue;

      const emoji = parts[0];
      const label = parts[1];
      const rawRole = parts[2];

      const roleId = rawRole.match(/^<@&(\d+)>$/)?.[1] ?? (rawRole.match(/^\d+$/) ? rawRole : null);
      if (!roleId) continue;

      const role = guild.roles.cache.get(roleId);
      if (!role) continue;

      roleEntries.push({ emoji, label, roleId: role.id });
    }

    if (roleEntries.length === 0) {
      await interaction.reply({
        content: i18n.t('autorole.wizard.no_valid_button_roles', guild.id),
        ephemeral: true,
      });
      return;
    }

    const roleError = validatePanelRoles(interaction, roleEntries.map((r) => r.roleId));
    if (roleError) {
      await interaction.reply({ content: roleError, ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const embed = new EmbedBuilder()
        .setColor(color as `#${string}`)
        .setTitle(title)
        .setDescription(description);

      const rows: ActionRowBuilder<ButtonBuilder>[] = [];
      for (let i = 0; i < roleEntries.length; i += 5) {
        const chunk = roleEntries.slice(i, i + 5);
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          chunk.map(entry =>
            new ButtonBuilder()
              .setCustomId(`autorole_btn_${entry.roleId}`)
              .setLabel(entry.label)
              .setStyle(ButtonStyle.Secondary)
              .setEmoji(entry.emoji)
          )
        );
        rows.push(row);
      }

      const sent = await (channel as TextChannel).send({ embeds: [embed], components: rows });

      // Register the panel so it shows up (and can be deleted) in the dashboard
      await this.client.db.reactionRoleMessage.create({
        data: {
          guildId: guild.id,
          channelId: channel.id,
          messageId: sent.id,
          title,
          description,
          color,
          type: 'BUTTON',
          roles: roleEntries as any,
        },
      }).catch((err: unknown) => this.client.logger.warn('Could not persist button role panel:', err));

      await interaction.editReply({
        content: i18n.t('autorole.wizard.button_created', guild.id, { channel: `${channel}`, count: String(roleEntries.length) }),
      });
    } catch (error) {
      this.client.logger.error('Error creating button role message:', error);
      await interaction.editReply({
        content: i18n.t('autorole.wizard.button_error', guild.id),
      });
    }
  }
}

// ─── Button Role Assignment Handler ───────────────────────────────────────────

export class AutoRoleButtonHandler extends Component {
  constructor(client: KorexClient) {
    super(client, {
      customId: 'autorole_btn_*',
      type: 'button',
      guildOnly: true,
    });
  }

  async execute(interaction: ComponentInteraction): Promise<void> {
    if (!interaction.isButton()) return;
    await this.handleRoleButton(interaction);
  }

  private async handleRoleButton(interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild!;
    const roleId = interaction.customId.replace('autorole_btn_', '');
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);

    if (!member) {
      await interaction.reply({ content: i18n.t('autorole.button.member_not_found', guild.id), ephemeral: true });
      return;
    }

    const role = guild.roles.cache.get(roleId);
    if (!role) {
      await interaction.reply({ content: i18n.t('autorole.button.role_not_found', guild.id), ephemeral: true });
      return;
    }

    // Re-validate on every click: an old panel (or a role that later had
    // permissions added) must not hand out moderation permissions.
    const safety = checkSelfAssignableRole(guild, role.id);
    if (!safety.ok) {
      await interaction.reply({ content: i18n.t('autorole.button.cannot_assign', guild.id), ephemeral: true });
      return;
    }

    try {
      if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role, 'Button role toggle');
        await interaction.reply({ content: i18n.t('autorole.button.removed', guild.id, { role: role.name }), ephemeral: true });
      } else {
        await member.roles.add(role, 'Button role toggle');
        await interaction.reply({ content: i18n.t('autorole.button.added', guild.id, { role: role.name }), ephemeral: true });
      }
    } catch (error) {
      this.client.logger.error('Error toggling button role:', error);
      await interaction.reply({ content: i18n.t('autorole.button.error', guild.id), ephemeral: true });
    }
  }
}

// ─── Default export ────────────────────────────────────────────────────────────

export default [AutoRolesReactionWizardModal, AutoRolesButtonWizardModal, AutoRoleButtonHandler];
