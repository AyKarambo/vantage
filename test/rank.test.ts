import { describe, it, expect } from 'vitest';
import {
  applyMatch, computeRank, currentRank, competitiveComps, rankKey, stateFromAnchor, ladderPoints,
  type RankAnchor, type RankState,
} from '../src/core/rank';
import type { GameRecord } from '../src/core/analytics';

const anchorAt = (tier: string, division: number, progressPct: number, setAt = 0): RankAnchor => ({
  tier, division, progressPct, setAt,
});

const win = (srDelta: number) => ({ result: 'Win' as const, srDelta });
const loss = (srDelta: number) => ({ result: 'Loss' as const, srDelta });
const draw = (srDelta = 0) => ({ result: 'Draw' as const, srDelta });

const pos = (s: RankState) => ({ tier: s.tier, division: s.division, progressPct: s.progressPct });

describe('rank engine — basic movement', () => {
  it('no matches → the anchor position, unprotected', () => {
    const s = computeRank(anchorAt('Gold', 3, 40), []);
    expect(pos(s)).toEqual({ tier: 'Gold', division: 3, progressPct: 40 });
    expect(s.protected).toBe(false);
  });

  it('a win adds % within the division', () => {
    const s = computeRank(anchorAt('Gold', 3, 40), [win(22)]);
    expect(pos(s)).toEqual({ tier: 'Gold', division: 3, progressPct: 62 });
  });

  it('a loss subtracts % within the division', () => {
    const s = computeRank(anchorAt('Gold', 3, 40), [loss(-19)]);
    expect(pos(s)).toEqual({ tier: 'Gold', division: 3, progressPct: 21 });
  });

  it('a draw moves by its logged delta (usually ~0) and clears nothing', () => {
    const s = computeRank(anchorAt('Gold', 3, 40), [draw(0)]);
    expect(pos(s)).toEqual({ tier: 'Gold', division: 3, progressPct: 40 });
  });
});

describe('rank engine — promotion (division decreases toward 1)', () => {
  it('crossing 100% promotes one division and carries the remainder', () => {
    const s = computeRank(anchorAt('Gold', 3, 80), [win(30)]);
    expect(pos(s)).toEqual({ tier: 'Gold', division: 2, progressPct: 10 });
  });

  it('crossing 100% at division 1 promotes to the next tier at division 5', () => {
    const s = computeRank(anchorAt('Gold', 1, 90), [win(20)]);
    expect(pos(s)).toEqual({ tier: 'Platinum', division: 5, progressPct: 10 });
  });

  it('caps at Champion 1, 100% — cannot promote past the top', () => {
    const s = computeRank(anchorAt('Champion', 1, 90), [win(50), win(50)]);
    expect(pos(s)).toEqual({ tier: 'Champion', division: 1, progressPct: 100 });
  });
});

describe('rank engine — rank protection', () => {
  it('a loss that would drop below 0% holds the division and keeps the negative carry', () => {
    const s = computeRank(anchorAt('Gold', 3, 10), [loss(-20)]);
    expect(pos(s)).toEqual({ tier: 'Gold', division: 3, progressPct: -10 });
    expect(s.protected).toBe(true);
  });

  it('a win while protected pays down the negative carry before climbing', () => {
    const s = computeRank(anchorAt('Gold', 3, 10), [loss(-20), win(25)]);
    expect(pos(s)).toEqual({ tier: 'Gold', division: 3, progressPct: 15 }); // -10 + 25
    expect(s.protected).toBe(false);
  });

  it('a win that does not fully clear the carry stays protected', () => {
    const s = computeRank(anchorAt('Gold', 3, 10), [loss(-20), win(6)]);
    expect(pos(s)).toEqual({ tier: 'Gold', division: 3, progressPct: -4 }); // -10 + 6
    expect(s.protected).toBe(true);
  });

  it('regression: a protected loss\'s negative carry offsets the next win\'s gain', () => {
    // Reported bug: game showed -19% while protected; next match won +26%, and the
    // app added the full +26% on top of 0 instead of the -19% carry (should land at 7%).
    const afterLoss = computeRank(anchorAt('Gold', 3, 1), [loss(-20)]);
    expect(pos(afterLoss)).toEqual({ tier: 'Gold', division: 3, progressPct: -19 });
    expect(afterLoss.protected).toBe(true);

    const afterWin = computeRank(anchorAt('Gold', 3, 1), [loss(-20), win(26)]);
    expect(pos(afterWin)).toEqual({ tier: 'Gold', division: 3, progressPct: 7 }); // -19 + 26
    expect(afterWin.protected).toBe(false);
  });

  it('a draw does not fabricate a climb — it neither clears protection nor loses ground', () => {
    const s = computeRank(anchorAt('Gold', 3, 10), [loss(-20), draw(0)]);
    expect(pos(s)).toEqual({ tier: 'Gold', division: 3, progressPct: -10 });
    expect(s.protected).toBe(true);
  });

  it('a second loss while protected demotes one division, carrying the buffer', () => {
    const s = computeRank(anchorAt('Gold', 3, 10), [loss(-20), loss(-18)]);
    // Buffer at demotion = 10 - 20 - 18 = -28 below the Gold 3 floor → Gold 4 at 100-28.
    expect(pos(s)).toEqual({ tier: 'Gold', division: 4, progressPct: 72 });
    expect(s.protected).toBe(false);
  });

  it('demotion within a tier goes to the next-lower division (1 → 2)', () => {
    const s = computeRank(anchorAt('Platinum', 1, 0), [loss(-20), loss(-20)]);
    // -40 below the Platinum 1 floor → Platinum 2 at 100-40.
    expect(pos(s)).toEqual({ tier: 'Platinum', division: 2, progressPct: 60 });
  });

  it('demotion from the lowest division (5) drops to the tier below at division 1', () => {
    const s = computeRank(anchorAt('Platinum', 5, 0), [loss(-20), loss(-20)]);
    expect(pos(s)).toEqual({ tier: 'Gold', division: 1, progressPct: 60 });
  });

  it('cannot demote below Bronze 5 — floors at 0%', () => {
    const s = computeRank(anchorAt('Bronze', 5, 0), [loss(-20), loss(-20)]);
    expect(pos(s)).toEqual({ tier: 'Bronze', division: 5, progressPct: 0 });
    expect(s.protected).toBe(false);
  });

  it('matches after a demotion keep tracking from the new position (no freeze)', () => {
    const s = computeRank(anchorAt('Gold', 3, 10), [loss(-20), loss(-18), win(30), win(30)]);
    // Demote to Gold 4 · 72%, then the two wins climb from there: +30 → Gold 3 · 2%, +30 → 32%.
    expect(pos(s)).toEqual({ tier: 'Gold', division: 3, progressPct: 32 });
    expect(s.protected).toBe(false);
  });

  it('carries the exact buffer into the lower division (Gold 3 −18% → Gold 4 · 82%)', () => {
    const s = computeRank(anchorAt('Gold', 3, 10), [loss(-20), loss(-8)]); // buffer -18
    expect(pos(s)).toEqual({ tier: 'Gold', division: 4, progressPct: 82 });
    expect(s.protected).toBe(false);
  });

  it('a big win clears the buffer and promotes out of protection (Gold 3 −8% + 130 → Gold 2 · 22%)', () => {
    const s = computeRank(anchorAt('Gold', 3, -8), [win(130)]);
    expect(pos(s)).toEqual({ tier: 'Gold', division: 2, progressPct: 22 });
    expect(s.protected).toBe(false);
  });

  it('cascades across multiple divisions and a tier boundary on a deep demotion', () => {
    const s = computeRank(anchorAt('Gold', 5, 5), [loss(-10), loss(-250)]); // buffer -255 below the Gold 5 floor
    expect(pos(s)).toEqual({ tier: 'Silver', division: 3, progressPct: 45 });
    expect(s.protected).toBe(false);
  });

  it('a huge demoting loss floors at Bronze 5 · 0% without wrapping', () => {
    const s = computeRank(anchorAt('Bronze', 5, -5), [loss(-500)]);
    expect(pos(s)).toEqual({ tier: 'Bronze', division: 5, progressPct: 0 });
    expect(s.protected).toBe(false);
  });
});

describe('rank engine — editability (recompute forward)', () => {
  it('changing a past delta changes the final rank', () => {
    const before = computeRank(anchorAt('Gold', 3, 40), [win(10), win(10), win(10)]);
    const after = computeRank(anchorAt('Gold', 3, 40), [win(30), win(10), win(10)]);
    expect(pos(before)).toEqual({ tier: 'Gold', division: 3, progressPct: 70 });
    expect(pos(after)).toEqual({ tier: 'Gold', division: 3, progressPct: 90 });
    expect(after.progressPct).not.toBe(before.progressPct);
  });
});

describe('applyMatch / stateFromAnchor primitives', () => {
  it('stateFromAnchor clamps a malformed anchor into the upper range, unprotected', () => {
    const s = stateFromAnchor({ tier: 'Gold', division: 9, progressPct: 250, setAt: 0 });
    expect(s.division).toBe(5);
    expect(s.progressPct).toBe(100);
    expect(s.protected).toBe(false);
  });

  it('a negative anchor % is a rank-protection carry (kept negative, protected)', () => {
    const s = stateFromAnchor(anchorAt('Gold', 3, -19));
    expect(pos(s)).toEqual({ tier: 'Gold', division: 3, progressPct: -19 });
    expect(s.protected).toBe(true);
  });

  it('an extreme negative anchor % floors at -100 (still protected)', () => {
    const s = stateFromAnchor(anchorAt('Gold', 3, -250));
    expect(s.progressPct).toBe(-100);
    expect(s.protected).toBe(true);
  });

  it('a win after a protected (negative) anchor pays the carry down', () => {
    // Anchored at Gold 3, -19 (in protection); a +22 win clears the buffer and climbs.
    const s = computeRank(anchorAt('Gold', 3, -19), [win(22)]);
    expect(pos(s)).toEqual({ tier: 'Gold', division: 3, progressPct: 3 });
    expect(s.protected).toBe(false);
  });

  it('a loss after a protected (negative) anchor demotes, carrying the buffer', () => {
    const s = computeRank(anchorAt('Gold', 3, -19), [loss(-5)]);
    // -24 below the Gold 3 floor → Gold 4 at 100-24.
    expect(pos(s)).toEqual({ tier: 'Gold', division: 4, progressPct: 76 });
  });

  it('a match with no srDelta does not move a mid-division rank', () => {
    const s = applyMatch(stateFromAnchor(anchorAt('Gold', 3, 40)), { result: 'Win' });
    expect(pos(s)).toEqual({ tier: 'Gold', division: 3, progressPct: 40 });
  });
});

describe('rank timeline — GameRecord bridge', () => {
  const g = (p: Partial<GameRecord>): GameRecord => ({
    matchId: 'm', timestamp: 0, account: 'Main', role: 'damage', map: 'Ilios',
    result: 'Win', gameType: 'Competitive', heroes: [], ...p,
  });

  it('rankKey is per account + role', () => {
    expect(rankKey('Main', 'tank')).toBe('Main::tank');
    expect(rankKey('Alt', 'support')).toBe('Alt::support');
  });

  it('pulls only competitive games for the (account, role) after the anchor, in order', () => {
    const games = [
      g({ matchId: 'before', timestamp: 5, result: 'Win', srDelta: 99 }), // before anchor → excluded
      g({ matchId: 'qp', timestamp: 20, gameType: 'Quick Play', srDelta: 50 }), // not comp → excluded
      g({ matchId: 'tank', timestamp: 30, role: 'tank', srDelta: 40 }), // other role → excluded
      g({ matchId: 'alt', timestamp: 40, account: 'Alt', srDelta: 40 }), // other account → excluded
      g({ matchId: 'a', timestamp: 50, result: 'Win', srDelta: 20 }),
      g({ matchId: 'b', timestamp: 60, result: 'Loss', srDelta: -10 }),
    ];
    const comps = competitiveComps(games, 'Main', 'damage', 10);
    expect(comps).toEqual([{ result: 'Win', srDelta: 20 }, { result: 'Loss', srDelta: -10 }]);
  });

  it('currentRank returns null without an anchor and computes from one when present', () => {
    const games = [g({ timestamp: 50, result: 'Win', srDelta: 22 })];
    expect(currentRank(games, {}, 'Main', 'damage')).toBeNull();
    const anchors = { [rankKey('Main', 'damage')]: anchorAt('Gold', 3, 40, 10) };
    const s = currentRank(games, anchors, 'Main', 'damage');
    expect(pos(s!)).toEqual({ tier: 'Gold', division: 3, progressPct: 62 });
  });

  it('currentRank respects untilTs (rank as of a given match)', () => {
    const anchors = { [rankKey('Main', 'damage')]: anchorAt('Gold', 3, 40, 10) };
    const games = [
      g({ matchId: 'a', timestamp: 50, result: 'Win', srDelta: 20 }),
      g({ matchId: 'b', timestamp: 60, result: 'Win', srDelta: 20 }),
    ];
    expect(currentRank(games, anchors, 'Main', 'damage', 50)!.progressPct).toBe(60);
    expect(currentRank(games, anchors, 'Main', 'damage', 60)!.progressPct).toBe(80);
  });
});

describe('rank engine — ladder scale', () => {
  it('ladderPoints is a monotonic 0..4000 scale, 500 per tier / 100 per division', () => {
    expect(ladderPoints({ tier: 'Bronze', division: 5, progressPct: 0 })).toBe(0);
    expect(ladderPoints({ tier: 'Champion', division: 1, progressPct: 100 })).toBe(4000);
    expect(ladderPoints({ tier: 'Gold', division: 3, progressPct: 40 })).toBe(1240);
    // A rank-protection buffer sits just below the division floor.
    expect(ladderPoints({ tier: 'Gold', division: 3, progressPct: -18 })).toBe(1182);
  });

  it('conserves ladder points across promotion, protection and demotion (no drift)', () => {
    const anchor = anchorAt('Gold', 3, 40);
    // Within-division loss, a first-dip protected loss, a second-dip demotion, a
    // multi-division win out of the new division, and a within-division loss — all on
    // one shared carry, so the running total maps 1:1 onto the ladder scale.
    const s = computeRank(anchor, [loss(-50), loss(-30), win(200), loss(-25)]);
    const sum = -50 - 30 + 200 - 25;
    expect(ladderPoints(s)).toBe(ladderPoints(anchor) + sum);
  });
});
