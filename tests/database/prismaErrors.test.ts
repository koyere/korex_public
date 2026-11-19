import { Prisma } from '@prisma/client';
import { uniqueViolationTarget } from '../../src/database/prismaErrors';

const p2002 = (meta: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test', meta });

describe('uniqueViolationTarget', () => {
  it('reads meta.target from the native engine (Prisma 6)', () => {
    expect(uniqueViolationTarget(p2002({ target: ['guildId', 'roleId'] }))).toBe('guildId,roleId');
  });

  it('reads the index name from the driver adapter (Prisma 7)', () => {
    const target = uniqueViolationTarget(p2002({
      driverAdapterError: { cause: { kind: 'UniqueConstraintViolation', constraint: { index: 'invite_reward_tiers_guildId_roleId_key' } } },
    }));

    expect(target).toContain('roleId');
  });

  it('reads the column list from the driver adapter', () => {
    expect(uniqueViolationTarget(p2002({
      driverAdapterError: { cause: { constraint: { fields: ['guildId', 'requiredInvites'] } } },
    }))).toBe('guildId,requiredInvites');
  });

  it('returns an empty string when there is no information', () => {
    expect(uniqueViolationTarget(p2002({}))).toBe('');
  });
});
