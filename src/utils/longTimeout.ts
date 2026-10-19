/**
 * setTimeout with delays longer than ~24.8 days.
 *
 * Node turns any delay > 2^31-1 ms into 1 ms, so a temporary ban of
 * 30 days or a long giveaway would run INSTANTLY. This function chains
 * partial timeouts until the target date is reached.
 */
const MAX_DELAY = 2_147_483_647;

export interface LongTimeout {
  clear(): void;
}

export function setLongTimeout(callback: () => void | Promise<void>, delayMs: number): LongTimeout {
  const target = Date.now() + Math.max(0, delayMs);
  let handle: NodeJS.Timeout;
  let cleared = false;

  const arm = () => {
    const remaining = target - Date.now();
    if (remaining > MAX_DELAY) {
      handle = setTimeout(arm, MAX_DELAY);
    } else {
      handle = setTimeout(() => {
        if (!cleared) void callback();
      }, Math.max(0, remaining));
    }
  };
  arm();

  return {
    clear() {
      cleared = true;
      clearTimeout(handle);
    },
  };
}
