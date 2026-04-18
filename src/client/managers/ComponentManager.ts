import { Collection, MessageFlags } from 'discord.js';
import { Component, ComponentInteraction } from '../structures/Component';
import { KorexClient } from '../KorexClient';
import { i18n } from '../../utils/i18n';

export class ComponentManager {
  public client: KorexClient;
  public components: Collection<string, Component>;

  constructor(client: KorexClient) {
    this.client = client;
    this.components = new Collection();
  }

  /**
   * Register a component
   */
  registerComponent(component: Component): void {
    if (this.components.has(component.customId)) {
      this.client.logger.warn(
        `Component with customId '${component.customId}' already exists, overwriting`
      );
    }

    this.components.set(component.customId, component);
    this.client.logger.debug(`Component registered: ${component.customId} (${component.type})`);
  }

  /**
   * Unregister a component
   */
  unregisterComponent(customId: string): boolean {
    const removed = this.components.delete(customId);

    if (removed) {
      this.client.logger.debug(`Component unregistered: ${customId}`);
    }

    return removed;
  }

  /**
   * Get a component by customId
   */
  getComponent(customId: string, type?: 'button' | 'selectMenu' | 'modal'): Component | undefined {
    // Search for exact match first
    const component = this.components.get(customId);

    if (component && (!type || component.type === type)) {
      return component;
    }

    // Search for pattern matches, filtered by type when provided
    for (const [, comp] of this.components) {
      if ((!type || comp.type === type) && comp.matches(customId)) {
        return comp;
      }
    }

    return undefined;
  }

  /**
   * Handle button interaction
   */
  async handleButton(interaction: ComponentInteraction): Promise<void> {
    if (!interaction.isButton()) {
      return;
    }

    const component = this.getComponent(interaction.customId, 'button');

    if (!component) {
      this.client.logger.debug(`Component not found for customId: ${interaction.customId}`);
      return; // Let message collectors handle it
    }

    await component.safeExecute(interaction);
  }

  /**
   * Handle select menu interaction
   */
  async handleSelectMenu(interaction: ComponentInteraction): Promise<void> {
    if (!interaction.isAnySelectMenu()) {
      return;
    }

    const component = this.getComponent(interaction.customId, 'selectMenu');

    if (!component) {
      this.client.logger.debug(`Component not found for customId: ${interaction.customId}`);
      return; // Let message collectors handle it
    }

    await component.safeExecute(interaction);
  }

  /**
   * Handle modal interaction
   */
  async handleModal(interaction: ComponentInteraction): Promise<void> {
    if (!interaction.isModalSubmit()) {
      return;
    }

    const component = this.getComponent(interaction.customId, 'modal');

    if (!component) {
      this.client.logger.debug(`Component not found for customId: ${interaction.customId}`);

      try {
        await interaction.reply({
          content: i18n.t('common.errors.form_expired', interaction.guildId || undefined),
          flags: MessageFlags.Ephemeral,
        });
      } catch (error) {
        this.client.logger.error('Error responding to modal not found:', error);
      }

      return;
    }

    if (component.type !== 'modal') {
      this.client.logger.warn(`Component ${interaction.customId} is not of type modal`);

      return;
    }

    await component.safeExecute(interaction);
  }

  /**
   * Get components by type
   */
  getComponentsByType(type: 'button' | 'selectMenu' | 'modal'): Component[] {
    return this.components
      .filter((component) => component.type === type)
      .map((component) => component);
  }

  /**
   * Get components from a specific addon
   */
  getAddonComponents(addonName: string): Component[] {
    return this.components
      .filter((component) => component.addon === addonName)
      .map((component) => component);
  }

  /**
   * Remove all components from an addon
   */
  removeAddonComponents(addonName: string): number {
    let removed = 0;
    const toRemove: string[] = [];

    for (const [customId, component] of this.components) {
      if (component.addon === addonName) {
        toRemove.push(customId);
      }
    }

    for (const customId of toRemove) {
      this.components.delete(customId);
      removed++;
    }

    if (removed > 0) {
      this.client.logger.info(`${removed} components removed from addon ${addonName}`);
    }

    return removed;
  }

  /**
   * Clean up expired components (optional, for temporary components)
   */
  cleanupExpiredComponents(): number {
    // This functionality can be implemented if temporary components are needed
    // For now, just return 0
    return 0;
  }

  /**
   * Get component statistics
   */
  getStats(): {
    total: number;
    byType: Record<string, number>;
    byAddon: Record<string, number>;
  } {
    const stats = {
      total: this.components.size,
      byType: {} as Record<string, number>,
      byAddon: {} as Record<string, number>,
    };

    for (const component of this.components.values()) {
      // Count by type
      stats.byType[component.type] = (stats.byType[component.type] || 0) + 1;

      // Count by addon
      if (component.addon) {
        stats.byAddon[component.addon] = (stats.byAddon[component.addon] || 0) + 1;
      } else {
        stats.byAddon['core'] = (stats.byAddon['core'] || 0) + 1;
      }
    }

    return stats;
  }

  /**
   * List all registered components
   */
  listComponents(): Array<{
    customId: string;
    type: string;
    addon: string | null;
    permissions: string[];
    ownerOnly: boolean;
    guildOnly: boolean;
  }> {
    return Array.from(this.components.values()).map((component) => ({
      customId: component.customId,
      type: component.type,
      addon: component.addon,
      permissions: component.permissions.map((perm) => perm.toString()),
      ownerOnly: component.ownerOnly,
      guildOnly: component.guildOnly,
    }));
  }

  /**
   * Check if a customId is registered
   */
  hasComponent(customId: string): boolean {
    return this.getComponent(customId) !== undefined;
  }

  /**
   * Clear all components
   */
  clear(): void {
    const count = this.components.size;

    this.components.clear();

    if (count > 0) {
      this.client.logger.info(`${count} components cleared`);
    }
  }

  /**
   * Load components from a directory (for core components)
   */
  async loadComponents(directory: string): Promise<void> {
    const fs = require('fs');
    const path = require('path');

    if (!fs.existsSync(directory)) {
      this.client.logger.warn(`Components directory not found: ${directory}`);

      return;
    }

    const componentFiles = fs
      .readdirSync(directory)
      .filter((file: string) =>
        (file.endsWith('.ts') || file.endsWith('.js')) &&
        !file.endsWith('.d.ts') &&
        !file.endsWith('.map')
      );

    this.client.logger.info(`Found ${componentFiles.length} component files: ${componentFiles.join(', ')}`);

    for (const file of componentFiles) {
      try {
        const componentPath = path.join(directory, file);
        const { default: ComponentExport } = await import(componentPath);

        if (!ComponentExport) {
          this.client.logger.warn(`Component ${file} has no default export`);
          continue;
        }

        // Support both a single class and an array of classes
        const classes: (new (client: KorexClient) => Component)[] = Array.isArray(ComponentExport)
          ? ComponentExport
          : [ComponentExport];

        for (const ComponentClass of classes) {
          const component: Component = new ComponentClass(this.client);

          this.registerComponent(component);

          this.client.logger.info(`Component registered: ${component.customId}`);
        }
      } catch (error) {
        this.client.logger.error(`Error loading component ${file}:`, error);
      }
    }

    this.client.logger.info(`${this.components.size} core components loaded`);
  }
}
