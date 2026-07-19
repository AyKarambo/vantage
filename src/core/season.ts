/**
 * The current Overwatch competitive season window — a pure, clock-injected
 * helper so the "This season" filter uses Blizzard's real season boundaries
 * instead of a rolling day window. No I/O and no ambient clock: callers pass
 * `now`, which keeps it unit-testable and Electron-free (core Guardrail 3).
 *
 * Approach: a table of known season start dates (grounded against Blizzard's
 * published schedule) plus a fixed nine-week cadence used to extrapolate future
 * seasons the table doesn't yet list — so the boundary stays sensible between
 * app releases instead of silently breaking when a new season starts.
 *
 * Every public function accepts an optional `starts` list (defaulting to the
 * built-in {@link SEASON_STARTS}); the editable-master-data feature passes the
 * user's effective season starts (defaults ⊕ overrides) so hand-added seasons
 * are honored without forking this logic. Callers that pass nothing get exactly
 * the pre-feature behavior.
 */

/** Nine weeks — Blizzard's stated season target; used to extrapolate past the table. */
export const SEASON_CADENCE_MS = 63 * 86_400_000;

/**
 * Known Overwatch competitive season start dates (UTC midnight), ascending. Grounded
 * against Blizzard's published schedule as of 2026-07; the last entry is the
 * current season. Append new seasons here as they are announced — anything past
 * the last entry is extrapolated by {@link SEASON_CADENCE_MS}.
 *
 * Note: in 2026 Blizzard restructured competitive into annual "story-arc" seasons
 * that restart their numbering; these boundaries are continuous regardless of the
 * labels below.
 */
export const SEASON_STARTS: readonly number[] = [
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

/**
 * The starts list to actually work from: an EMPTY list falls back to the
 * built-in table.
 *
 * Empty is reachable in production — the Master Data editor lets you remove
 * every season and `mergeSeasonStarts` has no floor — so this is a real state,
 * not a theoretical one. Normalising once, here, is what makes the whole module
 * total: guarding only the first/last reads (as this file previously did) left
 * the *walks* iterating the raw empty array, which both returned wrong answers
 * and, in `windowFor`, indexed out of bounds and threw.
 */
function usableStarts(starts: readonly number[]): readonly number[] {
  return starts.length ? starts : SEASON_STARTS;
}

/** First/last of an ascending starts list (defensive against an empty list). */
function firstOf(starts: readonly number[]): number {
  return usableStarts(starts)[0];
}
function lastOf(starts: readonly number[]): number {
  const list = usableStarts(starts);
  return list[list.length - 1];
}

/**
 * The start instant (ms) of the competitive season containing `now`: the latest
 * table entry at or before `now`; extrapolated forward by whole cadences when
 * `now` is past the last known season, or backward from the first entry when
 * `now` precedes the table (defensive — production always passes the real now).
 * Total — never throws; always `<= now`.
 */
export function seasonStart(now: number, starts: readonly number[] = SEASON_STARTS): number {
  const list = usableStarts(starts);
  const first = firstOf(list);
  const last = lastOf(list);
  if (now < first) {
    const stepsBack = Math.ceil((first - now) / SEASON_CADENCE_MS);
    return first - stepsBack * SEASON_CADENCE_MS;
  }
  let start = first;
  // Must walk the NORMALISED list: iterating the caller's raw (possibly empty)
  // array here skipped the loop entirely and returned the first season as the
  // "containing" one, which is wrong rather than merely unhelpful.
  for (const s of list) {
    if (s <= now) start = s;
    else break;
  }
  if (start === last) {
    // Past the last known season → roll forward by whole cadences.
    start += Math.floor((now - last) / SEASON_CADENCE_MS) * SEASON_CADENCE_MS;
  }
  return start;
}

/**
 * The `[start, end)` window of the season containing `now`. `end` is the next
 * known table boundary when `start` sits inside the table, otherwise one cadence
 * after `start` (the last-known or extrapolated season's estimated end).
 */
export function currentSeason(
  now: number,
  starts: readonly number[] = SEASON_STARTS,
): { start: number; end: number } {
  const list = usableStarts(starts);
  const first = firstOf(list);
  const last = lastOf(list);
  const start = seasonStart(now, list);
  if (start < first || start >= last) return { start, end: start + SEASON_CADENCE_MS };
  // Normalised list again: `.find` over the caller's raw empty array would
  // yield `end: undefined` and poison every downstream window comparison.
  const next = list.find((s) => s > start) as number;
  return { start, end: next };
}

/**
 * A single addressable competitive season window, used by the time filter's
 * season options (spec D2). `id` is derived from the start instant so it is
 * stable across app restarts and survives future label/calendar changes.
 */
export interface SeasonWindow {
  /** Stable addressing key — the season start as an ISO date, e.g. `'S:2026-06-16'`. */
  id: string;
  /** Inclusive start instant (ms, matches {@link seasonStart}/{@link currentSeason}). */
  start: number;
  /** Exclusive end instant (ms). */
  end: number;
  /** Human label — `'2026 Season 3'`, or a date range for pre-2026 seasons. */
  label: string;
  /** Calendar year the season starts in. */
  year: number;
  /** 1-based season number within {@link SeasonWindow.year}; resets every year. */
  seasonOfYear: number;
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** `'Feb 10'` from a UTC instant — used to build the pre-2026 date-range label. */
function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Year-numbering label: `'<year> Season N'`, N resetting to 1 every calendar year. */
function numberedLabel(year: number, seasonOfYear: number): string {
  return `${year} Season ${seasonOfYear}`;
}

/**
 * Builds the ascending list of season start instants from the first known
 * season through (and including) the season containing `now`, extrapolating
 * past the last entry by whole {@link SEASON_CADENCE_MS} steps as needed. This
 * is the single walk that both {@link currentSeasonWindow} and
 * {@link seasonsForData} use to derive `year`/`seasonOfYear` consistently.
 */
function seasonStartsThrough(now: number, starts: readonly number[] = SEASON_STARTS): number[] {
  // Same defense as firstOf/lastOf, which this walk previously lacked: an
  // explicitly EMPTY list is reachable in production — the master-data editor
  // lets you remove every season, and `mergeSeasonStarts` has no floor — and it
  // produced an empty walk that `windowFor` then indexed out of bounds, so
  // `new Date(undefined).toISOString()` threw and took the whole dashboard down
  // on every load. Falling back to the built-in table keeps the season filter
  // usable instead, honouring `currentSeasonWindow`'s documented "never throws".
  const base = starts.length ? starts : SEASON_STARTS;
  const list = [...base];
  const containing = seasonStart(now, base);
  while (list[list.length - 1] < containing) {
    list.push(list[list.length - 1] + SEASON_CADENCE_MS);
  }
  return list;
}

/**
 * The `[start, end)` + year/label metadata for the season start at `starts[i]`.
 * `starts` must be ascending and cover at least `i`; used internally so the
 * per-year counter and pre-2026 date-range fallback are computed once, in one
 * place, for both {@link currentSeasonWindow} and {@link seasonsForData}.
 */
function windowFor(starts: readonly number[], i: number): SeasonWindow {
  const start = starts[i];
  const end = i + 1 < starts.length ? starts[i + 1] : start + SEASON_CADENCE_MS;
  const year = new Date(start).getUTCFullYear();
  let seasonOfYear = 1;
  for (let j = i - 1; j >= 0; j--) {
    if (new Date(starts[j]).getUTCFullYear() !== year) break;
    seasonOfYear++;
  }
  const endYear = new Date(end).getUTCFullYear();
  // A year-spanning window (e.g. S20: Dec 2025 – Feb 2026) must show both years —
  // otherwise the label reads as if it ends in the start year.
  const label = year < 2026
    ? endYear !== year
      ? `${shortDate(start)}, ${year} – ${shortDate(end)}, ${endYear}`
      : `${shortDate(start)} – ${shortDate(end)}, ${year}`
    : numberedLabel(year, seasonOfYear);
  return { id: `S:${new Date(start).toISOString().slice(0, 10)}`, start, end, label, year, seasonOfYear };
}

/**
 * The season window containing `now`, always addressable (spec D2 "current
 * season always listed"). Total — never throws: a `now` that precedes the
 * first known season (e.g. a reset system clock) clamps to that first season
 * rather than looking up an index that isn't in the table.
 */
export function currentSeasonWindow(now: number, starts: readonly number[] = SEASON_STARTS): SeasonWindow {
  const list = seasonStartsThrough(now, starts);
  const containing = seasonStart(now, starts);
  const i = list.indexOf(containing);
  return windowFor(list, i === -1 ? 0 : i);
}

/**
 * Translates the legacy `days: 'season'` sentinel (pre-D2) into an addressable
 * `{ season: id }` for the current named season — the one place this
 * migration is implemented so every persisted-filter reader (renderer
 * `store.ts`'s `vantageFilters` load, `prefs.ts`'s saved-preset migration)
 * shares the exact same fallback instead of each re-deriving it.
 */
export function migrateLegacySeasonDays(
  now: number,
  starts: readonly number[] = SEASON_STARTS,
): { season: string } {
  return { season: currentSeasonWindow(now, starts).id };
}

/**
 * All season windows that contain at least one of `timestamps`, plus the
 * current season (always included even with zero matching timestamps —
 * fresh-install case), newest first. The list purposefully ignores the
 * account switcher — callers pass competitive-match timestamps across every
 * account (spec D2 / Resolved Q13).
 */
export function seasonsForData(
  timestamps: readonly number[],
  now: number,
  starts: readonly number[] = SEASON_STARTS,
): SeasonWindow[] {
  const current = currentSeasonWindow(now, starts);
  const oldest = timestamps.length > 0 ? Math.min(...timestamps) : now;
  const list = seasonStartsThrough(Math.max(now, oldest), starts);
  const windows: SeasonWindow[] = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i] > now) break;
    const w = windowFor(list, i);
    if (w.id === current.id) continue; // added once, below
    if (timestamps.some((t) => t >= w.start && t < w.end)) windows.push(w);
  }
  windows.push(current);
  windows.sort((a, b) => b.start - a.start);
  return windows;
}

/**
 * The window for a given season `id` (as produced by {@link currentSeasonWindow}
 * or {@link seasonsForData}), or `undefined` if `id` isn't addressable —
 * callers (`applyFilters`) fall back to a default window in that case.
 */
export function seasonWindowById(
  id: string,
  now: number,
  starts: readonly number[] = SEASON_STARTS,
): SeasonWindow | undefined {
  const match = /^S:(\d{4}-\d{2}-\d{2})$/.exec(id);
  if (!match) return undefined;
  const start = Date.parse(match[1]);
  if (Number.isNaN(start)) return undefined;
  const list = seasonStartsThrough(Math.max(now, start), starts);
  const i = list.indexOf(start);
  if (i === -1) return undefined;
  return windowFor(list, i);
}

/**
 * The `{ start, label }` entries for every season in `starts`, labels derived
 * over the *whole* list (so per-year numbering stays correct when the user adds
 * a season mid-table). Used to build the editable-master-data season snapshot —
 * structurally a `SeasonEntry[]` without importing the master-data module (which
 * imports this one), keeping the dependency one-directional.
 */
export function seasonEntriesFromStarts(
  starts: readonly number[] = SEASON_STARTS,
): Array<{ start: number; label: string }> {
  const list = [...starts].sort((a, b) => a - b);
  return list.map((_, i) => {
    const w = windowFor(list, i);
    return { start: w.start, label: w.label };
  });
}
