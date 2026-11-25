import { GuildKickoutService } from '../../src/services/GuildKickoutService';

// D·PAY-12: a license cancelled by the kickout job after the grace period keeps its paid time
// and is restored if the bot comes back before it expires
function makeClient(licenses: any[], premiums: any[] = []) {
  const db = {
    addonLicense: { findMany: jest.fn(async () => licenses), updateMany: jest.fn(async () => ({ count: 1 })) },
    guildPremium: { findMany: jest.fn(async () => premiums), updateMany: jest.fn(async () => ({ count: 1 })) },
    guild: { updateMany: jest.fn(async () => ({ count: 1 })) },
  };
  const redis = { del: jest.fn(async () => 1), setex: jest.fn(async () => 'OK') };
  const client: any = {
    db,
    redis: { getClient: () => redis },
    addons: { getLoadedAddons: () => [], enableAddon: jest.fn(async () => true) },
    addonSync: { publishEvent: jest.fn(async () => undefined) },
  };
  return { client, db };
}

const DAY = 86_400_000;

describe('GuildKickoutService.handleGuildRejoined', () => {
  it('restores a kickout-cancelled license as active until it expires', async () => {
    const expiresAt = new Date(Date.now() + 10 * DAY);
    const lic = { id: 'l1', guildId: 'g', addonName: 'tickets', status: 'CANCELLED', kickoutAt: new Date(Date.now() - 9 * DAY), cancelledAt: new Date(Date.now() - 2 * DAY), suspendedAt: null, expiresAt, paypalSubscriptionId: 'I-ABC' };
    const { client, db } = makeClient([lic]);
    const ok = await new GuildKickoutService(client).handleGuildRejoined('g');
    expect(ok).toBe(true);
    const call = (db.addonLicense.updateMany as jest.Mock).mock.calls[0][0];
    expect(call.where).toEqual({ id: 'l1', status: 'CANCELLED' });
    expect(call.data).toEqual({ status: 'ACTIVE', kickoutAt: null, expiresAt });
    expect(client.addons.enableAddon).toHaveBeenCalledWith('g', 'tickets');
  });

  it('only includes cancelled records with kickoutAt and time left', async () => {
    const { client, db } = makeClient([]);
    await new GuildKickoutService(client).handleGuildRejoined('g');
    const where = (db.addonLicense.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.OR[0]).toEqual({ status: 'KICKOUT' });
    expect(where.OR[1].status).toBe('CANCELLED');
    expect(where.OR[1].kickoutAt).toEqual({ not: null });
    expect(where.OR[1].expiresAt.gt).toBeInstanceOf(Date);
  });
});
