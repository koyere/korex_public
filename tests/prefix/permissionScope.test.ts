import { PermissionFlagsBits } from 'discord.js';
import { Command } from '../../src/client/structures/Command';

// Regression G·BOT-02 / G·BOT-26 (audit 2026-11-21)
jest.mock('../../src/utils/i18n', () => ({ i18n: { t: (k: string) => k } }));

const fakeClient: any = {
  config: { cooldowns: { default: 3 } },
  isOwner: () => false,
  addons: { isEnabled: async () => true, getAddon: () => null },
};

class TestCommand extends Command {
  constructor(scope?: 'guild' | 'channel', perms: bigint[] = [PermissionFlagsBits.ManageChannels]) {
    super(fakeClient, { name: 't', description: 't', category: 'admin', permissions: { user: perms }, permissionScope: scope });
  }
  data(): any { return null; }
  async executeSlash(): Promise<void> {}
}

const CHANNEL_ONLY = PermissionFlagsBits.ManageChannels | PermissionFlagsBits.SendMessages; // permission granted only in their own channel
const NONE = PermissionFlagsBits.SendMessages;

describe('Command.canExecute — permission scope', () => {
  it('requires the server-level permission by default: a single channel permission is not enough', async () => {
    const r = await new TestCommand().canExecute('u', 'g', CHANNEL_ONLY, NONE);
    expect(r.canExecute).toBe(false);
  });
  it('allows it with the server-level permission', async () => {
    const r = await new TestCommand().canExecute('u', 'g', NONE, CHANNEL_ONLY);
    expect(r.canExecute).toBe(true);
  });
  it("with permissionScope 'channel' the permission in the invoking channel is enough", async () => {
    const r = await new TestCommand('channel').canExecute('u', 'g', CHANNEL_ONLY, NONE);
    expect(r.canExecute).toBe(true);
  });
  it('denies when no permissions are available (the check used to be skipped)', async () => {
    expect((await new TestCommand().canExecute('u', 'g', CHANNEL_ONLY, undefined)).canExecute).toBe(false);
    expect((await new TestCommand('channel').canExecute('u', 'g', undefined, CHANNEL_ONLY)).canExecute).toBe(false);
  });
  it('server-level Administrator covers any permission', async () => {
    const r = await new TestCommand('guild', [PermissionFlagsBits.BanMembers, PermissionFlagsBits.ManageGuild]).canExecute('u', 'g', NONE, PermissionFlagsBits.Administrator);
    expect(r.canExecute).toBe(true);
  });
  it('commands without required permissions are unaffected', async () => {
    const r = await new TestCommand('guild', []).canExecute('u', 'g', undefined, undefined);
    expect(r.canExecute).toBe(true);
  });
});
