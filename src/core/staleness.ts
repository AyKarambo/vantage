/**
 * Staleness of an active improvement target — a pure predicate over how long a
 * target has been the current focus. Improvement works by rotating focus once a
 * habit is internalized; a target that has been active for many calendar days,
 * or across many matches, has gone stale and is worth rotating out or archiving.
 *
 * Pure and Electron-free like the rest of `core/`: the renderer supplies `now`
 * (`Date.now()`) so this module never reads the clock itself and stays testable.
 */

export interface StalenessSettings {
  /** Flag a target stale once it has been active at least this many days. */
  staleAfterDays: number;
  /** …or across at least this many matches since it was activated (whichever first). */
  staleAfterMatches: number;
}

export const DEFAULT_STALENESS: StalenessSettings = { staleAfterDays: 14, staleAfterMatches: 30 };

const DAY_MS = 86_400_000;

const clampDays = (n: number): number => Math.max(1, Math.min(365, Math.round(n)));
const clampMatches = (n: number): number => Math.max(1, Math.min(500, Math.round(n)));

/** Coerce a partial/untrusted settings object into a valid, clamped one. */
export function normalizeStaleness(s: Partial<StalenessSettings> | undefined): StalenessSettings {
  return {
    staleAfterDays: clampDays(s?.staleAfterDays ?? DEFAULT_STALENESS.staleAfterDays),
    staleAfterMatches: clampMatches(s?.staleAfterMatches ?? DEFAULT_STALENESS.staleAfterMatches),
  };
}

/**
 * Whether an active target has gone stale: active for at least `staleAfterDays`
 * calendar days OR across at least `staleAfterMatches` matches since activation,
 * whichever comes first. Each signal is checked independently, so a missing
 * `activatedAt` (a legacy row that never re-activated) still can't be stale on
 * the day axis, and a missing match count can't be stale on the match axis.
 */
export function isStale(
  activatedAt: number | undefined,
  matchesSinceActive: number | undefined,
  now: number,
  settings: StalenessSettings,
): boolean {
  const s = normalizeStaleness(settings);
  if (activatedAt !== undefined && (now - activatedAt) / DAY_MS >= s.staleAfterDays) return true;
  if (matchesSinceActive !== undefined && matchesSinceActive >= s.staleAfterMatches) return true;
  return false;
}
