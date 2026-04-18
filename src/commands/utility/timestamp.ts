import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';

export default class TimestampCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'timestamp',
      description: 'Generate Discord timestamps for messages',
      category: 'utility',
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
      .setDescription('Generate Discord timestamps for messages')
      .addSubcommand(subcommand =>
        subcommand
          .setName('now')
          .setDescription('Generate timestamp for current time')
          .addStringOption(option =>
            option
              .setName('format')
              .setDescription('Timestamp format')
              .addChoices(
                { name: 'Short Time (16:20)', value: 't' },
                { name: 'Long Time (4:20:30 PM)', value: 'T' },
                { name: 'Short Date (20/04/2021)', value: 'd' },
                { name: 'Long Date (20 April 2021)', value: 'D' },
                { name: 'Short Date/Time (20 April 2021 16:20)', value: 'f' },
                { name: 'Long Date/Time (Tuesday, 20 April 2021 4:20 PM)', value: 'F' },
                { name: 'Relative Time (2 months ago)', value: 'R' }
              )
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('custom')
          .setDescription('Generate timestamp for custom date/time')
          .addStringOption(option =>
            option
              .setName('datetime')
              .setDescription('Date and time (YYYY-MM-DD HH:MM or various formats)')
              .setRequired(true)
          )
          .addStringOption(option =>
            option
              .setName('timezone')
              .setDescription('Timezone (e.g., UTC, EST, PST, +02:00)')
              .setRequired(false)
          )
          .addStringOption(option =>
            option
              .setName('format')
              .setDescription('Timestamp format')
              .addChoices(
                { name: 'Short Time (16:20)', value: 't' },
                { name: 'Long Time (4:20:30 PM)', value: 'T' },
                { name: 'Short Date (20/04/2021)', value: 'd' },
                { name: 'Long Date (20 April 2021)', value: 'D' },
                { name: 'Short Date/Time (20 April 2021 16:20)', value: 'f' },
                { name: 'Long Date/Time (Tuesday, 20 April 2021 4:20 PM)', value: 'F' },
                { name: 'Relative Time (2 months ago)', value: 'R' }
              )
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('converter')
          .setDescription('Interactive timestamp converter with all formats')
          .addStringOption(option =>
            option
              .setName('datetime')
              .setDescription('Date and time (optional, defaults to now)')
              .setRequired(false)
          )
      ) as SlashCommandBuilder;
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'now':
        await this.handleNow(interaction);
        break;
      case 'custom':
        await this.handleCustom(interaction);
        break;
      case 'converter':
        await this.handleConverter(interaction);
        break;
    }
  }

  private async handleNow(interaction: ChatInputCommandInteraction): Promise<void> {
    const format = interaction.options.getString('format') || 'f';
    const guildId = interaction.guild?.id || 'global';

    const now = Math.floor(Date.now() / 1000);
    const timestamp = `<t:${now}:${format}>`;

    const embed = new EmbedBuilder()
      .setColor(Colors.Blue)
      .setTitle(i18n.t('timestamp.now.title', guildId))
      .addFields(
        {
          name: i18n.t('timestamp.now.timestamp', guildId),
          value: `\`${timestamp}\``,
          inline: true
        },
        {
          name: i18n.t('timestamp.now.preview', guildId),
          value: timestamp,
          inline: true
        },
        {
          name: i18n.t('timestamp.now.unix', guildId),
          value: `\`${now}\``,
          inline: true
        }
      )
      .setFooter({ text: i18n.t('timestamp.now.footer', guildId) })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  private async handleCustom(interaction: ChatInputCommandInteraction): Promise<void> {
    const datetimeInput = interaction.options.getString('datetime', true);
    const timezone = interaction.options.getString('timezone');
    const format = interaction.options.getString('format') || 'f';
    const guildId = interaction.guild?.id || 'global';

    try {
      const parsedDate = this.parseDateTime(datetimeInput, timezone);
      const unixTimestamp = Math.floor(parsedDate.getTime() / 1000);
      const timestamp = `<t:${unixTimestamp}:${format}>`;

      const embed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle(i18n.t('timestamp.custom.title', guildId))
        .addFields(
          {
            name: i18n.t('timestamp.custom.input', guildId),
            value: `\`${datetimeInput}\`${timezone ? ` (${timezone})` : ''}`,
            inline: false
          },
          {
            name: i18n.t('timestamp.custom.timestamp', guildId),
            value: `\`${timestamp}\``,
            inline: true
          },
          {
            name: i18n.t('timestamp.custom.preview', guildId),
            value: timestamp,
            inline: true
          },
          {
            name: i18n.t('timestamp.custom.unix', guildId),
            value: `\`${unixTimestamp}\``,
            inline: true
          }
        )
        .setFooter({ text: i18n.t('timestamp.custom.footer', guildId) })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });

    } catch (error) {
      await interaction.reply({
        content: i18n.t('timestamp.custom.error', guildId, { 
          input: datetimeInput,
          examples: i18n.t('timestamp.custom.examples', guildId)
        }),
        ephemeral: true
      });
    }
  }

  private async handleConverter(interaction: ChatInputCommandInteraction): Promise<void> {
    const datetimeInput = interaction.options.getString('datetime');
    const guildId = interaction.guild?.id || 'global';

    let targetDate: Date;
    let inputDescription: string;

    try {
      if (datetimeInput) {
        targetDate = this.parseDateTime(datetimeInput);
        inputDescription = datetimeInput;
      } else {
        targetDate = new Date();
        inputDescription = i18n.t('timestamp.converter.now', guildId);
      }

      const unixTimestamp = Math.floor(targetDate.getTime() / 1000);

      const embed = new EmbedBuilder()
        .setColor(Colors.Purple)
        .setTitle(i18n.t('timestamp.converter.title', guildId))
        .setDescription(i18n.t('timestamp.converter.description', guildId, { input: inputDescription }))
        .addFields(
          {
            name: i18n.t('timestamp.converter.unix', guildId),
            value: `\`${unixTimestamp}\``,
            inline: false
          }
        );

      // Add all format examples
      const formats = [
        { code: 't', name: 'Short Time', example: `<t:${unixTimestamp}:t>` },
        { code: 'T', name: 'Long Time', example: `<t:${unixTimestamp}:T>` },
        { code: 'd', name: 'Short Date', example: `<t:${unixTimestamp}:d>` },
        { code: 'D', name: 'Long Date', example: `<t:${unixTimestamp}:D>` },
        { code: 'f', name: 'Short Date/Time', example: `<t:${unixTimestamp}:f>` },
        { code: 'F', name: 'Long Date/Time', example: `<t:${unixTimestamp}:F>` },
        { code: 'R', name: 'Relative Time', example: `<t:${unixTimestamp}:R>` }
      ];

      for (const format of formats) {
        embed.addFields({
          name: `${format.name} (\`${format.code}\`)`,
          value: `\`<t:${unixTimestamp}:${format.code}>\` → ${format.example}`,
          inline: false
        });
      }

      // Add interactive buttons for copying
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('timestamp_copy_format')
        .setPlaceholder(i18n.t('timestamp.converter.select_placeholder', guildId))
        .addOptions(
          formats.map(format => ({
            label: format.name,
            description: `Copy <t:${unixTimestamp}:${format.code}>`,
            value: `${unixTimestamp}:${format.code}`,
            emoji: '📋'
          }))
        );

      const copyAllButton = new ButtonBuilder()
        .setCustomId(`timestamp_copy_all_${unixTimestamp}`)
        .setLabel(i18n.t('timestamp.converter.copy_all', guildId))
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📋');

      const refreshButton = new ButtonBuilder()
        .setCustomId('timestamp_refresh')
        .setLabel(i18n.t('timestamp.converter.refresh', guildId))
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔄');

      const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
      const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(copyAllButton, refreshButton);

      await interaction.reply({
        embeds: [embed],
        components: [row1, row2],
        ephemeral: true
      });

      // Handle component interactions
      const collector = interaction.channel?.createMessageComponentCollector({
        time: 300000 // 5 minutes
      });

      collector?.on('collect', async (componentInteraction) => {
        if (componentInteraction.user.id !== interaction.user.id) {
          await componentInteraction.reply({
            content: i18n.t('common.errors.not_your_interaction', guildId),
            ephemeral: true
          });

          return;
        }

        if (componentInteraction.isStringSelectMenu()) {
          const [timestamp, format] = componentInteraction.values[0].split(':');
          const timestampCode = `<t:${timestamp}:${format}>`;
          
          await componentInteraction.reply({
            content: i18n.t('timestamp.converter.copied', guildId, { timestamp: timestampCode }),
            ephemeral: true
          });
        } else if (componentInteraction.isButton()) {
          if (componentInteraction.customId.startsWith('timestamp_copy_all_')) {
            const timestamp = componentInteraction.customId.split('_')[3];
            const allFormats = formats.map(f => `<t:${timestamp}:${f.code}>`).join('\n');
            
            await componentInteraction.reply({
              content: `${i18n.t('timestamp.converter.all_copied', guildId)}\n\`\`\`\n${allFormats}\n\`\`\``,
              ephemeral: true
            });
          } else if (componentInteraction.customId === 'timestamp_refresh') {
            // Refresh with current time
            await componentInteraction.deferUpdate();
            const newDate = new Date();
            const newUnixTimestamp = Math.floor(newDate.getTime() / 1000);
            
            // Update the embed and components with new timestamp
            const newEmbed = EmbedBuilder.from(embed)
              .setDescription(i18n.t('timestamp.converter.description', guildId, { 
                input: i18n.t('timestamp.converter.now', guildId) 
              }))
              .setFields(
                { name: i18n.t('timestamp.converter.unix', guildId), value: `\`${newUnixTimestamp}\``, inline: false },
                ...formats.map(format => ({
                  name: `${format.name} (\`${format.code}\`)`,
                  value: `\`<t:${newUnixTimestamp}:${format.code}>\` → <t:${newUnixTimestamp}:${format.code}>`,
                  inline: false
                }))
              );

            const newSelectMenu = StringSelectMenuBuilder.from(selectMenu)
              .setOptions(
                formats.map(format => ({
                  label: format.name,
                  description: `Copy <t:${newUnixTimestamp}:${format.code}>`,
                  value: `${newUnixTimestamp}:${format.code}`,
                  emoji: '📋'
                }))
              );

            const newCopyAllButton = ButtonBuilder.from(copyAllButton)
              .setCustomId(`timestamp_copy_all_${newUnixTimestamp}`);

            const newRow1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(newSelectMenu);
            const newRow2 = new ActionRowBuilder<ButtonBuilder>().addComponents(newCopyAllButton, refreshButton);

            await interaction.editReply({
              embeds: [newEmbed],
              components: [newRow1, newRow2]
            });
          }
        }
      });

      collector?.on('end', () => {
        // Disable components after timeout
        const disabledRow1 = new ActionRowBuilder<StringSelectMenuBuilder>()
          .addComponents(selectMenu.setDisabled(true));
        const disabledRow2 = new ActionRowBuilder<ButtonBuilder>()
          .addComponents(copyAllButton.setDisabled(true), refreshButton.setDisabled(true));
        
        interaction.editReply({ components: [disabledRow1, disabledRow2] }).catch(() => {});
      });

    } catch (error) {
      await interaction.reply({
        content: i18n.t('timestamp.converter.error', guildId),
        ephemeral: true
      });
    }
  }

  private parseDateTime(input: string, timezone?: string | null): Date {
    // Remove extra whitespace
    input = input.trim();

    // Try various date formats
    const formats = [
      // ISO formats
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/,
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
      /^\d{4}-\d{2}-\d{2}$/,
      // US formats
      /^\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}(:\d{2})?\s?(AM|PM)?$/i,
      /^\d{1,2}\/\d{1,2}\/\d{4}$/,
      // European formats
      /^\d{1,2}\.\d{1,2}\.\d{4} \d{1,2}:\d{2}(:\d{2})?$/,
      /^\d{1,2}\.\d{1,2}\.\d{4}$/,
      // Unix timestamp
      /^\d{10}$/
    ];

    // Handle Unix timestamp
    if (/^\d{10}$/.test(input)) {
      return new Date(parseInt(input) * 1000);
    }

    // Handle relative time expressions
    const relativeMatch = input.match(/^(\d+)\s*(minutes?|hours?|days?|weeks?|months?|years?)\s*(ago|from now)?$/i);

    if (relativeMatch) {
      const amount = parseInt(relativeMatch[1]);
      const unit = relativeMatch[2].toLowerCase();
      const direction = relativeMatch[3]?.toLowerCase() === 'ago' ? -1 : 1;

      const now = new Date();

      switch (unit.charAt(0)) {
        case 'm': // minutes
          return new Date(now.getTime() + (amount * 60 * 1000 * direction));
        case 'h': // hours
          return new Date(now.getTime() + (amount * 60 * 60 * 1000 * direction));
        case 'd': // days
          return new Date(now.getTime() + (amount * 24 * 60 * 60 * 1000 * direction));
        case 'w': // weeks
          return new Date(now.getTime() + (amount * 7 * 24 * 60 * 60 * 1000 * direction));
        case 'y': // years
          const yearDate = new Date(now);

          yearDate.setFullYear(yearDate.getFullYear() + (amount * direction));

          return yearDate;
      }
    }

    // Try to parse as standard date
    let date = new Date(input);

    // If parsing failed, try some common formats
    if (isNaN(date.getTime())) {
      // Try DD/MM/YYYY format
      const ddmmyyyy = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);

      if (ddmmyyyy) {
        const [, day, month, year, hour = '0', minute = '0', second = '0'] = ddmmyyyy;

        date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), 
                       parseInt(hour), parseInt(minute), parseInt(second));
      }
    }

    if (isNaN(date.getTime())) {
      throw new Error('Invalid date format');
    }

    // Handle timezone if provided (basic implementation)
    if (timezone) {
      // This is a simplified timezone handling
      // In a production environment, you'd want to use a proper timezone library
      const timezoneOffset = this.parseTimezone(timezone);

      if (timezoneOffset !== null) {
        date = new Date(date.getTime() - (timezoneOffset * 60 * 1000));
      }
    }

    return date;
  }

  private parseTimezone(timezone: string): number | null {
    timezone = timezone.toUpperCase();
    
    // Handle UTC offset format (+/-HH:MM or +/-HHMM)
    const offsetMatch = timezone.match(/^([+-])(\d{1,2}):?(\d{2})$/);

    if (offsetMatch) {
      const [, sign, hours, minutes] = offsetMatch;
      const totalMinutes = parseInt(hours) * 60 + parseInt(minutes);

      return sign === '+' ? totalMinutes : -totalMinutes;
    }

    // Handle common timezone abbreviations
    const timezones: Record<string, number> = {
      'UTC': 0, 'GMT': 0,
      'EST': -300, 'CST': -360, 'MST': -420, 'PST': -480,
      'EDT': -240, 'CDT': -300, 'MDT': -360, 'PDT': -420,
      'CET': 60, 'EET': 120, 'JST': 540, 'AEST': 600
    };

    return timezones[timezone] || null;
  }
}