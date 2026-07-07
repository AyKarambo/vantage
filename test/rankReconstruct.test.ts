import { describe, it, expect } from 'vitest';
import {
  rankAfterMatch, srDeltaForSetRank, currentRank, rankKey,
  type RankAnchorMap, type RankPosition,
} from '../src/core/rank';
import type { GameRecord } from '../src/core/analytics';

const g = (p: Partial<GameRecord>): GameRecord => ({
  matchId: 'm', timestamp: 0, account: 'Main', role: 'damage', map: 'Ilios',
  result: 'Win', gameType: 'Competitive', heroes: [], ...p,
});
const pos = (tier: string, division: number, progressPct: number): RankPosition => ({ tier, division, progressPct });
const anchors = (setAt = 100): RankAnchorMap => ({
  [rankKey('Main', 'damage')]: { tier: 'Gold', division: 3, progressPct: 40, setAt },
});
const posOf = (s: { tier: string; division: number; progressPct: number } | null) =>
  s && { tier: s.tier, division: s.division, progressPct: s.progressPct };

// Two comp games before the anchor (setAt=100), two after.
const games: GameRecord[] = [
  g({ matchId: 'm1', timestamp: 50, result: 'Win', srDelta: 20 }),
  g({ matchId: 'm2', timestamp: 80, result: 'Loss', srDelta: -10 }),
  g({ matchId: 'm3', timestamp: 150, result: 'Win', srDelta: 20 }),
  g({ matchId: 'm4', timestamp: 200, result: 'Win', srDelta: 20 }),
];

describe('rankAfterMatch — forward (at/after the anchor)', () => {
  it('matches currentRank(untilTs) exactly', () => {
    const a = anchors();
    expect(posOf(rankAfterMatch(games, a, 'Main', 'damage', 150))).toEqual(
      posOf(currentRank(games, a, 'Main', 'damage', 150)),
    );
    expect(rankAfterMatch(games, a, 'Main', 'damage', 150)!.progressPct).toBe(60); // 40 + 20
    expect(rankAfterMatch(games, a, 'Main', 'damage', 200)!.progressPct).toBe(80); // 40 + 20 + 20
  });

  it('returns null without an anchor', () => {
    expect(rankAfterMatch(games, {}, 'Main', 'damage', 150)).toBeNull();
  });
});

describe('rankAfterMatch — backward (before the anchor)', () => {
  it('reconstructs the then-rank instead of echoing the anchor', () => {
    const a = anchors();
    // Nothing happened between m2 (80) and the anchor (100) → m2 lands on the anchor.
    expect(posOf(rankAfterMatch(games, a, 'Main', 'damage', 80))).toEqual(pos('Gold', 3, 40));
    // m1 (50) is one loss (-10 at m2) below the anchor → Gold 3 50 (anchor − (−10)).
    expect(posOf(rankAfterMatch(games, a, 'Main', 'damage', 50))).toEqual(pos('Gold', 3, 50));
  });

  it('treats an intervening match with no logged SR as 0 movement (no throw)', () => {
    const withGap = [...games, g({ matchId: 'gap', timestamp: 90, result: 'Win' })]; // no srDelta
    const a = anchors();
    expect(() => rankAfterMatch(withGap, a, 'Main', 'damage', 50)).not.toThrow();
    expect(posOf(rankAfterMatch(withGap, a, 'Main', 'damage', 50))).toEqual(pos('Gold', 3, 50));
  });
});

describe('srDeltaForSetRank — back-compute the SR % from an entered rank', () => {
  it('derives the delta from the reconstructed rank-before (target is first after the anchor)', () => {
    // Only m3 present → no comp before it → rank-before = the anchor (Gold 3 40).
    const a = anchors();
    const only = [g({ matchId: 'm3', timestamp: 150, result: 'Win', srDelta: 20 })];
    // Entered "after" = Gold 2 10 (=1310 pts); anchor Gold 3 40 (=1240 pts) → +70.
    expect(srDeltaForSetRank(only, a, 'Main', 'damage', 150, pos('Gold', 2, 10))).toBe(70);
  });

  it('uses the previous match as the rank-before when one exists', () => {
    const a = anchors();
    // Rank before m4 = rank after m3 = Gold 3 60 (=1260). Entered Gold 2 20 (=1320) → +60.
    expect(srDeltaForSetRank(games, a, 'Main', 'damage', 200, pos('Gold', 2, 20))).toBe(60);
  });

  it('returns 0 without an anchor (bootstrap handles that path)', () => {
    expect(srDeltaForSetRank(games, {}, 'Main', 'damage', 200, pos('Gold', 2, 20))).toBe(0);
  });
});
