import { describe, it, expect } from 'vitest';
import { rankToPoints, pointsToRank, computeRank, TIERS, type RankAnchor } from '../src/core/rank';
import type { RankPosition } from '../src/core/rank';

const pos = (tier: string, division: number, progressPct: number): RankPosition => ({ tier, division, progressPct });

describe('rank scalar — rankToPoints / pointsToRank', () => {
  it('anchors the endpoints', () => {
    expect(rankToPoints(pos('Bronze', 5, 0))).toBe(0);
    expect(pointsToRank(0)).toEqual(pos('Bronze', 5, 0));
    // Champion 1 100% is the ceiling.
    const top = rankToPoints(pos('Champion', 1, 100));
    expect(pointsToRank(top)).toEqual(pos('Champion', 1, 100));
    expect(pointsToRank(top + 999)).toEqual(pos('Champion', 1, 100)); // clamps, no 9th tier
  });

  it('steps division and tier boundaries cleanly', () => {
    expect(pointsToRank(400)).toEqual(pos('Bronze', 1, 0)); // top division of Bronze
    expect(pointsToRank(500)).toEqual(pos('Silver', 5, 0)); // next tier, lowest division
    expect(rankToPoints(pos('Silver', 5, 0))).toBe(500);
  });

  it('round-trips arbitrary in-range positions', () => {
    for (const tier of TIERS) {
      for (const division of [5, 4, 3, 2, 1]) {
        for (const pct of [0, 1, 37, 62, 99]) {
          const p = pos(tier, division, pct);
          expect(pointsToRank(rankToPoints(p))).toEqual(p);
        }
      }
    }
  });

  it('clamps below zero to Bronze 5 0%', () => {
    expect(pointsToRank(-250)).toEqual(pos('Bronze', 5, 0));
  });

  it('agrees with the forward engine on climbs (no protection)', () => {
    // Mirror the engine's promotion cases through the scalar: anchor + Σδ.
    const climb = (anchor: RankPosition, delta: number): RankPosition =>
      pointsToRank(rankToPoints(anchor) + delta);
    expect(climb(pos('Gold', 3, 80), 30)).toEqual(pos('Gold', 2, 10));
    expect(climb(pos('Gold', 1, 90), 20)).toEqual(pos('Platinum', 5, 10));

    // And equals what computeRank produces for the same single win.
    const viaEngine = computeRank({ tier: 'Gold', division: 3, progressPct: 80, setAt: 0 } as RankAnchor, [
      { result: 'Win', srDelta: 30 },
    ]);
    expect(pointsToRank(rankToPoints(pos('Gold', 3, 80)) + 30)).toEqual({
      tier: viaEngine.tier,
      division: viaEngine.division,
      progressPct: viaEngine.progressPct,
    });
  });
});
