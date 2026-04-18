import { ModalSubmitInteraction, EmbedBuilder, Colors } from 'discord.js';
import { Component } from '../client/structures/Component';
import { KorexClient } from '../client/KorexClient';
import { i18n } from '../utils/i18n';

const VALID_TRIGGER_TYPES = new Set(['exact', 'contains', 'starts', 'ends', 'regex']);

export default class AutoResponseModalComponent extends Component {
  constructor(client: KorexClient) {
    super(client, {
      customId: 'autoresponse_*',
      type: 'modal',
      guildOnly: true,
    });
  }

  async execute(interaction: ModalSubmitInteraction): Promise<void> {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: i18n.t('common.guild_only', interaction.guildId || undefined),
        ephemeral: true,
      });

      return;
    }

    const guildId = interaction.guildId;
    const customId = interaction.customId;

    if (customId === 'autoresponse_create') {
      await this.handleCreate(interaction, guildId);

      return;
    }

    if (customId.startsWith('autoresponse_edit_')) {
      const id = customId.replace('autoresponse_edit_', '');

      await this.handleEdit(interaction, guildId, id);

      return;
    }

    await interaction.reply({
      content: i18n.t('common.errors.form_expired', guildId),
      ephemeral: true,
    });
  }

  private async handleCreate(interaction: ModalSubmitInteraction, guildId: string): Promise<void> {
    const name = interaction.fields.getTextInputValue('name').trim();
    const triggersRaw = interaction.fields.getTextInputValue('triggers');
    const responseContent = interaction.fields.getTextInputValue('response').trim();
    const typeRaw = interaction.fields.getTextInputValue('type').trim().toLowerCase();
    const cooldownRaw = interaction.fields.getTextInputValue('cooldown').trim();

    const triggers = this.parseTriggers(triggersRaw);

    if (!name || !responseContent || triggers.length === 0) {
      await interaction.reply({
        content: i18n.t('common.errors.generic', guildId),
        ephemeral: true,
      });

      return;
    }

    const triggerType = VALID_TRIGGER_TYPES.has(typeRaw) ? typeRaw : 'contains';
    const cooldown = this.parseCooldown(cooldownRaw);

    const created = await this.client.autoResponseService.createAutoResponse(guildId, {
      name,
      triggers,
      triggerType: triggerType as any,
      caseSensitive: false,
      cooldown,
      enabled: true,
      createdBy: interaction.user.id,
      responses: [
        {
          type: 'text',
          content: responseContent,
        },
      ],
    });

    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle(i18n.t('commands.autoresponse.create.success_title', guildId))
      .setDescription(
        i18n.t('commands.autoresponse.create.success_desc', guildId, {
          name: created.name,
          id: created.id,
        })
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  private async handleEdit(
    interaction: ModalSubmitInteraction,
    guildId: string,
    id: string
  ): Promise<void> {
    const existing = (await this.client.autoResponseService.getGuildAutoResponses(guildId)).find(
      response => response.id === id
    );

    if (!existing) {
      await interaction.reply({
        content: i18n.t('commands.autoresponse.edit.id_not_found', guildId, { id }),
        ephemeral: true,
      });

      return;
    }

    const name = interaction.fields.getTextInputValue('name').trim();
    const triggersRaw = interaction.fields.getTextInputValue('triggers');
    const responseContent = interaction.fields.getTextInputValue('response').trim();
    const typeRaw = interaction.fields.getTextInputValue('type').trim().toLowerCase();
    const cooldownRaw = interaction.fields.getTextInputValue('cooldown').trim();

    const triggers = this.parseTriggers(triggersRaw);
    const triggerType = VALID_TRIGGER_TYPES.has(typeRaw) ? typeRaw : 'contains';
    const cooldown = this.parseCooldown(cooldownRaw);

    const updated = await this.client.autoResponseService.updateAutoResponse(id, {
      name: name || existing.name,
      triggers: triggers.length ? triggers : existing.triggers,
      triggerType: triggerType as any,
      cooldown,
      responses: [
        {
          type: 'text',
          content: responseContent,
        },
      ],
    });

    if (!updated) {
      await interaction.reply({
        content: i18n.t('common.errors.generic', guildId),
        ephemeral: true,
      });

      return;
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle(i18n.t('commands.autoresponse.edit.success_title', guildId))
      .setDescription(
        i18n.t('commands.autoresponse.edit.success_desc', guildId, {
          name: name || existing.name,
          id,
        })
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  private parseTriggers(raw: string): string[] {
    return raw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .slice(0, 25);
  }

  private parseCooldown(raw: string): number {
    const parsed = Number.parseInt(raw, 10);

    if (Number.isNaN(parsed) || parsed < 0) {
      return 5;
    }

    return Math.min(parsed, 300);
  }
}
