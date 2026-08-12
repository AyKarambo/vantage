import { describe, it, expect } from 'vitest';
import {
  countedMatches, runProgress, isRunComplete, hasDrifted, suppressedMatchIds, shouldOfferRun,
  PLACEMENT_RUN_LENGTH, type PlacementRun, type PredictedRank,
} from '../src/core/placements';
import type { GameRecord } from '../src/core/analytics';
import type { RankAnchor } from '../src/core/rank';

const g = (p: Partial<GameRecord>): GameRecord => ({
  matchId: 'm', timestamp: 0, account: 'Main', role: 'damage', map: 'Ilios',
  result: 'Win', gameType: 'Competitive', heroes: [], ...p,
});

const runAt = (p: Partial<PlacementRun> = {}): PlacementRun => ({
  account: 'Main', role: 'damage', startedAt: 0, preRunAnchor: null, predictions: {}, ...p,
});

const anchorAt = (setAt: number): RankAnchor => ({ tier: 'Gold', division: 3, progressPct: 40, setAt });

const pred = (tier: string, division: number): PredictedRank => ({ tier, division });

describe('countedMatches', () => {
  it('derives counted matches from history, ascending, capped at PLACEMENT_RUN_LENGTH', () => {
    const games = Array.from({ length: 12 }, (_, i) => g({ matchId: `m${i}`, timestamp: 100 + i }));
    const run = runAt({ startedAt: 100 });
    const counted = countedMatches(games, run);
    expect(counted).toHaveLength(PLACEMENT_RUN_LENGTH);
    expect(counted.map((m) => m.matchId)).toEqual(
      ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9'],
    );
  });

  it('a backdated startedAt reclassifies earlier matches as counted', () => {
    const games = [g({ matchId: 'a', timestamp: 10 }), g({ matchId: 'b', timestamp: 20 })];
    const laterRun = runAt({ startedAt: 20 });
    expect(countedMatches(games, laterRun).map((m) => m.matchId)).toEqual(['b']);
    const backdatedRun = runAt({ startedAt: 10 });
    expect(countedMatches(games, backdatedRun).map((m) => m.matchId)).toEqual(['a', 'b']);
  });

  it('excludes non-competitive games and games from other accounts/roles', () => {
    const games = [
      g({ matchId: 'qp', timestamp: 10, gameType: 'Quick Play' }), // not competitive
      g({ matchId: 'otherRole', timestamp: 20, role: 'tank' }), // other role
      g({ matchId: 'otherAcct', timestamp: 30, account: 'Alt' }), // other account
      g({ matchId: 'counted', timestamp: 40 }),
    ];
    const run = runAt({ startedAt: 0 });
    expect(countedMatches(games, run).map((m) => m.matchId)).toEqual(['counted']);
  });

  it('a match exactly at startedAt counts (>=, unlike the rank timeline\'s strict >)', () => {
    const games = [
      g({ matchId: 'before', timestamp: 499 }),
      g({ matchId: 'exact', timestamp: 500 }),
    ];
    const run = runAt({ startedAt: 500 });
    expect(countedMatches(games, run).map((m) => m.matchId)).toEqual(['exact']);
  });
});

describe('runProgress', () => {
  it('reports counted/target and the single prediction present', () => {
    const games = [
      g({ matchId: 'a', timestamp: 10 }),
      g({ matchId: 'b', timestamp: 20 }),
      g({ matchId: 'c', timestamp: 30 }),
    ];
    const run = runAt({ startedAt: 0, predictions: { a: pred('Gold', 3) } });
    expect(runProgress(games, run)).toEqual({
      counted: 3, target: PLACEMENT_RUN_LENGTH, latestPrediction: { tier: 'Gold', division: 3 },
    });
  });

  it('picks the latest counted match with a prediction, skipping blanks', () => {
    const games = [
      g({ matchId: 'a', timestamp: 10 }),
      g({ matchId: 'b', timestamp: 20 }),
      g({ matchId: 'c', timestamp: 30 }), // no prediction — latest but blank
    ];
    const run = runAt({ startedAt: 0, predictions: { a: pred('Gold', 3), b: pred('Gold', 2) } });
    expect(runProgress(games, run).latestPrediction).toEqual({ tier: 'Gold', division: 2 });
  });

  it('no prediction at all → latestPrediction is undefined', () => {
    const games = [g({ matchId: 'a', timestamp: 10 })];
    const run = runAt({ startedAt: 0 });
    expect(runProgress(games, run).latestPrediction).toBeUndefined();
  });
});

describe('isRunComplete', () => {
  it('false under 10 counted matches, true once 10 are counted', () => {
    const nine = Array.from({ length: 9 }, (_, i) => g({ matchId: `m${i}`, timestamp: i }));
    const ten = Array.from({ length: 10 }, (_, i) => g({ matchId: `m${i}`, timestamp: i }));
    const run = runAt({ startedAt: 0 });
    expect(isRunComplete(nine, run)).toBe(false);
    expect(isRunComplete(ten, run)).toBe(true);
  });
});

describe('hasDrifted', () => {
  const tenGames = () => Array.from({ length: 10 }, (_, i) => g({ matchId: `m${i}`, timestamp: i }));

  it('false for an open run (no completedAt/completedMatchIds yet)', () => {
    const run = runAt({ startedAt: 0 });
    expect(hasDrifted(tenGames(), run)).toBe(false);
  });

  it('false for a completed run whose counted ids are unchanged', () => {
    const games = tenGames();
    const run = runAt({
      startedAt: 0, completedAt: 1000, completedMatchIds: games.map((m) => m.matchId),
    });
    expect(hasDrifted(games, run)).toBe(false);
  });

  it('true when a counted match was removed from history since completion', () => {
    const games = tenGames();
    const run = runAt({
      startedAt: 0, completedAt: 1000, completedMatchIds: games.map((m) => m.matchId),
    });
    const withoutOne = games.filter((m) => m.matchId !== 'm5');
    expect(hasDrifted(withoutOne, run)).toBe(true);
  });
});

describe('suppressedMatchIds', () => {
  it('covers open runs only — a completed run\'s matches are not suppressed', () => {
    const games = [
      g({ matchId: 'a', timestamp: 10, role: 'damage' }),
      g({ matchId: 'b', timestamp: 20, role: 'tank' }),
    ];
    const openRun = runAt({ startedAt: 0, account: 'Main', role: 'damage' });
    const completedRun = runAt({
      startedAt: 0, account: 'Main', role: 'tank', completedAt: 100, completedMatchIds: ['b'],
    });
    expect(suppressedMatchIds(games, [openRun, completedRun])).toEqual(new Set(['a']));
  });

  it('an empty run list suppresses nothing', () => {
    expect(suppressedMatchIds([g({ matchId: 'a' })], [])).toEqual(new Set());
  });
});

describe('shouldOfferRun', () => {
  const baseOpts = () => ({
    seasonStart: 1000,
    isResetSeason: true,
    anchor: anchorAt(500),
    existingRun: undefined as PlacementRun | undefined,
    declinedSeasonStarts: [] as number[],
  });

  it('true when every condition holds', () => {
    expect(shouldOfferRun(baseOpts())).toBe(true);
  });

  it('false when it is not a reset season', () => {
    expect(shouldOfferRun({ ...baseOpts(), isResetSeason: false })).toBe(false);
  });

  it('false when a run already exists for the track', () => {
    expect(shouldOfferRun({ ...baseOpts(), existingRun: runAt() })).toBe(false);
  });

  it('false when this season start was already declined', () => {
    expect(shouldOfferRun({ ...baseOpts(), declinedSeasonStarts: [1000] })).toBe(false);
  });

  it('false when the track has no anchor at all', () => {
    expect(shouldOfferRun({ ...baseOpts(), anchor: null })).toBe(false);
  });

  it('false when the anchor was already set inside (or after) the new season', () => {
    expect(shouldOfferRun({ ...baseOpts(), anchor: anchorAt(1000) })).toBe(false); // equal boundary
    expect(shouldOfferRun({ ...baseOpts(), anchor: anchorAt(1500) })).toBe(false); // after
  });
});
