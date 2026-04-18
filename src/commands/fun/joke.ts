import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { botConfig } from '../../config/bot.config';

const CATEGORIES = ['programming', 'dad', 'puns', 'random'] as const;
type JokeCategory = typeof CATEGORIES[number];

export default class JokeCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'joke',
      description: 'Get a random joke',
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
      .setDescription(i18n.t('fun.joke.description', 'global'))
      .addStringOption(option =>
        option
          .setName('category')
          .setDescription('Joke category')
          .setRequired(false)
          .addChoices(
            { name: 'Programming', value: 'programming' },
            { name: 'Dad Jokes', value: 'dad' },
            { name: 'Puns', value: 'puns' },
            { name: 'Random', value: 'random' }
          )
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const category = (interaction.options.getString('category') || 'random') as JokeCategory;

    const jokes = this.getJokes(guildId, category);
    const randomJoke = jokes[Math.floor(Math.random() * jokes.length)];

    const categoryLabel = i18n.t(`fun.joke.categories.${category}`, guildId);

    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.primary)
      .setTitle(i18n.t('fun.joke.title', guildId))
      .setDescription(randomJoke)
      .addFields({ name: categoryLabel, value: '\u200b', inline: true })
      .setFooter({
        text: i18n.t('fun.joke.footer', guildId, { user: interaction.user.username }),
        iconURL: interaction.user.displayAvatarURL()
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  private getJokes(guildId: string, category: JokeCategory): string[] {
    if (category === 'random') {
      return [
        ...i18n.getList('fun.joke.programming', guildId),
        ...i18n.getList('fun.joke.dad', guildId),
        ...i18n.getList('fun.joke.puns', guildId)
      ];
    }

    return i18n.getList(`fun.joke.${category}`, guildId);
  }
}
