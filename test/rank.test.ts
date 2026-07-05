import { describe, it, expect } from 'vitest';
import {
  applyMatch, computeRank, currentRank, competitiveComps, rankKey, stateFromAnchor,
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
    expect(s.needsReanchor).toBe(false);
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
  it('a loss that would drop below 0% holds the division at 0% and protects it', () => {
    const s = computeRank(anchorAt('Gold', 3, 10), [loss(-20)]);
    expect(pos(s)).toEqual({ tier: 'Gold', division: 3, progressPct: 0 });
    expect(s.protected).toBe(true);
    expect(s.needsReanchor).toBe(false);
  });

  it('a win while protected clears protection and climbs from 0%', () => {
    const s = computeRank(anchorAt('Gold', 3, 10), [loss(-20), win(25)]);
    expect(pos(s)).toEqual({ tier: 'Gold', division: 3, progressPct: 25 });
    expect(s.protected).toBe(false);
  });

  it('a draw counts as "not losing" — it keeps the rank and clears protection', () => {
    const s = computeRank(anchorAt('Gold', 3, 10), [loss(-20), draw(0)]);
    expect(pos(s)).toEqual({ tier: 'Gold', division: 3, progressPct: 0 });
    expect(s.protected).toBe(false);
  });

  it('a second loss while protected demotes one division and flags a re-anchor', () => {
    const s = computeRank(anchorAt('Gold', 3, 10), [loss(-20), loss(-18)]);
    expect(s.tier).toBe('Gold');
    expect(s.division).toBe(4); // demoted (5 = lowest)
    expect(s.needsReanchor).toBe(true);
    expect(s.protected).toBe(false);
  });

  it('demotion within a tier goes to the next-lower division (1 → 2)', () => {
    const s = computeRank(anchorAt('Platinum', 1, 0), [loss(-20), loss(-20)]);
    expect(s.tier).toBe('Platinum');
    expect(s.division).toBe(2); // 1 is the highest division; below it is 2
    expect(s.needsReanchor).toBe(true);
  });

  it('demotion from the lowest division (5) drops to the tier below at division 1', () => {
    const s = computeRank(anchorAt('Platinum', 5, 0), [loss(-20), loss(-20)]);
    expect(s.tier).toBe('Gold');
    expect(s.division).toBe(1);
    expect(s.needsReanchor).toBe(true);
  });

  it('cannot demote below Bronze 5', () => {
    const s = computeRank(anchorAt('Bronze', 5, 0), [loss(-20), loss(-20)]);
    expect(pos(s).tier).toBe('Bronze');
    expect(pos(s).division).toBe(5);
  });

  it('once a re-anchor is needed, later matches are frozen until re-anchored', () => {
    const s = computeRank(anchorAt('Gold', 3, 10), [loss(-20), loss(-18), win(30), win(30)]);
    // The two trailing wins must NOT apply — the position is unknown post-demotion.
    expect(s.needsReanchor).toBe(true);
    expect(s.division).toBe(4);
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
  it('stateFromAnchor clamps a malformed anchor into range', () => {
    const s = stateFromAnchor({ tier: 'Gold', division: 9, progressPct: 250, setAt: 0 });
    expect(s.division).toBe(5);
    expect(s.progressPct).toBe(100);
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
