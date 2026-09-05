import { describe, it, expect } from 'vitest';
import { enteringRanks, enteringRankAt } from '../src/core/rank/entering';
import { rankEnteringMatch } from '../src/core/rank/reconstruct';
import { rankKey, type RankAnchorMap } from '../src/core/rank/types';
import { rankToPoints } from '../src/core/rank/scalar';
import type { GameRecord } from '../src/core/analytics';
import type { Result, Role } from '../src/core/model';

/**
 * The batched entering-rank fold. The contract that matters is that it agrees
 * with `rankEnteringMatch` — the same function the `rankAtStart` WRITE path uses
 * — on every match, so a derived table cell and a stored snapshot can never
 * disagree about the arithmetic. Everything else here pins the masks and the
 * honesty caveats.
 */

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

describe('enteringRanks — agreement with rankEnteringMatch', () => {
  it('matches the single-match oracle on every match, forward and backward of the anchor', () => {
    const anchors = anchorAt(5_000);
    const games = [
      game({ result: 'Win', timestamp: 1_000, srDelta: 21 }),
      game({ result: 'Loss', timestamp: 2_000, srDelta: -18 }),
      game({ result: 'Win', timestamp: 4_000, srDelta: 23 }),
      game({ result: 'Loss', timestamp: 6_000, srDelta: -20 }),
      game({ result: 'Win', timestamp: 7_000, srDelta: 22 }),
      game({ result: 'Draw', timestamp: 8_000 }),
    ];
    const batch = enteringRanks(games, anchors);
    for (const g of games) {
      const oracle = rankEnteringMatch(games, anchors, g.account, g.role, g.timestamp);
      const cell = batch.get(g.matchId);
      expect(cell, g.matchId).toBeDefined();
      expect(cell!.position, `${g.matchId} @ ${g.timestamp}`)
        .toEqual(oracle ? { tier: oracle.tier, division: oracle.division, progressPct: oracle.progressPct } : undefined);
    }
  });

  it('agrees with the oracle across several accounts and roles at once', () => {
    const anchors: RankAnchorMap = {
      ...anchorAt(5_000),
      [rankKey('Alt', 'support')]: { tier: 'Bronze', division: 2, progressPct: 10, setAt: 5_000 },
      [rankKey('Main', 'tank')]: { tier: 'Diamond', division: 1, progressPct: 80, setAt: 3_000 },
    };
    const games = [
      game({ result: 'Win', timestamp: 1_000, srDelta: 20 }),
      game({ result: 'Loss', timestamp: 6_000, srDelta: -20 }),
      game({ result: 'Win', timestamp: 2_000, srDelta: 25, account: 'Alt', role: 'support' }),
      game({ result: 'Win', timestamp: 7_000, srDelta: 25, account: 'Alt', role: 'support' }),
      game({ result: 'Loss', timestamp: 4_000, srDelta: -30, account: 'Main', role: 'tank' }),
    ];
    const batch = enteringRanks(games, anchors);
    for (const g of games) {
      const oracle = rankEnteringMatch(games, anchors, g.account, g.role, g.timestamp);
      expect(batch.get(g.matchId)!.position, g.matchId)
        .toEqual(oracle ? { tier: oracle.tier, division: oracle.division, progressPct: oracle.progressPct } : undefined);
    }
  });

  // Two matches at the same instant entered on the same rank — neither moved first.
  it('gives tied timestamps ONE shared entering value, both sides of the anchor', () => {
    const anchors = anchorAt(5_000);
    const games = [
      game({ matchId: 'back-a', result: 'Win', timestamp: 2_000, srDelta: 20 }),
      game({ matchId: 'back-b', result: 'Loss', timestamp: 2_000, srDelta: -15 }),
      game({ matchId: 'fwd-a', result: 'Win', timestamp: 8_000, srDelta: 20 }),
      game({ matchId: 'fwd-b', result: 'Loss', timestamp: 8_000, srDelta: -15 }),
    ];
    const batch = enteringRanks(games, anchors);
    expect(batch.get('back-a')!.position).toEqual(batch.get('back-b')!.position);
    expect(batch.get('fwd-a')!.position).toEqual(batch.get('fwd-b')!.position);
    for (const id of ['back-a', 'back-b', 'fwd-a', 'fwd-b']) {
      const g = games.find((x) => x.matchId === id)!;
      const oracle = rankEnteringMatch(games, anchors, g.account, g.role, g.timestamp)!;
      expect(batch.get(id)!.position, id)
        .toEqual({ tier: oracle.tier, division: oracle.division, progressPct: oracle.progressPct });
    }
  });

  it('walks the history once regardless of how many matches are asked about', () => {
    const anchors = anchorAt(500_000);
    // A getter that counts reads: the fold must touch each record's fields from
    // one pass, not re-scan per row the way the single-match helpers do.
    let reads = 0;
    const games: GameRecord[] = [];
    for (let i = 0; i < 300; i++) {
      const g = game({ result: i % 2 ? 'Win' : 'Loss', timestamp: 1_000 + i * 1_000, srDelta: i % 2 ? 20 : -20 });
      Object.defineProperty(g, 'gameType', { get() { reads++; return 'Competitive'; } });
      games.push(g);
    }
    enteringRanks(games, anchors);
    // One classifyGameType per record in the bucketing pass.
    expect(reads).toBe(300);
  });
});

describe('enteringRanks — which cell, and why it is blank', () => {
  it('prefers the stored snapshot over anything derived', () => {
    const anchors = anchorAt(5_000);
    const stored = { tier: 'Platinum', division: 4, progressPct: 12 };
    const games = [game({ matchId: 'm', result: 'Win', timestamp: 2_000, srDelta: 20, rankAtStart: stored })];
    const cell = enteringRanks(games, anchors).get('m')!;
    expect(cell).toEqual({ note: 'stored', position: stored });
  });

  it('blanks a suppressed match even when it has a stored snapshot', () => {
    // Matching dashboardData's mask exactly: the snapshot only ever exists
    // alongside a ±% that is itself masked, so showing half the story is worse.
    const anchors = anchorAt(5_000);
    const games = [game({ matchId: 'm', result: 'Win', timestamp: 2_000, srDelta: 20, rankAtStart: { tier: 'Gold', division: 1, progressPct: 5 } })];
    const cell = enteringRanks(games, anchors, { suppressed: new Set(['m']) }).get('m')!;
    expect(cell).toEqual({ note: 'placements' });
    expect(cell.position).toBeUndefined();
  });

  it('blanks a match older than its track reset, and never invents a number', () => {
    const anchors = anchorAt(9_000);
    const games = [
      game({ matchId: 'old', result: 'Win', timestamp: 1_000, srDelta: 20 }),
      game({ matchId: 'new', result: 'Win', timestamp: 8_000, srDelta: 20 }),
    ];
    const resetBefore = new Map([[rankKey('Main', 'damage'), 5_000]]);
    const batch = enteringRanks(games, anchors, { resetBefore });
    expect(batch.get('old')).toEqual({ note: 'pre-reset' });
    expect(batch.get('new')!.position).toBeDefined();
  });

  it('keeps a genuine pre-reset SNAPSHOT rather than blanking real data', () => {
    const anchors = anchorAt(9_000);
    const stored = { tier: 'Silver', division: 2, progressPct: 40 };
    const games = [game({ matchId: 'old', result: 'Win', timestamp: 1_000, srDelta: 20, rankAtStart: stored })];
    const resetBefore = new Map([[rankKey('Main', 'damage'), 5_000]]);
    expect(enteringRanks(games, anchors, { resetBefore }).get('old'))
      .toEqual({ note: 'stored', position: stored });
  });

  it('blanks every match on an unanchored track — never a winrate guess', () => {
    const games = [game({ matchId: 'm', result: 'Win', timestamp: 2_000, srDelta: 20 })];
    const cell = enteringRanks(games, {}).get('m')!;
    expect(cell).toEqual({ note: 'no-anchor' });
  });

  it('blanks a track whose anchor predates its own reset boundary', () => {
    const anchors = anchorAt(1_000);
    const games = [game({ matchId: 'm', result: 'Win', timestamp: 8_000, srDelta: 20 })];
    const resetBefore = new Map([[rankKey('Main', 'damage'), 5_000]]);
    expect(enteringRanks(games, anchors, { resetBefore }).get('m')).toEqual({ note: 'stale-anchor' });
  });

  it('omits non-competitive rows entirely — absence is not a blank cell', () => {
    const anchors = anchorAt(5_000);
    const games = [game({ matchId: 'qp', result: 'Win', timestamp: 2_000, gameType: 'Quick Play' })];
    expect(enteringRanks(games, anchors).has('qp')).toBe(false);
  });
});

describe('enteringRanks — protection and the honesty caveats', () => {
  it('reports protection only on a forward cell, and undefined (not false) backward', () => {
    const anchors = anchorAt(5_000);
    const games = [
      game({ matchId: 'back', result: 'Win', timestamp: 2_000, srDelta: 20 }),
      game({ matchId: 'fwd', result: 'Win', timestamp: 8_000, srDelta: 20 }),
    ];
    const batch = enteringRanks(games, anchors);
    expect(batch.get('back')!.note).toBe('reconstructed');
    // Not knowable, so it must not read as "definitely unprotected".
    expect(batch.get('back')!.protected).toBeUndefined();
    expect(batch.get('fwd')!.note).toBe('calculated');
    expect(batch.get('fwd')!.protected).toBe(false);
  });

  it('treats a match with no logged +/-% as 0, which drifts everything older', () => {
    const anchors = anchorAt(5_000);
    const withDelta = [
      game({ matchId: 'old', result: 'Win', timestamp: 1_000, srDelta: 20 }),
      game({ matchId: 'mid', result: 'Win', timestamp: 2_000, srDelta: 25 }),
    ];
    const withoutDelta = [withDelta[0], { ...withDelta[1], srDelta: undefined }];
    const a = enteringRanks(withDelta, anchors).get('old')!.position!;
    const b = enteringRanks(withoutDelta, anchors).get('old')!.position!;
    // The un-logged match shifts the older reconstruction by exactly its size.
    expect(rankToPoints(b) - rankToPoints(a)).toBe(25);
  });

  it('rewrites every reconstructed cell when the anchor moves, while a snapshot stays put', () => {
    const stored = { tier: 'Platinum', division: 4, progressPct: 12 };
    const games = [
      game({ matchId: 'derived', result: 'Win', timestamp: 2_000, srDelta: 20 }),
      game({ matchId: 'snap', result: 'Win', timestamp: 2_500, srDelta: 20, rankAtStart: stored }),
    ];
    const before = enteringRanks(games, anchorAt(5_000, 'Gold', 3, 50));
    const after = enteringRanks(games, anchorAt(5_000, 'Diamond', 1, 50));
    expect(after.get('derived')!.position).not.toEqual(before.get('derived')!.position);
    expect(after.get('snap')!.position).toEqual(before.get('snap')!.position);
  });

  it('does not subtract a suppressed match out of an older reconstruction', () => {
    const anchors = anchorAt(5_000);
    const games = [
      game({ matchId: 'old', result: 'Win', timestamp: 1_000, srDelta: 20 }),
      game({ matchId: 'run', result: 'Win', timestamp: 2_000, srDelta: 25 }),
    ];
    const plain = enteringRanks(games, anchors).get('old')!.position!;
    const masked = enteringRanks(games, anchors, { suppressed: new Set(['run']) }).get('old')!.position!;
    expect(rankToPoints(masked) - rankToPoints(plain)).toBe(25);
  });
});

describe('enteringRankAt', () => {
  it('answers for an instant no stored match sits on', () => {
    const anchors = anchorAt(5_000);
    const games = [game({ result: 'Win', timestamp: 2_000, srDelta: 20 })];
    const cell = enteringRankAt(games, anchors, 'Main', 'damage', 3_500);
    expect(cell.note).toBe('reconstructed');
    expect(cell.position).toBeDefined();
  });

  it('refuses to reconstruct across a reset, and reports a stale anchor', () => {
    const games = [game({ result: 'Win', timestamp: 1_000, srDelta: 20 })];
    expect(enteringRankAt(games, anchorAt(9_000), 'Main', 'damage', 1_000, { resetBefore: 5_000 }))
      .toEqual({ note: 'pre-reset' });
    expect(enteringRankAt(games, anchorAt(1_000), 'Main', 'damage', 8_000, { resetBefore: 5_000 }))
      .toEqual({ note: 'stale-anchor' });
  });

  it('reports no-anchor rather than a fabricated Bronze 5', () => {
    expect(enteringRankAt([], {}, 'Main', 'damage', 1_000)).toEqual({ note: 'no-anchor' });
  });
});

describe('rankEnteringMatch — the write path, rebuilt on the same fold', () => {
  it('now returns null before a reset instead of a cross-reset fabrication', () => {
    const anchors = anchorAt(9_000);
    const games = [game({ result: 'Win', timestamp: 1_000, srDelta: 20 })];
    expect(rankEnteringMatch(games, anchors, 'Main', 'damage', 1_000, undefined, 5_000)).toBeNull();
    // Without a boundary it still reconstructs, exactly as before.
    expect(rankEnteringMatch(games, anchors, 'Main', 'damage', 1_000)).not.toBeNull();
  });

  it('honours the suppression mask on a track whose first match is the target', () => {
    // The old no-previous-match branch dropped `suppressed` entirely, so the two
    // branches of one function disagreed about whether a masked delta counted.
    const anchors = anchorAt(5_000);
    const games = [game({ matchId: 'only', result: 'Win', timestamp: 2_000, srDelta: 25 })];
    const plain = rankEnteringMatch(games, anchors, 'Main', 'damage', 2_000)!;
    const masked = rankEnteringMatch(games, anchors, 'Main', 'damage', 2_000, new Set(['only']))!;
    expect(rankToPoints(masked) - rankToPoints(plain)).toBe(25);
  });
});
