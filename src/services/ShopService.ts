import { logger } from '../utils/Logger';
import { DatabaseManager } from '../client/managers/DatabaseManager';
import { EconomyService } from './EconomyService';
import { GuildMember } from 'discord.js';
import { i18n } from '../utils/i18n';

export interface ShopItem {
  id: string;
  guildId: string;
  name: string;
  description: string;
  translationKey?: string | null;
  price: number;
  type: string;
  data: any;
  stock: number;
  enabled: boolean;
  category: string;
  emoji?: string;
}

export interface InventoryItem {
  id: string;
  itemId: string;
  itemName: string;
  type: string;
  emoji?: string;
  quantity: number;
  equipped: boolean;
  data?: any;
}

export class ShopService {
  private static instance: ShopService;
  private logger = logger;
  private db: DatabaseManager | null = null;
  private economy: EconomyService;

  private constructor() {
    this.economy = EconomyService.getInstance();
  }

  public static getInstance(): ShopService {
    if (!ShopService.instance) {
      ShopService.instance = new ShopService();
    }

    return ShopService.instance;
  }

  public setDatabase(db: DatabaseManager): void {
    this.db = db;
  }

  private static readonly DEFAULT_CATALOG = [
    { translationKey: 'pizza',        name: 'Porción de Pizza',               emoji: '🍕', price: 50,    type: 'cosmetic',   description: 'Un trozo de pizza virtual. Nadie sabe cómo llegó aquí, pero se ve deliciosa.', stock: -1 },
    { translationKey: 'dice',         name: 'Dado de la Suerte',              emoji: '🎲', price: 75,    type: 'cosmetic',   description: 'Lánzalo. No pasará nada, pero la sensación es increíble.', stock: -1 },
    { translationKey: 'mystery_card', name: 'Carta Misteriosa',               emoji: '🃏', price: 100,   type: 'consumable', description: '¿Qué hay dentro? Nadie lo sabe. Ni tú después de abrirla.', stock: -1 },
    { translationKey: 'gamer_cap',    name: 'Gorra Gamer',                    emoji: '🧢', price: 150,   type: 'cosmetic',   description: 'Equiparla te hace un 12% más gamer. Estadísticamente hablando.', stock: -1 },
    { translationKey: 'crystal_ball', name: 'Bola de Cristal (Defectuosa)',   emoji: '🔮', price: 200,   type: 'consumable', description: 'Predice el futuro con un 0.3% de precisión. La garantía expiró.', stock: -1 },
    { translationKey: 'certificate',  name: 'Certificado de Buena Persona',   emoji: '📜', price: 250,   type: 'cosmetic',   description: 'Firmado por nadie importante, pero queda bonito en el perfil.', stock: -1 },
    { translationKey: 'magic_wand',   name: 'Varita de Hogwarts (Imitación)', emoji: '🪄', price: 350,   type: 'cosmetic',   description: 'No lanza hechizos, pero la onda es absolutamente increíble.', stock: -1 },
    { translationKey: 'robot',        name: 'Asistente Robot (Versión Gratis)',emoji: '🤖',price: 450,   type: 'consumable', description: 'Hace exactamente lo que tú harías. Ni más ni menos.', stock: -1 },
    { translationKey: 'wizard_hat',   name: 'Sombrero de Mago VIP',           emoji: '🎩', price: 600,   type: 'cosmetic',   description: 'Úsalo para parecer más inteligente en las reuniones de Discord.', stock: -1 },
    { translationKey: 'power_taco',   name: 'Taco del Poder',                 emoji: '🌮', price: 750,   type: 'consumable', description: 'Se dice que quien lo come obtiene sabiduría infinita. Se dice.', stock: 50 },
    { translationKey: 'unicorn',      name: 'Montura de Unicornio',           emoji: '🦄', price: 900,   type: 'cosmetic',   description: 'Solo válida en territorios imaginarios. Velocidad: absolutamente ridícula.', stock: -1 },
    { translationKey: 'briefcase',    name: 'Maletín Ejecutivo Vacío',        emoji: '💼', price: 1200,  type: 'cosmetic',   description: 'Parece que sabes lo que haces. El secreto está en la pose.', stock: -1 },
    { translationKey: 'rocket',       name: 'Cohete Personal (Sin Combustible)',emoji: '🚀',price: 1800, type: 'cosmetic',   description: 'Llega a las estrellas… teóricamente. Combustible vendido por separado.', stock: -1 },
    { translationKey: 'shield',       name: 'Escudo Anti-Críticas',           emoji: '🛡️', price: 2200,  type: 'consumable', description: 'Absorbe hasta 3 críticas de tus amigos. Duración: un rato.', stock: 30 },
    { translationKey: 'crown',        name: 'Corona del Servidor',            emoji: '👑', price: 2500,  type: 'cosmetic',   description: 'Símbolo de estatus máximo. No da poderes reales, solo respeto.', stock: -1 },
    { translationKey: 'diamond',      name: 'Diamante de la Eternidad',       emoji: '💎', price: 4000,  type: 'cosmetic',   description: 'Raro, brillante y completamente inútil. Como toda buena obra de arte.', stock: -1 },
    { translationKey: 'trophy',       name: 'Trofeo de Leyenda Absoluta',     emoji: '🏆', price: 6000,  type: 'cosmetic',   description: 'Para quien llegó hasta aquí. Eso ya merece respeto en sí mismo.', stock: -1 },
    { translationKey: 'star',         name: 'Estrella del Servidor',          emoji: '🌟', price: 8000,  type: 'cosmetic',   description: 'Tu nombre en las estrellas. Bueno, en el inventario. Que es casi lo mismo.', stock: -1 },
    { translationKey: 'lottery',      name: 'Ticket Dorado de Lotería',       emoji: '🎰', price: 10000, type: 'consumable', description: 'La suerte es para los valientes. O para los ricos. Tú decides.', stock: 10 },
    { translationKey: 'suit',         name: 'Traje de Millonario',            emoji: '🤵', price: 12000, type: 'cosmetic',   description: 'Porque si ya tienes 12,000 monedas, claramente sabes lo que haces.', stock: -1 },
    { translationKey: 'portal',       name: 'Portal Interdimensional',        emoji: '🌀', price: 15000, type: 'consumable', description: 'Se abre, te metes, apareces en el mismo servidor. Pero fue emocionante.', stock: 5 },
  ];

  /**
   * Inserts the base catalog into a new guild (idempotent by name)
   */
  public async seedDefaultItems(guildId: string): Promise<void> {
    if (!this.db) return;

    try {
      const existing = await this.db.prisma.shopItem.findMany({ where: { guildId }, select: { name: true } });
      const existingNames = new Set(existing.map(i => i.name));

      const toInsert = ShopService.DEFAULT_CATALOG.filter(item => !existingNames.has(item.name));

      for (const item of toInsert) {
        await this.db.prisma.shopItem.create({
          data: { guildId, name: item.name, description: item.description, translationKey: item.translationKey, price: item.price, type: item.type, emoji: item.emoji, stock: item.stock, enabled: true },
        });
      }

      if (toInsert.length > 0) {
        this.logger.info(`Shop: ${toInsert.length} items inserted in guild ${guildId}`);
      }
    } catch (error) {
      this.logger.error(`Error seeding shop items for guild ${guildId}:`, error);
    }
  }

  /**
   * Gets shop items from the DB
   */
  public async getShopItems(guildId: string): Promise<ShopItem[]> {
    if (!this.db) return [];

    try {
      const dbItems = await this.db.prisma.shopItem.findMany({
        where: { guildId, enabled: true }
      });

      return dbItems.map(item => ({
        id: item.id,
        guildId: item.guildId,
        name: item.name,
        description: item.description,
        translationKey: item.translationKey,
        price: item.price,
        type: item.type,
        data: item.roleId ? { roleId: item.roleId } : {},
        stock: item.stock,
        enabled: item.enabled,
        category: item.type,
        emoji: item.emoji || undefined
      }));
    } catch (error) {
      this.logger.error('Error fetching shop items:', error);

      return [];
    }
  }

  /**
   * Gets a specific item
   */
  public async getItem(itemId: string, guildId: string): Promise<ShopItem | null> {
    if (!this.db) return null;

    try {
      // Always scoped to the server and to active items: the ID comes from the user
      const item = await this.db.prisma.shopItem.findFirst({
        where: { id: itemId, guildId, enabled: true }
      });

      if (!item) return null;

      return {
        id: item.id,
        guildId: item.guildId,
        name: item.name,
        description: item.description,
        translationKey: item.translationKey,
        price: item.price,
        type: item.type,
        data: item.roleId ? { roleId: item.roleId } : {},
        stock: item.stock,
        enabled: item.enabled,
        category: item.type,
        emoji: item.emoji || undefined
      };
    } catch (error) {
      this.logger.error('Error fetching item:', error);

      return null;
    }
  }

  /**
   * Atomically reserves one unit of stock (stock -1 = unlimited).
   * Returns false if the item is out of stock.
   */
  public async reserveStock(itemId: string, guildId: string): Promise<boolean> {
    if (!this.db) return false;
    const item = await this.db.prisma.shopItem.findFirst({ where: { id: itemId, guildId }, select: { stock: true } });
    if (!item) return false;
    if (item.stock < 0) return true;
    const { count } = await this.db.prisma.shopItem.updateMany({
      where: { id: itemId, guildId, stock: { gt: 0 } },
      data: { stock: { decrement: 1 } },
    });
    return count === 1;
  }

  /** Returns a reserved unit (failed purchase). */
  public async releaseStock(itemId: string, guildId: string): Promise<void> {
    if (!this.db) return;
    await this.db.prisma.shopItem.updateMany({
      where: { id: itemId, guildId, stock: { gte: 0 } },
      data: { stock: { increment: 1 } },
    }).catch(() => {});
  }

  /**
   * Adds an item to the user's inventory
   */
  public async addToInventory(guildId: string, userId: string, itemId: string): Promise<boolean> {
    if (!this.db) return false;

    try {
      const existing = await this.db.prisma.userInventory.findUnique({
        where: { guildId_userId_itemId: { guildId, userId, itemId } }
      });

      if (existing) {
        await this.db.prisma.userInventory.update({
          where: { id: existing.id },
          data: { quantity: existing.quantity + 1 }
        });
      } else {
        await this.db.prisma.userInventory.create({
          data: { guildId, userId, itemId }
        });
      }

      return true;
    } catch (error) {
      this.logger.error('Error adding to inventory:', error);

      return false;
    }
  }

  /**
   * Gets the user's inventory
   */
  public async getUserInventory(guildId: string, userId: string): Promise<InventoryItem[]> {
    if (!this.db) return [];

    try {
      const inventory = await this.db.prisma.userInventory.findMany({
        where: { guildId, userId },
        include: { item: true }
      });

      return inventory.map(inv => ({
        id: inv.id,
        itemId: inv.itemId,
        itemName: inv.item.name,
        type: inv.item.type,
        emoji: inv.item.emoji || undefined,
        quantity: inv.quantity,
        equipped: inv.equipped,
        data: inv.item.roleId ? { roleId: inv.item.roleId } : {}
      }));
    } catch (error) {
      this.logger.error('Error fetching inventory:', error);

      return [];
    }
  }

  /**
   * Equips/unequips a cosmetic item
   */
  public async toggleEquip(guildId: string, userId: string, inventoryId: string): Promise<{ success: boolean; equipped: boolean; message: string }> {
    if (!this.db) return { success: false, equipped: false, message: i18n.t('shop.inv.unavailable', guildId) };

    try {
      const inv = await this.db.prisma.userInventory.findUnique({
        where: { id: inventoryId },
        include: { item: true }
      });

      if (!inv || inv.guildId !== guildId || inv.userId !== userId) {
        return { success: false, equipped: false, message: i18n.t('shop.inv.not_found', guildId) };
      }

      if (inv.item.type !== 'cosmetic') {
        return { success: false, equipped: false, message: i18n.t('shop.inv.only_cosmetic', guildId) };
      }

      // If equipping, unequip others of the same type
      if (!inv.equipped) {
        await this.db.prisma.userInventory.updateMany({
          where: { guildId, userId, equipped: true, item: { type: 'cosmetic' } },
          data: { equipped: false }
        });
      }

      const updated = await this.db.prisma.userInventory.update({
        where: { id: inventoryId },
        data: { equipped: !inv.equipped }
      });

      return {
        success: true,
        equipped: updated.equipped,
        message: updated.equipped
          ? i18n.t('shop.inv.equipped', guildId, { item: `${inv.item.emoji || '📦'} ${inv.item.name}` })
          : i18n.t('shop.inv.unequipped', guildId, { item: inv.item.name })
      };
    } catch (error) {
      this.logger.error('Error toggling equip:', error);

      return { success: false, equipped: false, message: i18n.t('shop.inv.equip_error', guildId) };
    }
  }

  /**
   * Uses a consumable item
   */
  public async useItem(guildId: string, userId: string, inventoryId: string): Promise<{ success: boolean; message: string }> {
    if (!this.db) return { success: false, message: i18n.t('shop.inv.unavailable', guildId) };

    try {
      const inv = await this.db.prisma.userInventory.findUnique({
        where: { id: inventoryId },
        include: { item: true }
      });

      if (!inv || inv.guildId !== guildId || inv.userId !== userId) {
        return { success: false, message: i18n.t('shop.inv.not_found', guildId) };
      }

      if (inv.item.type !== 'consumable') {
        return { success: false, message: i18n.t('shop.inv.not_consumable', guildId) };
      }

      // Reduce quantity or delete
      if (inv.quantity > 1) {
        await this.db.prisma.userInventory.update({
          where: { id: inventoryId },
          data: { quantity: inv.quantity - 1, usedAt: new Date() }
        });
      } else {
        await this.db.prisma.userInventory.delete({
          where: { id: inventoryId }
        });
      }

      return {
        success: true,
        message: i18n.t('shop.inv.used', guildId, { item: `${inv.item.emoji || '📦'} ${inv.item.name}`, description: inv.item.description })
      };
    } catch (error) {
      this.logger.error('Error using item:', error);

      return { success: false, message: i18n.t('shop.inv.use_error', guildId) };
    }
  }

  /**
   * Gets the user's equipped cosmetic
   */
  public async getEquippedCosmetic(guildId: string, userId: string): Promise<InventoryItem | null> {
    if (!this.db) return null;

    try {
      const equipped = await this.db.prisma.userInventory.findFirst({
        where: { guildId, userId, equipped: true },
        include: { item: true }
      });

      if (!equipped) return null;

      return {
        id: equipped.id,
        itemId: equipped.itemId,
        itemName: equipped.item.name,
        type: equipped.item.type,
        emoji: equipped.item.emoji || undefined,
        quantity: equipped.quantity,
        equipped: equipped.equipped
      };
    } catch (error) {
      this.logger.error('Error fetching equipped cosmetic:', error);

      return null;
    }
  }
}
