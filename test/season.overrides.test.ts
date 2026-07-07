import { describe, it, expect } from 'vitest';
import {
  SEASON_STARTS,
  seasonsForData,
  seasonWindowById,
  currentSeasonWindow,
  seasonStart,
  seasonEntriesFromStarts,
} from '../src/core/season';
import { applyFilters } from '../src/core/dashboardData';
import type { GameRecord } from '../src/core/analytics';

describe('editable season starts (injected)', () => {
  // Deliberately OFF the 9-week cadence (2026-06-16 + 63d = 2026-08-18) so this
  // season is only addressable via the injected list, not by extrapolation.
  const userStart = Date.parse('2026-08-25');
  const withUser = [...SEASON_STARTS, userStart].sort((a, b) => a - b);

  it('uses defaults identically when no starts are injected (AC 19 regression)', () => {
    const now = Date.parse('2026-06-20');
    expect(seasonStart(now)).toBe(seasonStart(now, SEASON_STARTS));
  });

  it('resolves a user-added season window by id (AC 20)', () => {
    const id = `S:${new Date(userStart).toISOString().slice(0, 10)}`;
    expect(seasonWindowById(id, Date.parse('2026-09-10'), withUser)?.start).toBe(userStart);
    // Without the injected list this off-cadence date is not addressable.
    expect(seasonWindowById(id, Date.parse('2026-09-10'))).toBeUndefined();
  });

  it('lists the user season for data that falls in it (AC 20)', () => {
    const t = Date.parse('2026-08-27');
    const windows = seasonsForData([t], Date.parse('2026-09-10'), withUser);
    expect(windows.some((w) => w.start === userStart)).toBe(true);
  });

  it('makes the injected season the current one when now is inside it', () => {
    const now = Date.parse('2026-08-27');
    expect(currentSeasonWindow(now, withUser).start).toBe(userStart);
  });

  it('derives an entry per injected start, ascending', () => {
    const entries = seasonEntriesFromStarts(withUser);
    expect(entries.length).toBe(withUser.length);
    expect(entries.map((e) => e.start)).toEqual([...withUser]);
  });

  it('still extrapolates by cadence past the last known start (AC 19)', () => {
    const past = Date.parse('2026-06-16') + 63 * 86_400_000 * 2 + 10 * 86_400_000;
    // No injected list → rolls forward from the last default start by whole cadences.
    expect(seasonStart(past)).toBeGreaterThan(SEASON_STARTS[SEASON_STARTS.length - 1]);
  });
});

// Regression: every filter-scoped read (dashboard AND the sibling hero/match
// detail handlers) must resolve a user-added off-cadence season against the
// effective starts, not the built-in list — otherwise it silently falls back to
// the 30-day window on those screens (the bug the pre-PR review caught).
describe('applyFilters honors an off-cadence user season (AC 20)', () => {
  const userStart = Date.parse('2025-07-01'); // between S17 and S18 — off the cadence, in the past
  const withUser = [...SEASON_STARTS, userStart].sort((a, b) => a - b);
  const g = (iso: string): GameRecord =>
    ({ matchId: iso, timestamp: Date.parse(iso), account: 'Main', role: 'tank', map: 'Ilios', result: 'Win', gameType: 'Competitive', heroes: [] } as unknown as GameRecord);
  const games = [g('2025-06-25'), g('2025-07-15'), g('2025-09-01')]; // before / inside / after the window
  const filter = { days: { season: `S:${new Date(userStart).toISOString().slice(0, 10)}` } };

  it('scopes to the season window when the effective starts are passed', () => {
    const out = applyFilters(games, filter, withUser);
    expect(out.map((x) => x.matchId)).toEqual(['2025-07-15']);
  });

  it('does NOT resolve the same season without the effective starts (falls back)', () => {
    // Off-cadence id is unaddressable against the built-in list → 30-day fallback,
    // which (these games are >1y old) yields nothing — provably different scoping.
    const out = applyFilters(games, filter);
    expect(out.map((x) => x.matchId)).toEqual([]);
  });
});
