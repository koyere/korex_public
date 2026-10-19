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
import { i18n } from '../../utils/i18n';

export default class HelpCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'help',
      description: i18n.t('commands.help.description', 'en'),
      category: 'utility',
      aliases: ['h'],
      cooldown: 5,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription(i18n.t('commands.help.description', 'en'))
      .setDescriptionLocalizations({
        'es-ES': i18n.t('commands.help.description', 'es'),
        'es-419': i18n.t('commands.help.description', 'es'),
      })
      .addStringOption((option) =>
        option
          .setName('command')
          .setDescription('Specific command to get help for')
          .setDescriptionLocalizations({
            'es-ES': 'Comando específico para obtener ayuda',
            'es-419': 'Comando específico para obtener ayuda',
          })
          .setRequired(false)
          .setAutocomplete(true)
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const lang = i18n.getGuildLanguage(interaction.guildId!);
    const commandName = interaction.options.getString('command');

    if (commandName) {
      await this.showCommandHelp(interaction, commandName, lang);
    } else {
      await this.showGeneralHelp(interaction, lang);
    }
  }

  private async showCommandHelp(
    interaction: ChatInputCommandInteraction,
    commandName: string,
    lang: string
  ): Promise<void> {
    const command = this.client.commands.getCommand(commandName);

    if (!command) {
      await interaction.reply({
        content: i18n.t('commands.help.not_found', lang, { name: commandName }),
        ephemeral: true,
      });
      return;
    }

    const cmdDesc = i18n.t(`commands.${command.name}.description`, lang) || command.description;
    const embed = createInfoEmbed(`📖 /${command.name}`, cmdDesc);

    embed.addFields([
      { name: i18n.t('commands.help.category', lang), value: this.getCategoryLabel(command.category, lang), inline: true },
      { name: i18n.t('commands.help.cooldown', lang, { seconds: String(command.cooldown) }), value: '​', inline: true },
      { name: i18n.t('commands.help.owner_only', lang), value: command.ownerOnly ? i18n.t('commands.help.yes', lang) : i18n.t('commands.help.no', lang), inline: true },
    ]);

    if (command.aliases.length > 0) {
      embed.addFields([{
        name: i18n.t('commands.help.aliases', lang),
        value: command.aliases.map((a) => `\`${a}\``).join(', '),
        inline: false,
      }]);
    }

    if (command.permissions.user.length > 0) {
      embed.addFields([{
        name: i18n.t('commands.help.permissions', lang),
        value: command.permissions.user.map((p) => `\`${p.toString()}\``).join(', '),
        inline: false,
      }]);
    }

    if (command.addon) {
      embed.addFields([{ name: i18n.t('commands.help.addon', lang), value: command.addon, inline: true }]);
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  private async showGeneralHelp(interaction: ChatInputCommandInteraction, lang: string): Promise<void> {
    const commands = this.client.commands.getEnabledCommands();
    const categories = this.groupCommandsByCategory(commands);
    const version = process.env.npm_package_version || '1.0.0';
    const menuId = `help_select_${interaction.id}`;

    const mainEmbed = new EmbedBuilder()
      .setColor(this.client.config.colors.primary)
      .setTitle(i18n.t('commands.help.title', lang))
      .setDescription(
        `${i18n.t('commands.help.commands_count', lang, { count: String(commands.length) })}\n` +
        `${i18n.t('commands.help.addons_count', lang, { count: String(this.client.addons.getLoadedAddons().length) })}\n` +
        `${i18n.t('commands.help.servers_count', lang, { count: String(this.client.guilds.cache.size) })}\n\n` +
        i18n.t('commands.help.intro', lang)
      )
      .setThumbnail(this.client.user?.displayAvatarURL() || null)
      .setFooter({ text: i18n.t('commands.help.footer', lang, { version }) })
      .setTimestamp();

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(menuId)
      .setPlaceholder(i18n.t('commands.help.select_category', lang))
      .addOptions(
        Object.entries(categories).map(([category, cmds]) => ({
          label: this.getCategoryLabel(category, lang),
          value: category,
          description: i18n.t('commands.help.cmd_count', lang, { count: String(cmds.length) }),
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

  private groupCommandsByCategory(commands: Command[]): Record<string, Command[]> {
    const categories: Record<string, Command[]> = {};
    for (const command of commands) {
      if (!categories[command.category]) categories[command.category] = [];
      categories[command.category].push(command);
    }
    for (const category in categories) {
      categories[category].sort((a, b) => a.name.localeCompare(b.name));
    }
    return categories;
  }

  private getCategoryLabel(category: string, lang: string): string {
    return i18n.t(`commands.help.cat_${category}`, lang) || category;
  }

  private getCategoryEmoji(category: string): string {
    const emojis: Record<string, string> = {
      moderation: '🛡️',
      utility: '🔧',
      economy: '💰',
      levels: '⭐',
      fun: '🎮',
      music: '🎵',
      admin: '⚙️',
      giveaways: '🎁',
      polls: '📊',
      welcome: '👋',
      logging: '📝',
      addon: '🧩',
    };
    return emojis[category] || '📂';
  }

  async executeAutocomplete?(interaction: any): Promise<void> {
    const focusedValue = interaction.options.getFocused();
    const commands = this.client.commands.getEnabledCommands();

    const filtered = commands
      .filter((cmd) => cmd.name.toLowerCase().includes(focusedValue.toLowerCase()))
      .slice(0, 25)
      .map((cmd) => ({
        name: `${cmd.name} - ${cmd.description}`,
        value: cmd.name,
      }));

    await interaction.respond(filtered);
  }
}
