/**
 * Component limits.
 *
 * 1. allowComponentClick: at most N clicks per user and component within a
 *    window (in memory; with sharding each shard limits its own traffic).
 * 2. coalesceUpdate: groups edits of a message (votes, entries): the first one
 *    is applied immediately and the following ones at most once every
 *    `intervalMs`, with the latest state, so a burst of clicks cannot exhaust
 *    the bot's global REST limit shared by every server.
 */

export const CLICK_LIMIT = 5;
export const CLICK_WINDOW_MS = 10_000;

const clicks = new Map<string, number[]>();

export function allowComponentClick(userId: string, componentKey: string, now = Date.now()): boolean {
  const key = `${userId}:${componentKey}`;
  const recent = (clicks.get(key) ?? []).filter(t => now - t < CLICK_WINDOW_MS);
  if (recent.length >= CLICK_LIMIT) {
    clicks.set(key, recent);
    return false;
  }
  recent.push(now);
  clicks.set(key, recent);
  if (clicks.size > 20_000) {
    for (const [k, ts] of clicks) if (!ts.some(t => now - t < CLICK_WINDOW_MS)) clicks.delete(k);
  }
  return true;
}

type Pending = { timer: NodeJS.Timeout; run: () => Promise<void> };
const pending = new Map<string, Pending>();
const lastRun = new Map<string, number>();

export function coalesceUpdate(key: string, run: () => Promise<void>, intervalMs = 2000): void {
  const existing = pending.get(key);
  if (existing) { existing.run = run; return; }

  const now = Date.now();
  const wait = Math.max(0, (lastRun.get(key) ?? 0) + intervalMs - now);
  const fire = async (r: () => Promise<void>) => {
    lastRun.set(key, Date.now());
    try { await r(); } catch { /* the edit is best-effort */ }
  };
  if (wait === 0) { void fire(run); return; }

  const entry: Pending = {
    run,
    timer: setTimeout(() => { pending.delete(key); void fire(entry.run); }, wait),
  };
  entry.timer.unref?.();
  pending.set(key, entry);
  if (lastRun.size > 20_000) {
    for (const [k, t] of lastRun) if (now - t > 60_000) lastRun.delete(k);
  }
}

/** Drops a pending grouped edit (before a final edit: close, status change). */
export function cancelCoalescedUpdate(key: string): void {
  const p = pending.get(key);
  if (p) { clearTimeout(p.timer); pending.delete(key); }
}
