import { checkUserRegex, testUserRegex, compileUserRegex, _clearUserRegexCache, USER_REGEX_MAX_INPUT } from '../../src/utils/userRegex';
import { AutoResponseService } from '../../src/services/AutoResponseService';

// Regression G·BOT-03 (audit 2026-11-21): these patterns passed the previous
// filter and blocked the bot process with exponential backtracking.
const EVIL = ['(\\w+\\s?)+$', '(a|aa)+$', '((a+))+$', '(a+b?)+$', '(.*,)+x', '(a+)+$'];

describe('userRegex (RE2)', () => {
  beforeEach(() => _clearUserRegexCache());

  it.each(EVIL)('evaluates %s in linear time', (pattern) => {
    const text = 'a'.repeat(USER_REGEX_MAX_INPUT) + '!';
    const t0 = Date.now();
    testUserRegex(pattern, false, text);
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it('bounds the evaluated text', () => {
    const text = 'x'.repeat(USER_REGEX_MAX_INPUT) + 'needle';
    expect(testUserRegex('needle', true, text)).toBe(false);
    expect(testUserRegex('needle', true, 'there is a needle')).toBe(true);
  });

  it('respects case and Unicode', () => {
    expect(testUserRegex('hola', false, 'HOLA mundo')).toBe(true);
    expect(testUserRegex('hola', true, 'HOLA mundo')).toBe(false);
    expect(testUserRegex('^ñ+$', false, 'ÑÑñ')).toBe(true);
  });

  it('rejects syntax RE2 does not support, with a reason', () => {
    expect(checkUserRegex('(a)\\1')).toMatchObject({ ok: false, problem: 'unsupported' });
    expect(checkUserRegex('(?=a)b')).toMatchObject({ ok: false, problem: 'unsupported' });
    expect(checkUserRegex('(?<=a)b')).toMatchObject({ ok: false, problem: 'unsupported' });
  });

  it('rejects empty, too long or invalid patterns', () => {
    expect(checkUserRegex('')).toMatchObject({ ok: false, problem: 'empty' });
    expect(checkUserRegex(42 as unknown)).toMatchObject({ ok: false, problem: 'empty' });
    expect(checkUserRegex('a'.repeat(201))).toMatchObject({ ok: false, problem: 'too_long' });
    expect(checkUserRegex('(abc')).toMatchObject({ ok: false, problem: 'invalid' });
  });

  it('an invalid pattern never matches or throws', () => {
    expect(compileUserRegex('(abc', false)).toBeNull();
    expect(testUserRegex('(abc', false, '(abc')).toBe(false);
  });

  it('AutoResponseService.isSafeRegex accepts slow patterns (no longer dangerous) and rejects invalid ones', () => {
    for (const p of EVIL) expect(AutoResponseService.isSafeRegex(p)).toBe(true);
    expect(AutoResponseService.isSafeRegex('(a)\\1')).toBe(false);
  });
});
