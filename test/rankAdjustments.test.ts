import { describe, it, expect } from 'vitest';
import {
  attachAdjustments, adjustmentMarks, applyAdjustment, currentRank, enteringRanks, enteringRankAt, parseRankAdjustment,
  rankAfterMatch, rankKey, stateFromAnchor, type RankAdjustment, type RankAnchorMap,
} from '../src/core/rank';
import { computeDashboard } from '../src/core/dashboardData';
import { buildImportEnvelope, parseVantageImport } from '../src/core/importEnvelope';
import type { GameRecord } from '../src/core/analytics';
import type { Result, Role } from '../src/core/model';
import { memoryDocs, providerHarness } from './providerFixtures';
import { RankAnchorStore } from '../src/store/rankAnchors';

/**
 * Cheater compensation / rank adjustments (#341): a rank change that is not a
 * match. It moves the computed rank like a match ±% after the anchor, is
 * ignored before it, and is never counted as a game anywhere.
 */

const T0 = 1_700_000_000_000;
const MIN = 60_000;
let seq = 0;
function game(result: Result, minute: number, srDelta?: number, over: Partial<GameRecord> = {}): GameRecord {
  return {
    matchId: `g-${++seq}`, timestamp: T0 + minute * MIN, account: 'Main', role: 'damage' as Role,
    map: "King's Row", gameType: 'Competitive', heroes: ['Tracer'], result, srDelta, ...over,
  };
}
const KEY = rankKey('Main', 'damage');
const anchorMap = (progressPct: number, division = 3, tier = 'Gold', setAt = T0): RankAnchorMap =>
  ({ [KEY]: { tier, division, progressPct, setAt } });
let aid = 0;
const adj = (minute: number, deltaPct: number, over: Partial<RankAdjustment> = {}): RankAdjustment => ({
  id: `a-${++aid}`, account: 'Main', role: 'damage', at: T0 + minute * MIN, deltaPct, reason: 'cheater-compensation', ...over,
});

describe('rank engine — adjustments after the anchor', () => {
  it('shifts the current rank by exactly X', () => {
    const games = [game('Win', 1, 20)];
    const base = currentRank(games, anchorMap(30), 'Main', 'damage');
    const withAdj = currentRank(games, attachAdjustments(anchorMap(30), [adj(5, 18)]), 'Main', 'damage');
    expect(base).toMatchObject({ tier: 'Gold', division: 3, progressPct: 50 });
    expect(withAdj).toMatchObject({ tier: 'Gold', division: 3, progressPct: 68, protected: false });
  });

  it('rolls over into the next division (and tier)', () => {
    expect(currentRank([], attachAdjustments(anchorMap(90), [adj(1, 25)]), 'Main', 'damage'))
      .toMatchObject({ tier: 'Gold', division: 2, progressPct: 15 });
    expect(currentRank([], attachAdjustments(anchorMap(95, 1), [adj(1, 10)]), 'Main', 'damage'))
      .toMatchObject({ tier: 'Platinum', division: 5, progressPct: 5 });
  });

  it('pays down the rank-protection buffer and clears protection once positive', () => {
    // Anchor at 10%, a -25 loss → protected at -15.
    const games = [game('Loss', 1, -25)];
    expect(currentRank(games, anchorMap(10), 'Main', 'damage')).toMatchObject({ progressPct: -15, protected: true });
    expect(currentRank(games, attachAdjustments(anchorMap(10), [adj(2, 20)]), 'Main', 'damage'))
      .toMatchObject({ tier: 'Gold', division: 3, progressPct: 5, protected: false });
    // Not enough to clear it: stays protected at the smaller carry.
    expect(currentRank(games, attachAdjustments(anchorMap(10), [adj(2, 5)]), 'Main', 'damage'))
      .toMatchObject({ progressPct: -10, protected: true });
  });

  it('applyAdjustment mirrors a match of that ±%', () => {
    const s = stateFromAnchor({ tier: 'Gold', division: 3, progressPct: 10, setAt: 0 });
    expect(applyAdjustment(s, 95)).toMatchObject({ division: 2, progressPct: 5 });
    expect(applyAdjustment(s, -30)).toMatchObject({ division: 3, progressPct: -20, protected: true });
  });

  it('interleaves with matches in time order', () => {
    // 90 → +20 adj = Gold 2 10 → loss -15 → protected at -5 (in Gold 2).
    const games = [game('Loss', 10, -15)];
    expect(currentRank(games, attachAdjustments(anchorMap(90), [adj(5, 20)]), 'Main', 'damage'))
      .toMatchObject({ division: 2, progressPct: -5, protected: true });
    // Same two deltas the other way round: loss to 75, then +20 = 95, still Gold 3.
    expect(currentRank(games, attachAdjustments(anchorMap(90), [adj(15, 20)]), 'Main', 'damage'))
      .toMatchObject({ division: 3, progressPct: 95 });
  });

  it('ignores adjustments at or before the anchor (the anchor already includes them)', () => {
    const anchors = attachAdjustments(anchorMap(40), [adj(-10, 30), adj(0, 30)]);
    expect(anchors[KEY].adjustments).toBeUndefined();
    expect(currentRank([], anchors, 'Main', 'damage')).toMatchObject({ progressPct: 40 });
  });

  it('re-anchoring keeps the adjustments after the new anchor', () => {
    const list = [adj(5, 10), adj(20, 7)];
    const reanchored = attachAdjustments(anchorMap(50, 3, 'Gold', T0 + 10 * MIN), list);
    expect(reanchored[KEY].adjustments).toEqual([{ at: T0 + 20 * MIN, deltaPct: 7 }]);
    expect(currentRank([], reanchored, 'Main', 'damage')).toMatchObject({ progressPct: 57 });
  });

  it('removing one restores the previous rank', () => {
    const games = [game('Win', 1, 12)];
    const before = currentRank(games, anchorMap(30), 'Main', 'damage');
    const list = [adj(5, 18)];
    expect(currentRank(games, attachAdjustments(anchorMap(30), list), 'Main', 'damage')).not.toEqual(before);
    expect(currentRank(games, attachAdjustments(anchorMap(30), list.slice(1)), 'Main', 'damage')).toEqual(before);
  });

  it('only touches its own (account, role) track', () => {
    const anchors: RankAnchorMap = { ...anchorMap(30), [rankKey('Main', 'tank')]: { tier: 'Gold', division: 3, progressPct: 30, setAt: T0 } };
    const out = attachAdjustments(anchors, [adj(5, 18, { role: 'tank' }), adj(5, 9, { account: 'Alt' })]);
    expect(currentRank([], out, 'Main', 'damage')).toMatchObject({ progressPct: 30 });
    expect(currentRank([], out, 'Main', 'tank')).toMatchObject({ progressPct: 48 });
  });

  it('as-of reads include adjustments up to that instant only', () => {
    const games = [game('Win', 1, 10), game('Win', 10, 10)];
    const anchors = attachAdjustments(anchorMap(30), [adj(5, 18)]);
    expect(currentRank(games, anchors, 'Main', 'damage', T0 + 2 * MIN)).toMatchObject({ progressPct: 40 });
    expect(rankAfterMatch(games, anchors, 'Main', 'damage', T0 + 10 * MIN)).toMatchObject({ progressPct: 68 });
  });

  it('entering ranks see the adjustment on the next match, batched and single agree', () => {
    const games = [game('Win', 1, 10), game('Win', 10, 10)];
    const anchors = attachAdjustments(anchorMap(30), [adj(5, 18)]);
    const batch = enteringRanks(games, anchors);
    expect(batch.get(games[0].matchId)?.position).toMatchObject({ progressPct: 30 });
    expect(batch.get(games[1].matchId)?.position).toMatchObject({ progressPct: 58 });
    for (const g of games) {
      expect(enteringRankAt(games, anchors, 'Main', 'damage', g.timestamp).position)
        .toEqual(batch.get(g.matchId)?.position);
    }
  });
});

describe('rank adjustments are never matches', () => {
  it('leave games, wins, winrate and the match list untouched while moving the rank', () => {
    const games = [game('Win', 1, 20), game('Loss', 2, -15)];
    const demo = { active: false, preference: 'off' as const, hasRealHistory: true };
    const plain = computeDashboard(games, { days: 'all' }, demo, { rankAnchors: anchorMap(30) });
    const list = [adj(5, 18)];
    const adjusted = computeDashboard(games, { days: 'all' }, demo, {
      rankAnchors: attachAdjustments(anchorMap(30), list), rankAdjustments: list,
    });
    expect(adjusted.overall).toEqual(plain.overall);
    expect(adjusted.matches.length).toBe(plain.matches.length);
    expect(adjusted.extremes).toEqual(plain.extremes);
    expect(adjusted.primaryRank?.progressPct).toBe((plain.primaryRank?.progressPct ?? 0) + 18);
    // …and it reaches the rank chart only as a marker.
    expect(adjusted.rankTrend[KEY]).toEqual(plain.rankTrend[KEY]);
    expect(adjusted.rankAdjustmentMarks[KEY]).toEqual([{ id: list[0].id, at: list[0].at, deltaPct: 18, reason: 'cheater-compensation' }]);
  });

  it('adjustmentMarks keeps the track and window', () => {
    const list = [adj(1, 5), adj(9, 7), adj(9, 4, { role: 'tank' })];
    expect(adjustmentMarks(list, 'Main', 'damage', T0 + 2 * MIN).map((m) => m.deltaPct)).toEqual([7]);
  });
});

describe('parseRankAdjustment', () => {
  const ok = { account: 'Main', role: 'damage', at: T0, deltaPct: 18.4, reason: 'cheater-compensation' };
  it('normalizes a valid entry (whole %-points)', () => {
    expect(parseRankAdjustment(ok)).toEqual({ ok: true, value: { ...ok, deltaPct: 18 } });
  });
  it.each([
    [{ ...ok, deltaPct: 0 }], [{ ...ok, deltaPct: 500 }], [{ ...ok, role: 'healer' }],
    [{ ...ok, account: ' ' }], [{ ...ok, at: -1 }], [{ ...ok, deltaPct: 'x' }], [null],
  ])('rejects %j', (raw) => {
    expect(parseRankAdjustment(raw).ok).toBe(false);
  });
  it('falls back to "manual" for an unknown reason', () => {
    const r = parseRankAdjustment({ ...ok, reason: 'whatever' });
    expect(r.ok && r.value.reason).toBe('manual');
  });
});

describe('RankAnchorStore — adjustment persistence', () => {
  it('survives a restart, attaches to map(), and cascades on relabel / account delete', () => {
    const docs = memoryDocs();
    const s1 = new RankAnchorStore(docs);
    s1.set({ account: 'Main', role: 'damage', tier: 'Gold', division: 3, progressPct: 30, setAt: T0 });
    const a = s1.addAdjustment({ account: 'Main', role: 'damage', at: T0 + MIN, deltaPct: 18, reason: 'cheater-compensation' });

    const s2 = new RankAnchorStore(docs); // "restart"
    expect(s2.listAdjustments()).toEqual([a]);
    expect(s2.map()[KEY].adjustments).toEqual([{ at: T0 + MIN, deltaPct: 18 }]);

    s2.relabel('Main', 'Renamed');
    expect(s2.listAdjustments()[0].account).toBe('Renamed');
    s2.removeAccount('Renamed');
    expect(s2.listAdjustments()).toEqual([]);
  });

  it('remove + restore round-trips under the same id, and restore is idempotent', () => {
    const s = new RankAnchorStore(memoryDocs());
    const a = s.addAdjustment({ account: 'Main', role: 'damage', at: T0, deltaPct: 18, reason: 'manual' });
    expect(s.removeAdjustment(a.id)).toEqual(a);
    expect(s.removeAdjustment(a.id)).toBeNull();
    expect(s.restoreAdjustment(a)).toBe(true);
    expect(s.restoreAdjustment(a)).toBe(false);
    expect(s.listAdjustments()).toEqual([a]);
  });
});

describe('provider — add / remove / restore', () => {
  it('moves getRanks by exactly X and back, and validates input', () => {
    const h = providerHarness({ games: [game('Win', 1, 10)] });
    h.rankAnchors.set({ account: 'Main', role: 'damage', tier: 'Gold', division: 3, progressPct: 30, setAt: T0 });
    const pct = (): number | undefined => h.provider.getRanks().find((r) => r.role === 'damage')?.progressPct;
    expect(pct()).toBe(40);
    const { adjustment, ranks } = h.provider.addRankAdjustment({
      account: 'Main', role: 'damage', deltaPct: 18, reason: 'cheater-compensation', at: T0 + 5 * MIN,
    });
    expect(ranks.find((r) => r.role === 'damage')?.progressPct).toBe(58);
    expect(h.provider.removeRankAdjustment(adjustment!.id).ranks.find((r) => r.role === 'damage')?.progressPct).toBe(40);
    expect(h.provider.restoreRankAdjustment(adjustment!).adjustment).toEqual(adjustment);
    expect(pct()).toBe(58);
    expect(() => h.provider.addRankAdjustment({ account: 'Main', role: 'damage', deltaPct: 0, reason: 'manual' })).toThrow();
  });
});

describe('v2 backup round-trip', () => {
  it('build → parse keeps every adjustment, and a bad row is rejected without aborting', () => {
    const list = [adj(1, 18), adj(2, -5, { reason: 'manual', note: 'typo fix' })];
    const env = buildImportEnvelope({ games: [], accounts: [], rankAnchors: anchorMap(30), rankAdjustments: list, targets: [] });
    expect(env.rankAdjustments).toEqual(list);
    // The anchor's read-time adjustments never leak into the anchor rows.
    const withAttached = buildImportEnvelope({ games: [], accounts: [], rankAnchors: attachAdjustments(anchorMap(30), list), targets: [] });
    expect(withAttached.rankAnchors[0]).not.toHaveProperty('adjustments');

    const parsed = parseVantageImport(JSON.parse(JSON.stringify({ ...env, rankAdjustments: [...env.rankAdjustments, { id: 'bad', deltaPct: 0 }] })));
    expect(parsed.rankAdjustments).toEqual(list);
    expect(parsed.errors.some((e) => e.reason.startsWith('Rank adjustment 2'))).toBe(true);
  });

  it('export → import through the provider restores adjustments, idempotently', async () => {
    let saved = '';
    const source = providerHarness({ deps: { saveTextFile: async (_n: string, text: string) => { saved = text; return 'x.json'; } } });
    source.rankAnchors.addAdjustment({ account: 'Main', role: 'damage', at: T0, deltaPct: 18, reason: 'cheater-compensation' });
    await source.provider.exportBackup();

    const target = providerHarness({ deps: { importFile: { pick: async () => JSON.parse(saved) } } });
    const first = await target.provider.importFromFile();
    expect(first.adjustmentsRestored).toBe(1);
    expect(target.provider.listRankAdjustments()).toEqual(source.provider.listRankAdjustments());
    const again = await target.provider.importFromFile();
    expect(again.adjustmentsRestored).toBeUndefined();
    expect(target.provider.listRankAdjustments()).toHaveLength(1);
  });
});
