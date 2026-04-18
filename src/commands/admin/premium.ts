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
                { name: 'Basic ($4.99/month)', value: 'basic' },
                { name: 'Pro ($9.99/month)', value: 'pro' }
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

      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('premium_view_plans')
            .setLabel(i18n.t('commands.premium.info.view_plans', guildId))
            .setStyle(ButtonStyle.Primary)
            .setEmoji('💎'),
          new ButtonBuilder()
            .setCustomId('premium_try_demo')
            .setLabel(i18n.t('commands.premium.info.try_demo', guildId))
            .setStyle(ButtonStyle.Success)
            .setEmoji('🆓')
        );

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

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('premium_view_usage')
          .setLabel(i18n.t('commands.premium.info.view_usage', guildId))
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📊'),
        new ButtonBuilder()
          .setCustomId('premium_manage')
          .setLabel(i18n.t('commands.premium.info.manage_subscription', guildId))
          .setStyle(ButtonStyle.Danger)
          .setEmoji('⚙️')
      );

    await interaction.reply({ embeds: [embed], components: [row] });
  }

  private async handlePlans(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    const plans = this.client.premiumService.getAvailablePlans();

    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.primary)
      .setTitle(`💎 ${i18n.t('commands.premium.plans.title', guildId)}`)
      .setDescription(i18n.t('commands.premium.plans.plans_description', guildId))
      .setTimestamp();

    // Add plan fields
    for (const plan of plans) {
      const priceText = plan.price === 0 ? 'FREE' : `${this.client.premiumService.formatPrice(plan.price)}/month`;
      const featuresText = plan.features.map(f => i18n.t(`premium.benefits.${f}`, guildId)).join('\n');
      
      embed.addFields({
        name: `${plan.name} - ${priceText}`,
        value: `${i18n.t('commands.premium.plans.duration', guildId, { days: plan.duration.toString() })}\n\n${featuresText}`,
        inline: true
      });
    }

    embed.addFields({
      name: i18n.t('commands.premium.plans.comparison', guildId),
      value: i18n.t('commands.premium.plans.comparison_value', guildId),
      inline: false
    });

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('premium_activate_demo')
          .setLabel('Demo (Free)')
          .setStyle(ButtonStyle.Success)
          .setEmoji('🆓'),
        new ButtonBuilder()
          .setCustomId('premium_activate_basic')
          .setLabel('Basic ($4.99)')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('💎'),
        new ButtonBuilder()
          .setCustomId('premium_activate_pro')
          .setLabel('Pro ($9.99)')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('👑')
      );

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
    const embed = new EmbedBuilder()
      .setColor(botConfig.colors.info)
      .setTitle(`💳 ${i18n.t('commands.premium.activate.payment_info', guildId)}`)
      .setDescription(i18n.t('commands.premium.activate.payment_desc', guildId, {
        plan: plan.name,
        price: this.client.premiumService.formatPrice(plan.price)
      }))
      .addFields(
        {
          name: i18n.t('commands.premium.activate.plan_features', guildId),
          value: plan.features.map(f => i18n.t(`premium.benefits.${f}`, guildId)).join('\n'),
          inline: false
        },
        {
          name: i18n.t('commands.premium.activate.payment_methods', guildId),
          value: i18n.t('commands.premium.activate.payment_methods_value', guildId),
          inline: false
        },
        {
          name: i18n.t('commands.premium.activate.contact_info', guildId),
          value: i18n.t('commands.premium.activate.contact_value', guildId),
          inline: false
        }
      )
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('premium_contact_support')
          .setLabel(i18n.t('commands.premium.activate.contact_support', guildId))
          .setStyle(ButtonStyle.Primary)
          .setEmoji('📞'),
        new ButtonBuilder()
          .setCustomId('premium_manual_activate')
          .setLabel(i18n.t('commands.premium.activate.manual_activate', guildId))
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('⚙️')
      );

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
      })
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('premium_confirm_cancel')
          .setLabel(i18n.t('commands.premium.cancel.confirm_button', guildId))
          .setStyle(ButtonStyle.Danger)
          .setEmoji('❌'),
        new ButtonBuilder()
          .setCustomId('premium_keep_subscription')
          .setLabel(i18n.t('commands.premium.cancel.keep_button', guildId))
          .setStyle(ButtonStyle.Success)
          .setEmoji('💎')
      );

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
    const plans = this.client.premiumService.getAvailablePlans();
    const basicPlan = plans.find(p => p.id === 'basic');
    const proPlan = plans.find(p => p.id === 'pro');

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
          value: i18n.t('commands.premium.benefits.comparison_value', guildId, {
            basic: basicPlan?.name || 'Basic',
            basicPrice: basicPlan ? this.client.premiumService.formatPrice(basicPlan.price) : '$4.99',
            pro: proPlan?.name || 'Pro',
            proPrice: proPlan ? this.client.premiumService.formatPrice(proPlan.price) : '$9.99'
          }),
          inline: false
        }
      )
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('premium_view_plans_benefits')
          .setLabel(i18n.t('commands.premium.benefits.view_plans', guildId))
          .setStyle(ButtonStyle.Primary)
          .setEmoji('💎'),
        new ButtonBuilder()
          .setCustomId('premium_start_trial_benefits')
          .setLabel(i18n.t('commands.premium.benefits.start_trial', guildId))
          .setStyle(ButtonStyle.Success)
          .setEmoji('🆓')
      );

    await interaction.reply({ embeds: [embed], components: [row] });
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