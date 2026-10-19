import { GuildMember } from 'discord.js';
import { Event } from '../../client/structures/Event';
import { KorexClient } from '../../client/KorexClient';

export default class GuildMemberRemoveEvent extends Event<'guildMemberRemove'> {
  constructor(client: KorexClient) {
    super(client, {
      name: 'guildMemberRemove',
      once: false,
    });
  }

  public async execute(...args: [GuildMember]): Promise<void> {
    const [member] = args;

    try {
      // Track activity for analytics
      await this.client.analytics.trackActivity(member.guild.id, 'leave', {
        userId: member.id,
        username: member.user.username
      });

      // Track invite statistics on leave
      await this.client.inviteService.trackMemberLeave(member);

      // Handle goodbye message
      await this.client.welcome.handleMemberLeave(member);

      // Log member leave
      await this.client.logging.logMemberLeave(member);

      // Auto-revoke collaborator access if the member leaves the server
      await this.revokeOperatorOnLeave(member);
    } catch (error) {
      this.client.logger.error('Error handling guild member remove event:', error);
    }
  }

  private async revokeOperatorOnLeave(member: GuildMember): Promise<void> {
    try {
      const operator = await this.client.database.prisma.guildOperator.findUnique({
        where: { guildId_userId: { guildId: member.guild.id, userId: member.id } },
      });

      if (!operator || operator.revokedAt) return;

      await this.client.database.prisma.guildOperator.update({
        where: { guildId_userId: { guildId: member.guild.id, userId: member.id } },
        data:  { revokedAt: new Date(), revokedBy: 'system:leave' },
      });

      // Record in the audit log
      await this.client.database.prisma.guildOperatorLog.create({
        data: {
          guildId:    member.guild.id,
          operatorId: member.id,
          username:   member.user.tag,
          action:     'operator.auto_revoked_leave',
          section:    'system',
          details:    { reason: 'member_left_guild' } as any,
        },
      });

      this.client.logger.info(
        `[TeamAccess] Auto-revoked operator ${member.user.tag} (${member.id}) from guild ${member.guild.name} (${member.guild.id}) — left server`,
      );
    } catch (err) {
      // best-effort — do not interrupt the main flow
      this.client.logger.warn(`[TeamAccess] Failed to auto-revoke operator on leave: ${err}`);
    }
  }
}
