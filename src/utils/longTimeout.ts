/**
 * setTimeout con delays de más de ~24,8 días.
 *
 * Node convierte cualquier delay > 2^31-1 ms en 1 ms, así que un ban temporal de
 * 30 días o un sorteo largo se ejecutaban AL INSTANTE. Esta función encadena
 * timeouts parciales hasta llegar a la fecha objetivo.
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
