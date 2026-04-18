import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { createInfoEmbed } from '../../utils/helpers';

export default class HelpCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'help',
      description: 'Muestra información de ayuda sobre los comandos',
      category: 'utility',
      aliases: ['ayuda', 'h'],
      cooldown: 5,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription(this.description)
      .addStringOption((option) =>
        option
          .setName('comando')
          .setDescription('Comando específico para obtener ayuda')
          .setRequired(false)
          .setAutocomplete(true)
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const commandName = interaction.options.getString('comando');

    if (commandName) {
      await this.showCommandHelp(interaction, commandName);
    } else {
      await this.showGeneralHelp(interaction);
    }
  }

  /**
   * Mostrar ayuda de un comando específico
   */
  private async showCommandHelp(
    interaction: ChatInputCommandInteraction,
    commandName: string
  ): Promise<void> {
    const command = this.client.commands.getCommand(commandName);

    if (!command) {
      await interaction.reply({
        content: `❌ No se encontró el comando \`${commandName}\`.`,
        ephemeral: true,
      });

      return;
    }

    const embed = createInfoEmbed(`📖 Ayuda: /${command.name}`, command.description);

    embed.addFields([
      {
        name: '📂 Categoría',
        value: command.category,
        inline: true,
      },
      {
        name: '⏱️ Cooldown',
        value: `${command.cooldown}s`,
        inline: true,
      },
      {
        name: '🔒 Solo Propietario',
        value: command.ownerOnly ? 'Sí' : 'No',
        inline: true,
      },
    ]);

    if (command.aliases.length > 0) {
      embed.addFields([
        {
          name: '🏷️ Aliases',
          value: command.aliases.map((alias) => `\`${alias}\``).join(', '),
          inline: false,
        },
      ]);
    }

    if (command.permissions.user.length > 0) {
      embed.addFields([
        {
          name: '🛡️ Permisos Requeridos',
          value: command.permissions.user.map((perm) => `\`${perm.toString()}\``).join(', '),
          inline: false,
        },
      ]);
    }

    if (command.addon) {
      embed.addFields([
        {
          name: '🧩 Addon',
          value: command.addon,
          inline: true,
        },
      ]);
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  /**
   * Mostrar ayuda general con menú de categorías
   * El manejo de interacciones del select menu está en el componente HelpCategorySelect
   */
  private async showGeneralHelp(interaction: ChatInputCommandInteraction): Promise<void> {
    const commands = this.client.commands.getEnabledCommands();
    const categories = this.groupCommandsByCategory(commands);

    // ID único para esta instancia del menú
    // El componente HelpCategorySelect captura todos los IDs que empiecen con 'help_select_'
    const menuId = `help_select_${interaction.id}`;

    const mainEmbed = new EmbedBuilder()
      .setColor(this.client.config.colors.primary)
      .setTitle('📚 Centro de Ayuda de Korex')
      .setDescription(
        `¡Hola! Soy **Korex**, tu bot de Discord profesional.\n\n` +
          `🎯 **Comandos disponibles:** ${commands.length}\n` +
          `🧩 **Addons cargados:** ${this.client.addons.getLoadedAddons().length}\n` +
          `📊 **Servidores:** ${this.client.guilds.cache.size}\n\n` +
          `Usa el menú de abajo para explorar comandos por categoría, o usa \`/help <comando>\` para ayuda específica.`
      )
      .setThumbnail(this.client.user?.displayAvatarURL() || null)
      .setFooter({
        text: `Korex v${process.env.npm_package_version || '1.0.0'} - The Core of Your Community`,
      })
      .setTimestamp();

    // Crear menú de selección de categorías
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(menuId)
      .setPlaceholder('📂 Selecciona una categoría para ver comandos')
      .addOptions(
        Object.entries(categories).map(([category, cmds]) => ({
          label: this.getCategoryDisplayName(category),
          value: category,
          description: `${cmds.length} comando${cmds.length !== 1 ? 's' : ''} disponible${cmds.length !== 1 ? 's' : ''}`,
          emoji: this.getCategoryEmoji(category),
        }))
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    await interaction.reply({
      embeds: [mainEmbed],
      components: [row],
      flags: MessageFlags.Ephemeral,
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

  /**
   * Autocomplete para comando específico
   */
  async executeAutocomplete?(interaction: any): Promise<void> {
    const focusedValue = interaction.options.getFocused();
    const commands = this.client.commands.getEnabledCommands();

    const filtered = commands
      .filter((cmd) => cmd.name.toLowerCase().includes(focusedValue.toLowerCase()))
      .slice(0, 25) // Discord limita a 25 opciones
      .map((cmd) => ({
        name: `${cmd.name} - ${cmd.description}`,
        value: cmd.name,
      }));

    await interaction.respond(filtered);
  }
}
