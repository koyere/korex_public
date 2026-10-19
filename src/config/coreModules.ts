/**
 * Módulos gratuitos que el owner puede activar/desactivar desde Ajustes.
 * Se guardan en `Guild.enabledAddons` junto a los addons de pago.
 *
 * Semántica de `enabledAddons` (única fuente de verdad, usar siempre estos helpers):
 *  - Sin fila de guild o array vacío (servidores antiguos) → todos los módulos core activos.
 *  - Si el owner desactiva TODOS los módulos core se guarda el marcador
 *    CORE_MODULES_OFF, para no confundirlo con el caso "array vacío".
 *  - En cualquier otro caso el array es autoritativo.
 */
export const CORE_MODULES = ['moderation', 'welcome', 'levels', 'music', 'logging', 'economy'] as const;
export type CoreModule = (typeof CORE_MODULES)[number];

export const CORE_MODULES_OFF = '_core_off';

export function isCoreModule(name: string): name is CoreModule {
  return (CORE_MODULES as readonly string[]).includes(name);
}

/** Lista efectiva de entradas (módulos core + addons) para un valor guardado. */
export function effectiveEnabledAddons(stored: string[] | null | undefined): string[] {
  if (!stored || stored.length === 0) return [...CORE_MODULES];
  return stored.filter((a) => a !== CORE_MODULES_OFF);
}

/** ¿Está activo un módulo core en este guild? */
export function isCoreModuleEnabled(stored: string[] | null | undefined, moduleName: string): boolean {
  return effectiveEnabledAddons(stored).includes(moduleName);
}

/**
 * Valor a guardar tras añadir una entrada (p. ej. al activar un addon de pago)
 * sin perder los módulos core de un guild antiguo con array vacío.
 */
export function withEntryAdded(stored: string[] | null | undefined, entry: string): string[] {
  const base = !stored || stored.length === 0 ? [...CORE_MODULES] : stored;
  return [...new Set([...base, entry])];
}

/** Valor a guardar tras quitar una entrada. */
export function withEntryRemoved(stored: string[] | null | undefined, entry: string): string[] {
  const base = !stored || stored.length === 0 ? [...CORE_MODULES] : stored;
  return normalizeStored(base.filter((a) => a !== entry));
}

/** Evita guardar un array vacío (significaría "todo activo"). */
export function normalizeStored(list: string[]): string[] {
  const clean = [...new Set(list.filter((a) => a !== CORE_MODULES_OFF))];
  const hasCore = clean.some(isCoreModule);
  return hasCore ? clean : [...clean, CORE_MODULES_OFF];
}
