import RE2 from 're2';

/**
 * User-defined regular expressions (auto-responses, filters).
 *
 * They are compiled with RE2, a linear-time engine without backtracking: no
 * pattern can block the process (ReDoS), however complex the evaluated text.
 * The bot serves every server from a single Node process, so a slow regex in
 * one server used to stall all the others.
 *
 * RE2 does not support backreferences (\1) or lookaround ((?=…), (?<=…)); those
 * patterns are rejected when saved, with a reason that can be shown to the user.
 */

export const USER_REGEX_MAX_LENGTH = 200;
/** Maximum text evaluated per message (Discord allows up to 4,000 with Nitro). */
export const USER_REGEX_MAX_INPUT = 2000;
const CACHE_MAX_ENTRIES = 2000;

export type UserRegexProblem = 'empty' | 'too_long' | 'unsupported' | 'invalid';

export interface UserRegexCheck {
  ok: boolean;
  problem?: UserRegexProblem;
  /** Technical engine message (for logs only, not for the user). */
  detail?: string;
}

/** Validates a pattern before saving it. */
export function checkUserRegex(pattern: unknown): UserRegexCheck {
  if (typeof pattern !== 'string' || pattern.length === 0) return { ok: false, problem: 'empty' };
  if (pattern.length > USER_REGEX_MAX_LENGTH) return { ok: false, problem: 'too_long' };
  try {
    new RE2(pattern, 'u');
    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Errors from syntax RE2 does not implement (valid in JavaScript)
    const unsupported = /invalid perl operator|invalid escape sequence|backreference/i.test(detail);
    return { ok: false, problem: unsupported ? 'unsupported' : 'invalid', detail };
  }
}

/** Compatibility with the previous name: true if the pattern can be used. */
export function isSafeUserRegex(pattern: unknown): boolean {
  return checkUserRegex(pattern).ok;
}

// Bounded cache (simple insertion-order LRU): processMessage runs on every
// message and each server may have several patterns.
const cache = new Map<string, RE2 | null>();

/** Compiles (with caching) a user pattern; null if it is not valid. */
export function compileUserRegex(pattern: string, caseSensitive: boolean): RE2 | null {
  const key = `${caseSensitive ? 's' : 'i'}:${pattern}`;
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  let compiled: RE2 | null = null;
  if (checkUserRegex(pattern).ok) {
    try {
      compiled = new RE2(pattern, caseSensitive ? 'u' : 'iu');
    } catch {
      compiled = null;
    }
  }
  cache.set(key, compiled);
  if (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return compiled;
}

/** Evaluates a user pattern against bounded text. Never throws. */
export function testUserRegex(pattern: string, caseSensitive: boolean, text: string): boolean {
  const re = compileUserRegex(pattern, caseSensitive);
  if (!re) return false;
  try {
    return re.test(text.slice(0, USER_REGEX_MAX_INPUT));
  } catch {
    return false;
  }
}

/** For tests only. */
export function _clearUserRegexCache(): void {
  cache.clear();
}
