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
      await interaction.reply({ content: '❌ Canal no encontrado o inválido.', ephemeral: true });
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
        await interaction.reply({ content: '❌ Debes escribir al menos un emoji (uno por línea, uno por rol).', ephemeral: true });
        return;
      }

      const type = (wizardData.type || 'MULTIPLE') as 'MULTIPLE' | 'SINGLE' | 'UNIQUE';

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
          content: `✅ Mensaje de roles de reacción creado en ${channel} con **${roles.length}** rol(es).`,
        });
      } catch (error) {
        this.client.logger.error('Error creating reaction role message:', error);
        await interaction.editReply({
          content: '❌ Error al crear el mensaje. Verifica que el bot tenga permisos para enviar mensajes y agregar reacciones en ese canal.',
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
        await interaction.reply({ content: '❌ No se encontraron roles válidos.', ephemeral: true });
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
          content: `✅ Mensaje de roles de reacción creado en ${channel} con **${roles.length}** rol(es).`,
        });
      } catch (error) {
        this.client.logger.error('Error creating reaction role message:', error);
        await interaction.editReply({
          content: '❌ Error al crear el mensaje. Verifica que el bot tenga permisos para enviar mensajes y agregar reacciones en ese canal.',
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
      await interaction.reply({ content: '❌ Canal no encontrado o inválido.', ephemeral: true });
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
        content: '❌ No se encontraron roles válidos. Formato: `emoji etiqueta roleId` (uno por línea).',
        ephemeral: true,
      });
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

      await (channel as TextChannel).send({ embeds: [embed], components: rows });

      await interaction.editReply({
        content: `✅ Mensaje de roles con botones creado en ${channel} con **${roleEntries.length}** rol(es).`,
      });
    } catch (error) {
      this.client.logger.error('Error creating button role message:', error);
      await interaction.editReply({
        content: '❌ Error al crear el mensaje. Verifica que el bot tenga permisos para enviar mensajes en ese canal.',
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
      await interaction.reply({ content: '❌ No se pudo encontrar tu perfil en el servidor.', ephemeral: true });
      return;
    }

    const role = guild.roles.cache.get(roleId);
    if (!role) {
      await interaction.reply({ content: '❌ Rol no encontrado. Es posible que haya sido eliminado.', ephemeral: true });
      return;
    }

    const botMember = guild.members.me;
    if (!botMember || role.position >= botMember.roles.highest.position || role.managed) {
      await interaction.reply({ content: '❌ No tengo permisos suficientes para asignar ese rol.', ephemeral: true });
      return;
    }

    try {
      if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role, 'Button role toggle');
        await interaction.reply({ content: `✅ Se te quitó el rol **${role.name}**.`, ephemeral: true });
      } else {
        await member.roles.add(role, 'Button role toggle');
        await interaction.reply({ content: `✅ Se te asignó el rol **${role.name}**.`, ephemeral: true });
      }
    } catch (error) {
      this.client.logger.error('Error toggling button role:', error);
      await interaction.reply({ content: '❌ Error al asignar/quitar el rol.', ephemeral: true });
    }
  }
}

// ─── Default export ────────────────────────────────────────────────────────────

export default [AutoRolesReactionWizardModal, AutoRolesButtonWizardModal, AutoRoleButtonHandler];
