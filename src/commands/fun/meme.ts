import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { botConfig } from '../../config/bot.config';

export default class MemeCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'meme',
      description: 'Get a random meme',
      category: 'fun',
      cooldown: 5,
      permissions: {
        user: [],
        bot: []
      }
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription(i18n.t(`commands.${this.name}.description`, 'global'));
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;

    await interaction.deferReply();

    // Attempt up to 3 times to get a SFW image post
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch('https://meme-api.com/gimme/memes', {
          headers: { 'User-Agent': 'KorexBot/1.0' }
        });

        if (!response.ok) throw new Error(`API error: ${response.status}`);

        const data = await response.json() as {
          url: string;
          title: string;
          ups: number;
          subreddit: string;
          nsfw: boolean;
          spoiler: boolean;
        };

        if (!data?.url) throw new Error('No URL in response');

        // Skip NSFW or spoiler posts and retry
        if (data.nsfw || data.spoiler) continue;

        const embed = new EmbedBuilder()
          .setColor(botConfig.colors.primary)
          .setTitle(`😂 ${data.title || i18n.t('fun.meme.title', guildId)}`)
          .setImage(data.url)
          .setFooter({
            text: i18n.t('fun.meme.footer', guildId, {
              upvotes: String(data.ups ?? 0),
              subreddit: data.subreddit ?? 'memes'
            })
          })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        return;

      } catch {
        if (attempt === 2) {
          // All attempts failed — show a clean error message
          const embed = new EmbedBuilder()
            .setColor(botConfig.colors.error ?? '#ff0000')
            .setTitle(i18n.t('fun.meme.title', guildId))
            .setDescription(i18n.t('fun.meme.error', guildId))
            .setTimestamp();

          await interaction.editReply({ embeds: [embed] });
        }
      }
    }
  }
}