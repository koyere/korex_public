import { PermissionFlagsBits } from 'discord.js';
import {
  allChannelsId,
  CommandPermissionContext,
  CommandPermissionOverride,
  evaluateCommandPermission,
  hasDefaultMemberPermissions,
} from '../../src/client/prefix/commandPermissions';

const GUILD = '100000000000000000';
const CHANNEL = '200000000000000000';
const OTHER_CHANNEL = '200000000000000001';
const PARENT = '300000000000000000';
const USER = '400000000000000000';
const ROLE_A = '500000000000000000';
const ROLE_B = '600000000000000000';

const ROLE = 1;
const MEMBER = 2;
const CHAN = 3;

const o = (id: string, type: number, permission: boolean): CommandPermissionOverride => ({ id, type, permission });

function ctx(partial: Partial<CommandPermissionContext> = {}): CommandPermissionContext {
  return {
    guildId: GUILD,
    channelId: CHANNEL,
    parentChannelId: null,
    userId: USER,
    roleIds: [],
    isOwner: false,
    memberPermissions: PermissionFlagsBits.SendMessages,
    defaultMemberPermissions: null,
    commandOverrides: null,
    appOverrides: null,
    ...partial,
  };
}

describe('hasDefaultMemberPermissions', () => {
  it('no restriction', () => {
    expect(hasDefaultMemberPermissions(null, 0n)).toBe(true);
  });
  it('requires all bits', () => {
    const req = (PermissionFlagsBits.BanMembers | PermissionFlagsBits.KickMembers).toString();
    expect(hasDefaultMemberPermissions(req, PermissionFlagsBits.BanMembers)).toBe(false);
    expect(hasDefaultMemberPermissions(req, PermissionFlagsBits.BanMembers | PermissionFlagsBits.KickMembers)).toBe(true);
  });
  it('"0" = administrators only', () => {
    expect(hasDefaultMemberPermissions('0', PermissionFlagsBits.ManageGuild)).toBe(false);
    expect(hasDefaultMemberPermissions('0', PermissionFlagsBits.Administrator)).toBe(true);
  });
});

describe('evaluateCommandPermission', () => {
  const ban = PermissionFlagsBits.BanMembers.toString();

  it('without overrides applies default_member_permissions', () => {
    expect(evaluateCommandPermission(ctx({ defaultMemberPermissions: ban }))).toBe(false);
    expect(evaluateCommandPermission(ctx({ defaultMemberPermissions: ban, memberPermissions: PermissionFlagsBits.BanMembers }))).toBe(true);
  });

  it('role override allows even when default permissions are missing', () => {
    expect(evaluateCommandPermission(ctx({
      defaultMemberPermissions: ban, roleIds: [ROLE_A], commandOverrides: [o(ROLE_A, ROLE, true)],
    }))).toBe(true);
  });

  it('user > role > @everyone', () => {
    const overrides = [o(GUILD, ROLE, false), o(ROLE_A, ROLE, true), o(USER, MEMBER, false)];
    expect(evaluateCommandPermission(ctx({ roleIds: [ROLE_A], commandOverrides: overrides }))).toBe(false);
    expect(evaluateCommandPermission(ctx({ roleIds: [ROLE_A], commandOverrides: overrides.slice(0, 2) }))).toBe(true);
    expect(evaluateCommandPermission(ctx({ roleIds: [], commandOverrides: overrides.slice(0, 2) }))).toBe(false);
  });

  it('one allowed role is enough; otherwise a denied one denies', () => {
    expect(evaluateCommandPermission(ctx({ roleIds: [ROLE_A, ROLE_B], commandOverrides: [o(ROLE_A, ROLE, false), o(ROLE_B, ROLE, true)] }))).toBe(true);
    expect(evaluateCommandPermission(ctx({ roleIds: [ROLE_A], commandOverrides: [o(ROLE_A, ROLE, false), o(GUILD, ROLE, true)] }))).toBe(false);
  });

  it('@everyone allows even when default permissions are missing', () => {
    expect(evaluateCommandPermission(ctx({ defaultMemberPermissions: ban, commandOverrides: [o(GUILD, ROLE, true)] }))).toBe(true);
  });

  it('channels: specific > all channels (guildId - 1)', () => {
    expect(allChannelsId(GUILD)).toBe('99999999999999999');
    const all = allChannelsId(GUILD);
    expect(evaluateCommandPermission(ctx({ commandOverrides: [o(all, CHAN, false)] }))).toBe(false);
    expect(evaluateCommandPermission(ctx({ commandOverrides: [o(all, CHAN, false), o(CHANNEL, CHAN, true)] }))).toBe(true);
    expect(evaluateCommandPermission(ctx({ channelId: OTHER_CHANNEL, commandOverrides: [o(all, CHAN, false), o(CHANNEL, CHAN, true)] }))).toBe(false);
  });

  it('threads use the parent channel', () => {
    expect(evaluateCommandPermission(ctx({
      channelId: OTHER_CHANNEL, parentChannelId: PARENT, commandOverrides: [o(PARENT, CHAN, false)],
    }))).toBe(false);
  });

  it('a denied channel blocks even administrators, but not the owner', () => {
    const commandOverrides = [o(CHANNEL, CHAN, false)];
    expect(evaluateCommandPermission(ctx({ commandOverrides, memberPermissions: PermissionFlagsBits.Administrator }))).toBe(false);
    expect(evaluateCommandPermission(ctx({ commandOverrides, isOwner: true }))).toBe(true);
  });

  it('administrators ignore user/role denials', () => {
    expect(evaluateCommandPermission(ctx({
      memberPermissions: PermissionFlagsBits.Administrator, commandOverrides: [o(GUILD, ROLE, false), o(USER, MEMBER, false)],
    }))).toBe(true);
  });

  it('application level as the command default', () => {
    // The application denies @everyone; the command says nothing
    expect(evaluateCommandPermission(ctx({ appOverrides: [o(GUILD, ROLE, false)] }))).toBe(false);
    // The command allows a role: it takes precedence over the application
    expect(evaluateCommandPermission(ctx({
      roleIds: [ROLE_A], appOverrides: [o(GUILD, ROLE, false)], commandOverrides: [o(ROLE_A, ROLE, true)],
    }))).toBe(true);
    // Channel: the command has no channel overrides → the application ones are used
    expect(evaluateCommandPermission(ctx({
      appOverrides: [o(CHANNEL, CHAN, false)], commandOverrides: [o(GUILD, ROLE, true)],
    }))).toBe(false);
    // The command's channel takes precedence over the application's
    expect(evaluateCommandPermission(ctx({
      appOverrides: [o(CHANNEL, CHAN, false)], commandOverrides: [o(CHANNEL, CHAN, true)],
    }))).toBe(true);
  });

  it('only channel overrides on the command: the member falls back to the application and then to the default', () => {
    expect(evaluateCommandPermission(ctx({
      defaultMemberPermissions: ban, commandOverrides: [o(CHANNEL, CHAN, true)],
    }))).toBe(false);
    expect(evaluateCommandPermission(ctx({
      defaultMemberPermissions: ban, commandOverrides: [o(CHANNEL, CHAN, true)], appOverrides: [o(USER, MEMBER, true)],
    }))).toBe(true);
  });
});
