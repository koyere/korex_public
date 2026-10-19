import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { botConfig } from '../../config/bot.config';

/** /antiraid status | end — estado y fin manual del modo raid de Moderación. */
export default class AntiRaidCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'antiraid',
      description: 'Manage the moderation anti-raid mode',
      category: 'moderation',
      cooldown: 5,
      permissions: {
        user: [PermissionFlagsBits.ManageGuild],
        bot: [],
      },
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription('Manage the moderation anti-raid mode')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((sub) => sub.setName('status').setDescription('Show the raid mode status'))
      .addSubcommand((sub) => sub.setName('end').setDescription('End raid mode now and restore the previous state')) as SlashCommandBuilder;
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const t = (key: string, vars?: Record<string, string>) => i18n.t(`commands.antiraid.${key}`, guildId, vars);
    await interaction.deferReply({ ephemeral: true });

    try {
      if (interaction.options.getSubcommand() === 'end') {
        const result = await this.client.antiRaid.endRaid(guildId, interaction.user.id);
        const key = result === 'ended' ? 'end_done' : result === 'scheduled' ? 'end_scheduled' : result === 'busy' ? 'end_busy' : 'end_not_active';
        await interaction.editReply({ content: t(key), allowedMentions: { parse: [] } });
        return;
      }

      const state = await this.client.antiRaid.getStatus(guildId);
      if (!state) {
        await interaction.editReply({ content: t('status_inactive') });
        return;
      }
      const ts = (d: Date) => `<t:${Math.floor(d.getTime() / 1000)}:R>`;
      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.error)
        .setTitle(t('status_active_title'))
        .setDescription(t('status_active_desc', {
          started: ts(state.startedAt),
          ends: ts(state.endsAt),
          joins: String(state.joinCount),
          actions: String(state.actionCount),
          action: i18n.t(`moderation.antiraid.actions.${state.action}`, guildId),
        }))
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      this.client.logger.error('Error in /antiraid:', error);
      await interaction.editReply({ content: t('error') }).catch(() => null);
    }
  }
}
