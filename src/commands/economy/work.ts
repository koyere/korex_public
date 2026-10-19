import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, Colors } from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class WorkCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'work',
      description: 'Work to earn money with random jobs',
      category: 'economy',
      cooldown: 5,
      guildOnly: true,
      addon: 'economy',
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('work')
      .setDescription('Work to earn money with random jobs');
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const guildId = interaction.guild!.id;
      const userId = interaction.user.id;

      const result = await this.client.economy.work(guildId, userId);

      if (!result.success) {
        await interaction.reply({
          content: result.message,
          ephemeral: true,
        });

        return;
      }

      // Get a random job and custom message
      const workData = this.getRandomWork(guildId);
      const config = await this.client.economy.getConfig(guildId);
      
      const earned = result.amount ?? 0;
      const symbol = config.currencySymbol;
      const t = (key: string, vars?: Record<string, string>) => i18n.t(key, guildId, vars);

      const embed = new EmbedBuilder()
        .setTitle(t('work.result.title'))
        .setColor(Colors.Green)
        .setDescription(`**${workData.emoji} ${workData.job}**\n${workData.description}\n\n${t('work.result.earned', { amount: `${earned} ${symbol}` })}`)
        .addFields(
          {
            name: t('work.result.earnings'),
            value: `+${earned} ${symbol}`,
            inline: true,
          },
          {
            name: t('work.result.new_balance'),
            value: `${result.newBalance} ${symbol}`,
            inline: true,
          },
          {
            name: t('work.result.next'),
            value: `<t:${Math.floor((Date.now() + config.workCooldown * 1000) / 1000)}:R>`,
            inline: true,
          }
        )
        .setFooter({
          text: t('work.result.footer'),
          iconURL: interaction.user.displayAvatarURL(),
        })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      await this.client.errorHandler.handleCommandError(error as Error, interaction, {
        command: 'work',
      });
    }
  }

  private getRandomWork(guildId: string): { job: string; description: string; emoji: string } {
    const works = [
      {
        job: i18n.t('work.jobs.programmer.name', guildId),
        description: i18n.t('work.jobs.programmer.desc', guildId),
        emoji: '💻'
      },
      {
        job: i18n.t('work.jobs.delivery.name', guildId),
        description: i18n.t('work.jobs.delivery.desc', guildId),
        emoji: '🚚'
      },
      {
        job: i18n.t('work.jobs.chef.name', guildId),
        description: i18n.t('work.jobs.chef.desc', guildId),
        emoji: '👨‍🍳'
      },
      {
        job: i18n.t('work.jobs.streamer.name', guildId),
        description: i18n.t('work.jobs.streamer.desc', guildId),
        emoji: '🎮'
      },
      {
        job: i18n.t('work.jobs.designer.name', guildId),
        description: i18n.t('work.jobs.designer.desc', guildId),
        emoji: '🎨'
      },
      {
        job: i18n.t('work.jobs.teacher.name', guildId),
        description: i18n.t('work.jobs.teacher.desc', guildId),
        emoji: '👨‍🏫'
      },
      {
        job: i18n.t('work.jobs.mechanic.name', guildId),
        description: i18n.t('work.jobs.mechanic.desc', guildId),
        emoji: '🔧'
      },
      {
        job: i18n.t('work.jobs.doctor.name', guildId),
        description: i18n.t('work.jobs.doctor.desc', guildId),
        emoji: '👨‍⚕️'
      },
      {
        job: i18n.t('work.jobs.musician.name', guildId),
        description: i18n.t('work.jobs.musician.desc', guildId),
        emoji: '🎵'
      },
      {
        job: i18n.t('work.jobs.photographer.name', guildId),
        description: i18n.t('work.jobs.photographer.desc', guildId),
        emoji: '📸'
      },
      {
        job: i18n.t('work.jobs.barista.name', guildId),
        description: i18n.t('work.jobs.barista.desc', guildId),
        emoji: '☕'
      },
      {
        job: i18n.t('work.jobs.gardener.name', guildId),
        description: i18n.t('work.jobs.gardener.desc', guildId),
        emoji: '🌱'
      },
      {
        job: i18n.t('work.jobs.writer.name', guildId),
        description: i18n.t('work.jobs.writer.desc', guildId),
        emoji: '✍️'
      },
      {
        job: i18n.t('work.jobs.cleaner.name', guildId),
        description: i18n.t('work.jobs.cleaner.desc', guildId),
        emoji: '🧹'
      },
      {
        job: i18n.t('work.jobs.security.name', guildId),
        description: i18n.t('work.jobs.security.desc', guildId),
        emoji: '🛡️'
      }
    ];

    return works[Math.floor(Math.random() * works.length)];
  }
}
