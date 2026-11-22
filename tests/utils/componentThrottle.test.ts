import { allowComponentClick, coalesceUpdate, cancelCoalescedUpdate, CLICK_LIMIT, CLICK_WINDOW_MS } from '../../src/utils/componentThrottle';
import { channelScopeIds, isChannelNsfw, isVisibleToEveryone } from '../../src/utils/channelScope';

// Component click limit and grouped edits; threads inherit their parent channel's rules.
describe('click limit', () => {
  it('at most CLICK_LIMIT clicks per user and component within the window', () => {
    const t0 = 1_000_000;
    const results = Array.from({ length: CLICK_LIMIT + 2 }, (_, i) => allowComponentClick('u1', 'poll_vote_*', t0 + i));
    expect(results.filter(Boolean)).toHaveLength(CLICK_LIMIT);
    expect(allowComponentClick('u2', 'poll_vote_*', t0)).toBe(true);           // another user
    expect(allowComponentClick('u1', 'giveaway_*', t0)).toBe(true);            // another component
    expect(allowComponentClick('u1', 'poll_vote_*', t0 + CLICK_WINDOW_MS + 10)).toBe(true); // new window
  });
});

describe('grouped edits', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('first edit is immediate; a burst collapses into one edit with the latest state', async () => {
    const calls: number[] = [];
    for (let i = 1; i <= 10; i++) coalesceUpdate('poll:p1', async () => { calls.push(i); }, 2000);
    expect(calls).toEqual([1]);
    await jest.advanceTimersByTimeAsync(2100);
    expect(calls).toEqual([1, 10]);
  });

  it('a final edit cancels the pending one', async () => {
    const calls: string[] = [];
    coalesceUpdate('poll:p2', async () => { calls.push('a'); }, 2000);
    coalesceUpdate('poll:p2', async () => { calls.push('b'); }, 2000);
    cancelCoalescedUpdate('poll:p2');
    await jest.advanceTimersByTimeAsync(3000);
    expect(calls).toEqual(['a']);
  });
});

describe('effective channel', () => {
  const parent = { id: 'c1', nsfw: true };
  const thread = { id: 't1', parentId: 'c1', parent, isThread: () => true };
  it('a thread inherits NSFW and the ignore list from its parent channel', () => {
    expect(isChannelNsfw(thread)).toBe(true);
    expect(channelScopeIds(thread)).toEqual(['t1', 'c1']);
    expect(isChannelNsfw({ id: 'c2', nsfw: false, isThread: () => false })).toBe(false);
    expect(channelScopeIds({ id: 'c2', isThread: () => false })).toEqual(['c2']);
  });
});

describe('visibility for @everyone', () => {
  const guild = { roles: { everyone: { id: 'g1' } } };
  const chan = (visible: boolean) => ({ id: 'c', isThread: () => false, permissionsFor: () => ({ has: () => visible }) });
  it('public channel yes, private no; a private thread never', () => {
    expect(isVisibleToEveryone(chan(true), guild)).toBe(true);
    expect(isVisibleToEveryone(chan(false), guild)).toBe(false);
    expect(isVisibleToEveryone({ id: 't', type: 12, isThread: () => true, parent: chan(true) }, guild)).toBe(false);
    expect(isVisibleToEveryone({ id: 't', type: 11, isThread: () => true, parent: chan(false) }, guild)).toBe(false);
  });
});
