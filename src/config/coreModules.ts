/**
 * Free modules the owner can enable/disable from Settings.
 * They are stored in `Guild.enabledAddons` alongside paid addons.
 *
 * Semantics of `enabledAddons` (single source of truth, always use these helpers):
 *  - No guild row or empty array (older servers) → all core modules active.
 *  - If the owner disables ALL core modules, the marker
 *    CORE_MODULES_OFF is stored, so it is not confused with the "empty array" case.
 *  - In any other case the array is authoritative.
 */
export const CORE_MODULES = ['moderation', 'welcome', 'levels', 'music', 'logging', 'economy'] as const;
export type CoreModule = (typeof CORE_MODULES)[number];

export const CORE_MODULES_OFF = '_core_off';

export function isCoreModule(name: string): name is CoreModule {
  return (CORE_MODULES as readonly string[]).includes(name);
}

/** Effective list of entries (core modules + addons) for a stored value. */
export function effectiveEnabledAddons(stored: string[] | null | undefined): string[] {
  if (!stored || stored.length === 0) return [...CORE_MODULES];
  return stored.filter((a) => a !== CORE_MODULES_OFF);
}

/** Is a core module active in this guild? */
export function isCoreModuleEnabled(stored: string[] | null | undefined, moduleName: string): boolean {
  return effectiveEnabledAddons(stored).includes(moduleName);
}

/**
 * Value to store after adding an entry (e.g. when enabling a paid addon)
 * without losing the core modules of an older guild with an empty array.
 */
export function withEntryAdded(stored: string[] | null | undefined, entry: string): string[] {
  const base = !stored || stored.length === 0 ? [...CORE_MODULES] : stored;
  return [...new Set([...base, entry])];
}

/** Value to store after removing an entry. */
export function withEntryRemoved(stored: string[] | null | undefined, entry: string): string[] {
  const base = !stored || stored.length === 0 ? [...CORE_MODULES] : stored;
  return normalizeStored(base.filter((a) => a !== entry));
}

/** Avoids storing an empty array (it would mean "everything active"). */
export function normalizeStored(list: string[]): string[] {
  const clean = [...new Set(list.filter((a) => a !== CORE_MODULES_OFF))];
  const hasCore = clean.some(isCoreModule);
  return hasCore ? clean : [...clean, CORE_MODULES_OFF];
}
