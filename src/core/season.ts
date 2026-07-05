/**
 * The current Overwatch 2 competitive season window — a pure, clock-injected
 * helper so the "This season" filter uses Blizzard's real season boundaries
 * instead of a rolling day window. No I/O and no ambient clock: callers pass
 * `now`, which keeps it unit-testable and Electron-free (core Guardrail 3).
 *
 * Approach: a table of known season start dates (grounded against Blizzard's
 * published schedule) plus a fixed nine-week cadence used to extrapolate future
 * seasons the table doesn't yet list — so the boundary stays sensible between
 * app releases instead of silently breaking when a new season starts.
 */

/** Nine weeks — Blizzard's stated season target; used to extrapolate past the table. */
export const SEASON_CADENCE_MS = 63 * 86_400_000;

/**
 * Known OW2 competitive season start dates (UTC midnight), ascending. Grounded
 * against Blizzard's published schedule as of 2026-07; the last entry is the
 * current season. Append new seasons here as they are announced — anything past
 * the last entry is extrapolated by {@link SEASON_CADENCE_MS}.
 *
 * Note: in 2026 Blizzard restructured competitive into annual "story-arc" seasons
 * that restart their numbering; these boundaries are continuous regardless of the
 * labels below.
 */
const SEASON_STARTS: readonly number[] = [
  '2024-08-20', // S12 New Frontiers
  '2024-10-15', // S13 Spellbinder
  '2024-12-10', // S14 Hazard
  '2025-02-18', // S15 Honor and Glory
  '2025-04-22', // S16 Stadium
  '2025-06-24', // S17 Powered Up!
  '2025-08-26', // S18
  '2025-10-14', // S19 Haunted Masquerade
  '2025-12-09', // S20 Vendetta
  '2026-02-10', // 2026 arc S1
  '2026-04-14', // 2026 arc S2 Summit
  '2026-06-16', // 2026 arc S3 Into the Tiger's Den
].map((d) => Date.parse(d));

const FIRST = SEASON_STARTS[0];
const LAST = SEASON_STARTS[SEASON_STARTS.length - 1];

/**
 * The start instant (ms) of the competitive season containing `now`: the latest
 * table entry at or before `now`; extrapolated forward by whole cadences when
 * `now` is past the last known season, or backward from the first entry when
 * `now` precedes the table (defensive — production always passes the real now).
 * Total — never throws; always `<= now`.
 */
export function seasonStart(now: number): number {
  if (now < FIRST) {
    const stepsBack = Math.ceil((FIRST - now) / SEASON_CADENCE_MS);
    return FIRST - stepsBack * SEASON_CADENCE_MS;
  }
  let start = FIRST;
  for (const s of SEASON_STARTS) {
    if (s <= now) start = s;
    else break;
  }
  if (start === LAST) {
    // Past the last known season → roll forward by whole cadences.
    start += Math.floor((now - LAST) / SEASON_CADENCE_MS) * SEASON_CADENCE_MS;
  }
  return start;
}

/**
 * The `[start, end)` window of the season containing `now`. `end` is the next
 * known table boundary when `start` sits inside the table, otherwise one cadence
 * after `start` (the last-known or extrapolated season's estimated end).
 */
export function currentSeason(now: number): { start: number; end: number } {
  const start = seasonStart(now);
  if (start < FIRST || start >= LAST) return { start, end: start + SEASON_CADENCE_MS };
  const next = SEASON_STARTS.find((s) => s > start) as number;
  return { start, end: next };
}
