import { describe, it, expect } from 'vitest';
import {
  competitiveOnly, seasonStarts, filteredCompetitiveGames,
  dashboardRead, heroDetailRead, matchDetailRead, playerHistoryRead,
} from '../src/main/dashboard/reads';
import type { DataProvider } from '../src/main/dashboard/provider';
import type { GameRecord } from '../src/core/analytics';
import type { Result, Role } from '../src/core/model';
import { DEFAULT_MASTER_DATA, type MasterData, type SeasonEntry } from '../src/core/masterData';
import { DEFAULT_BREAK_REMINDER } from '../src/core/breakReminder';
import { DEFAULT_STALENESS } from '../src/core/staleness';
import { DEFAULT_READINESS } from '../src/core/readiness';
import { DEFAULT_SESSION_SETTINGS } from '../src/core/sessionSettings';
import { DEFAULT_GRADING_SETTINGS } from '../src/core/gradingSettings';

/**
 * Characterization tests for the read compositions extracted out of
 * `ipcHandlers.ts`. They exist to pin the two *product invariants* that the
 * extraction is there to protect — the competitive-only gate and season-window
 * resolution from the provider's effective master data — so a second consumer
 * (the MCP bridge) cannot re-derive them differently without failing here.
 */

function game(p: Partial<GameRecord> & { result: Result; map: string; role: Role }): GameRecord {
  return {
    matchId: Math.random().toString(36).slice(2),
    timestamp: Date.parse('2026-06-01T12:00:00Z'),
    account: 'Karambo',
    gameType: 'Competitive',
    heroes: ['Tracer'],
    ...p,
  };
}

/** Counts of the provider reads the compositions perform, for wiring assertions. */
interface Calls { games: number }

function fakeProvider(
  over: { games?: GameRecord[]; seasons?: SeasonEntry[] } = {},
): { provider: DataProvider; calls: Calls } {
  const calls: Calls = { games: 0 };
  const master: MasterData = {
    ...DEFAULT_MASTER_DATA,
    ...(over.seasons ? { seasons: over.seasons } : {}),
  };
  const partial: Partial<DataProvider> = {
    games: () => { calls.games += 1; return over.games ?? []; },
    demoContext: () => ({ active: false, preference: 'off', hasRealHistory: true }),
    manualTargets: () => [],
    getBreakReminder: () => DEFAULT_BREAK_REMINDER,
    getStaleness: () => DEFAULT_STALENESS,
    getReadiness: () => DEFAULT_READINESS,
    getSessionSettings: () => DEFAULT_SESSION_SETTINGS,
    getGrading: () => DEFAULT_GRADING_SETTINGS,
    rankAnchorMap: () => ({}),
    effectiveMasterData: () => master,
    pendingMatches: () => [],
  };
  return { provider: partial as DataProvider, calls };
}

describe('competitiveOnly', () => {
  it('keeps competitive rows and drops every other game type', () => {
    const games = [
      game({ result: 'Win', map: 'A', role: 'damage', gameType: 'Competitive' }),
      game({ result: 'Win', map: 'A', role: 'damage', gameType: 'Quick Play' }),
      game({ result: 'Loss', map: 'A', role: 'damage', gameType: 'Arcade' }),
      game({ result: 'Win', map: 'A', role: 'damage', gameType: 'Custom Game' }),
      game({ result: 'Loss', map: 'A', role: 'damage', gameType: 'Ranked' }),
    ];
    const kept = competitiveOnly(games);
    expect(kept.map((g) => g.gameType)).toEqual(['Competitive', 'Ranked']);
  });
});

describe('the competitive-only gate applies to every filter-scoped read', () => {
  const comp = game({ result: 'Win', map: "King's Row", role: 'damage', matchId: 'comp-1' });
  const quick = game({
    result: 'Win', map: "King's Row", role: 'damage', matchId: 'qp-1', gameType: 'Quick Play',
  });

  it('filteredCompetitiveGames excludes non-competitive rows', () => {
    const { provider } = fakeProvider({ games: [comp, quick] });
    expect(filteredCompetitiveGames(provider, {}).map((g) => g.matchId)).toEqual(['comp-1']);
  });

  it('matchDetailRead opens a competitive match but not a quickplay one', () => {
    const { provider } = fakeProvider({ games: [comp, quick] });
    expect(matchDetailRead(provider, 'comp-1', {})).not.toBeNull();
    // Gated out of the history the drill-down searches → indistinguishable from
    // an unknown id, which is exactly the contract (`MatchDetail | null`).
    expect(matchDetailRead(provider, 'qp-1', {})).toBeNull();
  });

  it('heroDetailRead and playerHistoryRead run over the gated history', () => {
    const { provider } = fakeProvider({ games: [comp, quick] });
    expect(heroDetailRead(provider, 'Tracer', {})).toBeDefined();
    expect(() => playerHistoryRead(provider, 'Someone#1234')).not.toThrow();
  });
});

describe('season-window resolution comes from the provider effective master data', () => {
  const SEASON_START = Date.parse('2026-03-07');
  const seasons: SeasonEntry[] = [{ start: SEASON_START, label: 'Test Season' }];
  // Inside the custom season, and far enough in the past that the 30-day
  // fallback window would exclude it — that asymmetry is what makes this test
  // able to tell the two code paths apart.
  const old = game({
    result: 'Win', map: 'A', role: 'damage', matchId: 'old-1',
    timestamp: Date.parse('2026-03-10T12:00:00Z'),
  });
  const filter = { days: { season: 'S:2026-03-07' } } as const;

  it('seasonStarts reads the starts off the provider', () => {
    const { provider } = fakeProvider({ seasons });
    expect(seasonStarts(provider)).toEqual([SEASON_START]);
  });

  it('resolves an off-cadence season id to its own window', () => {
    const { provider } = fakeProvider({ games: [old], seasons });
    expect(filteredCompetitiveGames(provider, filter).map((g) => g.matchId)).toEqual(['old-1']);
  });

  it('falls back to the 30-day window when the id resolves to no season', () => {
    // Same filter, same game — only the provider's season list differs. If a
    // caller ever stopped threading the provider's starts through, the previous
    // test would silently degrade into this one.
    const { provider } = fakeProvider({ games: [old], seasons: [] });
    expect(filteredCompetitiveGames(provider, filter)).toEqual([]);
  });
});

describe('dashboardRead', () => {
  it('threads the provider through and returns a payload', () => {
    const games = [game({ result: 'Win', map: 'A', role: 'damage' })];
    const { provider, calls } = fakeProvider({ games });
    const data = dashboardRead(provider, {});
    expect(data).toBeTypeOf('object');
    expect(calls.games).toBeGreaterThan(0);
  });

  it('tolerates an undefined filter set (untrusted IPC sends anything)', () => {
    const { provider } = fakeProvider({ games: [] });
    expect(() => dashboardRead(provider, undefined)).not.toThrow();
    expect(() => filteredCompetitiveGames(provider, undefined)).not.toThrow();
  });
});
