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
 * Componente global para manejar el select menu del comando /help
 * Usa patrón wildcard para capturar todos los IDs dinámicos: help_select_*
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

    // Reconocer la interacción inmediatamente
    await selectInteraction.deferUpdate();

    const selectedCategory = selectInteraction.values[0];
    const commands = this.client.commands.getEnabledCommands();
    const categories = this.groupCommandsByCategory(commands);
    const categoryCommands = categories[selectedCategory];

    if (!categoryCommands || categoryCommands.length === 0) {
      return;
    }

    // Crear embed de la categoría
    const categoryEmbed = this.createCategoryEmbed(selectedCategory, categoryCommands);

    // Reconstruir el select menu con las categorías actuales
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(selectInteraction.customId) // Mantener el mismo ID
      .setPlaceholder('📂 Selecciona una categoría para ver comandos')
      .addOptions(
        Object.entries(categories).map(([category, cmds]) => ({
          label: this.getCategoryDisplayName(category),
          value: category,
          description: `${cmds.length} comando${cmds.length !== 1 ? 's' : ''} disponible${cmds.length !== 1 ? 's' : ''}`,
          emoji: this.getCategoryEmoji(category),
          default: category === selectedCategory,
        }))
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    // Actualizar el mensaje
    await selectInteraction.editReply({
      embeds: [categoryEmbed],
      components: [row],
    });
  }

  /**
   * Agrupar comandos por categoría
   */
  private groupCommandsByCategory(commands: Command[]): Record<string, Command[]> {
    const categories: Record<string, Command[]> = {};

    for (const command of commands) {
      if (!categories[command.category]) {
        categories[command.category] = [];
      }
      categories[command.category].push(command);
    }

    // Ordenar comandos dentro de cada categoría
    for (const category in categories) {
      categories[category].sort((a, b) => a.name.localeCompare(b.name));
    }

    return categories;
  }

  /**
   * Crear embed para una categoría específica
   */
  private createCategoryEmbed(category: string, commands: Command[]): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(this.client.config.colors.primary)
      .setTitle(`${this.getCategoryEmoji(category)} ${this.getCategoryDisplayName(category)}`)
      .setDescription(
        `Comandos disponibles en la categoría **${this.getCategoryDisplayName(category)}**:`
      )
      .setFooter({ text: 'Usa /help <comando> para más información sobre un comando específico' })
      .setTimestamp();

    // Dividir comandos en chunks para evitar límite de caracteres
    const commandChunks = chunkArray(commands, 10);

    for (let i = 0; i < commandChunks.length && i < 3; i++) {
      const chunk = commandChunks[i];
      const commandList = chunk.map((cmd) => `\`/${cmd.name}\` - ${cmd.description}`).join('\n');

      embed.addFields([
        {
          name: i === 0 ? 'Comandos' : `Comandos (${i + 1})`,
          value: commandList,
          inline: false,
        },
      ]);
    }

    if (commandChunks.length > 3) {
      embed.addFields([
        {
          name: 'Y más...',
          value: `Hay ${commands.length - 30} comandos adicionales en esta categoría.`,
          inline: false,
        },
      ]);
    }

    return embed;
  }

  /**
   * Obtener nombre de display para categoría
   */
  private getCategoryDisplayName(category: string): string {
    const names: Record<string, string> = {
      moderation: 'Moderación',
      utility: 'Utilidades',
      economy: 'Economía',
      levels: 'Niveles',
      fun: 'Diversión',
      music: 'Música',
      admin: 'Administración',
      giveaway: 'Sorteos',
      welcome: 'Bienvenida',
      logging: 'Registros',
      addon: 'Addons',
    };

    return names[category] || category;
  }

  /**
   * Obtener emoji para categoría
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
