import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, Colors } from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class RankCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'rank',
      description: "Shows your rank or another user's rank",
      category: 'levels',
      cooldown: 3,
      guildOnly: true,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName(i18n.t('levels.rank.name', 'global'))
      .setDescription(i18n.t('levels.rank.description', 'global'))
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription(i18n.t('levels.rank.user_option', 'global'))
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const guildId = interaction.guild!.id;
      const lang = i18n.getGuildLanguage(guildId);

      const levelUser = await this.client.levels.getUser(guildId, targetUser.id);
      const nextLevelXp = this.client.levels.getXpForLevel(levelUser.level + 1);
      const currentLevelXp = this.client.levels.getXpForLevel(levelUser.level);
      const progressXp = Math.max(0, levelUser.totalXp - currentLevelXp);
      const neededXp = nextLevelXp - currentLevelXp;
      const progressPercent = Math.max(0, Math.min(100, Math.floor((progressXp / neededXp) * 100)));

      const embed = new EmbedBuilder()
        .setTitle(i18n.t('levels.rank.title', lang, { user: targetUser.username }))
        .setColor(Colors.Blue)
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
          {
            name: i18n.t('levels.rank.level', lang),
            value: levelUser.level.toString(),
            inline: true,
          },
          {
            name: i18n.t('levels.rank.xp', lang),
            value: `${levelUser.xp.toLocaleString()} XP`,
            inline: true,
          },
          {
            name: i18n.t('levels.rank.messages', lang),
            value: levelUser.messages.toString(),
            inline: true,
          },
          {
            name: i18n.t('levels.rank.xp_progress', lang),
            value: `${progressXp.toLocaleString()}/${neededXp.toLocaleString()} XP (${progressPercent}%)`,
            inline: false,
          }
        );

      // Progress bar
      const progressBar = this.createProgressBar(progressPercent);

      embed.setDescription(progressBar);

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      await this.client.errorHandler.handleCommandError(error as Error, interaction, {
        command: 'rank',
      });
    }
  }

  private createProgressBar(percent: number): string {
    // Ensure percent is between 0 and 100
    const safePercent = Math.max(0, Math.min(100, percent));
    const totalBars = 20;
    const filledBars = Math.floor((safePercent / 100) * totalBars);
    const emptyBars = Math.max(0, totalBars - filledBars);

    return `${'█'.repeat(filledBars) + '░'.repeat(emptyBars)} ${safePercent}%`;
  }
}
