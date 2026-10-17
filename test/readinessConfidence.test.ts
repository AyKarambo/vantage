/**
 * Confidence gates (issue #307, T8) — the four conditions 'high' needs, exposed in the summary so
 * the readiness screen can say which ones keep it lower. Covers AC3 (all gates met ⇒ high), AC17
 * (unmet gates are named with the player's numbers; no-read summaries carry none) and AC18 (the
 * account-mix gate reads the rank-weighted main share, not the raw one).
 */
import { describe, it, expect } from 'vitest';
import { computeReadiness, safeReadiness, READINESS_TUNING as T, dayOrdinal } from '../src/core/readiness';
import type { ReadinessConfidenceGate, ReadinessSummary } from '../src/core/readiness';
import { perfState, EMPTY_CONTEXT } from '../src/core/readiness/performance';
import type { GameRecord } from '../src/core/analytics';
import type { RankPosition } from '../src/core/rank/types';
import { ts, statSpan, span, withRank, CALM } from './readinessFixtures';

const HEALTHY = { damage: 8000, deaths: 5, elims: 20 };
const GM5: RankPosition = { tier: 'Grandmaster', division: 5, progressPct: 0 }; // the main's usual rank
const EMERALD: RankPosition = { tier: 'Emerald', division: 3, progressPct: 0 }; // far below it: a smurf gap

const NOW = ts(35, 20);

interface WlOpts {
  account?: string;
  hour?: number;
}

/** `wins` Wins + `losses` Losses on every day in [from, to] — same stats, so the winrate sample fills without moving the form. */
function wl(from: number, to: number, wins: number, losses: number, o: WlOpts = {}): GameRecord[] {
  const { account = 'Main', hour = 14 } = o;
  return [
    ...statSpan(from, to, { perDay: wins, result: 'Win', ...HEALTHY, account, hour }),
    ...statSpan(from, to, { perDay: losses, result: 'Loss', ...HEALTHY, account, hour: hour + 2 }),
  ];
}

const gateOf = (r: ReadinessSummary, key: ReadinessConfidenceGate['key']): ReadinessConfidenceGate => {
  const gate = r.confidenceGates.find((g) => g.key === key);
  if (!gate) throw new Error(`no ${key} gate`);
  return gate;
};

const unmetKeys = (r: ReadinessSummary): string[] => r.confidenceGates.filter((g) => !g.met).map((g) => g.key);

/** perfState as of `day`, with an empty target context (mirrors the helper in readinessPerformance.test.ts). */
const perfAt = (games: GameRecord[], day: number) =>
  perfState([...games].sort((a, b) => a.timestamp - b.timestamp), dayOrdinal(ts(day)), EMPTY_CONTEXT, false);

describe('AC3 — a read that meets all four gates is high, and says so', () => {
  const games = wl(5, 35, 2, 2); // 4 decided games a day for 31 days, one account, full stats

  it('is high with every gate met, in the documented order', () => {
    const r = computeReadiness(games, NOW);
    expect(r.confidence).toBe('high');
    expect(r.confidenceGates.map((g) => g.key)).toEqual(['active-days', 'comparable-games', 'winrate-sample', 'account-mix']);
    expect(r.confidenceGates.every((g) => g.met)).toBe(true);
  });

  it('labels each met gate with the player’s own numbers', () => {
    const r = computeReadiness(games, NOW);
    expect(gateOf(r, 'active-days').label).toBe(`played on ${T.chronicDays} of the last ${T.chronicDays} days (needs ${T.confidenceActiveDays})`);
    expect(gateOf(r, 'comparable-games').label).toBe('100% of your recent games have comparable live stats (needs 50%)');
    expect(gateOf(r, 'winrate-sample').label).toBe('enough decided games on one account to compare your winrate');
    expect(gateOf(r, 'account-mix').label).toBe("100% of this week's read comes from your main account (needs 70%)");
  });

  it('a big history alone does not move it — only the last 7/21 days count', () => {
    // Same recent games, with ten months of extra play before them: identical gates and confidence.
    const big = [...wl(-300, 4, 2, 2), ...games];
    const a = computeReadiness(games, NOW);
    const b = computeReadiness(big, NOW);
    expect(b.confidence).toBe(a.confidence);
    expect(b.confidenceGates).toEqual(a.confidenceGates);
  });

  it('a big history does not rescue a thin recent window either', () => {
    const recentlyThin = [...wl(-300, 14, 2, 2), ...wl(30, 30, 2, 2), ...wl(35, 35, 2, 2)]; // 2 active days in the last 21
    const r = computeReadiness(recentlyThin, NOW);
    expect(r.confidence).not.toBe('high');
    expect(gateOf(r, 'active-days').met).toBe(false);
  });
});

describe('AC17 — unmet gates are named with the player’s numbers', () => {
  it('a manual-logs history fails the comparable-games gate at 0%', () => {
    const manual = [
      ...span(5, 35, { perDay: 2, result: 'Win', mental: CALM }),
      ...span(5, 35, { perDay: 2, result: 'Loss', mental: CALM, hour: 16 }),
    ];
    const r = computeReadiness(manual, NOW);
    expect(r.confidence).not.toBe('high');
    expect(r.regime).toBe('manual');
    const gate = gateOf(r, 'comparable-games');
    expect(gate.met).toBe(false);
    expect(gate.label).toBe('0% of your recent games have comparable live stats (needs 50%)');
    expect(unmetKeys(r)).toContain('comparable-games');
  });

  it('too few stat-carrying games reports the actual percentage', () => {
    // One stat game in three each day; the rest are manual logs — a third of the window is comparable.
    const games = [
      ...statSpan(5, 35, { perDay: 1, result: 'Win', ...HEALTHY }),
      ...span(5, 35, { perDay: 1, result: 'Win', mental: CALM, hour: 17 }),
      ...span(5, 35, { perDay: 1, result: 'Loss', mental: CALM, hour: 19 }),
    ];
    const r = computeReadiness(games, NOW);
    const share = Math.round(perfAt(games, 35).statCoverage * 100);
    expect(share).toBe(33);
    const gate = gateOf(r, 'comparable-games');
    expect(gate.met).toBe(false);
    expect(gate.label).toBe(`${share}% of your recent games have comparable live stats (needs 50%)`);
    expect(r.confidence).not.toBe('high');
  });

  it('too few decided games fails the winrate-sample gate and says what it needs', () => {
    const r = computeReadiness(wl(5, 35, 1, 1), NOW); // 2 decided a day: 14 this week, below 20
    const gate = gateOf(r, 'winrate-sample');
    expect(gate.met).toBe(false);
    expect(gate.label).toBe(
      `not enough decided games on one account to compare your winrate (needs ${T.wrMinDecidedAcute} this week and ${T.wrMinDecidedBase} in the two weeks before)`,
    );
    expect(unmetKeys(r)).toEqual(['winrate-sample']);
    expect(r.confidence).toBe('medium');
  });

  it('few active days fails the active-days gate with the player’s count', () => {
    // Every third day over the last 21: 7 active days, below the 12 needed.
    const games = [
      ...wl(5, 14, 2, 2),
      ...[15, 18, 21, 24, 27, 30, 33].flatMap((d) => wl(d, d, 4, 4)),
      ...wl(35, 35, 4, 4),
    ];
    const r = computeReadiness(games, NOW);
    const gate = gateOf(r, 'active-days');
    expect(gate.met).toBe(false);
    const played = Number(/played on (\d+) of the last/.exec(gate.label)?.[1]);
    expect(played).toBeLessThan(T.confidenceActiveDays);
    expect(gate.label).toBe(`played on ${played} of the last ${T.chronicDays} days (needs ${T.confidenceActiveDays})`);
    expect(r.confidence).not.toBe('high');
  });

  it('confidence is high exactly when every gate is met', () => {
    const histories = [
      wl(5, 35, 2, 2),
      wl(5, 35, 1, 1),
      span(5, 35, { perDay: 3, mental: CALM }),
      [...wl(5, 35, 3, 2, { account: 'Main' }), ...wl(5, 35, 3, 2, { account: 'Alt', hour: 17 })],
    ];
    for (const games of histories) {
      const r = computeReadiness(games, NOW);
      expect(r.confidence === 'high').toBe(r.confidenceGates.every((g) => g.met));
    }
  });

  it('insufficient and stale summaries carry no gates', () => {
    expect(computeReadiness([], NOW).confidenceGates).toEqual([]);
    const short = computeReadiness(span(34, 35, { perDay: 10 }), NOW);
    expect(short.band).toBe('insufficient-data');
    expect(short.confidenceGates).toEqual([]);
    const stale = computeReadiness(span(0, 18, { perDay: 3, mental: CALM }), ts(40, 20));
    expect(stale.band).toBe('rusty');
    expect(stale.confidenceGates).toEqual([]);
    // The defensive wrapper's fallback is the same shape.
    const bad = safeReadiness([{ ...span(5, 5, { perDay: 1 })[0], timestamp: NaN }] as GameRecord[], NOW);
    expect(Array.isArray(bad.confidenceGates)).toBe(true);
  });
});

describe('AC18 — the account-mix gate reads the rank-weighted main share', () => {
  /**
   * One history, only the alt's rank differs. Main plays 4 a day throughout; the alt plays 1 a day
   * before the acute week and 4 a day during it — half of this week's games are on the alt.
   */
  const history = (altRank: RankPosition | null): GameRecord[] => {
    const main = withRank(wl(5, 35, 2, 2, { account: 'Main' }), GM5);
    const alt = [...wl(5, 28, 1, 0, { account: 'Alt', hour: 17 }), ...wl(29, 35, 2, 2, { account: 'Alt', hour: 17 })];
    return [...main, ...(altRank ? withRank(alt, altRank) : alt)];
  };

  it('an alt at the main’s own rank counts fully: the gate passes although the raw share is below the bar', () => {
    const games = history(GM5);
    const p = perfAt(games, 35);
    expect(p.maxAccountShare).toBeLessThan(T.accountMixBar); // raw: the main carries only half the week
    expect(p.altDamp).toBe(1);
    expect(p.mainShare).toBe(1);
    const r = computeReadiness(games, NOW);
    expect(gateOf(r, 'account-mix').met).toBe(true);
    expect(gateOf(r, 'account-mix').label).toBe("100% of this week's read comes from your main account (needs 70%)");
    expect(r.confidence).toBe('high');
    expect(r.signals.some((s) => s.key === 'mixed-accounts')).toBe(false);
  });

  it('the same games on a smurf-gap alt fail the gate, with the weighted share in the label', () => {
    const games = history(EMERALD);
    const p = perfAt(games, 35);
    expect(p.mainShare).toBeCloseTo(p.altDamp, 12);
    expect(p.mainShare).toBeLessThan(T.accountMixBar);
    const r = computeReadiness(games, NOW);
    const gate = gateOf(r, 'account-mix');
    expect(gate.met).toBe(false);
    expect(gate.label).toBe(`${Math.round(p.mainShare * 100)}% of this week's read comes from your main account (needs 70%)`);
    expect(unmetKeys(r)).toEqual(['account-mix']);
    expect(r.confidence).toBe('medium');
    // The note and the gate agree.
    expect(r.signals.some((s) => s.key === 'mixed-accounts')).toBe(true);
  });

  it('without rank data an alt counts at the flat fallback: a 40% alt share still passes at 0.74', () => {
    // Main 3 a day, alt 2 a day: 21 vs 14 games in the week (the alt is 40%, the main 60% raw).
    const games = [...wl(5, 35, 2, 1, { account: 'Main' }), ...wl(5, 35, 1, 1, { account: 'Alt', hour: 17 })];
    const p = perfAt(games, 35);
    expect(p.maxAccountShare).toBeCloseTo(21 / 35, 12);
    expect(p.altShare).toBeCloseTo(14 / 35, 12);
    expect(p.altDamp).toBeCloseTo((21 + 14 * T.altAccountWeight) / 35, 12);
    expect(p.altDamp).toBeCloseTo(0.74, 12);
    expect(p.mainShare).toBe(p.altDamp);
    const r = computeReadiness(games, NOW);
    expect(gateOf(r, 'account-mix').met).toBe(true);
    expect(gateOf(r, 'account-mix').label).toBe("74% of this week's read comes from your main account (needs 70%)");
    expect(r.signals.some((s) => s.key === 'mixed-accounts')).toBe(false);
    expect(r.signals.some((s) => s.key === 'alt-weighted')).toBe(true);
  });

  it('two accounts with an exact game tie → no main → the raw share applies: mixed-accounts note, not high', () => {
    const games = [...wl(5, 35, 2, 1, { account: 'Main' }), ...wl(5, 35, 2, 1, { account: 'Alt', hour: 17 })];
    const p = perfAt(games, 35);
    expect(p.mainAccount).toBeNull();
    expect(p.mainShare).toBe(p.maxAccountShare);
    expect(p.mainShare).toBe(0.5);
    const r = computeReadiness(games, NOW);
    expect(r.mainAccount).toBeNull();
    expect(r.confidence).not.toBe('high');
    expect(gateOf(r, 'account-mix').met).toBe(false);
    expect(gateOf(r, 'account-mix').label).toBe("50% of this week's read comes from your main account (needs 70%)");
    expect(r.signals.find((s) => s.key === 'mixed-accounts')?.label).toBe('recent games span multiple accounts — the read is less precise');
  });

  it('a single-account history has a main share of 1', () => {
    expect(perfAt(wl(5, 35, 2, 2), 35).mainShare).toBe(1);
  });
});
