/**
 * Automatic warning escalation (Moderation). Disabled by default; stored in
 * `moderation_configs.warnEscalationEnabled` / `warnEscalationSteps` and used by /setup,
 * the Moderation panel and ModerationService.checkAutoActions.
 *
 * With escalation enabled, the highest step reached is applied (like the original
 * /setup: 3 → timeout, 5 → kick, 7 → ban); if no step applies, the single
 * threshold (warnThreshold / warnAction) still works.
 */

export type WarnEscalationAction = 'timeout' | 'kick' | 'ban';

export interface WarnEscalationStep {
  warnings: number;
  action: WarnEscalationAction;
  /** Minutes: duration of the timeout or temporary ban (no value = permanent ban). */
  duration?: number | null;
}

export const WARN_ESCALATION_MAX_STEPS = 5;
/** Maximum Discord timeout: 28 days. */
export const WARN_ESCALATION_MAX_TIMEOUT_MIN = 40_320;
/** Temporary ban: up to 1 year. */
export const WARN_ESCALATION_MAX_BAN_MIN = 525_600;

export const DEFAULT_WARN_ESCALATION: WarnEscalationStep[] = [
  { warnings: 3, action: 'timeout', duration: 60 },
  { warnings: 5, action: 'kick' },
  { warnings: 7, action: 'ban', duration: 1440 },
];

/**
 * Validates and normalizes the steps. Returns null if the format is invalid
 * (the API responds 400); ascending order by warning count, no duplicates.
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

/** Saved steps (or the defaults if empty or corrupted). */
export function readWarnEscalation(raw: unknown): WarnEscalationStep[] {
  return normalizeWarnEscalation(raw) ?? DEFAULT_WARN_ESCALATION;
}

/** Applicable step for a warning count (the highest reached) or null. */
export function pickWarnEscalationStep(steps: WarnEscalationStep[], warningCount: number): WarnEscalationStep | null {
  let best: WarnEscalationStep | null = null;
  for (const s of steps) if (warningCount >= s.warnings && (!best || s.warnings > best.warnings)) best = s;
  return best;
}
