import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} from 'discord.js';
import { i18n } from './i18n';
import { botConfig } from '../config/bot.config';

export interface PollSetupData {
  channelId: string;
  title: string;
  description?: string;
  options: Array<{ id: string; text: string; emoji?: string }>;
  type?: string;
  durationHours?: number;
  anonymous: boolean;
  allowChange: boolean;
  hostId: string;
}

export function buildTypeSelectRow(guildId: string, userId: string): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`poll_type_select_${userId}`)
      .setPlaceholder(i18n.t('polls.wizard.type_placeholder', guildId))
      .addOptions([
        { label: i18n.t('polls.types.simple', guildId), value: 'simple', emoji: '✅', description: 'Yes/No or two options' },
        { label: i18n.t('polls.types.multiple', guildId), value: 'multiple', emoji: '☑️', description: 'Pick one or more options' },
        { label: i18n.t('polls.types.dropdown', guildId), value: 'dropdown', emoji: '📋', description: 'Select from a dropdown menu' },
        { label: i18n.t('polls.types.ranking', guildId), value: 'ranking', emoji: '🏆', description: 'Rank options by preference' },
      ])
  );
}

export function buildDurationSelectRow(guildId: string, userId: string): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`poll_duration_select_${userId}`)
      .setPlaceholder(i18n.t('polls.wizard.duration_placeholder', guildId))
      .addOptions([
        { label: i18n.t('polls.durations.1', guildId), value: '1', emoji: '⚡' },
        { label: i18n.t('polls.durations.6', guildId), value: '6', emoji: '🕕' },
        { label: i18n.t('polls.durations.12', guildId), value: '12', emoji: '🕛' },
        { label: i18n.t('polls.durations.24', guildId), value: '24', emoji: '📅' },
        { label: i18n.t('polls.durations.48', guildId), value: '48', emoji: '🗓️' },
        { label: i18n.t('polls.durations.168', guildId), value: '168', emoji: '📆' },
        { label: i18n.t('polls.durations.0', guildId), value: '0', emoji: '♾️' },
      ])
  );
}

export function buildConfirmPanel(data: PollSetupData, guildId: string): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const durationLabel = data.durationHours === 0
    ? i18n.t('polls.wizard.no_expiry', guildId)
    : data.durationHours
      ? i18n.t(`polls.durations.${data.durationHours}`, guildId)
      : '—';

  const embed = new EmbedBuilder()
    .setColor(botConfig.colors.primary)
    .setTitle(i18n.t('polls.wizard.step4_title', guildId))
    .setDescription(`> **${data.title}**${data.description ? `\n> ${data.description}` : ''}`)
    .addFields(
      {
        name: i18n.t('polls.wizard.field_options', guildId),
        value: data.options.map((o, i) => `${i + 1}. ${o.emoji ? `${o.emoji} ` : ''}${o.text}`).join('\n'),
        inline: false
      },
      {
        name: i18n.t('polls.wizard.field_type', guildId),
        value: i18n.t(`polls.types.${data.type ?? 'simple'}`, guildId),
        inline: true
      },
      {
        name: i18n.t('polls.wizard.field_duration', guildId),
        value: durationLabel,
        inline: true
      },
      {
        name: i18n.t('polls.wizard.field_channel', guildId),
        value: `<#${data.channelId}>`,
        inline: true
      },
      {
        name: i18n.t('polls.wizard.field_settings', guildId),
        value: [
          data.anonymous
            ? i18n.t('polls.wizard.anonymous_on', guildId)
            : i18n.t('polls.wizard.anonymous_off', guildId),
          data.allowChange
            ? i18n.t('polls.wizard.allow_change_on', guildId)
            : i18n.t('polls.wizard.allow_change_off', guildId),
        ].join('\n'),
        inline: false
      }
    );

  const toggleRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`poll_toggle_anon_${data.hostId}`)
      .setLabel(data.anonymous
        ? i18n.t('polls.wizard.anonymous_on', guildId)
        : i18n.t('polls.wizard.anonymous_off', guildId))
      .setStyle(data.anonymous ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`poll_toggle_change_${data.hostId}`)
      .setLabel(data.allowChange
        ? i18n.t('polls.wizard.allow_change_on', guildId)
        : i18n.t('polls.wizard.allow_change_off', guildId))
      .setStyle(data.allowChange ? ButtonStyle.Success : ButtonStyle.Secondary)
  );

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`poll_create_confirm_${data.hostId}`)
      .setLabel(i18n.t('polls.wizard.create', guildId))
      .setStyle(ButtonStyle.Success)
      .setEmoji('📊'),
    new ButtonBuilder()
      .setCustomId(`poll_create_cancel_${data.hostId}`)
      .setLabel(i18n.t('buttons.cancel', guildId))
      .setStyle(ButtonStyle.Danger)
      .setEmoji('❌')
  );

  return { embeds: [embed], components: [toggleRow, actionRow] };
}

export function parseOptions(optionsText: string): Array<{ id: string; text: string; emoji?: string }> {
  const lines = optionsText.split('\n').filter(line => line.trim());
  const options: Array<{ id: string; text: string; emoji?: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const emojiMatch = line.match(/^(\p{Emoji})\s*(.+)$/u);
    if (emojiMatch) {
      options.push({ id: `option_${i}`, text: emojiMatch[2].trim(), emoji: emojiMatch[1] });
    } else {
      options.push({ id: `option_${i}`, text: line });
    }
  }
  return options;
}
