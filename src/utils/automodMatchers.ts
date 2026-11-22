/**
 * AutoMod matchers.
 *
 * - Words: compared after normalizing (accents, zero-width characters, common
 *   substitutions such as 0→o or @→a) and as whole words, not substrings; long
 *   words are also searched with separators removed ("w.o.r.d").
 * - Links: also without a scheme (discord.gg/…, www.…, domains with a common TLD),
 *   and the allow list compares the real host (equal or subdomain), not a substring
 *   of the whole URL.
 */

const ZERO_WIDTH = new RegExp('[\\u200B-\\u200F\\u2028-\\u202F\\u2060-\\u206F\\uFEFF\\u00AD]', 'g');
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '|': 'l' };

/** Normalized text for matching: no accents or invisible characters, lowercase, no leet. */
export function normalizeForMatch(text: string): string {
  return String(text ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(ZERO_WIDTH, '')
    .toLowerCase()
    .replace(/[0134578@$!|]/g, c => LEET[c] ?? c);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Does it contain any filtered word as a whole word (after normalizing)? */
export function containsFilteredWord(content: string, words: string[]): boolean {
  const text = normalizeForMatch(content);
  const squashed = text.replace(/[^a-z0-9]/g, '');
  return words.some(raw => {
    const word = normalizeForMatch(raw).trim();
    if (!word) return false;
    // Multi-word expressions: spaces are kept
    const re = new RegExp(`(^|[^a-z0-9])${escapeRe(word)}(?=[^a-z0-9]|$)`);
    if (re.test(text)) return true;
    // Evasion with separators (w.o.r.d): only for long words, so short words don't
    // bring back substring false positives
    const compact = word.replace(/[^a-z0-9]/g, '');
    return compact.length >= 5 && squashed.includes(compact) && /[^a-z0-9\s]/.test(text);
  });
}

const COMMON_TLDS = 'com|net|org|io|gg|co|me|xyz|ru|tk|ly|link|app|dev|site|online|shop|top|info|biz|club|live|store|tv|cc|es|mx|ar|uk|de|fr|us|ca|br';
const LINK_RE = new RegExp(
  [
    'https?:\\/\\/[^\\s<>]+',
    'www\\.[^\\s<>]+',
    '(?:discord(?:app)?\\.com\\/invite|discord\\.gg)\\/[^\\s<>]+',
    `(?<![@\\w.-])(?:[a-z0-9-]+\\.)+(?:${COMMON_TLDS})(?![a-z0-9-])(?:\\/[^\\s<>]*)?`,
  ].join('|'),
  'gi',
);

/** Host of a link (lowercase, without www.) or null. */
export function linkHost(link: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(link) ? link : `http://${link}`);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Allowed host from what the administrator typed (with or without scheme/path). */
function allowedHost(entry: string): string | null {
  return linkHost(entry.trim());
}

/** Links in the text (with and without a scheme). */
export function extractLinks(content: string): string[] {
  return String(content ?? '').match(LINK_RE) ?? [];
}

/**
 * Is there any link that isn't allowed? Without an allow list, every link is. An
 * allowed host covers its subdomains (youtube.com allows m.youtube.com), but not
 * "youtube.com.evil.example" or "evil.example/?youtube.com".
 */
export function hasDisallowedLink(content: string, allowedLinks: string[]): boolean {
  const links = extractLinks(content);
  if (links.length === 0) return false;
  if (allowedLinks.length === 0) return true;
  const allowed = allowedLinks.map(allowedHost).filter((h): h is string => !!h);
  return links.some(link => {
    const host = linkHost(link);
    if (!host) return true;
    return !allowed.some(a => host === a || host.endsWith(`.${a}`));
  });
}

/**
 * Windowed duplicate counter: only repeats of the same text within `windowMs`
 * count, and messages without text (images, stickers) never count as duplicates.
 */
export function duplicateCountInWindow(
  tracker: { lastContent: string; duplicateTimes?: number[] },
  content: string,
  now: number,
  windowMs: number,
): number {
  const text = String(content ?? '').trim();
  if (!text) return 0;
  if (text !== tracker.lastContent) {
    tracker.lastContent = text;
    tracker.duplicateTimes = [now];
    return 0;
  }
  tracker.duplicateTimes = [...(tracker.duplicateTimes ?? []).filter(t => now - t < windowMs), now];
  return tracker.duplicateTimes.length - 1;
}
