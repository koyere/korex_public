import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType,
  AutocompleteInteraction
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class InventoryCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'inventory',
      description: 'View and manage your inventory',
      category: 'economy',
      cooldown: 3,
      guildOnly: true,
      addon: 'economy',
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('inventory')
      .setDescription('View and manage your inventory')
      .addSubcommand(sub => sub.setName('view').setDescription('View your inventory'))
      .addSubcommand(sub => sub
        .setName('equip')
        .setDescription('Equip a cosmetic item')
        .addStringOption(opt => opt.setName('item').setDescription('Item to equip').setRequired(true).setAutocomplete(true))
      )
      .addSubcommand(sub => sub
        .setName('use')
        .setDescription('Use a consumable item')
        .addStringOption(opt => opt.setName('item').setDescription('Item to use').setRequired(true).setAutocomplete(true))
      );
  }

  async executeAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const guildId = interaction.guild?.id;
    const userId = interaction.user.id;

    if (!guildId) return;

    const subcommand = interaction.options.getSubcommand();
    const focused = interaction.options.getFocused().toLowerCase();
    const inventory = await this.client.shop.getUserInventory(guildId, userId);

    let filtered = inventory;

    if (subcommand === 'equip') {
      filtered = inventory.filter(i => i.type === 'cosmetic');
    } else if (subcommand === 'use') {
      filtered = inventory.filter(i => i.type === 'consumable');
    }

    const choices = filtered
      .filter(item => item.itemName.toLowerCase().includes(focused))
      .slice(0, 25)
      .map(item => ({
        name: `${item.emoji || '📦'} ${item.itemName} (x${item.quantity})`,
        value: item.id
      }));

    await interaction.respond(choices);
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild!.id;
    const userId = interaction.user.id;
    const lang = i18n.getGuildLanguage(guildId);

    if (sub === 'view') {
      await this.viewInventory(interaction, guildId, userId, lang);
    } else if (sub === 'equip') {
      await this.equipItem(interaction, guildId, userId, lang);
    } else if (sub === 'use') {
      await this.useItem(interaction, guildId, userId, lang);
    }
  }

  private async viewInventory(interaction: ChatInputCommandInteraction, guildId: string, userId: string, lang: string): Promise<void> {
    await interaction.deferReply();

    const inventory = await this.client.shop.getUserInventory(guildId, userId);

    if (inventory.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(Colors.Grey)
        .setTitle(i18n.t('inventory.view.title', lang, { user: interaction.user.username }))
        .setDescription(i18n.t('inventory.view.empty_own', lang))
        .setFooter({ text: i18n.t('shop.browse.footer', lang) });

      await interaction.editReply({ embeds: [embed] });

      return;
    }

    const cosmetics = inventory.filter(i => i.type === 'cosmetic');
    const consumables = inventory.filter(i => i.type === 'consumable');
    const roles = inventory.filter(i => i.type === 'role');

    const embed = new EmbedBuilder()
      .setColor(Colors.Purple)
      .setTitle(i18n.t('inventory.view.title', lang, { user: interaction.user.username }))
      .setDescription(i18n.t('inventory.view.description', lang, { count: inventory.length.toString() }))
      .setThumbnail(interaction.user.displayAvatarURL());

    if (cosmetics.length > 0) {
      const list = cosmetics.map(i => {
        const equipped = i.equipped ? ' ✅' : '';

        return `${i.emoji || '📦'} **${i.itemName}**${equipped} (x${i.quantity})`;
      }).join('\n');

      embed.addFields({ name: `✨ ${i18n.t('common.cosmetics', lang)}`, value: list, inline: false });
    }

    if (consumables.length > 0) {
      const list = consumables.map(i => `${i.emoji || '📦'} **${i.itemName}** (x${i.quantity})`).join('\n');

      embed.addFields({ name: `⚡ ${i18n.t('common.consumables', lang)}`, value: list, inline: false });
    }

    if (roles.length > 0) {
      const list = roles.map(i => `${i.emoji || '📦'} **${i.itemName}** (x${i.quantity})`).join('\n');

      embed.addFields({ name: `🎭 ${i18n.t('common.roles', lang)}`, value: list, inline: false });
    }

    // Menú para acciones rápidas
    if (cosmetics.length > 0 || consumables.length > 0) {
      const options: { label: string; value: string; emoji: string }[] = [];
      
      for (const item of cosmetics.slice(0, 12)) {
        options.push({
          label: `${item.equipped ? '❌ Desequipar' : '✅ Equipar'} ${item.itemName}`,
          value: `equip_${item.id}`,
          emoji: item.emoji || '📦'
        });
      }
      
      for (const item of consumables.slice(0, 12)) {
        options.push({
          label: `Usar ${item.itemName}`,
          value: `use_${item.id}`,
          emoji: item.emoji || '📦'
        });
      }

      if (options.length > 0) {
        const select = new StringSelectMenuBuilder()
          .setCustomId('inventory_action')
          .setPlaceholder(i18n.t('inventory.view.use_button', lang))
          .addOptions(options.slice(0, 25));

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
        const msg = await interaction.editReply({ embeds: [embed], components: [row] });

        const collector = msg.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 60000 });

        collector.on('collect', async i => {
          if (i.user.id !== userId) {
            await i.reply({ content: i18n.t('common.errors.not_your_interaction', lang), ephemeral: true });

            return;
          }

          const [action, itemId] = i.values[0].split('_');

          await i.deferUpdate();

          if (action === 'equip') {
            const result = await this.client.shop.toggleEquip(guildId, userId, itemId);

            await interaction.followUp({ content: result.message, ephemeral: true });
          } else if (action === 'use') {
            const result = await this.client.shop.useItem(guildId, userId, itemId);

            await interaction.followUp({ content: result.message, ephemeral: true });
          }

          // Refrescar inventario
          await this.viewInventory(interaction, guildId, userId, lang);
        });
      } else {
        await interaction.editReply({ embeds: [embed] });
      }
    } else {
      await interaction.editReply({ embeds: [embed] });
    }
  }

  private async equipItem(interaction: ChatInputCommandInteraction, guildId: string, userId: string, lang: string): Promise<void> {
    const itemId = interaction.options.getString('item', true);

    await interaction.deferReply({ ephemeral: true });

    const result = await this.client.shop.toggleEquip(guildId, userId, itemId);

    const embed = new EmbedBuilder()
      .setColor(result.success ? Colors.Green : Colors.Red)
      .setDescription(result.message);

    await interaction.editReply({ embeds: [embed] });
  }

  private async useItem(interaction: ChatInputCommandInteraction, guildId: string, userId: string, lang: string): Promise<void> {
    const itemId = interaction.options.getString('item', true);

    await interaction.deferReply();

    const result = await this.client.shop.useItem(guildId, userId, itemId);

    const embed = new EmbedBuilder()
      .setColor(result.success ? Colors.Green : Colors.Red)
      .setTitle(result.success ? i18n.t('inventory.use.success_title', lang) : i18n.t('inventory.use.error_title', lang))
      .setDescription(result.message);

    await interaction.editReply({ embeds: [embed] });
  }
}
