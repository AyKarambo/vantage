import { describe, it, expect } from 'vitest';
import { perfState, EMPTY_CONTEXT } from '../src/core/readiness/performance';
import { READINESS_TUNING as T, dayOrdinal } from '../src/core/readiness';
import type { GameRecord } from '../src/core/analytics';
import { ts, statSpan, span } from './readinessFixtures';

/** perfState at the given day, with empty target context. */
const perfAt = (games: GameRecord[], day: number) =>
  perfState([...games].sort((a, b) => a.timestamp - b.timestamp), dayOrdinal(ts(day)), EMPTY_CONTEXT, false);

const HEALTHY = { damage: 8000, deaths: 5, elims: 20 };
const COLLAPSED = { damage: 5500, deaths: 8, elims: 13 };

describe('CUSUM decline detector — anti-false-alarm arithmetic', () => {
  // 24 days × 2/day = 48 baseline games, full bucket trust.
  const baseline = statSpan(5, 28, { perDay: 2, ...HEALTHY });

  it('a single terrible game can NEVER fire (winsorized 2.5 − slack 0.25 < threshold 2.5)', () => {
    const one = statSpan(35, 35, { perDay: 1, damage: 100, deaths: 20, elims: 1 });
    const p = perfAt([...baseline, ...one], 35);
    expect(p.declineFired).toBe(false);
    expect(p.statPenalty).toBe(0);
  });

  it('a short bad session (3 games) does not fire', () => {
    const three = statSpan(35, 35, { perDay: 3, ...COLLAPSED });
    const p = perfAt([...baseline, ...three], 35);
    expect(p.declineFired).toBe(false);
  });

  it('evidenceMinGames is an independent gate: 5 catastrophic games cross C but do NOT fire', () => {
    const five = statSpan(35, 35, { perDay: 5, damage: 100, deaths: 20, elims: 1 });
    const p = perfAt([...baseline, ...five], 35);
    expect(p.cusumMax).toBeGreaterThanOrEqual(T.cusumThreshold); // C alone would fire...
    expect(p.countedGames).toBeLessThan(T.evidenceMinGames);
    expect(p.declineFired).toBe(false); // ...but the game-count gate holds
  });

  it('a 12-game marathon of decline fires the same day', () => {
    const marathon = statSpan(35, 35, { perDay: 12, ...COLLAPSED });
    const p = perfAt([...baseline, ...marathon], 35);
    expect(p.declineFired).toBe(true);
    expect(p.statPenalty).toBeGreaterThanOrEqual(T.statPenaltyBase);
    expect(p.statPenalty).toBeLessThanOrEqual(T.statPenaltyCap);
  });

  it('a decline sustained across several sessions also fires', () => {
    const decline = statSpan(33, 35, { perDay: 4, ...COLLAPSED }); // 3 days × 4
    const p = perfAt([...baseline, ...decline], 35);
    expect(p.declineFired).toBe(true);
  });

  it('healthy play produces no penalty and possibly a bonus, never a decline', () => {
    const steady = statSpan(29, 35, { perDay: 3, ...HEALTHY });
    const p = perfAt([...baseline, ...steady], 35);
    expect(p.declineFired).toBe(false);
    expect(p.delta).toBeGreaterThanOrEqual(0);
  });
});

describe('bucket trust ramp (graduated, no cliff)', () => {
  it('cusumMax grows monotonically with baseline size across the 15→20 ramp', () => {
    // Same 10-game acute collapse against baselines of increasing size.
    let prev = -1;
    for (let n = 14; n <= 21; n += 1) {
      const baseline = statSpan(5, 5 + n - 1, { perDay: 1, ...HEALTHY });
      const collapse = statSpan(35, 35, { perDay: 10, ...COLLAPSED });
      const p = perfAt([...baseline, ...collapse], 35);
      expect(p.cusumMax).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = p.cusumMax;
    }
  });

  it('below statMinGames baseline the bucket is fully inert', () => {
    const thin = statSpan(5, 18, { perDay: 1, ...HEALTHY }); // 14 < 15 baseline games
    const collapse = statSpan(35, 35, { perDay: 10, ...COLLAPSED });
    const p = perfAt([...thin, ...collapse], 35);
    expect(p.countedGames).toBe(0);
    expect(p.declineFired).toBe(false);
  });
});

describe('learning window & hero-switch isolation', () => {
  it('a hero below the learning window is excluded and surfaces as still-learning', () => {
    const main = statSpan(5, 28, { perDay: 2, ...HEALTHY }); // Tracer, established
    // 6 lifetime Genji games (< heroLearnGames 12), all terrible:
    const learning = statSpan(33, 35, { perDay: 2, hero: 'Genji', damage: 1000, deaths: 15, elims: 3 });
    const p = perfAt([...main, ...learning], 35);
    expect(p.stillLearning).toContain('Genji');
    expect(p.declineFired).toBe(false);
  });

  it('two heroes with different stat profiles never cross-contaminate (per-hero baselines)', () => {
    // Tracer: high damage. Mercy: low damage, high healing. Both long-established;
    // acute games match each hero's own baseline → no decline from switching.
    const tracer = statSpan(5, 28, { perDay: 1, hero: 'Tracer', ...HEALTHY });
    const mercy = statSpan(5, 28, { perDay: 1, hero: 'Mercy', damage: 1200, deaths: 3, elims: 8, healing: 9000, hour: 18, role: 'support' });
    const acute = [
      ...statSpan(34, 35, { perDay: 3, hero: 'Tracer', ...HEALTHY }),
      ...statSpan(34, 35, { perDay: 3, hero: 'Mercy', damage: 1200, deaths: 3, elims: 8, healing: 9000, hour: 18, role: 'support' }),
    ];
    const p = perfAt([...tracer, ...mercy, ...acute], 35);
    expect(p.declineFired).toBe(false);
    expect(p.countedGames).toBeGreaterThanOrEqual(T.evidenceMinGames);
  });
});

describe('role fallback & mix-shift guard', () => {
  // Two DPS heroes alternating throughout, each hero bucket thin (<15) but the
  // role bucket rich and the acute mix matching the baseline mix.
  const mixedBaseline = [
    ...statSpan(5, 18, { perDay: 1, hero: 'Cassidy', ...HEALTHY }),
    ...statSpan(5, 18, { perDay: 1, hero: 'Ashe', ...HEALTHY, hour: 18 }),
  ];

  it('uses the role baseline when the mix is stable — a real decline still fires', () => {
    const collapse = [
      ...statSpan(33, 35, { perDay: 2, hero: 'Cassidy', ...COLLAPSED }),
      ...statSpan(33, 35, { perDay: 2, hero: 'Ashe', ...COLLAPSED, hour: 18 }),
    ];
    const p = perfAt([...mixedBaseline, ...collapse], 35);
    expect(p.declineFired).toBe(true);
  });

  it('a hero-mix shift within the role never reads as decline (overlap gate)', () => {
    // Baseline was Cassidy+Ashe; acute is all Widowmaker (also thin) with very
    // different numbers — overlap 0 → role fallback skipped → inert.
    const widow = statSpan(33, 35, { perDay: 4, hero: 'Widowmaker', damage: 4000, deaths: 6, elims: 10 });
    const p = perfAt([...mixedBaseline, ...widow], 35);
    expect(p.countedGames).toBe(0);
    expect(p.declineFired).toBe(false);
  });
});

describe('winrate component (per-account, sample-gated)', () => {
  it('under-sampled acute window → silently inert (wrDip null)', () => {
    const games = [
      ...span(5, 28, { perDay: 3 }),
      ...span(29, 35, { perDay: 2, result: 'Loss' }), // 14 decided < 20
    ];
    const p = perfAt(games, 35);
    expect(p.wrDip).toBeNull();
    expect(p.wrPenalty).toBe(0);
  });

  it('a real dip over enough games engages, capped at its regime ceiling', () => {
    const games = [
      ...span(5, 28, { perDay: 3 }), // wins, base ≥ 30 decided
      ...span(29, 35, { perDay: 4, result: 'Loss' }), // 28 acute decided losses
    ];
    const p = perfAt(games, 35);
    expect(p.wrDip).not.toBeNull();
    expect(p.wrPenalty).toBeGreaterThan(0);
    // Manual fixture (no per-10 stats) ⇒ b=0 ⇒ the promoted manual ceiling (readiness-data-regimes).
    // The invariant that matters is unchanged: the penalty is CAPPED, never unbounded.
    expect(p.wrPenalty).toBeLessThanOrEqual(T.wrPenaltyCap + T.wrManualCapBoost);
  });

  it("per-account isolation: a smurf's stable results never mask the main account's dip", () => {
    const mainBase = span(5, 28, { perDay: 3, account: 'Main' });
    const mainDip = span(29, 35, { perDay: 4, result: 'Loss', account: 'Main' });
    const smurfSteady = [...span(5, 28, { perDay: 2, account: 'Smurf', hour: 19 }), ...span(29, 35, { perDay: 3, account: 'Smurf', hour: 19 })];
    const p = perfAt([...mainBase, ...mainDip, ...smurfSteady], 35);
    // Main dips hard; Smurf is stable — pooled dip stays positive and engages.
    expect(p.wrDip).not.toBeNull();
    expect(p.wrDip!).toBeGreaterThan(T.wrDipMin);
    expect(p.wrPenalty).toBeGreaterThan(0);
  });

  it('maxAccountShare reflects acute account concentration', () => {
    const a = span(29, 35, { perDay: 2, account: 'Main' });
    const b = span(29, 35, { perDay: 2, account: 'Smurf', hour: 19 });
    const p = perfAt([...span(5, 28, { perDay: 2 }), ...a, ...b], 35);
    expect(p.maxAccountShare).toBeLessThan(T.accountMixBar);
  });
});

describe('flex player (buckets never fill)', () => {
  it('per-10 component inert, coverage low, winrate still bounded by its own cap', () => {
    // 16 heroes in rotation → every hero stays under the learning window, so no
    // bucket (hero or role-fallback) ever becomes comparable.
    const heroes = Array.from({ length: 16 }, (_, i) => `Hero${i}`);
    const games: GameRecord[] = [];
    for (let d = 5; d <= 35; d += 1) {
      const hero = heroes[d % heroes.length];
      games.push(...statSpan(d, d, { perDay: 3, hero, ...HEALTHY, result: d >= 29 ? 'Loss' : 'Win' }));
    }
    const p = perfAt(games, 35);
    expect(p.countedGames).toBe(0);
    expect(p.statCoverage).toBe(0);
    // readiness-data-regimes SUPERSEDES the prior "winrate never absorbs the freed stat weight" rule:
    // with no per-10 coverage (b=0) the results arm is deliberately PROMOTED to the manual ceiling.
    // The surviving invariant is that it stays bounded by that ceiling (and still can't red without
    // load corroboration — verified in the composite suite), not that it shrinks.
    expect(p.delta).toBeGreaterThanOrEqual(-(T.wrPenaltyCap + T.wrManualCapBoost));
  });

  it('a STABLE flex rotation is covered by the role fallback by design (mix overlap high)', () => {
    const heroes = ['A', 'B', 'C', 'D']; // each hero ~23 lifetime games, hero buckets thin, role bucket rich
    const games: GameRecord[] = [];
    for (let d = 5; d <= 35; d += 1) {
      games.push(...statSpan(d, d, { perDay: 3, hero: heroes[d % heroes.length], ...HEALTHY }));
    }
    const p = perfAt(games, 35);
    expect(p.countedGames).toBeGreaterThan(0); // the fallback engages for a stable mix
    expect(p.declineFired).toBe(false); // ...and healthy play is not a decline
  });
});

describe('perfDelta bounds', () => {
  it('worst case stays within [perfDeltaMin, perfDeltaMax]', () => {
    const baseline = statSpan(5, 28, { perDay: 3, ...HEALTHY });
    const collapse = statSpan(29, 35, { perDay: 10, result: 'Loss', damage: 100, deaths: 20, elims: 1 });
    const p = perfAt([...baseline, ...collapse], 35);
    expect(p.delta).toBeGreaterThanOrEqual(T.perfDeltaMin);
    expect(p.delta).toBeLessThanOrEqual(T.perfDeltaMax);
  });
});

describe('passivity guard — output-gated deaths credit (owner revision 2026-07-08)', () => {
  // Full-trust Tracer baseline: 8000 dmg / 5 deaths / 20 elims per 10.
  const baseline = statSpan(5, 28, { perDay: 3, ...HEALTHY });

  it('"playing scared" (damage down 30%, deaths down, elims held) now FIRES the decline index', () => {
    // Pre-revision this cancelled out (deaths credit offset the damage drop → weighted −0.24 < slack).
    // With output below baseline the deaths credit is gated to zero, so the game score IS the pure
    // damage decline and the CUSUM accrues.
    const scared = statSpan(29, 35, { perDay: 3, damage: 5600, deaths: 4, elims: 20 });
    const p = perfAt([...baseline, ...scared], 35);
    expect(p.declineFired).toBe(true);
    expect(p.statPenalty).toBeGreaterThan(0);
    expect(p.objectiveAdverse).toBe(true);
  });

  it('deaths down while output HOLDS keeps full credit — genuine positioning improvement, no decline', () => {
    const better = statSpan(29, 35, { perDay: 3, damage: 8000, deaths: 4, elims: 20 });
    const p = perfAt([...baseline, ...better], 35);
    expect(p.declineFired).toBe(false);
    expect(p.cusumMax).toBe(0);
  });

  it('aggression (damage up, slightly more deaths) still nets fine — no rule change', () => {
    const aggressive = statSpan(29, 35, { perDay: 3, damage: 10000, deaths: 6, elims: 22 });
    const p = perfAt([...baseline, ...aggressive], 35);
    expect(p.declineFired).toBe(false);
  });

  it('deaths UP stays fully adverse even while output is down (no gating on the adverse side)', () => {
    const worse = statSpan(29, 35, { perDay: 3, damage: 5600, deaths: 8, elims: 14 });
    const p = perfAt([...baseline, ...worse], 35);
    expect(p.declineFired).toBe(true);
    expect(p.metricMeans.deaths ?? 0).toBeLessThan(0); // raw metric mean stays truthful
  });

  it('the gate is graduated: deeper output decline ⇒ monotonically more accrual (no cliff)', () => {
    const mk = (damage: number) => perfAt([...baseline, ...statSpan(29, 35, { perDay: 3, damage, deaths: 4, elims: 20 })], 35).cusumMax;
    const shallow = mk(7450); // output z ≈ −0.25 → deaths credit half-applies → game score still ≥ 0-ish
    const deep = mk(5600); // output z ≈ −1.09 → credit fully gated → accrues hard
    expect(deep).toBeGreaterThan(shallow);
    expect(shallow).toBeGreaterThanOrEqual(0);
  });

  it('metricMeans keeps the RAW deaths direction even when the credit is gated (label truthfulness)', () => {
    const scared = statSpan(29, 35, { perDay: 3, damage: 5600, deaths: 4, elims: 20 });
    const p = perfAt([...baseline, ...scared], 35);
    expect(p.metricMeans.deaths ?? 0).toBeGreaterThan(0); // fewer deaths still reads as its true direction
  });
});
