import { describe, it, expect } from 'vitest';
import {
  countedMatches, trackMatchesFrom, runProgress, isRunComplete, isAwaitingRank, hasDrifted,
  suppressedMatchIds, shouldOfferRun,
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
      countedMatchIds: ['a', 'b', 'c'],
    });
  });

  it('reports the ids of the counted matches, in order and capped at ten', () => {
    const games = Array.from({ length: 13 }, (_, i) => g({ matchId: `m${i}`, timestamp: 100 + i }));
    const { countedMatchIds } = runProgress(games, runAt({ startedAt: 100 }));
    expect(countedMatchIds).toHaveLength(PLACEMENT_RUN_LENGTH);
    // m10..m12 are on the track but past the cap — they are ordinary games, and
    // this is exactly what lets a caller tell them apart from the counted ten.
    expect(countedMatchIds).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9']);
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

describe('trackMatchesFrom', () => {
  it('selects the same matches as countedMatches but WITHOUT the ten-match cap', () => {
    const games = Array.from({ length: 14 }, (_, i) => g({ matchId: `m${i}`, timestamp: 100 + i }));
    const run = runAt({ startedAt: 100 });
    expect(countedMatches(games, run)).toHaveLength(PLACEMENT_RUN_LENGTH);
    const all = trackMatchesFrom(games, run);
    expect(all).toHaveLength(14);
    // Same filter and ordering — the cap is the only difference.
    expect(all.slice(0, PLACEMENT_RUN_LENGTH)).toEqual(countedMatches(games, run));
  });

  it('applies the same account/role/competitive/startedAt filter', () => {
    const games = [
      g({ matchId: 'before', timestamp: 50 }),
      g({ matchId: 'at', timestamp: 100 }), // >= startedAt, like countedMatches
      g({ matchId: 'otherRole', timestamp: 110, role: 'tank' }),
      g({ matchId: 'otherAccount', timestamp: 120, account: 'Alt' }),
      g({ matchId: 'quickPlay', timestamp: 130, gameType: 'Quick Play' }),
      g({ matchId: 'after', timestamp: 140 }),
    ];
    const run = runAt({ startedAt: 100 });
    expect(trackMatchesFrom(games, run).map((m) => m.matchId)).toEqual(['at', 'after']);
  });
});

describe('isAwaitingRank', () => {
  const tenGames = () => Array.from({ length: 10 }, (_, i) => g({ matchId: `m${i}`, timestamp: i }));

  it('false mid-run — the run is waiting on matches, not on the player', () => {
    const nine = Array.from({ length: 9 }, (_, i) => g({ matchId: `m${i}`, timestamp: i }));
    expect(isAwaitingRank(nine, runAt({ startedAt: 0 }))).toBe(false);
  });

  it('true at the target while completedAt is still unset — the reported bug state', () => {
    expect(isAwaitingRank(tenGames(), runAt({ startedAt: 0 }))).toBe(true);
  });

  it('false once the revealed rank has been confirmed', () => {
    const games = tenGames();
    const run = runAt({
      startedAt: 0, completedAt: 9, completedMatchIds: games.map((m) => m.matchId),
    });
    expect(isAwaitingRank(games, run)).toBe(false);
  });

  it('stays true past the target — extra matches never confirm a rank on the player\'s behalf', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => g({ matchId: `m${i}`, timestamp: i }));
    expect(isAwaitingRank(twelve, runAt({ startedAt: 0 }))).toBe(true);
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

  it('suppresses PAST the tenth match while the run is still open — those matches have no settled rank to move', () => {
    const games = Array.from({ length: 13 }, (_, i) => g({ matchId: `m${i}`, timestamp: i }));
    const openRun = runAt({ startedAt: 0 });
    const ids = suppressedMatchIds(games, [openRun]);
    expect(ids.size).toBe(13);
    // m10..m12 fall outside countedMatches' ten-match cap but inside the run's
    // "no settled rank yet" window — the ±% they carry must not reach the PRE-run anchor.
    expect(ids.has('m10')).toBe(true);
    expect(ids.has('m12')).toBe(true);
  });

  it('re-admits everything the moment the run completes, including the surplus', () => {
    const games = Array.from({ length: 13 }, (_, i) => g({ matchId: `m${i}`, timestamp: i }));
    const completed = runAt({
      startedAt: 0, completedAt: 9,
      completedMatchIds: games.slice(0, PLACEMENT_RUN_LENGTH).map((m) => m.matchId),
    });
    expect(suppressedMatchIds(games, [completed])).toEqual(new Set());
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
