import { describe, it, expect } from 'vitest';
import { rankSeries } from '../src/core/rank/series';
import { rankToPoints } from '../src/core/rank/scalar';
import { rankKey, type RankAnchorMap } from '../src/core/rank/types';
import type { GameRecord } from '../src/core/analytics';
import type { Result, Role } from '../src/core/model';

let seq = 0;
function game(p: Partial<GameRecord> & { result: Result; timestamp: number }): GameRecord {
  return {
    matchId: p.matchId ?? `g-${++seq}`,
    account: 'Main',
    role: 'damage' as Role,
    map: "King's Row",
    gameType: 'Competitive',
    heroes: ['Tracer'],
    ...p,
  };
}

const anchorAt = (setAt: number, tier = 'Gold', division = 3, progressPct = 50): RankAnchorMap =>
  ({ [rankKey('Main', 'damage')]: { tier, division, progressPct, setAt } });

describe('rankSeries', () => {
  it('plots forward and backward points, oldest first, with correct point scalars', () => {
    const anchors = anchorAt(5_000);
    const games = [
      game({ result: 'Loss', timestamp: 2_000, srDelta: -18 }),
      game({ result: 'Win', timestamp: 7_000, srDelta: 22 }),
      game({ result: 'Win', timestamp: 1_000, srDelta: 21 }),
    ];
    const series = rankSeries(games, anchors, 'Main', 'damage');
    expect(series.map((p) => p.timestamp)).toEqual([1_000, 2_000, 7_000]);
    // Every point's `points` matches rankToPoints of its own tier/division/progressPct.
    for (const p of series) {
      expect(p.points).toBe(rankToPoints({ tier: p.tier, division: p.division, progressPct: p.progressPct }));
    }
  });

  it('marks a stored rankAtStart as NOT estimated, and a derived one as estimated', () => {
    const anchors = anchorAt(5_000);
    const stored = { tier: 'Platinum', division: 4, progressPct: 12 };
    const games = [
      game({ result: 'Win', timestamp: 1_000, rankAtStart: stored }), // forward of nothing — has its own stored snapshot
      game({ result: 'Win', timestamp: 7_000, srDelta: 22 }), // forward-calculated from the anchor
    ];
    const series = rankSeries(games, anchors, 'Main', 'damage');
    expect(series[0].estimated).toBe(false);
    expect(series[0].tier).toBe('Platinum');
    expect(series[1].estimated).toBe(true);
  });

  it('omits matches with no entering rank (no anchor) instead of guessing', () => {
    const games = [game({ result: 'Win', timestamp: 1_000 })];
    expect(rankSeries(games, {}, 'Main', 'damage')).toEqual([]);
  });

  it('omits matches inside an open placement run (suppressed)', () => {
    const anchors = anchorAt(5_000);
    const suppressedGame = game({ result: 'Win', timestamp: 7_000, srDelta: 22 });
    const series = rankSeries([suppressedGame], anchors, 'Main', 'damage', {
      suppressed: new Set([suppressedGame.matchId]),
    });
    expect(series).toEqual([]);
  });

  it('omits pre-reset matches when a reset boundary is supplied', () => {
    // The reset boundary sits AT-OR-BEFORE the anchor's setAt (5,000) — a
    // boundary between the anchor and a later match would make the anchor
    // itself stale (a defensive, practically-unreachable case entering.ts's
    // own comments call out), which isn't what this test is pinning.
    const anchors = anchorAt(5_000);
    const before = game({ result: 'Win', timestamp: 1_000, srDelta: 21 });
    const after = game({ result: 'Win', timestamp: 7_000, srDelta: 22 });
    const series = rankSeries([before, after], anchors, 'Main', 'damage', {
      resetBefore: new Map([[rankKey('Main', 'damage'), 3_000]]),
    });
    expect(series.map((p) => p.matchId)).toEqual([after.matchId]);
  });

  it('only includes matches for the requested account+role track', () => {
    const anchors: RankAnchorMap = {
      ...anchorAt(5_000),
      [rankKey('Alt', 'support')]: { tier: 'Bronze', division: 2, progressPct: 10, setAt: 5_000 },
    };
    const mine = game({ result: 'Win', timestamp: 1_000, srDelta: 10 });
    const other = game({ result: 'Win', timestamp: 1_000, srDelta: 10, account: 'Alt', role: 'support' as Role });
    const series = rankSeries([mine, other], anchors, 'Main', 'damage');
    expect(series.map((p) => p.matchId)).toEqual([mine.matchId]);
  });
});
