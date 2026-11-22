import { GuildMember, PermissionFlagsBits } from 'discord.js';
import { reviewInviter } from '../../services/TeamAccessGuard';
import { Event } from '../../client/structures/Event';
import { KorexClient } from '../../client/KorexClient';

export default class GuildMemberUpdateEvent extends Event<'guildMemberUpdate'> {
  constructor(client: KorexClient) {
    super(client, {
      name: 'guildMemberUpdate',
      once: false,
    });
  }

  public async execute(...args: [GuildMember, GuildMember]): Promise<void> {
    const [oldMember, newMember] = args;

    try {
      // Check if member started boosting
      const wasBooster = oldMember.premiumSince !== null;
      const isBooster = newMember.premiumSince !== null;

      if (!wasBooster && isBooster) {
        // Member started boosting
        await this.client.autoRole.handleMemberBoostChange(newMember, true);
        this.client.logger.info(`${newMember.user.tag} started boosting ${newMember.guild.name}`);
      } else if (wasBooster && !isBooster && !oldMember.partial) {
        // Stopped boosting: remove the booster roles
        await this.client.autoRole.handleMemberBoostChange(newMember, false);
        this.client.logger.info(`${newMember.user.tag} stopped boosting ${newMember.guild.name}`);
      }

      // Lost Administrator: their dashboard invites are cancelled and the owner
      // reviews the collaborators they brought in
      if (!oldMember.partial
          && oldMember.permissions.has(PermissionFlagsBits.Administrator)
          && !newMember.permissions.has(PermissionFlagsBits.Administrator)
          && newMember.guild.ownerId !== newMember.id) {
        await reviewInviter(this.client, newMember.guild, newMember.id, 'demoted').catch(() => undefined);
      }
    } catch (error) {
      this.client.logger.error('Error handling guild member update event:', error);
    }
  }
}
