import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class LanguageCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'language',
      description: 'Change server language',
      category: 'admin',
      permissions: {
        user: [PermissionFlagsBits.ManageGuild],
      },
      cooldown: 5,
      guildOnly: true,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('language')
      .setDescription('Change server language')
      .addStringOption((option) =>
        option
          .setName('lang')
          .setDescription('Language to set')
          .setRequired(false)
          .addChoices({ name: 'English', value: 'en' }, { name: 'Español', value: 'es' })
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const newLanguage = interaction.options.getString('lang');
      const guildId = interaction.guild!.id;
      const currentLanguage = i18n.getGuildLanguage(guildId);

      if (!newLanguage) {
        // Show current language and available languages
        const availableLanguages = i18n.getAvailableLanguages();

        const embed = new EmbedBuilder()
          .setColor(Colors.Blurple)
          .setTitle('🌍 Server Language Settings')
          .addFields(
            {
              name: 'Current Language',
              value: this.getLanguageName(currentLanguage),
              inline: true,
            },
            {
              name: 'Available Languages',
              value: availableLanguages.map((lang) => this.getLanguageName(lang)).join('\n'),
              inline: true,
            }
          )
          .setDescription('Use `/language <lang>` to change the server language.')
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        return;
      }

      if (!i18n.hasLanguage(newLanguage)) {
        await interaction.reply({
          content: `❌ Language \`${newLanguage}\` is not available.`,
          ephemeral: true,
        });

        return;
      }

      // Set new language
      i18n.setGuildLanguage(guildId, newLanguage);

      // Save to database
      try {
        await this.client.db.guildConfig.upsert({
          where: { guildId },
          update: { language: newLanguage },
          create: {
            guildId,
            language: newLanguage,
            autoModEnabled: false,
            maxWarnings: 3,
            warningExpireDays: 30,
            autoActions: [],
          },
        });
      } catch (error) {
        this.client.logger.error('Error saving language to database:', error);
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle('✅ Language Changed')
        .setDescription(
          `Server language has been changed to **${this.getLanguageName(newLanguage)}**.`
        )
        .addFields({
          name: 'Note',
          value: 'All bot responses will now be in the selected language.',
          inline: false,
        })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      this.client.logger.info(
        `Language changed to ${newLanguage} in guild ${interaction.guild!.name} by ${interaction.user.tag}`
      );
    } catch (error) {
      await this.client.errorHandler.handleCommandError(error as Error, interaction, {
        command: 'language',
      });
    }
  }

  private getLanguageName(code: string): string {
    const names: Record<string, string> = {
      en: '🇺🇸 English',
      es: '🇪🇸 Español',
    };

    return names[code] || code;
  }
}
