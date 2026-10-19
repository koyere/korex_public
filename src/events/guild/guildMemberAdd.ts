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

    // Cada paso es independiente: un fallo no debe impedir los siguientes
    const step = (name: string, fn: () => Promise<unknown>) =>
      fn().catch((error) => this.client.logger.error(`Error in guildMemberAdd (${name}):`, error));

    try {
      // Honeypot primero (anti-raid y cuentas nuevas) y después el anti-raid de
      // Moderación: si alguno expulsa o banea, no se da la bienvenida ni los roles automáticos.
      const honeypotRemoved = await this.client.honeypot.handleMemberJoin(member).catch(() => false);
      // Anti-raid de Moderación: cuenta siempre la entrada; no actúa si Honeypot
      // ya expulsó/baneó o ya sancionó esta misma entrada (claim en Redis).
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

      // Plazo para verificarse (si el servidor lo tiene activado)
      await step('verification-deadline', () => this.client.verificationService.scheduleDeadline(member));
    } catch (error) {
      this.client.logger.error('Error handling guild member add event:', error);
    }
  }
}
