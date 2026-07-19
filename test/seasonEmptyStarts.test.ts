import { describe, it, expect } from 'vitest';
import {
  SEASON_STARTS, seasonStart, currentSeason, currentSeasonWindow, seasonsForData,
  seasonWindowById, migrateLegacySeasonDays,
} from '../src/core/season';
import { computeDashboard } from '../src/core/dashboardData';
import {
  DEFAULT_MASTER_DATA, mergeMasterData, removeSeasonOverride, emptyOverrides,
} from '../src/core/masterData';
import type { GameRecord } from '../src/core/analytics';

/**
 * Regression: an EMPTY effective season list used to crash the dashboard.
 *
 * It is reachable in production — the Master Data editor renders an
 * unconditional "Remove" on every season row, `removeSeasonOverride` has no
 * floor, and `mergeSeasonStarts` deletes freely — so removing all 12 default
 * seasons yielded `seasons: []`. `seasonStartsThrough` then produced an empty
 * walk that `windowFor` indexed out of bounds, and
 * `new Date(undefined).toISOString()` threw `RangeError: Invalid time value`.
 *
 * Because the overrides persist, that bricked the main screen on EVERY
 * subsequent launch, with no in-app way back. These tests pin the fallback.
 */

const NOW = Date.parse('2026-07-19T12:00:00Z');

function game(p: Partial<GameRecord> = {}): GameRecord {
  return {
    matchId: 'm-1',
    timestamp: Date.parse('2026-06-20T12:00:00Z'),
    account: 'Karambo',
    gameType: 'Competitive',
    heroes: ['Tracer'],
    result: 'Win',
    map: "King's Row",
    role: 'damage',
    ...p,
  };
}

const demo = { active: false, preference: 'off' as const, hasRealHistory: true };

describe('season helpers survive an empty starts list', () => {
  it('currentSeasonWindow returns a real window instead of throwing', () => {
    const w = currentSeasonWindow(NOW, []);
    expect(() => new Date(w.start).toISOString()).not.toThrow();
    expect(w.id).toMatch(/^S:\d{4}-\d{2}-\d{2}$/);
    expect(w.end).toBeGreaterThan(w.start);
    expect(w.start).toBeLessThanOrEqual(NOW);
  });

  it('falls back to the built-in table, matching the no-argument behaviour', () => {
    expect(currentSeasonWindow(NOW, [])).toEqual(currentSeasonWindow(NOW, SEASON_STARTS));
  });

  it('seasonsForData still lists the current season', () => {
    const seasons = seasonsForData([Date.parse('2026-06-20T12:00:00Z')], NOW, []);
    expect(seasons.length).toBeGreaterThan(0);
    for (const s of seasons) expect(s.id).toMatch(/^S:\d{4}-\d{2}-\d{2}$/);
  });

  it('seasonWindowById resolves a known id and rejects an unknown one', () => {
    const known = currentSeasonWindow(NOW, SEASON_STARTS).id;
    expect(seasonWindowById(known, NOW, [])).toBeDefined();
    // Unknown ids still return undefined so applyFilters takes its documented
    // 30-day fallback rather than showing nothing.
    expect(seasonWindowById('S:1999-01-01', NOW, [])).toBeUndefined();
  });

  it('migrateLegacySeasonDays produces an addressable id', () => {
    expect(migrateLegacySeasonDays(NOW, []).season).toMatch(/^S:\d{4}-\d{2}-\d{2}$/);
  });

  it('seasonStart and currentSeason do not throw', () => {
    expect(() => seasonStart(NOW, [])).not.toThrow();
    expect(() => currentSeason(NOW, [])).not.toThrow();
    expect(seasonStart(NOW, [])).toBeLessThanOrEqual(NOW);
  });

  it('seasonStart returns the CONTAINING season, not merely a non-throwing one', () => {
    // A second, quieter bug alongside the crash: firstOf/lastOf fell back to the
    // built-in table but the walk still iterated the caller's empty array, so
    // the loop never ran and `start` stayed at the FIRST season (Aug 2024)
    // instead of the current one. No exception — just a silently wrong answer
    // that would have mis-scoped every season-filtered read.
    expect(seasonStart(NOW, [])).toBe(seasonStart(NOW, SEASON_STARTS));
  });

  it('currentSeason yields a finite window, never an undefined end', () => {
    const w = currentSeason(NOW, []);
    expect(Number.isFinite(w.end)).toBe(true);
    expect(w.end).toBeGreaterThan(w.start);
  });
});

describe('the dashboard survives an empty season list', () => {
  it('computeDashboard does not throw with seasons: []', () => {
    const master = { ...DEFAULT_MASTER_DATA, seasons: [] };
    expect(() => computeDashboard([game()], {}, demo, {}, master, [])).not.toThrow();
  });

  it.each([
    ['no filter', {}],
    ['a day window', { days: 30 }],
    ['all time', { days: 'all' as const }],
    ['a season filter', { days: { season: 'S:2026-06-16' } }],
  ])('survives %s', (_label, filters) => {
    const master = { ...DEFAULT_MASTER_DATA, seasons: [] };
    expect(() => computeDashboard([game()], filters, demo, {}, master, [])).not.toThrow();
  });

  it('still offers season options, so the filter stays usable', () => {
    // The payload field is `options.seasons` — asserting on a mistyped path
    // here would pass vacuously and prove nothing, so this compares against
    // the healthy case rather than merely checking "not empty".
    const empty = computeDashboard([game()], {}, demo, {}, { ...DEFAULT_MASTER_DATA, seasons: [] }, []);
    const healthy = computeDashboard([game()], {}, demo, {}, DEFAULT_MASTER_DATA, []);
    expect(empty.options.seasons.length).toBeGreaterThan(0);
    expect(empty.options.seasons).toEqual(healthy.options.seasons);
  });
});

describe('the reachable user path: remove every season in the editor', () => {
  it('produces an empty effective list that no longer crashes the dashboard', () => {
    // Exactly what the Master Data editor does, once per season row.
    let overrides = emptyOverrides();
    for (const s of DEFAULT_MASTER_DATA.seasons) {
      const id = `S:${new Date(s.start).toISOString().slice(0, 10)}`;
      overrides = removeSeasonOverride(overrides, DEFAULT_MASTER_DATA, id);
    }
    const effective = mergeMasterData(DEFAULT_MASTER_DATA, overrides);

    // The empty state is still reachable — this fix makes it survivable, it
    // does not prevent it. If a floor is ever added upstream, update this.
    expect(effective.seasons).toEqual([]);
    expect(() => computeDashboard([game()], {}, demo, {}, effective, [])).not.toThrow();
  });
});

describe('the fallback only applies when the list is empty', () => {
  it('honours a user-supplied off-cadence season', () => {
    const custom = [Date.parse('2026-03-07')];
    const w = currentSeasonWindow(NOW, custom);
    // Derived from the custom list, not silently replaced by the built-ins.
    expect(w.start).toBeGreaterThanOrEqual(custom[0]);
    expect(w).not.toEqual(currentSeasonWindow(NOW, SEASON_STARTS));
  });

  it('leaves the built-in behaviour unchanged', () => {
    expect(currentSeasonWindow(NOW)).toEqual(currentSeasonWindow(NOW, SEASON_STARTS));
    expect(seasonsForData([], NOW)).toEqual(seasonsForData([], NOW, SEASON_STARTS));
  });
});
