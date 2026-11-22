import { containsFilteredWord, hasDisallowedLink, duplicateCountInWindow, normalizeForMatch } from '../../src/utils/automodMatchers';

// AutoMod false positives and trivial evasions.
describe('word filter', () => {
  it('catches evasions with accents, leet and invisible characters', () => {
    expect(containsFilteredWord('you are an 1d10t', ['idiot'])).toBe(true);
    expect(containsFilteredWord('ÍDIOT', ['idiot'])).toBe(true);
    expect(containsFilteredWord('id​iota', ['idiota'])).toBe(true);
    expect(containsFilteredWord('i.d.i.o.t', ['idiot'])).toBe(true);
  });
  it('no substring false positives', () => {
    expect(containsFilteredWord('my classmates', ['ass'])).toBe(false);
    expect(containsFilteredWord('passing the class', ['ass'])).toBe(false);
    expect(containsFilteredWord('kiss my ass', ['ass'])).toBe(true);
  });
  it('normalizes', () => { expect(normalizeForMatch('CAFÉ 4ñ0')).toBe('cafe ano'); });
});

describe('link filter', () => {
  it('catches links without a scheme', () => {
    expect(hasDisallowedLink('join discord.gg/abc123', [])).toBe(true);
    expect(hasDisallowedLink('see www.site.example', [])).toBe(true);
    expect(hasDisallowedLink('visit evil.xyz now', [])).toBe(true);
    expect(hasDisallowedLink('hello, how are you?', [])).toBe(false);
    expect(hasDisallowedLink('my email is a@b.com', [])).toBe(false);
  });
  it('the allow list compares the real host', () => {
    expect(hasDisallowedLink('https://www.youtube.com/watch?v=1', ['youtube.com'])).toBe(false);
    expect(hasDisallowedLink('https://m.youtube.com/x', ['youtube.com'])).toBe(false);
    expect(hasDisallowedLink('https://youtube.com.evil.example/', ['youtube.com'])).toBe(true);
    expect(hasDisallowedLink('https://evil.example/?youtube.com', ['youtube.com'])).toBe(true);
  });
});

describe('windowed duplicates', () => {
  it('messages without text never count and the window expires', () => {
    const tr: any = { lastContent: '' };
    expect(duplicateCountInWindow(tr, '', 0, 15000)).toBe(0);
    expect(duplicateCountInWindow(tr, '', 1000, 15000)).toBe(0);
    expect(duplicateCountInWindow(tr, 'lol', 0, 15000)).toBe(0);
    expect(duplicateCountInWindow(tr, 'lol', 5000, 15000)).toBe(1);
    expect(duplicateCountInWindow(tr, 'lol', 60000, 15000)).toBe(0);
  });
});
