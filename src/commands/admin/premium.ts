import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits
} from 'discord.js';
import { Command } from '../../client/structures/Command';
import { KorexClient } from '../../client/KorexClient';
import { i18n } from '../../utils/i18n';
import { botConfig } from '../../config/bot.config';

export default class PremiumCommand extends Command {
  constructor(client: KorexClient) {
    super(client, {
      name: 'premium',
      description: 'Manage premium subscription and features',
      category: 'admin',
      cooldown: 3,
      permissions: {
        user: [PermissionFlagsBits.ManageGuild],
        bot: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]
      }
    });
  }

  data() {
    return new SlashCommandBuilder()
      .setName(this.name)
      .setDescription(i18n.t(`commands.${this.name}.description`, 'global'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand(subcommand =>
        subcommand
          .setName('info')
          .setDescription(i18n.t(`commands.${this.name}.info.description`, 'global'))
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('plans')
          .setDescription(i18n.t(`commands.${this.name}.plans.description`, 'global'))
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('activate')
          .setDescription(i18n.t(`commands.${this.name}.activate.description`, 'global'))
          .addStringOption(option =>
            option
              .setName('plan')
              .setDescription(i18n.t(`commands.${this.name}.activate.plan_option`, 'global'))
              .setRequired(true)
              .addChoices(
                { name: 'Demo (7 days free)', value: 'demo' },
                { name: 'Basic (see the panel)', value: 'basic' },
                { name: 'Pro (see the panel)', value: 'pro' }
              )
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('cancel')
          .setDescription(i18n.t(`commands.${this.name}.cancel.description`, 'global'))
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('usage')
          .setDescription(i18n.t(`commands.${this.name}.usage.description`, 'global'))
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('benefits')
          .setDescription(i18n.t(`commands.${this.name}.benefits.description`, 'global'))
      );
  }

  async executeSlash(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'info':
        await this.handleInfo(interaction, guildId);
        break;
      case 'plans':
        await this.handlePlans(interaction, guildId);
        break;
      case 'activate':
        await this.handleActivate(interaction, guildId);
        break;
      case 'cancel':
        await this.handleCancel(interaction, guildId);
        break;
      case 'usage':
        await this.handleUsage(interaction, guildId);
        break;
      case 'benefits':
        await this.handleBenefits(interaction, guildId);
        break;
    }
  }

  private async handleInfo(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    const subscription = await this.client.premiumService.getGuildSubscription(guildId);

    if (!subscription || !subscription.isActive || subscription.endDate <= new Date()) {
      // No premium subscription
      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.warning)
        .setTitle(`💎 ${i18n.t('commands.premium.info.no_premium_title', guildId)}`)
        .setDescription(i18n.t('commands.premium.info.no_premium_desc', guildId))
        .addFields({
          name: i18n.t('commands.premium.info.upgrade_benefits', guildId),
          value: this.client.premiumService.getPremiumBenefits(guildId).join('\n'),
          inline: false
        })
        .setTimestamp();

      const row = this.panelRow(guildId); // D·PAY-16: these buttons previously had no handler

      await interaction.reply({ embeds: [embed], components: [row] });

      return;
    }

    // Has premium subscription
    const plan = this.client.premiumService.getPlan(subscription.planId);
    const daysRemaining = this.client.premiumService.getDaysRemaining(subscription);

    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.success)
      .setTitle(`💎 ${i18n.t('commands.premium.info.premium_active', guildId)}`)
      .setDescription(i18n.t('commands.premium.info.premium_desc', guildId, {
        plan: plan?.name || 'Unknown',
        days: daysRemaining.toString()
      }))
      .addFields(
        {
          name: i18n.t('commands.premium.info.subscription_details', guildId),
          value: i18n.t('commands.premium.info.subscription_value', guildId, {
            plan: plan?.name || 'Unknown',
            price: plan ? this.client.premiumService.formatPrice(plan.price) : '$0.00',
            days: daysRemaining.toString()
          }),
          inline: true
        },
        {
          name: i18n.t('commands.premium.info.active_features', guildId),
          value: plan?.features.map(f => i18n.t(`premium.benefits.${f}`, guildId)).join('\n') || 'None',
          inline: false
        }
      )
      .setTimestamp();

    const row = this.panelRow(guildId); // D·PAY-16: these buttons previously had no handler

    await interaction.reply({ embeds: [embed], components: [row] });
  }

  private async handlePlans(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    // No fictitious $4.99/$9.99 plans anymore (D·PAY-16)
    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.primary)
      .setTitle(i18n.t('commands.premium.catalog.title', guildId))
      .setDescription(`${i18n.t('commands.premium.catalog.desc', guildId)}\n\n${await this.catalogText(guildId)}`)
      .setTimestamp();

    const row = this.panelRow(guildId); // D·PAY-16: these buttons previously had no handler

    await interaction.reply({ embeds: [embed], components: [row] });
  }

  private async handleActivate(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    const planId = interaction.options.getString('plan', true);

    // Check if already has premium
    const hasActive = await this.client.premiumService.hasActivePremium(guildId);

    if (hasActive) {
      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.warning)
        .setTitle(`⚠️ ${i18n.t('commands.premium.activate.already_premium', guildId)}`)
        .setDescription(i18n.t('commands.premium.activate.already_premium_desc', guildId))
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });

      return;
    }

    const plan = this.client.premiumService.getPlan(planId);

    if (!plan) {
      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.error)
        .setTitle(`❌ ${i18n.t('commands.premium.activate.invalid_plan', guildId)}`)
        .setDescription(i18n.t('commands.premium.activate.invalid_plan_desc', guildId))
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });

      return;
    }

    // Handle demo activation
    if (planId === 'demo') {
      const result = await this.client.premiumService.activatePremium(guildId, planId, interaction.user.id);
      
      if (!result.success) {
        const embed = new EmbedBuilder()
          .setColor(botConfig.colors.error)
          .setTitle('❌ Error')
          .setDescription(result.error || 'Failed to activate demo')
          .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });

        return;
      }

      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.success)
        .setTitle(`🎉 ${i18n.t('commands.premium.activate.demo_activated', guildId)}`)
        .setDescription(i18n.t('commands.premium.activate.demo_desc', guildId))
        .addFields({
          name: i18n.t('commands.premium.activate.trial_details', guildId),
          value: i18n.t('commands.premium.activate.trial_value', guildId, {
            days: plan.duration.toString(),
            features: plan.features.map(f => i18n.t(`premium.benefits.${f}`, guildId)).join('\n• ')
          }),
          inline: false
        })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      return;
    }

    // Handle paid plan activation
    void plan;
    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.info)
      .setTitle(i18n.t('commands.premium.catalog.buy_title', guildId))
      .setDescription(`${i18n.t('commands.premium.catalog.buy_desc', guildId)}\n\n${await this.catalogText(guildId)}`)
      .setTimestamp();

    const row = this.panelRow(guildId); // D·PAY-16: these buttons previously had no handler

    await interaction.reply({ embeds: [embed], components: [row] });
  }

  private async handleCancel(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    const subscription = await this.client.premiumService.getGuildSubscription(guildId);

    if (!subscription || !subscription.isActive) {
      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.warning)
        .setTitle(`⚠️ ${i18n.t('commands.premium.cancel.no_premium', guildId)}`)
        .setDescription(i18n.t('commands.premium.cancel.no_premium_desc', guildId))
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });

      return;
    }

    const plan = this.client.premiumService.getPlan(subscription.planId);
    const endDate = subscription.endDate.toLocaleDateString();

    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.warning)
      .setTitle(`⚠️ ${i18n.t('commands.premium.cancel.confirm_title', guildId)}`)
      .setDescription(i18n.t('commands.premium.cancel.confirm_desc', guildId, {
        plan: plan?.name || 'Unknown',
        endDate
      }))
      .addFields({
        name: i18n.t('commands.premium.cancel.what_happens', guildId),
        value: i18n.t('commands.premium.cancel.what_happens_value', guildId),
        inline: false
      }, {
        name: '\u200b',
        value: i18n.t('commands.premium.catalog.manage_desc', guildId),
        inline: false
      })
      .setTimestamp();

    const row = this.panelRow(guildId); // D·PAY-16: these buttons previously had no handler

    await interaction.reply({ embeds: [embed], components: [row] });
  }

  private async handleUsage(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    const stats = await this.client.premiumService.getUsageStats(guildId);

    if (!stats.subscription || !stats.plan) {
      const embed = new EmbedBuilder()
        .setColor(botConfig.colors.warning)
        .setTitle(`⚠️ ${i18n.t('commands.premium.usage.no_premium', guildId)}`)
        .setDescription(i18n.t('commands.premium.usage.no_premium_desc', guildId))
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });

      return;
    }

    const resetDate = new Date().toLocaleDateString();

    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.primary)
      .setTitle(`📊 ${i18n.t('commands.premium.usage.title', guildId)}`)
      .setDescription(i18n.t('commands.premium.usage.usage_description', guildId, {
        plan: stats.plan.name,
        resetDate
      }))
      .addFields(
        {
          name: i18n.t('commands.premium.usage.auto_responses', guildId),
          value: this.formatUsage(stats.usage.autoResponses, guildId),
          inline: true
        },
        {
          name: i18n.t('commands.premium.usage.giveaways', guildId),
          value: this.formatUsage(stats.usage.giveaways, guildId),
          inline: true
        },
        {
          name: i18n.t('commands.premium.usage.polls', guildId),
          value: this.formatUsage(stats.usage.polls, guildId),
          inline: true
        }
      )
      .addFields({
        name: i18n.t('commands.premium.usage.premium_features', guildId),
        value: [
          i18n.t('commands.premium.usage.advanced_analytics', guildId),
          i18n.t('commands.premium.usage.priority_support', guildId),
          i18n.t('commands.premium.usage.custom_branding', guildId)
        ].join('\n'),
        inline: false
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  private async handleBenefits(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    const benefits = this.client.premiumService.getPremiumBenefits(guildId);

    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.primary)
      .setTitle(`💎 ${i18n.t('commands.premium.benefits.title', guildId)}`)
      .setDescription(i18n.t('commands.premium.benefits.benefits_description', guildId))
      .addFields(
        {
          name: i18n.t('commands.premium.benefits.all_benefits', guildId),
          value: benefits.join('\n'),
          inline: false
        },
        {
          name: i18n.t('commands.premium.benefits.plan_comparison', guildId),
          value: await this.catalogText(guildId), // D·PAY-16
          inline: false
        }
      )
      .setTimestamp();

    const row = this.panelRow(guildId); // D·PAY-16: these buttons previously had no handler

    await interaction.reply({ embeds: [embed], components: [row] });
  }

  /** Link button to the server's add-ons page in the panel (D·PAY-16) */
  private panelRow(guildId: string): ActionRowBuilder<ButtonBuilder> {
    const url = `${process.env.PANEL_URL || 'https://panel.korex.dev'}/dashboard/${guildId}/addons`;
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setURL(url)
        .setLabel(i18n.t('commands.premium.catalog.open_panel', guildId))
        .setEmoji('💎'),
    );
  }

  /** Paid add-ons are only sold on the hosted Korex; no fictitious plans or prices (D·PAY-16) */
  private async catalogText(guildId: string): Promise<string> {
    return i18n.t('commands.premium.catalog.hosted', guildId);
  }

  private formatUsage(usage: { used: number; limit: number; percentage: number }, guildId: string): string {
    if (usage.limit === -1) {
      return i18n.t('commands.premium.usage.unlimited', guildId, { used: usage.used.toString() });
    }

    return i18n.t('commands.premium.usage.usage_format', guildId, {
      used: usage.used.toString(),
      limit: usage.limit.toString(),
      percentage: usage.percentage.toString()
    });
  }
}