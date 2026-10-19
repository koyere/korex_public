import { InviteRewardService } from '../../src/services/InviteRewardService';

/** Mocks the minimum Prisma/Discord surface used by reward synchronization. */
function setup(opts: {
  tiers: Array<{ requiredInvites: number; roleId: string }>;
  valid: number;
  bonus?: number;
  stackRoles?: boolean;
  removeOnDrop?: boolean;
  memberRoles?: string[];
  grants?: string[];
  dangerousRoles?: string[];
}) {
  const grants = new Set<string>(opts.grants ?? []);
  const memberRoles = new Set<string>(opts.memberRoles ?? []);
  const positions: Record<string, number> = {};
  opts.tiers.forEach((t, i) => { positions[t.roleId] = i + 1; });
  for (const r of opts.grants ?? []) if (!(r in positions)) positions[r] = 50;

  const makeRole = (id: string) => ({
    id,
    managed: false,
    permissions: { has: () => (opts.dangerousRoles ?? []).includes(id) },
    comparePositionTo: (other: { position: number }) => (positions[id] ?? 0) - other.position,
  });
  const roles = new Map<string, any>();
  for (const id of Object.keys(positions)) roles.set(id, makeRole(id));

  const member = {
    id: 'u1',
    user: { bot: false, displayAvatarURL: () => '' },
    toString: () => '<@u1>',
    roles: {
      cache: { has: (id: string) => memberRoles.has(id) },
      add: jest.fn(async (id: string) => { memberRoles.add(id); }),
      remove: jest.fn(async (id: string) => { memberRoles.delete(id); }),
    },
  };

  const guild: any = {
    id: 'g1',
    ownerId: 'owner',
    roles: { cache: roles },
    channels: { cache: new Map() },
    members: {
      me: { permissions: { has: () => true }, roles: { highest: { position: 100 } } },
      fetch: jest.fn(async () => member),
    },
  };

  const prisma: any = {
    inviteRewardConfig: {
      findUnique: jest.fn(async () => ({
        enabled: true,
        stackRoles: opts.stackRoles ?? true,
        removeOnDrop: opts.removeOnDrop ?? true,
        announceChannelId: null,
      })),
    },
    inviteRewardTier: {
      findMany: jest.fn(async () => [...opts.tiers]
        .sort((a, b) => a.requiredInvites - b.requiredInvites)
        .map((t, i) => ({ id: `t${i}`, ...t }))),
    },
    inviteRewardGrant: {
      findMany: jest.fn(async () => [...grants].map((roleId) => ({ roleId }))),
      createMany: jest.fn(async ({ data }: any) => {
        const id = data[0].roleId;
        if (grants.has(id)) return { count: 0 };
        grants.add(id);
        return { count: 1 };
      }),
      deleteMany: jest.fn(async ({ where }: any) => { grants.delete(where.roleId); return { count: 1 }; }),
    },
    inviteStats: {
      findUnique: jest.fn(async () => ({ validInvites: opts.valid, bonusInvites: opts.bonus ?? 0 })),
    },
  };

  const service = new InviteRewardService({ db: prisma } as any);
  return { service, guild, member, grants, memberRoles };
}

const TIERS = [
  { requiredInvites: 5, roleId: 'r5' },
  { requiredInvites: 10, roleId: 'r10' },
  { requiredInvites: 20, roleId: 'r20' },
];

describe('InviteRewardService.syncMember', () => {
  it('stacks the reached roles (valid + bonus)', async () => {
    const { service, guild, memberRoles, grants } = setup({ tiers: TIERS, valid: 8, bonus: 2 });
    const res = await service.syncMember(guild, 'u1', { announce: false });
    expect(res.added.sort()).toEqual(['r10', 'r5']);
    expect([...memberRoles].sort()).toEqual(['r10', 'r5']);
    expect([...grants].sort()).toEqual(['r10', 'r5']);
  });

  it('"highest only" mode replaces the lower role', async () => {
    const { service, guild, memberRoles } = setup({
      tiers: TIERS, valid: 12, stackRoles: false, memberRoles: ['r5'], grants: ['r5'],
    });
    await service.syncMember(guild, 'u1', { announce: false });
    expect([...memberRoles]).toEqual(['r10']);
  });

  it('is idempotent: a second pass changes nothing', async () => {
    const { service, guild, member } = setup({ tiers: TIERS, valid: 10 });
    await service.syncMember(guild, 'u1', { announce: false });
    const second = await service.syncMember(guild, 'u1', { announce: false });
    expect(second).toEqual({ added: [], removed: [] });
    expect(member.roles.add).toHaveBeenCalledTimes(2);
  });

  it('when dropping below the threshold, removes only the roles the bot granted', async () => {
    const { service, guild, memberRoles } = setup({
      tiers: TIERS, valid: 6, memberRoles: ['r5', 'r10', 'r20'], grants: ['r5', 'r10'],
    });
    const res = await service.syncMember(guild, 'u1', { announce: false });
    expect(res.removed).toEqual(['r10']);
    // r20 was given manually by an administrator: left untouched
    expect([...memberRoles].sort()).toEqual(['r20', 'r5']);
  });

  it('without removal on drop, keeps the roles already granted', async () => {
    const { service, guild, memberRoles } = setup({
      tiers: TIERS, valid: 1, removeOnDrop: false, memberRoles: ['r5', 'r10'], grants: ['r5', 'r10'],
    });
    const res = await service.syncMember(guild, 'u1', { announce: false });
    expect(res).toEqual({ added: [], removed: [] });
    expect([...memberRoles].sort()).toEqual(['r10', 'r5']);
  });

  it('does not assign dangerous roles even if configured', async () => {
    const { service, guild, memberRoles } = setup({ tiers: TIERS, valid: 30, dangerousRoles: ['r20'] });
    await service.syncMember(guild, 'u1', { announce: false });
    expect(memberRoles.has('r20')).toBe(false);
    expect(memberRoles.has('r10')).toBe(true);
  });

  it('serializes concurrent synchronizations of the same member', async () => {
    const { service, guild, member } = setup({ tiers: TIERS, valid: 5 });
    await Promise.all([
      service.syncMember(guild, 'u1', { announce: false }),
      service.syncMember(guild, 'u1', { announce: false }),
      service.syncMember(guild, 'u1', { announce: false }),
    ]);
    expect(member.roles.add).toHaveBeenCalledTimes(1);
  });
});
