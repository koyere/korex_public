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

export default class ShopCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'shop',
      description: 'Browse and buy items from the server shop',
      category: 'economy',
      cooldown: 3,
      guildOnly: true,
      addon: 'economy',
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('shop')
      .setDescription('Browse and buy items from the server shop')
      .addSubcommand(sub => sub.setName('browse').setDescription('Browse all shop items'))
      .addSubcommand(sub => sub
        .setName('buy')
        .setDescription('Buy an item')
        .addStringOption(opt => opt.setName('item').setDescription('Item to buy').setRequired(true).setAutocomplete(true))
      );
  }

  async executeAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const guildId = interaction.guild?.id;

    if (!guildId) return;

    const focused = interaction.options.getFocused().toLowerCase();
    const items = await this.client.shop.getShopItems(guildId);

    const choices = items
      .filter(item => item.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map(item => ({ name: `${item.emoji || '📦'} ${item.name} - ${item.price} 🪙`, value: item.id }));

    await interaction.respond(choices);
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();

    if (sub === 'browse') await this.browse(interaction);
    else if (sub === 'buy') await this.buy(interaction);
  }

  private async browse(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guild!.id;

    await interaction.deferReply();

    const items = await this.client.shop.getShopItems(guildId);
    const config = await this.client.economy.getConfig(guildId);

    if (items.length === 0) {
      await interaction.editReply('❌ No hay items en la tienda. El admin debe agregarlos desde el panel web.');

      return;
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.Blue)
      .setTitle('🛒 Tienda del Servidor')
      .setDescription('Selecciona un item del menú o usa `/shop buy`')
      .setFooter({ text: `${items.length} items disponibles` });

    const itemList = items.map(item => {
      const stock = item.stock === -1 ? '∞' : item.stock;

      return `${item.emoji || '📦'} **${item.name}** - ${item.price} ${config.currencySymbol}\n└ ${item.description || 'Sin descripción'} (Stock: ${stock})`;
    }).join('\n\n');

    embed.addFields({ name: 'Items', value: itemList.substring(0, 1024) || 'Vacío' });

    const select = new StringSelectMenuBuilder()
      .setCustomId('shop_buy')
      .setPlaceholder('Selecciona un item para comprar...')
      .addOptions(items.slice(0, 25).map(item => ({
        label: item.name,
        description: `${item.price} ${config.currencySymbol}`,
        value: item.id,
        emoji: item.emoji || '📦'
      })));

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    const msg = await interaction.editReply({ embeds: [embed], components: [row] });

    const collector = msg.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 60000 });

    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) {
        await i.reply({ content: '❌ Este menú no es para ti', ephemeral: true });

        return;
      }
      await i.deferUpdate();
      await this.processBuy(interaction, i.values[0]);
    });
  }

  private async buy(interaction: ChatInputCommandInteraction): Promise<void> {
    const itemId = interaction.options.getString('item', true);

    await interaction.deferReply();
    await this.processBuy(interaction, itemId);
  }

  private async processBuy(interaction: ChatInputCommandInteraction, itemId: string): Promise<void> {
    const guildId = interaction.guild!.id;
    const userId = interaction.user.id;

    const item = await this.client.shop.getItem(itemId);

    if (!item) {
      await interaction.editReply('❌ Item no encontrado');

      return;
    }

    if (item.stock === 0) {
      await interaction.editReply('❌ Este item está agotado');

      return;
    }

    const user = await this.client.economy.getUser(guildId, userId);

    if (user.balance < item.price) {
      await interaction.editReply(`❌ No tienes suficientes monedas. Necesitas ${item.price} 🪙 y tienes ${user.balance} 🪙`);

      return;
    }

    // Descontar monedas
    const result = await this.client.economy.removeMoney(guildId, userId, item.price, 'Shop purchase');

    if (!result.success) {
      await interaction.editReply(`❌ ${result.message}`);

      return;
    }

    // Si es un rol, asignarlo directamente
    if (item.type === 'role' && item.data?.roleId) {
      try {
        const member = await interaction.guild!.members.fetch(userId);

        await member.roles.add(item.data.roleId);
      } catch (e) {
        this.client.logger.error('Error adding role:', e);
      }
    }

    // Agregar al inventario
    await this.client.shop.addToInventory(guildId, userId, itemId);

    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle('✅ Compra Exitosa')
      .setDescription(`Has comprado **${item.emoji || '📦'} ${item.name}** por ${item.price} 🪙`)
      .addFields(
        { name: '💰 Nuevo Balance', value: `${result.newBalance} 🪙`, inline: true },
        { name: '🎒 Inventario', value: 'Usa `/inventory view` para ver tus items', inline: true }
      );

    await interaction.editReply({ embeds: [embed], components: [] });
  }
}
