/**
 * Escalado automático por avisos (Moderación). Desactivado por defecto; se guarda en
 * `moderation_configs.warnEscalationEnabled` / `warnEscalationSteps` y lo usan /setup,
 * el panel de Moderación y ModerationService.checkAutoActions.
 *
 * Con el escalado activado se aplica el escalón más alto alcanzado (como el /setup
 * original: 3 → silencio, 5 → expulsión, 7 → baneo); si ningún escalón aplica, sigue
 * funcionando el umbral único (warnThreshold / warnAction).
 */

export type WarnEscalationAction = 'timeout' | 'kick' | 'ban';

export interface WarnEscalationStep {
  warnings: number;
  action: WarnEscalationAction;
  /** Minutos: duración del silencio o del baneo temporal (sin valor = baneo permanente). */
  duration?: number | null;
}

export const WARN_ESCALATION_MAX_STEPS = 5;
/** Máximo de un timeout de Discord: 28 días. */
export const WARN_ESCALATION_MAX_TIMEOUT_MIN = 40_320;
/** Baneo temporal: hasta 1 año. */
export const WARN_ESCALATION_MAX_BAN_MIN = 525_600;

export const DEFAULT_WARN_ESCALATION: WarnEscalationStep[] = [
  { warnings: 3, action: 'timeout', duration: 60 },
  { warnings: 5, action: 'kick' },
  { warnings: 7, action: 'ban', duration: 1440 },
];

/**
 * Valida y normaliza los escalones. Devuelve null si el formato no es válido
 * (la API responde 400); orden ascendente por número de avisos, sin repetidos.
 */
export function normalizeWarnEscalation(raw: unknown): WarnEscalationStep[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > WARN_ESCALATION_MAX_STEPS) return null;
  const steps: WarnEscalationStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const warnings = Number((item as any).warnings);
    const action = (item as any).action;
    if (!Number.isInteger(warnings) || warnings < 1 || warnings > 50) return null;
    if (action !== 'timeout' && action !== 'kick' && action !== 'ban') return null;
    let duration: number | null = null;
    const rawDuration = (item as any).duration;
    if (action !== 'kick' && rawDuration !== null && rawDuration !== undefined && rawDuration !== '') {
      duration = Number(rawDuration);
      const max = action === 'timeout' ? WARN_ESCALATION_MAX_TIMEOUT_MIN : WARN_ESCALATION_MAX_BAN_MIN;
      if (!Number.isInteger(duration) || duration < 1 || duration > max) return null;
    }
    if (action === 'timeout' && !duration) duration = 60;
    steps.push({ warnings, action, ...(action === 'kick' ? {} : { duration }) });
  }
  const unique = new Set(steps.map(s => s.warnings));
  if (unique.size !== steps.length) return null;
  return steps.sort((a, b) => a.warnings - b.warnings);
}

/** Escalones guardados (o los de por defecto si están vacíos o dañados). */
export function readWarnEscalation(raw: unknown): WarnEscalationStep[] {
  return normalizeWarnEscalation(raw) ?? DEFAULT_WARN_ESCALATION;
}

/** Escalón aplicable para un número de avisos (el más alto alcanzado) o null. */
export function pickWarnEscalationStep(steps: WarnEscalationStep[], warningCount: number): WarnEscalationStep | null {
  let best: WarnEscalationStep | null = null;
  for (const s of steps) if (warningCount >= s.warnings && (!best || s.warnings > best.warnings)) best = s;
  return best;
}
