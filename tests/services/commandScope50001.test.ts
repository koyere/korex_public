jest.mock('../../src/utils/i18n', () => ({ i18n: { t: (k: string) => k } }));
jest.mock('discord.js', () => {
  const actual = jest.requireActual('discord.js');
  class FakeREST { setToken() { return this; } async put() { throw new actual.DiscordAPIError({ code: 50001, message: 'Missing Access' }, 50001, 403, 'PUT', '/x', {}); } }
  return { ...actual, REST: FakeREST };
});
import { CommandManager } from '../../src/client/managers/CommandManager';

// Regression G·BOT-14 (audit 2026-11-21): a 50001 with the bot still in the server set KICKOUT.
function client(inGuild: boolean) {
  const owner = { send: jest.fn(async () => undefined) };
  return {
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    db: { guild: { findUnique: jest.fn(async () => ({ enabledAddons: ['tickets'] })), update: jest.fn(async () => ({})) } },
    addons: { addons: new Map(), invalidateEnabledCache: jest.fn() },
    guilds: { cache: new Map(inGuild ? [['g1', { name: 'S', fetchOwner: async () => owner }]] : []) },
    kickoutService: { handleGuildLeft: jest.fn(async () => undefined) },
    user: { id: 'bot' },
    owner,
  } as any;
}

describe('command sync with 50001', () => {
  it('if the bot is still in the server it leaves licenses and addons alone and notifies the owner', async () => {
    const c = client(true);
    await new CommandManager(c).syncGuildAddonCommands('g1');
    expect(c.kickoutService.handleGuildLeft).not.toHaveBeenCalled();
    expect(c.db.guild.update).not.toHaveBeenCalled();
    expect(c.owner.send).toHaveBeenCalledTimes(1);
  });
  it('if the bot is gone it is treated as a removal (previous behaviour)', async () => {
    const c = client(false);
    await new CommandManager(c).syncGuildAddonCommands('g1');
    expect(c.kickoutService.handleGuildLeft).toHaveBeenCalledWith('g1');
  });
});
