/**
 * Measured-target grading settings — the user-facing "partial credit" margin:
 * how close to a measured threshold (on the failing side) still counts as a
 * `partial` grade rather than a `missed`. One global setting, applied to every
 * measured-grade computation (matches list, match detail, Focus hit-rate,
 * sparks, Notion export) so the number is consistent everywhere. The hard-coded
 * fallback lives at {@link ./targets/measured DEFAULT_PARTIAL_MARGIN}; this
 * module is the persisted, editable layer over it (mirrors `SessionSettings`).
 */
import { DEFAULT_PARTIAL_MARGIN } from './targets/measured';

export interface GradingSettings {
  /** Partial-credit margin as a fraction of the threshold, 0..0.5 (0.2 = 20%). */
  partialMargin: number;
}

export const DEFAULT_GRADING_SETTINGS: GradingSettings = { partialMargin: DEFAULT_PARTIAL_MARGIN };

/** Clamp the margin into a sane 0..0.5 band, rounded to whole percentage points. */
const clampMargin = (n: number): number => Math.round(Math.max(0, Math.min(0.5, n)) * 100) / 100;

/** Coerce a partial/untrusted settings object into a valid, clamped one. */
export function normalizeGradingSettings(s: Partial<GradingSettings> | undefined): GradingSettings {
  const m = s?.partialMargin;
  return {
    partialMargin: Number.isFinite(m) ? clampMargin(m as number) : DEFAULT_GRADING_SETTINGS.partialMargin,
  };
}
