import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { checkAutoRole, canAutoAssignRole, isGuildAdministrator } from '../../src/utils/roleSafety';

// Regression G·BOT-01 / C·API-05 (audit 2026-11-21)
type FakeRole = { id: string; position: number; managed: boolean; permissions: PermissionsBitField; comparePositionTo: (o: FakeRole) => number };
const role = (id: string, position: number, perms: bigint[] = [], managed = false): FakeRole => ({
  id, position, managed, permissions: new PermissionsBitField(perms),
  comparePositionTo(o) { return this.position - o.position; },
});

const everyone = role('g1', 0);
const helper = role('helper', 2);
const member = role('member', 3);
const mod = role('mod', 5, [PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageMessages]);
const staff = role('staff', 6);
const modTools = role('modtools', 4, [PermissionFlagsBits.BanMembers]);
const admin = role('admin', 8, [PermissionFlagsBits.Administrator]);
const bot = role('bot', 10);
const aboveBot = role('above', 11);
const integration = role('integ', 1, [], true);
const roles = new Map([everyone, helper, member, mod, staff, modTools, admin, bot, aboveBot, integration].map((r) => [r.id, r]));

const guild: any = { id: 'g1', ownerId: 'owner', roles: { cache: roles }, members: { me: { roles: { highest: bot } } } };
const memberWith = (id: string, top: FakeRole, perms: bigint[] = []): any => ({
  id, guild, roles: { highest: top }, permissions: new PermissionsBitField(perms),
});
const moderator = memberWith('m1', mod, [PermissionFlagsBits.ManageRoles]);
const discordAdmin = memberWith('a1', admin, [PermissionFlagsBits.Administrator]);
const owner = memberWith('owner', helper);

describe('checkAutoRole', () => {
  it('a moderator cannot configure the Administrator role (reported scenario)', () => {
    expect(checkAutoRole(guild, 'admin', moderator, isGuildAdministrator(moderator))).toMatchObject({ ok: false, problem: 'dangerous' });
  });
  it('a moderator cannot configure a role above their own', () => {
    expect(checkAutoRole(guild, 'staff', moderator, false)).toMatchObject({ ok: false, problem: 'above_actor' });
  });
  it('a moderator cannot configure roles with moderation permissions', () => {
    expect(checkAutoRole(guild, 'modtools', moderator, false)).toMatchObject({ ok: false, problem: 'dangerous' });
  });
  it('a moderator can configure a normal role below their own', () => {
    expect(checkAutoRole(guild, 'member', moderator, false)).toMatchObject({ ok: true });
  });
  it('a Discord Administrator can configure roles with moderation permissions', () => {
    expect(isGuildAdministrator(discordAdmin)).toBe(true);
    expect(checkAutoRole(guild, 'modtools', discordAdmin, true)).toMatchObject({ ok: true });
    expect(checkAutoRole(guild, 'staff', discordAdmin, true)).toMatchObject({ ok: true });
  });
  it('nobody can configure a role with Administrator as an automatic role', () => {
    expect(checkAutoRole(guild, 'admin', discordAdmin, true)).toMatchObject({ ok: false, problem: 'dangerous' });
    expect(checkAutoRole(guild, 'admin', owner, true)).toMatchObject({ ok: false, problem: 'dangerous' });
  });
  it('the server owner counts as an administrator even with a low role', () => {
    expect(isGuildAdministrator(owner)).toBe(true);
  });
  it('rejects @everyone, managed roles, roles above the bot and no identifiable actor', () => {
    expect(checkAutoRole(guild, 'g1', discordAdmin, true)).toMatchObject({ ok: false, problem: 'everyone' });
    expect(checkAutoRole(guild, 'integ', discordAdmin, true)).toMatchObject({ ok: false, problem: 'managed' });
    expect(checkAutoRole(guild, 'above', discordAdmin, true)).toMatchObject({ ok: false, problem: 'above_bot' });
    expect(checkAutoRole(guild, 'member', null, false)).toMatchObject({ ok: false, problem: 'above_actor' });
    expect(checkAutoRole(guild, 'nope', discordAdmin, true)).toMatchObject({ ok: false, problem: 'not_found' });
  });
});

describe('canAutoAssignRole (on hand-out)', () => {
  it('never hands out a role with Administrator even if configured earlier', () => {
    expect(canAutoAssignRole(guild, admin as any)).toBe(false);
  });
  it('hands out normal and moderation roles configured by an admin, below the bot', () => {
    expect(canAutoAssignRole(guild, member as any)).toBe(true);
    expect(canAutoAssignRole(guild, modTools as any)).toBe(true);
  });
  it('does not hand out managed roles, @everyone or roles above the bot', () => {
    expect(canAutoAssignRole(guild, integration as any)).toBe(false);
    expect(canAutoAssignRole(guild, everyone as any)).toBe(false);
    expect(canAutoAssignRole(guild, aboveBot as any)).toBe(false);
    expect(canAutoAssignRole(guild, null)).toBe(false);
  });
});
