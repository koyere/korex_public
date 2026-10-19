import { ApplicationCommandOptionType as T } from 'discord.js';
import {
  coerceValue,
  formatUsageArgs,
  listCommandPaths,
  parseOptions,
  PREFIX_PATTERN,
  PrefixOptionDef,
  resolveCommandPath,
  stripPrefix,
  tokenize,
} from '../../src/client/prefix/ArgumentParser';
import { getPrefixUnsupportedReason, isFullyUnsupported, isPartiallyUnsupported } from '../../src/client/prefix/prefixCompatibility';

const USER_ID = '123456789012345678';
const ROLE_ID = '223456789012345678';
const CHANNEL_ID = '323456789012345678';
const BOT_ID = '423456789012345678';

const values = (opts: { name: string; value: unknown }[]) => Object.fromEntries(opts.map(o => [o.name, o.value]));

describe('tokenize', () => {
  it('splits on spaces and respects quotes', () => {
    expect(tokenize('a  "b c"   d').map(t => t.value)).toEqual(['a', 'b c', 'd']);
  });

  it('supports typographic quotes and «»', () => {
    expect(tokenize('“hola mundo” «otro valor»').map(t => t.value)).toEqual(['hola mundo', 'otro valor']);
  });

  it('escapes quotes with a backslash', () => {
    expect(tokenize('"di \\"hola\\"" fin').map(t => t.value)).toEqual(['di "hola"', 'fin']);
  });

  it('detects name:value and name:"value with spaces"', () => {
    const [a, b] = tokenize('reason:"spam masivo" days:7');
    expect(a).toMatchObject({ key: 'reason', keyValue: 'spam masivo' });
    expect(b).toMatchObject({ key: 'days', keyValue: '7' });
  });

  it('does not treat URLs as name:value when there is no option with that name', () => {
    const defs: PrefixOptionDef[] = [{ name: 'query', type: T.String, required: true }];
    const res = parseOptions(defs, tokenize('https://soundcloud.com/x'));
    expect(res.ok && values(res.options)).toEqual({ query: 'https://soundcloud.com/x' });
  });

  it('unclosed quote takes the rest', () => {
    expect(tokenize('"abc def').map(t => t.value)).toEqual(['abc def']);
  });

  it('empty string', () => {
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('stripPrefix', () => {
  it('detects the prefix case-insensitively', () => {
    expect(stripPrefix('K!help', 'k!', BOT_ID)).toEqual({ body: 'help', viaMention: false });
    expect(stripPrefix('!ban x', '!', BOT_ID)).toEqual({ body: 'ban x', viaMention: false });
  });

  it('accepts the bot mention as a prefix', () => {
    expect(stripPrefix(`<@${BOT_ID}> help`, '!', BOT_ID)).toEqual({ body: 'help', viaMention: true });
    expect(stripPrefix(`<@!${BOT_ID}>ping`, '!', BOT_ID)).toEqual({ body: 'ping', viaMention: true });
    expect(stripPrefix(`<@${BOT_ID}>`, '!', BOT_ID)).toEqual({ body: '', viaMention: true });
  });

  it('ignores messages without a prefix or with only the prefix', () => {
    expect(stripPrefix('hola', '!', BOT_ID)).toBeNull();
    expect(stripPrefix('!', '!', BOT_ID)).toBeNull();
    expect(stripPrefix(`<@${USER_ID}> help`, '!', BOT_ID)).toBeNull();
  });
});

describe('PREFIX_PATTERN', () => {
  it('validates 1-5 character prefixes without spaces or dangerous characters', () => {
    expect(PREFIX_PATTERN.test('!')).toBe(true);
    expect(PREFIX_PATTERN.test('k!')).toBe(true);
    expect(PREFIX_PATTERN.test('korex')).toBe(true);
    expect(PREFIX_PATTERN.test('')).toBe(false);
    expect(PREFIX_PATTERN.test('abcdef')).toBe(false);
    expect(PREFIX_PATTERN.test('a b')).toBe(false);
    expect(PREFIX_PATTERN.test('`')).toBe(false);
    expect(PREFIX_PATTERN.test('a​')).toBe(false);
  });
});

describe('coerceValue', () => {
  it('integers with bounds', () => {
    const def: PrefixOptionDef = { name: 'n', type: T.Integer, min_value: 1, max_value: 100 };
    expect(coerceValue(def, '50')).toEqual({ value: 50 });
    expect(coerceValue(def, '0')).toBeNull();
    expect(coerceValue(def, '101')).toBeNull();
    expect(coerceValue(def, '1.5')).toBeNull();
    expect(coerceValue(def, 'abc')).toBeNull();
  });

  it('numbers with decimal point or comma', () => {
    const def: PrefixOptionDef = { name: 'n', type: T.Number };
    expect(coerceValue(def, '1.5')).toEqual({ value: 1.5 });
    expect(coerceValue(def, '2,25')).toEqual({ value: 2.25 });
    expect(coerceValue(def, '1e9')).toBeNull();
  });

  it('booleans in es/en', () => {
    const def: PrefixOptionDef = { name: 'b', type: T.Boolean };
    for (const v of ['true', 'sí', 'si', 'yes', 'on', '1']) expect(coerceValue(def, v)).toEqual({ value: true });
    for (const v of ['false', 'no', 'off', '0']) expect(coerceValue(def, v)).toEqual({ value: false });
    expect(coerceValue(def, 'quizás')).toBeNull();
  });

  it('users, roles and channels by mention or ID', () => {
    expect(coerceValue({ name: 'u', type: T.User }, `<@${USER_ID}>`)).toEqual({ value: USER_ID });
    expect(coerceValue({ name: 'u', type: T.User }, `<@!${USER_ID}>`)).toEqual({ value: USER_ID });
    expect(coerceValue({ name: 'u', type: T.User }, USER_ID)).toEqual({ value: USER_ID });
    expect(coerceValue({ name: 'u', type: T.User }, `<@&${ROLE_ID}>`)).toBeNull();
    expect(coerceValue({ name: 'r', type: T.Role }, `<@&${ROLE_ID}>`)).toEqual({ value: ROLE_ID });
    expect(coerceValue({ name: 'c', type: T.Channel }, `<#${CHANNEL_ID}>`)).toEqual({ value: CHANNEL_ID });
    expect(coerceValue({ name: 'c', type: T.Channel }, 'general')).toBeNull();
  });

  it('mentionables distinguish user and role', () => {
    const def: PrefixOptionDef = { name: 'm', type: T.Mentionable };
    expect(coerceValue(def, `<@${USER_ID}>`)).toEqual({ value: USER_ID, mentionKind: 'user' });
    expect(coerceValue(def, `<@&${ROLE_ID}>`)).toEqual({ value: ROLE_ID, mentionKind: 'role' });
    expect(coerceValue(def, USER_ID)).toEqual({ value: USER_ID, mentionKind: 'unknown' });
  });

  it('choices by value or name', () => {
    const def: PrefixOptionDef = {
      name: 'privacy', type: T.String,
      choices: [{ name: 'Public', value: 'public' }, { name: 'Private', value: 'private' }],
    };
    expect(coerceValue(def, 'PRIVATE')).toEqual({ value: 'private' });
    expect(coerceValue(def, 'Public')).toEqual({ value: 'public' });
    expect(coerceValue(def, 'secret')).toBeNull();
    const intDef: PrefixOptionDef = { name: 'd', type: T.Integer, choices: [{ name: 'One day', value: 1 }, { name: 'Week', value: 7 }] };
    expect(coerceValue(intDef, 'week')).toEqual({ value: 7 });
    expect(coerceValue(intDef, '1')).toEqual({ value: 1 });
  });

  it('text length', () => {
    expect(coerceValue({ name: 's', type: T.String, max_length: 3 }, 'abcd')).toBeNull();
    expect(coerceValue({ name: 's', type: T.String, min_length: 2 }, 'a')).toBeNull();
  });
});

describe('resolveCommandPath', () => {
  const root: PrefixOptionDef[] = [
    { name: 'list', type: T.Subcommand, options: [] },
    {
      name: 'category', type: T.SubcommandGroup, options: [
        { name: 'add', type: T.Subcommand, options: [{ name: 'name', type: T.String, required: true }] },
        { name: 'remove', type: T.Subcommand, options: [] },
      ],
    },
  ];

  it('command without subcommands', () => {
    const res = resolveCommandPath([{ name: 'q', type: T.String }], tokenize('hola'));
    expect(res.ok && res.path).toMatchObject({ group: null, subcommand: null });
  });

  it('simple subcommand (case-insensitive)', () => {
    const res = resolveCommandPath(root, tokenize('LIST'));
    expect(res.ok && res.path).toMatchObject({ group: null, subcommand: 'list', rest: [] });
  });

  it('group + subcommand (multiple words)', () => {
    const res = resolveCommandPath(root, tokenize('category add Soporte técnico'));
    expect(res.ok && res.path.group).toBe('category');
    expect(res.ok && res.path.subcommand).toBe('add');
    expect(res.ok && res.path.rest.map(t => t.value)).toEqual(['Soporte', 'técnico']);
  });

  it('subcommand errors', () => {
    const missing = resolveCommandPath(root, []);
    expect(!missing.ok && missing.error).toMatchObject({ code: 'missing_subcommand', available: ['list', 'category'] });
    const unknown = resolveCommandPath(root, tokenize('foo'));
    expect(!unknown.ok && unknown.error.code).toBe('unknown_subcommand');
    const groupOnly = resolveCommandPath(root, tokenize('category'));
    expect(!groupOnly.ok && groupOnly.error).toMatchObject({ code: 'missing_subcommand', available: ['category add', 'category remove'] });
  });
});

describe('parseOptions', () => {
  const ban: PrefixOptionDef[] = [
    { name: 'user', type: T.User, required: true },
    { name: 'reason', type: T.String },
    { name: 'delete_days', type: T.Integer, min_value: 0, max_value: 7 },
  ];

  it('positionals in order', () => {
    const res = parseOptions(ban, tokenize(`<@${USER_ID}> spam 3`));
    expect(res.ok && values(res.options)).toEqual({ user: USER_ID, reason: 'spam', delete_days: 3 });
  });

  it('text takes multiple words if the rest does not fit', () => {
    const res = parseOptions(ban, tokenize(`<@${USER_ID}> spam en el chat`));
    expect(res.ok && values(res.options)).toEqual({ user: USER_ID, reason: 'spam en el chat' });
  });

  it('text leaves free what fits the next option', () => {
    const res = parseOptions(ban, tokenize(`<@${USER_ID}> spam en el chat 7`));
    expect(res.ok && values(res.options)).toEqual({ user: USER_ID, reason: 'spam en el chat', delete_days: 7 });
  });

  it('quotes and named arguments', () => {
    const res = parseOptions(ban, tokenize(`${USER_ID} delete_days:2 reason:"a b c"`));
    expect(res.ok && values(res.options)).toEqual({ user: USER_ID, reason: 'a b c', delete_days: 2 });
  });

  it('a single text option takes everything (!play song with spaces)', () => {
    const play: PrefixOptionDef[] = [{ name: 'query', type: T.String, required: true }];
    const res = parseOptions(play, tokenize('never gonna give you up'));
    expect(res.ok && values(res.options)).toEqual({ query: 'never gonna give you up' });
  });

  it('skips optionals that do not fit', () => {
    const defs: PrefixOptionDef[] = [
      { name: 'prize', type: T.String, required: true },
      { name: 'duration', type: T.Integer, required: true },
      { name: 'winners', type: T.Integer },
      { name: 'title', type: T.String },
    ];
    const a = parseOptions(defs, tokenize('Discord Nitro 24'));
    expect(a.ok && values(a.options)).toEqual({ prize: 'Discord Nitro', duration: 24 });
    const b = parseOptions(defs, tokenize('Nitro 24 Gran sorteo'));
    expect(b.ok && values(b.options)).toEqual({ prize: 'Nitro', duration: 24, title: 'Gran sorteo' });
    const c = parseOptions(defs, tokenize('"Nitro anual" 24 2 Sorteo'));
    expect(c.ok && values(c.options)).toEqual({ prize: 'Nitro anual', duration: 24, winners: 2, title: 'Sorteo' });
  });

  it('an optional text option after another text option is named-only', () => {
    const defs: PrefixOptionDef[] = [
      { name: 'title', type: T.String, required: true },
      { name: 'note', type: T.String },
    ];
    const a = parseOptions(defs, tokenize('hola mundo'));
    expect(a.ok && values(a.options)).toEqual({ title: 'hola mundo' });
    const b = parseOptions(defs, tokenize('hola note:mundo'));
    expect(b.ok && values(b.options)).toEqual({ title: 'hola', note: 'mundo' });
    expect(formatUsageArgs(defs)).toBe('<title> [note:…]');
  });

  it('missing required option', () => {
    const res = parseOptions(ban, []);
    expect(!res.ok && res.error.code).toBe('missing_option');
    expect(!res.ok && res.error.option?.name).toBe('user');
  });

  it('invalid value', () => {
    const res = parseOptions(ban, tokenize('juan'));
    expect(!res.ok && res.error).toMatchObject({ code: 'invalid_value', value: 'juan' });
    const named = parseOptions(ban, tokenize(`${USER_ID} delete_days:30`));
    expect(!named.ok && named.error).toMatchObject({ code: 'invalid_value', value: '30' });
  });

  it('too many arguments', () => {
    const defs: PrefixOptionDef[] = [{ name: 'amount', type: T.Integer, required: true }];
    const res = parseOptions(defs, tokenize('5 6'));
    expect(!res.ok && res.error.code).toBe('too_many_arguments');
  });

  it('repeated option', () => {
    const res = parseOptions(ban, tokenize(`${USER_ID} reason:a reason:b`));
    expect(!res.ok && res.error.code).toBe('duplicate_option');
  });

  it('message attachments', () => {
    const defs: PrefixOptionDef[] = [
      { name: 'file', type: T.Attachment, required: true },
      { name: 'title', type: T.String },
    ];
    const ok = parseOptions(defs, tokenize('Mi archivo'), 1);
    expect(ok.ok && ok.options).toEqual([
      expect.objectContaining({ name: 'file', attachmentIndex: 0 }),
      expect.objectContaining({ name: 'title', value: 'Mi archivo' }),
    ]);
    const missing = parseOptions(defs, [], 0);
    expect(!missing.ok && missing.error.code).toBe('missing_attachment');
  });

  it('positional booleans, roles and channels', () => {
    const defs: PrefixOptionDef[] = [
      { name: 'channel', type: T.Channel, required: true },
      { name: 'role', type: T.Role },
      { name: 'enabled', type: T.Boolean },
    ];
    const res = parseOptions(defs, tokenize(`<#${CHANNEL_ID}> <@&${ROLE_ID}> no`));
    expect(res.ok && values(res.options)).toEqual({ channel: CHANNEL_ID, role: ROLE_ID, enabled: false });
  });

  it('too many tokens', () => {
    const res = parseOptions([{ name: 'q', type: T.String }], tokenize(Array(150).fill('x').join(' ')));
    expect(!res.ok && res.error.code).toBe('too_many_tokens');
  });
});

describe('help and compatibility', () => {
  it('paths of a command with groups', () => {
    const paths = listCommandPaths([
      { name: 'view', type: T.Subcommand, options: [] },
      { name: 'ai-key', type: T.SubcommandGroup, options: [{ name: 'set', type: T.Subcommand, options: [] }] },
    ]);
    expect(paths.map(p => p.path)).toEqual(['view', 'ai-key set']);
  });

  it('usage text', () => {
    expect(formatUsageArgs([
      { name: 'user', type: T.User, required: true },
      { name: 'reason', type: T.String },
      { name: 'file', type: T.Attachment },
    ])).toBe('<user> [reason] [file:📎]');
  });

  it('list of unsupported paths', () => {
    expect(getPrefixUnsupportedReason('massban', null, null)).toBe('modal');
    expect(getPrefixUnsupportedReason('poll', null, 'create')).toBe('modal');
    expect(getPrefixUnsupportedReason('poll', null, 'list')).toBeNull();
    expect(getPrefixUnsupportedReason('ticketconfig', 'category', 'add')).toBe('modal');
    expect(getPrefixUnsupportedReason('ticketconfig', 'category', 'list')).toBeNull();
    expect(getPrefixUnsupportedReason('aiconfig', 'ai-key', 'status')).toBe('sensitive');
    expect(getPrefixUnsupportedReason('ban', null, null)).toBeNull();
    expect(isFullyUnsupported('massban')).toBe(true);
    expect(isPartiallyUnsupported('poll')).toBe(true);
    expect(isPartiallyUnsupported('ban')).toBe(false);
  });
});
