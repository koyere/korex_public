import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Guild,
  RoleSelectMenuBuilder
} from 'discord.js';
import { i18n } from './i18n';
import { botConfig } from '../config/bot.config';
import type { SuggestionConfig } from '../services/SuggestionService';

/**
 * Paneles de /suggestions config: resumen + botones (activar/desactivar, ajustes, roles).
 * Los botones los atiende src/components/SuggestionConfigComponents.ts.
 */

const yesNo = (value: boolean, guildId: string) =>
  value ? `✅ ${i18n.t('common.yes', guildId)}` : `❌ ${i18n.t('common.no', guildId)}`;

const roleList = (ids: string[], guildId: string) =>
  ids.length > 0 ? ids.map(id => `<@&${id}>`).join(' ').slice(0, 1024) : i18n.t('common.none', guildId);

export function buildSuggestionConfigEmbed(guildId: string, config: SuggestionConfig): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(botConfig.colors.primary)
    .setTitle(i18n.t('suggestions.config.title', guildId))
    .setDescription(i18n.t('suggestions.config.description', guildId))
    .addFields(
      {
        name: i18n.t('suggestions.config.enabled', guildId),
        value: config.enabled ? `✅ ${i18n.t('common.enabled', guildId)}` : `❌ ${i18n.t('common.disabled', guildId)}`,
        inline: true
      },
      {
        name: i18n.t('suggestions.config.channel', guildId),
        value: config.channelId ? `<#${config.channelId}>` : i18n.t('common.none', guildId),
        inline: true
      },
      {
        name: i18n.t('suggestions.config.cooldown', guildId),
        value: i18n.t('suggestions.config.cooldown_value', guildId, { seconds: String(config.cooldown) }),
        inline: true
      },
      {
        name: i18n.t('suggestions.config.auto_threads', guildId),
        value: yesNo(config.autoCreateThreads, guildId),
        inline: true
      },
      {
        name: i18n.t('suggestions.config.vote_threshold', guildId),
        value: config.voteThreshold.toString(),
        inline: true
      },
      {
        name: i18n.t('suggestions.config.notify_author', guildId),
        value: yesNo(config.notifyAuthor, guildId),
        inline: true
      }
    )
    .setTimestamp();
}

export function buildSuggestionConfigButtons(guildId: string, config: SuggestionConfig): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('suggestions_toggle')
        .setLabel(i18n.t(config.enabled ? 'suggestions.config.buttons.disable' : 'suggestions.config.buttons.enable', guildId))
        .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
        .setEmoji(config.enabled ? '❌' : '✅'),
      new ButtonBuilder()
        .setCustomId('suggestions_settings')
        .setLabel(i18n.t('suggestions.config.buttons.settings', guildId))
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⚙️'),
      new ButtonBuilder()
        .setCustomId('suggestions_roles')
        .setLabel(i18n.t('suggestions.config.buttons.roles', guildId))
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('👥')
    );
}

/** Panel de ajustes: hilos automáticos, aviso al autor y cooldown */
export function buildSuggestionSettingsPanel(guildId: string, config: SuggestionConfig) {
  const embed = new EmbedBuilder()
    .setColor(botConfig.colors.primary)
    .setTitle(i18n.t('suggestions.config.settings_title', guildId))
    .setDescription(i18n.t('suggestions.config.settings_description', guildId))
    .addFields(
      {
        name: i18n.t('suggestions.config.cooldown', guildId),
        value: i18n.t('suggestions.config.cooldown_value', guildId, { seconds: String(config.cooldown) }),
        inline: true
      },
      { name: i18n.t('suggestions.config.auto_threads', guildId), value: yesNo(config.autoCreateThreads, guildId), inline: true },
      { name: i18n.t('suggestions.config.notify_author', guildId), value: yesNo(config.notifyAuthor, guildId), inline: true }
    );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('suggestions_cfg_threads')
      .setLabel(i18n.t('suggestions.config.auto_threads', guildId))
      .setStyle(config.autoCreateThreads ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setEmoji('🧵'),
    new ButtonBuilder()
      .setCustomId('suggestions_cfg_notify')
      .setLabel(i18n.t('suggestions.config.notify_author', guildId))
      .setStyle(config.notifyAuthor ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setEmoji('🔔'),
    new ButtonBuilder()
      .setCustomId('suggestions_cfg_cooldown')
      .setLabel(i18n.t('suggestions.config.cooldown', guildId))
      .setStyle(ButtonStyle.Primary)
      .setEmoji('⏱️')
  );

  return { embeds: [embed], components: [row] };
}

/** Panel de roles: staff (gestionan sugerencias) y votantes (vacío = todos) */
export function buildSuggestionRolesPanel(guild: Guild, config: SuggestionConfig) {
  const guildId = guild.id;
  // Preselección solo con roles que siguen existiendo (Discord rechaza IDs inválidos)
  const existing = (ids: string[]) => ids.filter(id => guild.roles.cache.has(id)).slice(0, 25);
  const embed = new EmbedBuilder()
    .setColor(botConfig.colors.primary)
    .setTitle(i18n.t('suggestions.config.roles_title', guildId))
    .setDescription(i18n.t('suggestions.config.roles_description', guildId))
    .addFields(
      { name: i18n.t('suggestions.config.staff_roles', guildId), value: roleList(config.staffRoleIds, guildId), inline: false },
      { name: i18n.t('suggestions.config.voter_roles', guildId), value: roleList(config.voterRoleIds, guildId), inline: false }
    );

  const staff = new RoleSelectMenuBuilder()
    .setCustomId('suggestions_roleselect_staff')
    .setPlaceholder(i18n.t('suggestions.config.staff_placeholder', guildId))
    .setMinValues(0)
    .setMaxValues(25);
  if (existing(config.staffRoleIds).length > 0) staff.setDefaultRoles(existing(config.staffRoleIds));

  const voter = new RoleSelectMenuBuilder()
    .setCustomId('suggestions_roleselect_voter')
    .setPlaceholder(i18n.t('suggestions.config.voter_placeholder', guildId))
    .setMinValues(0)
    .setMaxValues(25);
  if (existing(config.voterRoleIds).length > 0) voter.setDefaultRoles(existing(config.voterRoleIds));

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(staff),
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(voter)
    ]
  };
}
