import { GuildMember } from 'discord.js';
import { Event } from '../../client/structures/Event';
import { KorexClient } from '../../client/KorexClient';

export default class GuildMemberAddEvent extends Event<'guildMemberAdd'> {
  constructor(client: KorexClient) {
    super(client, {
      name: 'guildMemberAdd',
      once: false,
    });
  }

  public async execute(...args: [GuildMember]): Promise<void> {
    const [member] = args;

    // Each step is independent: a failure must not prevent the following ones
    const step = (name: string, fn: () => Promise<unknown>) =>
      fn().catch((error) => this.client.logger.error(`Error in guildMemberAdd (${name}):`, error));

    try {
      // Honeypot first (anti-raid and new accounts) and then the Moderation
      // anti-raid: if either kicks or bans, no welcome or auto-roles are given.
      const honeypotRemoved = await this.client.honeypot.handleMemberJoin(member).catch(() => false);
      // Moderation anti-raid: always counts the join; does not act if Honeypot
      // already kicked/banned or already sanctioned this same join (claim in Redis).
      const raidRemoved = await this.client.antiRaid.handleMemberJoin(member, honeypotRemoved).catch(() => false);
      const removed = honeypotRemoved || raidRemoved;

      // Track activity for analytics
      await step('analytics', () => this.client.analytics.trackActivity(member.guild.id, 'join', {
        userId: member.id,
        username: member.user.username
      }));

      // Track invite usage
      await step('invites', () => this.client.inviteService.trackMemberJoin(member));

      // Log member join
      await step('logging', () => this.client.logging.logMemberJoin(member));

      if (removed) return;

      // Handle welcome message
      await step('welcome', () => this.client.welcome.handleMemberJoin(member));

      // Handle auto-roles
      await step('autoroles', () => this.client.autoRole.handleMemberJoin(member));

      // Verification deadline (if the server has it enabled)
      await step('verification-deadline', () => this.client.verificationService.scheduleDeadline(member));
    } catch (error) {
      this.client.logger.error('Error handling guild member add event:', error);
    }
  }
}
