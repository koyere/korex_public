import { Collection } from 'discord.js';
import { KorexClient } from '../KorexClient';

interface CooldownData {
  expiresAt: number;
  duration: number;
}

export class CooldownManager {
  public client: KorexClient;
  private cooldowns: Collection<string, Collection<string, CooldownData>>;
  private cleanupInterval: NodeJS.Timeout;

  constructor(client: KorexClient) {
    this.client = client;
    this.cooldowns = new Collection();

    // Clean expired cooldowns every 5 minutes
    this.cleanupInterval = setInterval(
      () => {
        this.cleanup();
      },
      5 * 60 * 1000
    );
  }

  /**
   * Check if a user has an active cooldown for a command
   */
  checkCooldown(commandName: string, userId: string): number | null {
    const commandCooldowns = this.cooldowns.get(commandName);

    if (!commandCooldowns) {
      return null;
    }

    const userCooldown = commandCooldowns.get(userId);

    if (!userCooldown) {
      return null;
    }

    const now = Date.now();

    if (now >= userCooldown.expiresAt) {
      // Cooldown expired, remove it
      commandCooldowns.delete(userId);

      return null;
    }

    // Return remaining time in seconds
    return (userCooldown.expiresAt - now) / 1000;
  }

  /**
   * Apply cooldown to a user for a command
   */
  applyCooldown(commandName: string, userId: string, duration: number): void {
    if (!this.cooldowns.has(commandName)) {
      this.cooldowns.set(commandName, new Collection());
    }

    const commandCooldowns = this.cooldowns.get(commandName)!;
    const expiresAt = Date.now() + duration * 1000;

    commandCooldowns.set(userId, {
      expiresAt,
      duration,
    });

    this.client.logger.debug(`Cooldown applied: ${commandName} -> ${userId} (${duration}s)`);
  }

  /**
   * Remove cooldown from a user for a specific command
   */
  removeCooldown(commandName: string, userId: string): boolean {
    const commandCooldowns = this.cooldowns.get(commandName);

    if (!commandCooldowns) {
      return false;
    }

    const removed = commandCooldowns.delete(userId);

    if (removed) {
      this.client.logger.debug(`Cooldown removed: ${commandName} -> ${userId}`);
    }

    return removed;
  }

  /**
   * Remove all cooldowns from a user
   */
  removeUserCooldowns(userId: string): number {
    let removed = 0;

    for (const [commandName, commandCooldowns] of this.cooldowns) {
      if (commandCooldowns.delete(userId)) {
        removed++;
      }
    }

    if (removed > 0) {
      this.client.logger.debug(`${removed} cooldowns removed for user ${userId}`);
    }

    return removed;
  }

  /**
   * Remove all cooldowns from a command
   */
  removeCommandCooldowns(commandName: string): boolean {
    const removed = this.cooldowns.delete(commandName);

    if (removed) {
      this.client.logger.debug(`All cooldowns removed for command ${commandName}`);
    }

    return removed;
  }

  /**
   * Get all active cooldowns for a user
   */
  getUserCooldowns(userId: string): Array<{
    command: string;
    expiresAt: number;
    remainingSeconds: number;
  }> {
    const userCooldowns: Array<{
      command: string;
      expiresAt: number;
      remainingSeconds: number;
    }> = [];

    const now = Date.now();

    for (const [commandName, commandCooldowns] of this.cooldowns) {
      const userCooldown = commandCooldowns.get(userId);

      if (userCooldown && now < userCooldown.expiresAt) {
        userCooldowns.push({
          command: commandName,
          expiresAt: userCooldown.expiresAt,
          remainingSeconds: (userCooldown.expiresAt - now) / 1000,
        });
      }
    }

    return userCooldowns.sort((a, b) => a.expiresAt - b.expiresAt);
  }

  /**
   * Get cooldown statistics
   */
  getStats(): {
    totalCommands: number;
    totalUsers: number;
    totalCooldowns: number;
    byCommand: Record<string, number>;
  } {
    const stats = {
      totalCommands: this.cooldowns.size,
      totalUsers: 0,
      totalCooldowns: 0,
      byCommand: {} as Record<string, number>,
    };

    const uniqueUsers = new Set<string>();

    for (const [commandName, commandCooldowns] of this.cooldowns) {
      const activeCooldowns = commandCooldowns.filter(
        (cooldown) => Date.now() < cooldown.expiresAt
      );

      stats.byCommand[commandName] = activeCooldowns.size;
      stats.totalCooldowns += activeCooldowns.size;

      // Count unique users
      for (const userId of activeCooldowns.keys()) {
        uniqueUsers.add(userId);
      }
    }

    stats.totalUsers = uniqueUsers.size;

    return stats;
  }

  /**
   * Clean up expired cooldowns
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [commandName, commandCooldowns] of this.cooldowns) {
      const expiredUsers: string[] = [];

      for (const [userId, cooldown] of commandCooldowns) {
        if (now >= cooldown.expiresAt) {
          expiredUsers.push(userId);
        }
      }

      for (const userId of expiredUsers) {
        commandCooldowns.delete(userId);
        cleaned++;
      }

      // If no cooldowns remain for this command, remove the collection
      if (commandCooldowns.size === 0) {
        this.cooldowns.delete(commandName);
      }
    }

    if (cleaned > 0) {
      this.client.logger.debug(`${cleaned} expired cooldowns cleaned up`);
    }
  }

  /**
   * Clear all cooldowns
   */
  clear(): void {
    const totalCooldowns = this.getStats().totalCooldowns;

    this.cooldowns.clear();

    if (totalCooldowns > 0) {
      this.client.logger.info(`${totalCooldowns} cooldowns cleared`);
    }
  }

  /**
   * Destroy the manager (clean up interval)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clear();
  }
}
