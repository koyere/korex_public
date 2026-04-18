import { logger } from '../utils/Logger';
import { DatabaseManager } from '../client/managers/DatabaseManager';
import { Guild, GuildMember, TextChannel, EmbedBuilder, Colors } from 'discord.js';

export interface LevelUser {
  guildId: string;
  userId: string;
  xp: number;
  level: number;
  totalXp: number;
  messages: number;
  voiceMinutes: number;
  lastXpGain: Date | null;
}

export interface LevelConfig {
  guildId: string;
  enabled: boolean;
  xpPerMessage: number;
  xpPerVoiceMinute: number;
  xpCooldown: number;
  xpMultiplier: number;
  bonusChannels: Record<string, number>;
  bonusRoles: Record<string, number>;
  ignoredChannels: string[];
  ignoredRoles: string[];
  levelUpEnabled: boolean;
  levelUpChannelId: string | null;
  levelUpMessage: string;
  levelRoles: Record<number, string>;
  stackRoles: boolean;
}

export interface LevelUpResult {
  leveledUp: boolean;
  oldLevel: number;
  newLevel: number;
  xpGained: number;
  roleRewards?: string[];
}

export class LevelService {
  private static instance: LevelService;
  private logger = logger;
  private db: DatabaseManager | null = null;
  private userCache = new Map<string, LevelUser>();
  private cooldowns = new Map<string, number>();

  private constructor() {}

  public static getInstance(): LevelService {
    if (!LevelService.instance) {
      LevelService.instance = new LevelService();
    }

    return LevelService.instance;
  }

  /**
   * Inicializa la conexión a la base de datos
   */
  public setDatabase(db: DatabaseManager): void {
    this.db = db;
  }

  /**
   * Obtiene los datos de nivel de un usuario
   */
  public async getUser(guildId: string, userId: string): Promise<LevelUser> {
    const cacheKey = `${guildId}:${userId}`;

    // Verificar caché primero
    let user = this.userCache.get(cacheKey);

    if (!user && this.db) {
      // Buscar en base de datos
      const dbUser = await this.db.prisma.guildUser.findUnique({
        where: {
          guildId_userId: {
            guildId,
            userId,
          },
        },
      });

      if (dbUser) {
        user = {
          guildId: dbUser.guildId,
          userId: dbUser.userId,
          xp: dbUser.xp,
          level: dbUser.level,
          totalXp: dbUser.totalXp,
          messages: dbUser.messages,
          voiceMinutes: dbUser.voiceMinutes,
          lastXpGain: dbUser.lastXpGain || null,
        };
      } else {
        // Crear usuario nuevo
        user = await this.createUser(guildId, userId);
      }

      // Cachear por 5 minutos
      this.userCache.set(cacheKey, user);
      setTimeout(() => this.userCache.delete(cacheKey), 5 * 60 * 1000);
    }

    return (
      user || {
        guildId,
        userId,
        xp: 0,
        level: 0,
        totalXp: 0,
        messages: 0,
        voiceMinutes: 0,
        lastXpGain: null,
      }
    );
  }

  /**
   * Crea un nuevo usuario en el sistema de niveles
   */
  private async createUser(guildId: string, userId: string): Promise<LevelUser> {
    if (!this.db) {
      throw new Error('Database not available');
    }

    const dbUser = await this.db.prisma.guildUser.upsert({
      where: {
        guildId_userId: {
          guildId,
          userId,
        },
      },
      update: {},
      create: {
        guildId,
        userId,
        xp: 0,
        level: 0,
        totalXp: 0,
        messages: 0,
        voiceMinutes: 0,
      },
    });

    return {
      guildId: dbUser.guildId,
      userId: dbUser.userId,
      xp: dbUser.xp,
      level: dbUser.level,
      totalXp: dbUser.totalXp,
      messages: dbUser.messages,
      voiceMinutes: dbUser.voiceMinutes,
      lastXpGain: dbUser.lastXpGain || null,
    };
  }

  /**
   * Actualiza los datos de un usuario
   */
  private async updateUser(user: LevelUser): Promise<void> {
    if (!this.db) {
      throw new Error('Database not available');
    }

    await this.db.prisma.guildUser.update({
      where: {
        guildId_userId: {
          guildId: user.guildId,
          userId: user.userId,
        },
      },
      data: {
        xp: user.xp,
        level: user.level,
        totalXp: user.totalXp,
        messages: user.messages,
        voiceMinutes: user.voiceMinutes,
        lastXpGain: user.lastXpGain || null,
      },
    });

    // Actualizar caché
    const cacheKey = `${user.guildId}:${user.userId}`;

    this.userCache.set(cacheKey, user);
  }

  /**
   * Returns whether the 'levels' module is enabled at the guild level.
   * An empty enabledAddons array (legacy guilds) is treated as "all enabled".
   */
  private async isGuildModuleEnabled(guildId: string, moduleName: string): Promise<boolean> {
    if (!this.db) return true;
    const guild = await this.db.prisma.guild.findUnique({
      where: { id: guildId },
      select: { enabledAddons: true },
    });
    if (!guild || guild.enabledAddons.length === 0) return true;
    return guild.enabledAddons.includes(moduleName);
  }

  /**
   * Obtiene la configuración de niveles de un servidor
   */
  public async getConfig(guildId: string): Promise<LevelConfig> {
    if (!this.db) {
      return this.getDefaultConfig(guildId);
    }

    try {
      // Parallel: fetch module toggle and config at the same time
      const [moduleEnabled, config] = await Promise.all([
        this.isGuildModuleEnabled(guildId, 'levels'),
        this.db.prisma.levelConfig.findUnique({ where: { guildId } }),
      ]);

      if (!config) {
        const defaults = this.getDefaultConfig(guildId);
        return { ...defaults, enabled: moduleEnabled ? defaults.enabled : false };
      }

      return {
        guildId: config.guildId,
        // Module toggle takes precedence over the per-guild granular setting
        enabled: moduleEnabled ? config.enabled : false,
        xpPerMessage: config.xpPerMessage,
        xpPerVoiceMinute: config.xpPerVoiceMinute,
        xpCooldown: config.xpCooldown,
        xpMultiplier: config.xpMultiplier,
        bonusChannels: (config.bonusChannels as Record<string, number>) || undefined,
        bonusRoles: (config.bonusRoles as Record<string, number>) || undefined,
        ignoredChannels: config.ignoredChannels,
        ignoredRoles: config.ignoredRoles,
        levelUpEnabled: config.levelUpEnabled,
        levelUpChannelId: config.levelUpChannelId || null,
        levelUpMessage: config.levelUpMessage,
        levelRoles: (config.levelRoles as Record<number, string>) || {},
        stackRoles: config.stackRoles,
      };
    } catch (error) {
      this.logger.error('Error getting level config:', error);

      return this.getDefaultConfig(guildId);
    }
  }

  private getDefaultConfig(guildId: string): LevelConfig {
    return {
      guildId,
      enabled: true,
      xpPerMessage: 15,
      xpPerVoiceMinute: 5,
      xpCooldown: 60, // 1 minuto en segundos
      xpMultiplier: 1.0,
      bonusChannels: {},
      bonusRoles: {},
      ignoredChannels: [],
      ignoredRoles: [],
      levelUpEnabled: true,
      levelUpChannelId: null,
      levelUpMessage: '🎉 ¡{user} subió al nivel {level}!',
      levelRoles: {},
      stackRoles: false,
    };
  }

  /**
   * Añade XP por mensaje
   */
  public async addMessageXp(
    guild: Guild,
    member: GuildMember,
    channelId: string,
    currentChannel?: TextChannel
  ): Promise<LevelUpResult> {
    const config = await this.getConfig(guild.id);

    if (!config.enabled) {
      return {
        leveledUp: false,
        oldLevel: 0,
        newLevel: 0,
        xpGained: 0,
      };
    }

    // Verificar si el canal está ignorado
    if (config.ignoredChannels.includes(channelId)) {
      return {
        leveledUp: false,
        oldLevel: 0,
        newLevel: 0,
        xpGained: 0,
      };
    }

    // Verificar si el usuario tiene roles ignorados
    const hasIgnoredRole = member.roles.cache.some((role) => config.ignoredRoles.includes(role.id));

    if (hasIgnoredRole) {
      return {
        leveledUp: false,
        oldLevel: 0,
        newLevel: 0,
        xpGained: 0,
      };
    }

    // Verificar cooldown
    const cooldownKey = `${guild.id}:${member.id}`;
    const now = Date.now();
    const lastXp = this.cooldowns.get(cooldownKey) || 0;

    if (now - lastXp < config.xpCooldown * 1000) {
      return {
        leveledUp: false,
        oldLevel: 0,
        newLevel: 0,
        xpGained: 0,
      };
    }

    this.cooldowns.set(cooldownKey, now);

    const user = await this.getUser(guild.id, member.id);
    const oldLevel = user.level;

    // Calcular XP base
    let xpGain = config.xpPerMessage;

    // Aplicar multiplicador global
    xpGain *= config.xpMultiplier;

    // Aplicar bonus por canal
    if (config.bonusChannels && config.bonusChannels[channelId]) {
      xpGain *= config.bonusChannels[channelId];
    }

    // Aplicar bonus por roles
    if (config.bonusRoles) {
      for (const role of member.roles.cache.values()) {
        if (config.bonusRoles[role.id]) {
          xpGain *= config.bonusRoles[role.id];
          break; // Solo aplicar el primer bonus encontrado
        }
      }
    }

    // Redondear XP
    xpGain = Math.round(xpGain);

    // Añadir XP
    user.xp += xpGain;
    user.totalXp += xpGain;
    user.messages += 1;
    user.lastXpGain = new Date();

    // Verificar si subió de nivel
    const newLevel = this.calculateLevel(user.totalXp);
    const leveledUp = newLevel > oldLevel;

    if (leveledUp) {
      user.level = newLevel;
      user.xp = user.totalXp - this.getXpForLevel(newLevel);
    }

    await this.updateUser(user);

    const result: LevelUpResult = {
      leveledUp,
      oldLevel,
      newLevel,
      xpGained: xpGain,
    };

    // Manejar subida de nivel
    if (leveledUp) {
      result.roleRewards = await this.handleLevelUp(guild, member, newLevel, config);

      if (config.levelUpEnabled) {
        await this.sendLevelUpMessage(guild, member, newLevel, config);
      }
    }

    return result;
  }

  /**
   * Añade XP por tiempo en canal de voz
   */
  public async addVoiceXp(
    guild: Guild,
    member: GuildMember,
    minutes: number
  ): Promise<LevelUpResult> {
    const config = await this.getConfig(guild.id);

    if (!config.enabled) {
      return {
        leveledUp: false,
        oldLevel: 0,
        newLevel: 0,
        xpGained: 0,
      };
    }

    const user = await this.getUser(guild.id, member.id);
    const oldLevel = user.level;

    // Calcular XP por voz
    let xpGain = config.xpPerVoiceMinute * minutes;

    xpGain *= config.xpMultiplier;
    xpGain = Math.round(xpGain);

    // Añadir XP
    user.xp += xpGain;
    user.totalXp += xpGain;
    user.voiceMinutes += minutes;

    // Verificar si subió de nivel
    const newLevel = this.calculateLevel(user.totalXp);
    const leveledUp = newLevel > oldLevel;

    if (leveledUp) {
      user.level = newLevel;
      user.xp = user.totalXp - this.getXpForLevel(newLevel);
    }

    await this.updateUser(user);

    const result: LevelUpResult = {
      leveledUp,
      oldLevel,
      newLevel,
      xpGained: xpGain,
    };

    // Manejar subida de nivel
    if (leveledUp) {
      result.roleRewards = await this.handleLevelUp(guild, member, newLevel, config);

      if (config.levelUpEnabled) {
        await this.sendLevelUpMessage(guild, member, newLevel, config);
      }
    }

    return result;
  }

  /**
   * Calcula el nivel basado en XP total
   */
  public calculateLevel(totalXp: number): number {
    // Fórmula: nivel = floor(sqrt(totalXp / 100))
    return Math.floor(Math.sqrt(totalXp / 100));
  }

  /**
   * Calcula el XP necesario para un nivel específico
   */
  public getXpForLevel(level: number): number {
    // Fórmula: xp = (nivel^2) * 100
    return level * level * 100;
  }

  /**
   * Calcula el XP necesario para el siguiente nivel
   */
  public getXpForNextLevel(currentLevel: number): number {
    return this.getXpForLevel(currentLevel + 1);
  }

  /**
   * Maneja la subida de nivel (roles, etc.)
   */
  private async handleLevelUp(
    guild: Guild,
    member: GuildMember,
    newLevel: number,
    config: LevelConfig
  ): Promise<string[]> {
    const roleRewards: string[] = [];

    if (!config.levelRoles) {
      return roleRewards;
    }

    try {
      // Buscar roles para este nivel
      const roleId = config.levelRoles[newLevel];

      if (roleId) {
        const role = guild.roles.cache.get(roleId);

        if (role) {
          await member.roles.add(role, `Level up reward - Level ${newLevel}`);
          roleRewards.push(role.name);

          // Si no se apilan roles, quitar roles de niveles anteriores
          if (!config.stackRoles) {
            for (const [level, oldRoleId] of Object.entries(config.levelRoles)) {
              if (parseInt(level) < newLevel && oldRoleId !== roleId) {
                const oldRole = guild.roles.cache.get(oldRoleId);

                if (oldRole && member.roles.cache.has(oldRole.id)) {
                  await member.roles.remove(oldRole, `Level up - removing old level role`);
                }
              }
            }
          }
        }
      }
    } catch (error) {
      this.logger.error('Error handling level up roles:', error);
    }

    return roleRewards;
  }

  /**
   * Envía mensaje de subida de nivel
   */
  private async sendLevelUpMessage(
    guild: Guild,
    member: GuildMember,
    newLevel: number,
    config: LevelConfig,
    currentChannel?: TextChannel
  ): Promise<void> {
    try {
      let channel: TextChannel | null = null;

      // 1. Usar canal configurado específicamente
      if (config.levelUpChannelId) {
        channel = guild.channels.cache.get(config.levelUpChannelId) as TextChannel;
      }

      // 2. Usar canal actual del mensaje (si se proporcionó)
      if (!channel && currentChannel) {
        channel = currentChannel;
      }

      // 3. Buscar canal general como último recurso
      if (!channel) {
        channel = guild.channels.cache.find(
          (ch) => ch.type === 0 && 
          (ch.name.includes('general') || ch.name.includes('chat') || ch.name.includes('principal'))
        ) as TextChannel;
      }

      // 4. Usar el primer canal de texto disponible
      if (!channel) {
        channel = guild.channels.cache.find(ch => ch.type === 0) as TextChannel;
      }

      if (!channel) {
        this.logger.warn(`No suitable channel found for level up message in guild ${guild.id}`);

        return;
      }

      // Verificar permisos del bot
      const permissions = channel.permissionsFor(guild.members.me!);

      if (!permissions?.has(['SendMessages', 'EmbedLinks'])) {
        this.logger.warn(`Missing permissions in channel ${channel.id} for level up message`);

        return;
      }

      // Formatear mensaje
      const message = config.levelUpMessage
        .replace('{user}', member.toString())
        .replace('{level}', newLevel.toString())
        .replace('{username}', member.user.username)
        .replace('{displayName}', member.displayName);

      const embed = new EmbedBuilder()
        .setColor(Colors.Gold)
        .setTitle('🎉 ¡Subida de Nivel!')
        .setDescription(message)
        .addFields({
          name: '📊 Progreso',
          value: `**Nivel:** ${newLevel}\n**XP Total:** ${(await this.getUser(guild.id, member.id)).totalXp}`,
          inline: true,
        })
        .setThumbnail(member.user.displayAvatarURL())
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    } catch (error) {
      this.logger.error('Error sending level up message:', error);
    }
  }

  /**
   * Obtiene el leaderboard de niveles
   */
  public async getLeaderboard(guildId: string, limit: number = 10): Promise<LevelUser[]> {
    try {
      if (!this.db) {
        return [];
      }

      const users = await this.db.prisma.guildUser.findMany({
        where: { guildId },
        orderBy: [{ level: 'desc' }, { totalXp: 'desc' }],
        take: limit,
      });

      return users.map((user) => ({
        guildId: user.guildId,
        userId: user.userId,
        xp: user.xp,
        level: user.level,
        totalXp: user.totalXp,
        messages: user.messages,
        voiceMinutes: user.voiceMinutes,
        lastXpGain: user.lastXpGain || null,
      }));
    } catch (error) {
      this.logger.error('Error getting leaderboard:', error);

      return [];
    }
  }

  /**
   * Obtiene la posición de un usuario en el leaderboard
   */
  public async getUserRank(guildId: string, userId: string): Promise<number> {
    try {
      if (!this.db) {
        return 0;
      }

      const user = await this.getUser(guildId, userId);

      const rank = await this.db.prisma.guildUser.count({
        where: {
          guildId,
          OR: [
            { level: { gt: user.level } },
            {
              level: user.level,
              totalXp: { gt: user.totalXp },
            },
          ],
        },
      });

      return rank + 1;
    } catch (error) {
      this.logger.error('Error getting user rank:', error);

      return 0;
    }
  }

  /**
   * Añade XP manualmente a un usuario
   */
  public async addXp(
    guild: Guild,
    userId: string,
    amount: number,
    reason: string = 'Manual addition'
  ): Promise<LevelUpResult> {
    try {
      const user = await this.getUser(guild.id, userId);
      const oldLevel = user.level;

      user.xp += amount;
      user.totalXp += amount;

      // Verificar si subió de nivel
      const newLevel = this.calculateLevel(user.totalXp);
      const leveledUp = newLevel > oldLevel;

      if (leveledUp) {
        user.level = newLevel;
        user.xp = user.totalXp - this.getXpForLevel(newLevel);
      }

      await this.updateUser(user);

      this.logger.info(
        `Added ${amount} XP to user ${userId} in guild ${guild.id}. Reason: ${reason}`
      );

      const result: LevelUpResult = {
        leveledUp,
        oldLevel,
        newLevel,
        xpGained: amount,
      };

      // Manejar subida de nivel si es necesario
      if (leveledUp) {
        const member = await guild.members.fetch(userId).catch(() => null);

        if (member) {
          const config = await this.getConfig(guild.id);

          result.roleRewards = await this.handleLevelUp(guild, member, newLevel, config);

          if (config.levelUpEnabled) {
            await this.sendLevelUpMessage(guild, member, newLevel, config);
          }
        }
      }

      return result;
    } catch (error) {
      this.logger.error('Error adding XP:', error);

      return {
        leveledUp: false,
        oldLevel: 0,
        newLevel: 0,
        xpGained: 0,
      };
    }
  }

  /**
   * Quita XP a un usuario
   */
  public async removeXp(
    guild: Guild,
    userId: string,
    amount: number,
    reason: string = 'Manual removal'
  ): Promise<LevelUpResult> {
    try {
      const user = await this.getUser(guild.id, userId);
      const oldLevel = user.level;

      user.totalXp = Math.max(0, user.totalXp - amount);

      // Recalcular nivel y XP actual
      const newLevel = this.calculateLevel(user.totalXp);

      user.level = newLevel;
      user.xp = user.totalXp - this.getXpForLevel(newLevel);

      await this.updateUser(user);

      this.logger.info(
        `Removed ${amount} XP from user ${userId} in guild ${guild.id}. Reason: ${reason}`
      );

      return {
        leveledUp: false,
        oldLevel,
        newLevel,
        xpGained: -amount,
      };
    } catch (error) {
      this.logger.error('Error removing XP:', error);

      return {
        leveledUp: false,
        oldLevel: 0,
        newLevel: 0,
        xpGained: 0,
      };
    }
  }

  /**
   * Obtiene estadísticas de niveles del servidor
   */
  public async getServerStats(guildId: string): Promise<{
    totalUsers: number;
    totalXp: number;
    averageLevel: number;
    highestLevel: number;
    totalMessages: number;
    totalVoiceMinutes: number;
  }> {
    try {
      if (!this.db) {
        return {
          totalUsers: 0,
          totalXp: 0,
          averageLevel: 0,
          highestLevel: 0,
          totalMessages: 0,
          totalVoiceMinutes: 0,
        };
      }

      const stats = await this.db.prisma.guildUser.aggregate({
        where: { guildId },
        _count: { userId: true },
        _sum: {
          totalXp: true,
          messages: true,
          voiceMinutes: true,
        },
        _avg: { level: true },
        _max: { level: true },
      });

      return {
        totalUsers: stats._count.userId,
        totalXp: stats._sum.totalXp || 0,
        averageLevel: Math.round(stats._avg.level || 0),
        highestLevel: stats._max.level || 0,
        totalMessages: stats._sum.messages || 0,
        totalVoiceMinutes: stats._sum.voiceMinutes || 0,
      };
    } catch (error) {
      this.logger.error('Error getting server stats:', error);

      return {
        totalUsers: 0,
        totalXp: 0,
        averageLevel: 0,
        highestLevel: 0,
        totalMessages: 0,
        totalVoiceMinutes: 0,
      };
    }
  }
}
