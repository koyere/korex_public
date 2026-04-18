import { logger } from '../utils/Logger';
import { DatabaseManager } from '../client/managers/DatabaseManager';
import { EconomyService } from './EconomyService';
import { GuildMember } from 'discord.js';

export interface ShopItem {
  id: string;
  guildId: string;
  name: string;
  description: string;
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

  /**
   * Obtiene items de la tienda desde la BD
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
   * Obtiene un item específico
   */
  public async getItem(itemId: string): Promise<ShopItem | null> {
    if (!this.db) return null;

    try {
      const item = await this.db.prisma.shopItem.findUnique({
        where: { id: itemId }
      });

      if (!item) return null;

      return {
        id: item.id,
        guildId: item.guildId,
        name: item.name,
        description: item.description,
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
   * Agrega item al inventario del usuario
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

      // Reducir stock si no es ilimitado
      const item = await this.db.prisma.shopItem.findUnique({ where: { id: itemId } });

      if (item && item.stock > 0) {
        await this.db.prisma.shopItem.update({
          where: { id: itemId },
          data: { stock: item.stock - 1 }
        });
      }

      return true;
    } catch (error) {
      this.logger.error('Error adding to inventory:', error);

      return false;
    }
  }

  /**
   * Obtiene el inventario del usuario
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
   * Equipa/desequipa un item cosmético
   */
  public async toggleEquip(guildId: string, userId: string, inventoryId: string): Promise<{ success: boolean; equipped: boolean; message: string }> {
    if (!this.db) return { success: false, equipped: false, message: 'Base de datos no disponible' };

    try {
      const inv = await this.db.prisma.userInventory.findUnique({
        where: { id: inventoryId },
        include: { item: true }
      });

      if (!inv || inv.guildId !== guildId || inv.userId !== userId) {
        return { success: false, equipped: false, message: 'Item no encontrado en tu inventario' };
      }

      if (inv.item.type !== 'cosmetic') {
        return { success: false, equipped: false, message: 'Solo puedes equipar items cosméticos' };
      }

      // Si va a equipar, desequipar otros del mismo tipo
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
        message: updated.equipped ? `${inv.item.emoji || '📦'} ${inv.item.name} equipado` : `${inv.item.name} desequipado`
      };
    } catch (error) {
      this.logger.error('Error toggling equip:', error);

      return { success: false, equipped: false, message: 'Error al equipar item' };
    }
  }

  /**
   * Usa un item consumible
   */
  public async useItem(guildId: string, userId: string, inventoryId: string): Promise<{ success: boolean; message: string }> {
    if (!this.db) return { success: false, message: 'Base de datos no disponible' };

    try {
      const inv = await this.db.prisma.userInventory.findUnique({
        where: { id: inventoryId },
        include: { item: true }
      });

      if (!inv || inv.guildId !== guildId || inv.userId !== userId) {
        return { success: false, message: 'Item no encontrado en tu inventario' };
      }

      if (inv.item.type !== 'consumable') {
        return { success: false, message: 'Este item no es consumible' };
      }

      // Reducir cantidad o eliminar
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
        message: `${inv.item.emoji || '📦'} Usaste ${inv.item.name}! ${inv.item.description}`
      };
    } catch (error) {
      this.logger.error('Error using item:', error);

      return { success: false, message: 'Error al usar item' };
    }
  }

  /**
   * Obtiene el cosmético equipado del usuario
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
