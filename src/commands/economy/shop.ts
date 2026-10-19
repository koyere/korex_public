import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType,
  AutocompleteInteraction,
  Role
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { ShopItem } from '../../services/ShopService';
import { checkSelfAssignableRole } from '../../utils/roleSafety';

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

  private resolveItem(item: ShopItem, lang: string): { name: string; description: string } {
    if (item.translationKey) {
      const name = this.client.i18n.t(`shop.catalog.${item.translationKey}.name`, lang) || item.name;
      const description = this.client.i18n.t(`shop.catalog.${item.translationKey}.desc`, lang) || item.description;
      return { name, description };
    }
    return { name: item.name, description: item.description };
  }

  async executeAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const guildId = interaction.guild?.id;

    if (!guildId) return;

    const focused = interaction.options.getFocused().toLowerCase();
    const items = await this.client.shop.getShopItems(guildId);
    const lang = await this.client.i18n.getGuildLanguage(guildId);

    const { currencySymbol } = await this.client.economy.getConfig(guildId);
    const choices = items
      .filter(item => {
        const { name } = this.resolveItem(item, lang);
        return name.toLowerCase().includes(focused);
      })
      .slice(0, 25)
      .map(item => {
        const { name } = this.resolveItem(item, lang);
        return { name: `${item.emoji || '📦'} ${name} - ${item.price} ${currencySymbol}`.slice(0, 100), value: item.id };
      });

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
    const lang = await this.client.i18n.getGuildLanguage(guildId);

    if (items.length === 0) {
      await interaction.editReply(this.client.i18n.t('shop.browse.empty', lang));

      return;
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.Blue)
      .setTitle(this.client.i18n.t('shop.browse.title', lang))
      .setDescription(this.client.i18n.t('shop.browse.description', lang, { currency: config.currencySymbol, count: String(items.length) }))
      .setFooter({ text: this.client.i18n.t('shop.browse.footer', lang) });

    const itemList = items.map(item => {
      const { name, description } = this.resolveItem(item, lang);
      const stock = item.stock === -1 ? '∞' : item.stock;

      return `${item.emoji || '📦'} **${name}** - ${item.price} ${config.currencySymbol}\n└ ${description} (${this.client.i18n.t('shop.browse.stock', lang)}: ${stock})`;
    }).join('\n\n');

    embed.addFields({ name: this.client.i18n.t('shop.browse.items', lang), value: itemList.substring(0, 1024) || this.client.i18n.t('shop.browse.empty', lang) });

    const select = new StringSelectMenuBuilder()
      .setCustomId('shop_buy')
      .setPlaceholder(this.client.i18n.t('shop.browse.select_placeholder', lang))
      .addOptions(items.slice(0, 25).map(item => {
        const { name } = this.resolveItem(item, lang);
        return {
          label: name,
          description: `${item.price} ${config.currencySymbol}`,
          value: item.id,
          emoji: item.emoji || '📦'
        };
      }));

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    const msg = await interaction.editReply({ embeds: [embed], components: [row] });

    const collector = msg.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 60000 });

    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) {
        await i.reply({ content: this.client.i18n.t('common.errors.not_your_interaction', lang), ephemeral: true });

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
    const lang = await this.client.i18n.getGuildLanguage(guildId);
    const t = (key: string, vars?: Record<string, string>) => this.client.i18n.t(key, lang, vars);

    const item = await this.client.shop.getItem(itemId, guildId);

    if (!item) {
      await interaction.editReply(t('shop.buy.not_found'));

      return;
    }

    const economyConfig = await this.client.economy.getConfig(guildId);
    const symbol = economyConfig.currencySymbol;

    // Un rol de la tienda lo puede comprar cualquiera: debe ser seguro
    let role: Role | undefined;
    if (item.type === 'role' && item.data?.roleId) {
      const check = checkSelfAssignableRole(interaction.guild!, item.data.roleId);
      if (!check.ok) {
        await interaction.editReply(t('shop.buy.role_unavailable'));

        return;
      }
      role = check.role;
      const member = await interaction.guild!.members.fetch(userId).catch(() => null);
      if (member?.roles.cache.has(role.id)) {
        await interaction.editReply(t('shop.buy.already_has_role', { role: role.name }));

        return;
      }
    }

    const user = await this.client.economy.getUser(guildId, userId);

    if (user.balance < item.price) {
      await interaction.editReply(t('shop.buy.insufficient', {
        price: `${item.price} ${symbol}`,
        balance: `${user.balance} ${symbol}`,
      }));

      return;
    }

    if (!(await this.client.shop.reserveStock(item.id, guildId))) {
      await interaction.editReply(t('shop.buy.out_of_stock'));

      return;
    }

    // Descontar monedas
    const result = await this.client.economy.removeMoney(guildId, userId, item.price, 'Shop purchase');

    if (!result.success) {
      await this.client.shop.releaseStock(item.id, guildId);
      await interaction.editReply(`❌ ${result.message}`);

      return;
    }

    // Si es un rol, asignarlo; si falla, se devuelve el dinero y el stock
    if (role) {
      try {
        const member = await interaction.guild!.members.fetch(userId);

        await member.roles.add(role, 'Shop purchase');
      } catch (e) {
        this.client.logger.error('Error adding role:', e);
        await this.client.economy.addMoney(guildId, userId, item.price, 'Shop refund');
        await this.client.shop.releaseStock(item.id, guildId);
        await interaction.editReply(t('shop.buy.role_failed'));

        return;
      }
    }

    // Agregar al inventario
    await this.client.shop.addToInventory(guildId, userId, item.id);

    const { name: itemName } = this.resolveItem(item, lang);

    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle(t('shop.buy.success_title'))
      .setDescription(t('shop.buy.success_desc', { item: `${item.emoji || '📦'} ${itemName}`, price: String(item.price), symbol }))
      .addFields(
        { name: t('shop.buy.new_balance'), value: `${result.newBalance} ${symbol}`, inline: true },
        { name: t('shop.buy.inventory_hint_label'), value: t('shop.buy.inventory_hint'), inline: true }
      );

    await interaction.editReply({ embeds: [embed], components: [] });
  }

}
