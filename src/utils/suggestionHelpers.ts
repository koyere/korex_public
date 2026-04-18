import { ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import { i18n } from './i18n';

export function buildCategorySelectRow(guildId: string): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('suggestion_category_select')
      .setPlaceholder(i18n.t('suggestions.select.category_placeholder', guildId))
      .addOptions([
        { label: i18n.t('suggestions.categories.feature', guildId), value: 'feature', emoji: '🚀' },
        { label: i18n.t('suggestions.categories.improvement', guildId), value: 'improvement', emoji: '✨' },
        { label: i18n.t('suggestions.categories.bug', guildId), value: 'bug', emoji: '🐛' },
        { label: i18n.t('suggestions.categories.other', guildId), value: 'other', emoji: '💬' },
      ])
  );
}

export function buildPrioritySelectRow(guildId: string, category: string): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`suggestion_priority_select_${category}`)
      .setPlaceholder(i18n.t('suggestions.select.priority_placeholder', guildId))
      .addOptions([
        { label: i18n.t('suggestions.priorities.low', guildId), value: 'low', emoji: '🟢' },
        { label: i18n.t('suggestions.priorities.medium', guildId), value: 'medium', emoji: '🟡' },
        { label: i18n.t('suggestions.priorities.high', guildId), value: 'high', emoji: '🔴' },
      ])
  );
}
