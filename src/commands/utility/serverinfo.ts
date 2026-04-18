import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
  Guild,
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class ServerInfoCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'serverinfo',
      description: 'Shows server information',
      category: 'utility',
      cooldown: 5,
      guildOnly: true,
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName('serverinfo')
      .setDescription('Shows server information');
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const guild = interaction.guild!;
      const guildId = guild.id;
      const lang = i18n.getGuildLanguage(guildId);

      const owner = await guild.fetchOwner();
      const channels = guild.channels.cache;
      const roles = guild.roles.cache;
      const emojis = guild.emojis.cache;

      const embed = new EmbedBuilder()
        .setTitle(i18n.t('serverinfo.title', lang, { name: guild.name }))
        .setColor(Colors.Blue)
        .setThumbnail(guild.iconURL() || null)
        .addFields(
          {
            name: i18n.t('serverinfo.owner', lang),
            value: owner.user.tag,
            inline: true,
          },
          {
            name: i18n.t('serverinfo.created', lang),
            value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`,
            inline: true,
          },
          {
            name: i18n.t('serverinfo.members', lang),
            value: guild.memberCount.toString(),
            inline: true,
          },
          {
            name: i18n.t('serverinfo.channels', lang),
            value: `${channels.filter((c) => c.type === 0).size} Text\n${channels.filter((c) => c.type === 2).size} Voice`,
            inline: true,
          },
          {
            name: i18n.t('serverinfo.roles', lang),
            value: roles.size.toString(),
            inline: true,
          },
          {
            name: i18n.t('serverinfo.emojis', lang),
            value: emojis.size.toString(),
            inline: true,
          },
          {
            name: i18n.t('serverinfo.boost_level', lang),
            value: `Level ${guild.premiumTier}`,
            inline: true,
          },
          {
            name: i18n.t('serverinfo.boosts', lang),
            value: guild.premiumSubscriptionCount?.toString() || '0',
            inline: true,
          },
          {
            name: i18n.t('serverinfo.verification', lang),
            value: this.getVerificationLevel(guild.verificationLevel),
            inline: true,
          }
        );

      if (guild.description) {
        embed.setDescription(guild.description);
      }

      if (guild.bannerURL()) {
        embed.setImage(guild.bannerURL()!);
      }

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      await this.client.errorHandler.handleCommandError(error as Error, interaction, {
        command: 'serverinfo',
      });
    }
  }

  private getVerificationLevel(level: number): string {
    const levels = ['None', 'Low', 'Medium', 'High', 'Very High'];

    return levels[level] || 'Unknown';
  }
}
