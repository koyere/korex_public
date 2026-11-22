import { GuildKickoutService } from '../../src/services/GuildKickoutService';

// Regression D·PAY-07 (audit 2026-11-21): servers that removed the bot while it
// was down kept paying forever.
function setup(fetchImpl: (id: string) => Promise<unknown>) {
  const client: any = {
    isReady: () => true,
    shard: null,
    guilds: { cache: new Map([['present', {}]]), fetch: jest.fn(({ guild }: any) => fetchImpl(guild)) },
    db: {
      addonLicense: { findMany: jest.fn(async () => [{ guildId: 'gone' }, { guildId: 'netfail' }, { guildId: 'present' }]) },
      guildPremium: { findMany: jest.fn(async () => [{ guildId: 'alive-but-uncached' }]) },
    },
  };
  const svc = new GuildKickoutService(client);
  const left = jest.spyOn(svc, 'handleGuildLeft').mockResolvedValue(undefined);
  return { svc, left };
}

describe('GuildKickoutService.reconcileAbsentGuilds', () => {
  it('applies the kickout only when Discord confirms the bot is gone', async () => {
    const { svc, left } = setup(async (id) => {
      if (id === 'gone') throw Object.assign(new Error('Unknown Guild'), { code: 10004 });
      if (id === 'netfail') throw Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' });
      return {};
    });
    expect(await svc.reconcileAbsentGuilds()).toBe(1);
    expect(left).toHaveBeenCalledTimes(1);
    expect(left).toHaveBeenCalledWith('gone');
  });
  it('does nothing with sharding or before the bot is ready', async () => {
    const { svc, left } = setup(async () => { throw Object.assign(new Error('x'), { code: 10004 }); });
    (svc as any).client.shard = {};
    expect(await svc.reconcileAbsentGuilds()).toBe(0);
    (svc as any).client.shard = null;
    (svc as any).client.isReady = () => false;
    expect(await svc.reconcileAbsentGuilds()).toBe(0);
    expect(left).not.toHaveBeenCalled();
  });
});
