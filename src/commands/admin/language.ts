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
        const t = (key: string) => i18n.t(key, currentLanguage);

        const embed = new EmbedBuilder()
          .setColor(Colors.Blurple)
          .setTitle(t('language_cmd.title'))
          .addFields(
            { name: t('language_cmd.current'), value: this.getLanguageName(currentLanguage), inline: true },
            { name: t('language_cmd.available'), value: availableLanguages.map((lang) => this.getLanguageName(lang)).join('\n'), inline: true }
          )
          .setDescription(t('language_cmd.usage'))
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        return;
      }

      if (!i18n.hasLanguage(newLanguage)) {
        await interaction.reply({
          content: i18n.t('language_cmd.unavailable', currentLanguage, { lang: newLanguage }),
          ephemeral: true,
        });

        return;
      }

      // Save to guilds.language: read by the dashboard (Settings) and by the startup load
      await this.client.db.guild.upsert({
        where: { id: guildId },
        update: { language: newLanguage },
        create: { id: guildId, language: newLanguage },
      });
      i18n.setGuildLanguage(guildId, newLanguage);

      const embed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle(i18n.t('language_cmd.changed_title', newLanguage))
        .setDescription(i18n.t('language_cmd.changed_description', newLanguage, { language: this.getLanguageName(newLanguage) }))
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
