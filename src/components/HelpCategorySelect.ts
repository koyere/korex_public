import {
  StringSelectMenuInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import { Component, ComponentInteraction } from '../client/structures/Component';
import { KorexClient } from '../client/KorexClient';
import { Command } from '../client/structures/Command';
import { chunkArray } from '../utils/helpers';

/**
 * Global component that handles the /help command's select menu
 * Uses a wildcard pattern to capture all dynamic IDs: help_select_*
 */
export default class HelpCategorySelect extends Component {
  constructor(client: KorexClient) {
    super(client, {
      customId: 'help_select_*',
      type: 'selectMenu',
      guildOnly: false,
      ephemeral: true,
    });
  }

  async execute(interaction: ComponentInteraction): Promise<void> {
    if (!interaction.isStringSelectMenu()) return;

    const selectInteraction = interaction as StringSelectMenuInteraction;

    // Acknowledge the interaction immediately
    await selectInteraction.deferUpdate();

    const selectedCategory = selectInteraction.values[0];
    const commands = this.client.commands.getEnabledCommands();
    const categories = this.groupCommandsByCategory(commands);
    const categoryCommands = categories[selectedCategory];

    if (!categoryCommands || categoryCommands.length === 0) {
      return;
    }

    // Create the category embed
    const categoryEmbed = this.createCategoryEmbed(selectedCategory, categoryCommands);

    // Rebuild the select menu with the current categories
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(selectInteraction.customId) // Keep the same ID
      .setPlaceholder('📂 Select a category to view commands')
      .addOptions(
        Object.entries(categories).map(([category, cmds]) => ({
          label: this.getCategoryDisplayName(category),
          value: category,
          description: `${cmds.length} command${cmds.length !== 1 ? 's' : ''} available`,
          emoji: this.getCategoryEmoji(category),
          default: category === selectedCategory,
        }))
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    // Update the message
    await selectInteraction.editReply({
      embeds: [categoryEmbed],
      components: [row],
    });
  }

  /**
   * Group commands by category
   */
  private groupCommandsByCategory(commands: Command[]): Record<string, Command[]> {
    const categories: Record<string, Command[]> = {};

    for (const command of commands) {
      if (!categories[command.category]) {
        categories[command.category] = [];
      }
      categories[command.category].push(command);
    }

    // Sort commands within each category
    for (const category in categories) {
      categories[category].sort((a, b) => a.name.localeCompare(b.name));
    }

    return categories;
  }

  /**
   * Create embed for a specific category
   */
  private createCategoryEmbed(category: string, commands: Command[]): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(this.client.config.colors.primary)
      .setTitle(`${this.getCategoryEmoji(category)} ${this.getCategoryDisplayName(category)}`)
      .setDescription(
        `Commands available in the **${this.getCategoryDisplayName(category)}** category:`
      )
      .setFooter({ text: 'Use /help <command> for more information about a specific command' })
      .setTimestamp();

    // Split commands into chunks to avoid the character limit
    const commandChunks = chunkArray(commands, 10);

    for (let i = 0; i < commandChunks.length && i < 3; i++) {
      const chunk = commandChunks[i];
      const commandList = chunk.map((cmd) => `\`/${cmd.name}\` - ${cmd.description}`).join('\n');

      embed.addFields([
        {
          name: i === 0 ? 'Commands' : `Commands (${i + 1})`,
          value: commandList,
          inline: false,
        },
      ]);
    }

    if (commandChunks.length > 3) {
      embed.addFields([
        {
          name: 'And more...',
          value: `There are ${commands.length - 30} more commands in this category.`,
          inline: false,
        },
      ]);
    }

    return embed;
  }

  /**
   * Get display name for a category
   */
  private getCategoryDisplayName(category: string): string {
    const names: Record<string, string> = {
      moderation: 'Moderation',
      utility: 'Utility',
      economy: 'Economy',
      levels: 'Levels',
      fun: 'Fun',
      music: 'Music',
      admin: 'Administration',
      giveaway: 'Giveaways',
      welcome: 'Welcome',
      logging: 'Logging',
      addon: 'Addons',
    };

    return names[category] || category;
  }

  /**
   * Get emoji for a category
   */
  private getCategoryEmoji(category: string): string {
    const emojis: Record<string, string> = {
      moderation: '🛡️',
      utility: '🔧',
      economy: '💰',
      levels: '⭐',
      fun: '🎮',
      music: '🎵',
      admin: '⚙️',
      giveaway: '🎁',
      welcome: '👋',
      logging: '📝',
      addon: '🧩',
    };

    return emojis[category] || '📂';
  }
}
