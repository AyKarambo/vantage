import { describe, it, expect } from 'vitest';
import { perfState, EMPTY_CONTEXT, mainAccountOf } from '../src/core/readiness/performance';
import { computeReadiness, READINESS_TUNING as T, dayOrdinal } from '../src/core/readiness';
import type { GameRecord } from '../src/core/analytics';
import type { RankPosition } from '../src/core/rank/types';
import { UNKNOWN_ACCOUNT } from '../src/core/accountsManage';
import { ts, statSpan, span, withRank } from './readinessFixtures';

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

describe('passivity guard — review hardening (2026-07-08)', () => {
  const baseline = statSpan(5, 28, { perDay: 3, ...HEALTHY });

  it('MONOTONE at the deaths baseline: marginally fewer deaths can never flip a verdict', () => {
    // With output down, deaths exactly at baseline vs one-hundredth better must behave
    // near-identically — the guard engages gradually over the deaths dimension too. The
    // binary aligned>0 gate this pins against flipped declineFired on a 0.01 deaths/10 change.
    const at = (deaths: number) =>
      perfAt([...baseline, ...statSpan(29, 35, { perDay: 3, damage: 6800, deaths, elims: 20 })], 35);
    const atBaseline = at(5);
    const hairBetter = at(4.99);
    expect(hairBetter.declineFired).toBe(atBaseline.declineFired);
    expect(Math.abs(hairBetter.cusumMax - atBaseline.cusumMax)).toBeLessThan(0.35);
    // And clearly-fewer deaths with output down still engages the guard fully (scared fires).
    expect(at(4).declineFired).toBe(true);
  });

  it('SUPPORT: healing holding at baseline vouches for output — a heal-focused style shift is not "scared"', () => {
    // Battle-Mercy stops dueling: damage halves, deaths halve, but healing (her actual job)
    // holds exactly at baseline. Resolved #8 rejected punishing genuine efficiency shifts.
    const mercyBase = statSpan(5, 28, { perDay: 3, hero: 'Mercy', role: 'support', damage: 1200, deaths: 3, elims: 8, healing: 9000 });
    const healBot = statSpan(29, 35, { perDay: 3, hero: 'Mercy', role: 'support', damage: 600, deaths: 1.5, elims: 8, healing: 9000 });
    const p = perfAt([...mercyBase, ...healBot], 35);
    expect(p.declineFired).toBe(false);
    expect(p.statPenalty).toBe(0);
  });

  it('SUPPORT: healing ALSO down + deaths down = a scared support — fires', () => {
    const mercyBase = statSpan(5, 28, { perDay: 3, hero: 'Mercy', role: 'support', damage: 1200, deaths: 3, elims: 8, healing: 9000 });
    const scared = statSpan(29, 35, { perDay: 3, hero: 'Mercy', role: 'support', damage: 600, deaths: 1.5, elims: 5, healing: 6000 });
    const p = perfAt([...mercyBase, ...scared], 35);
    expect(p.declineFired).toBe(true);
  });
});

// ---- several accounts, one player (owner amendment 2026-09-03) ----------------

describe('cross-account hero experience — the learning window pools ALL accounts', () => {
  // The Genji/Shion false alarm: 244 Genji games on the main and 6 on an alt is a Genji player
  // on the alt too. Hero experience belongs to the player, not to the account they queued on.
  const tracerMain = statSpan(5, 28, { perDay: 2, ...HEALTHY, account: 'Main' });

  it('8 Genji games on an alt + 6 on the main = 14 ≥ heroLearnGames ⇒ NOT still learning', () => {
    const mainGenji = statSpan(20, 25, { perDay: 1, hero: 'Genji', ...HEALTHY, account: 'Main', hour: 18 }); // 6
    const altGenji = statSpan(32, 35, { perDay: 2, hero: 'Genji', ...HEALTHY, account: 'Smurf', hour: 19 }); // 8
    const p = perfAt([...tracerMain, ...mainGenji, ...altGenji], 35);
    expect(p.stillLearning).not.toContain('Genji');
  });

  it('6 on the alt + 5 on the main = 11 < heroLearnGames ⇒ still learning', () => {
    const mainGenji = statSpan(20, 24, { perDay: 1, hero: 'Genji', ...HEALTHY, account: 'Main', hour: 18 }); // 5
    const altGenji = statSpan(33, 35, { perDay: 2, hero: 'Genji', ...HEALTHY, account: 'Smurf', hour: 19 }); // 6
    const p = perfAt([...tracerMain, ...mainGenji, ...altGenji], 35);
    expect(p.stillLearning).toContain('Genji');
  });
});

describe('mainAccountOf — the account that carries the verdict', () => {
  it('null for an empty history', () => {
    expect(mainAccountOf([])).toBeNull();
  });

  it('the account with the most games', () => {
    const games = [...span(5, 14, { perDay: 1, account: 'Karambo' }), ...span(10, 12, { perDay: 1, account: 'SirTilt', hour: 19 })];
    expect(mainAccountOf(games)).toBe('Karambo');
    expect(mainAccountOf([...games].reverse())).toBe('Karambo'); // order-independent
  });

  it('needs a clear lead to hold the crown — a near-tie has no main at all', () => {
    const a = span(5, 9, { perDay: 1, account: 'A' }); // 5 games
    const b = span(6, 10, { perDay: 1, account: 'B' }); // 5 games
    expect(mainAccountOf([...a, ...b])).toBeNull(); // exact tie ⇒ no clear main
    expect(mainAccountOf([...b, ...a])).toBeNull(); // order-independent — no tie-break to disagree with
    const aAhead = [...a, ...span(11, 11, { perDay: 1, account: 'A' })]; // 6 vs 5 clears the 10% margin
    expect(mainAccountOf([...aAhead, ...b])).toBe('A');
  });

  it('a single account is always its own main — the margin only ever compares against a real runner-up', () => {
    expect(mainAccountOf(span(5, 9, { perDay: 1, account: 'Solo' }))).toBe('Solo');
  });

  it('a tie among several accounts is still no main, whichever pair is tightest', () => {
    // Two accounts tied for the lead, a third clearly behind — the tie at the
    // top still fails the margin no matter which of the two a sort would have
    // preferred; there is no tie-break left to disagree with that outcome.
    const zed = span(5, 9, { perDay: 2, account: 'Zed' }); // 10
    const amy = span(5, 9, { perDay: 2, account: 'Amy', hour: 18 }); // 10
    const low = span(5, 6, { perDay: 1, account: 'Low', hour: 20 }); // 2
    expect(mainAccountOf([...zed, ...amy, ...low])).toBeNull();
    expect(mainAccountOf([...amy, ...zed, ...low])).toBeNull();
  });

  it('never crowns the Unknown bucket — it is unresolved captures, not an account', () => {
    const unknown = span(5, 20, { perDay: 2, account: UNKNOWN_ACCOUNT });
    const real = span(5, 9, { perDay: 1, account: 'Karambo', hour: 19 });
    expect(mainAccountOf([...unknown, ...real])).toBe('Karambo');
    expect(mainAccountOf(unknown)).toBeNull();
  });

  it('an account abandoned before the active window cannot keep the crown', () => {
    const old = span(1, 20, { perDay: 3, account: 'OldMain' }); // 60 lifetime games, none recent
    const now = span(30, 35, { perDay: 2, account: 'NewMain', hour: 19 }); // 12 recent games
    expect(mainAccountOf([...old, ...now], { activeFromOrdinal: dayOrdinal(ts(25)) })).toBe('NewMain');
    // Without an active window it is a plain lifetime count, as before.
    expect(mainAccountOf([...old, ...now])).toBe('OldMain');
    // Nobody active ⇒ every account competes again rather than nobody doing.
    expect(mainAccountOf([...old], { activeFromOrdinal: dayOrdinal(ts(30)) })).toBe('OldMain');
  });
});

describe('main-account damper — an alt week moves the verdict less, both ways', () => {
  const W = T.altAccountWeight;
  // Both accounts carry a full-trust healthy baseline; Main (72 games) is the main, Smurf (24) the alt.
  const mainBase = statSpan(5, 28, { perDay: 3, ...HEALTHY, account: 'Main' });
  const smurfBase = statSpan(5, 28, { perDay: 1, ...HEALTHY, account: 'Smurf', hour: 19 });

  it('pins the factor and the single-account defaults', () => {
    expect(W).toBe(0.35);
    const p = perfAt(mainBase, 28);
    expect(p.mainAccount).toBe('Main');
    expect(p.altShare).toBe(0);
  });

  it('DETECTORS are untouched — an alt-only collapse accumulates exactly what the same collapse on the main does', () => {
    const onAlt = perfAt([...mainBase, ...smurfBase, ...statSpan(33, 35, { perDay: 3, ...COLLAPSED, account: 'Smurf', hour: 19 })], 35);
    const onMain = perfAt([...mainBase, ...smurfBase, ...statSpan(33, 35, { perDay: 3, ...COLLAPSED, account: 'Main' })], 35);
    expect(onAlt.altShare).toBe(1); // the acute window is alt-only
    expect(onMain.altShare).toBe(0);
    // Identical baselines and identical stats ⇒ identical evidence. Weighting a CUSUM would have
    // scaled its recovery steps too and could fire a decline the unweighted engine never saw;
    // the damper cannot, because it never touches the accumulators.
    expect(onAlt.cusumMax).toBeCloseTo(onMain.cusumMax, 9);
    expect(onAlt.countedGames).toBe(onMain.countedGames);
    expect(onAlt.statPenalty).toBeCloseTo(onMain.statPenalty, 9);
    expect(onAlt.blend).toBeCloseTo(onMain.blend, 9);
    expect(onAlt.statCoverage).toBeCloseTo(onMain.statCoverage, 9);
    // Only the finished subscore differs, by exactly the damper.
    expect(onAlt.delta).toBeCloseTo(onMain.delta * W, 9);
    expect(onAlt.delta).toBeGreaterThan(onMain.delta); // both negative ⇒ the alt week costs less
  });

  it('playing WELL on the alt between poor main games can never CREATE a decline', () => {
    // The asymmetry a per-game CUSUM weight introduces: good alt games stop cancelling bad main
    // ones, so the accumulator drifts up. Here the favourable alt games must still clear it.
    const mixed = [
      ...statSpan(5, 28, { perDay: 4, ...HEALTHY, account: 'Main' }),
      ...statSpan(5, 28, { perDay: 2, ...HEALTHY, account: 'Smurf', hour: 19 }),
      ...statSpan(31, 35, { perDay: 2, damage: 7000, deaths: 6, elims: 17, account: 'Main' }), // mildly below
      ...statSpan(31, 35, { perDay: 2, damage: 9200, deaths: 4, elims: 24, account: 'Smurf', hour: 19 }), // above
    ];
    const p = perfAt(mixed, 35);
    expect(p.cusumMax).toBeLessThan(T.cusumThreshold);
    expect(p.declineFired).toBe(false);
  });

  it('damps a good alt week by the same factor as a bad one — never one-sided', () => {
    const good = (account: string, hour: number) => statSpan(29, 35, { perDay: 3, damage: 9500, deaths: 3, elims: 26, account, hour });
    const bad = (account: string, hour: number) => statSpan(29, 35, { perDay: 3, ...COLLAPSED, account, hour });
    const goodAlt = perfAt([...mainBase, ...smurfBase, ...good('Smurf', 19)], 35);
    const goodMain = perfAt([...mainBase, ...smurfBase, ...good('Main', 14)], 35);
    const badAlt = perfAt([...mainBase, ...smurfBase, ...bad('Smurf', 19)], 35);
    const badMain = perfAt([...mainBase, ...smurfBase, ...bad('Main', 14)], 35);
    expect(goodMain.delta).toBeGreaterThan(0);
    expect(badMain.delta).toBeLessThan(0);
    expect(goodAlt.delta).toBeCloseTo(goodMain.delta * W, 9);
    expect(badAlt.delta).toBeCloseTo(badMain.delta * W, 9);
  });

  it('scales continuously with the share of the week spent away from the main', () => {
    const deltas = [0, 3, 6, 9].map((altPerDay) => {
      const acute = [
        ...statSpan(33, 35, { perDay: 9 - altPerDay, ...COLLAPSED, account: 'Main' }),
        ...statSpan(33, 35, { perDay: altPerDay, ...COLLAPSED, account: 'Smurf', hour: 19 }),
      ];
      return perfAt([...mainBase, ...smurfBase, ...acute], 35).delta;
    });
    // Monotone toward neutral as more of the week moves to the alt — no cliff anywhere.
    for (let i = 1; i < deltas.length; i += 1) expect(deltas[i]).toBeGreaterThan(deltas[i - 1]);
  });

  it('unresolved captures are not an alt account', () => {
    const withUnknown = [
      ...statSpan(5, 28, { perDay: 3, ...HEALTHY, account: 'Main' }),
      ...statSpan(33, 35, { perDay: 2, ...COLLAPSED, account: 'Main' }),
      ...statSpan(33, 35, { perDay: 1, ...COLLAPSED, account: UNKNOWN_ACCOUNT, hour: 19 }),
    ];
    const p = perfAt(withUnknown, 35);
    expect(p.mainAccount).toBe('Main');
    expect(p.altShare).toBe(0); // nothing to damp: the player has one account
  });

  it('per-metric direction means stay truthful (unweighted, one game one vote)', () => {
    const onAlt = perfAt([...mainBase, ...smurfBase, ...statSpan(33, 35, { perDay: 3, ...COLLAPSED, account: 'Smurf', hour: 19 })], 35);
    const onMain = perfAt([...mainBase, ...smurfBase, ...statSpan(33, 35, { perDay: 3, ...COLLAPSED, account: 'Main' })], 35);
    expect(onAlt.metricMeans.damage).toBeCloseTo(onMain.metricMeans.damage!, 9);
    expect(onAlt.metricMeans.deaths!).toBeLessThan(0);
  });

  describe('winrate pooling', () => {
    // The uncoupled baseline window is days 15–28 (chronicDays 21 minus the acute week): both
    // accounts must clear wrMinDecidedBase (30) there — Main 14×6 = 84, Smurf 14×3 = 42 — and
    // Main clears mainAccountLeadMargin over Smurf whether or not Smurf's 21 acute games are
    // the only acute games in the window (144 vs 93 ⇒ still a clear lead either way).
    const mainWins = span(5, 28, { perDay: 6, account: 'Main' }); // 144
    const smurfWins = span(5, 28, { perDay: 3, account: 'Smurf', hour: 19 }); // 72
    const acute = (account: string, result: 'Win' | 'Loss') =>
      span(29, 35, { perDay: 3, result, account, hour: account === 'Main' ? 14 : 19 }); // 21 decided each

    it('pools by raw sample size; the damper does the account weighting once, on the delta', () => {
      const dipOnAlt = perfAt([...mainWins, ...smurfWins, ...acute('Main', 'Win'), ...acute('Smurf', 'Loss')], 35);
      const dipOnMain = perfAt([...mainWins, ...smurfWins, ...acute('Main', 'Loss'), ...acute('Smurf', 'Win')], 35);
      expect(dipOnAlt.mainAccount).toBe('Main');
      // Equal raw samples on both sides ⇒ the pooled dip is the same either way…
      expect(dipOnAlt.wrDip).toBeCloseTo(0.5, 9);
      expect(dipOnMain.wrDip).toBeCloseTo(0.5, 9);
      expect(dipOnAlt.wrPenalty).toBeCloseTo(dipOnMain.wrPenalty, 9);
      // …and the half-alt week is damped once, at the end.
      expect(dipOnAlt.altShare).toBeCloseTo(0.5, 9);
      expect(dipOnAlt.delta).toBeCloseTo(dipOnMain.delta, 9);
    });

    it('the sample gates stay on RAW counts: an alt alone with 21 decided acute games is still a read', () => {
      const p = perfAt([...mainWins, ...smurfWins, ...acute('Smurf', 'Loss')], 35);
      expect(p.wrDip).not.toBeNull();
      expect(p.wrDip!).toBeCloseTo(1, 9); // the only account in the pool ⇒ its own dip
      expect(p.altShare).toBe(1);
    });
  });

  it('blend and coverage are account-blind, even when only the ALT has comparable stats', () => {
    // The case a weighted blend got wrong: the main's bucket is too thin to compare while the
    // alt's is full. Coverage must describe the DATA, not which account it came from — a weighted
    // ratio here collapsed b and switched on the promoted manual caps.
    const games = [
      ...statSpan(5, 18, { perDay: 1, hero: 'Winston', ...HEALTHY, account: 'Main', role: 'tank' }), // 14 < statMinGames
      ...statSpan(5, 28, { perDay: 3, ...HEALTHY, account: 'Smurf', hour: 19 }),
      ...statSpan(29, 35, { perDay: 3, hero: 'Winston', ...HEALTHY, account: 'Main', role: 'tank' }),
      ...statSpan(29, 35, { perDay: 3, ...HEALTHY, account: 'Smurf', hour: 19 }),
    ];
    const p = perfAt(games, 35);
    const mirrored = perfAt(games.map((g) => ({ ...g, account: 'Main' })), 35);
    expect(p.blend).toBeCloseTo(mirrored.blend, 9);
    expect(p.statCoverage).toBeCloseTo(mirrored.statCoverage, 9);
  });

  it('a stats-rich two-account history keeps b = 1', () => {
    const games = [
      ...statSpan(5, 35, { perDay: 2, ...HEALTHY, account: 'Main' }),
      ...statSpan(5, 35, { perDay: 1, ...HEALTHY, account: 'Smurf', hour: 19 }),
    ];
    const p = perfAt(games, 35);
    expect(p.mainAccount).toBe('Main');
    expect(p.blend).toBe(1);
    expect(p.statCoverage).toBe(1);
    expect(p.altShare).toBeCloseTo(7 / 21, 9); // RAW share of the acute window
    expect(p.maxAccountShare).toBeCloseTo(14 / 21, 9);
  });
});

describe('rank-proximity weighting — how much an alt game actually costs', () => {
  // Rank-scalar points: 100/division, 500/tier (see ../rank/scalar). The main
  // sits at Grandmaster 5, 0% (index 7) = 3500 — "low GM" in the ask this
  // implements ("my main rank is low gm and i play on mid/high master then it
  // should be taken into account 100% ... low master should weigh less and
  // dia/emerald is basically smurfing at this point").
  const GM5: RankPosition = { tier: 'Grandmaster', division: 5, progressPct: 0 }; // 3500
  const MID_MASTER: RankPosition = { tier: 'Master', division: 2, progressPct: 50 }; // 3350, 150pt gap
  const LOW_MASTER: RankPosition = { tier: 'Master', division: 5, progressPct: 0 }; // 3000, 500pt gap
  const DIAMOND: RankPosition = { tier: 'Diamond', division: 3, progressPct: 0 }; // 2700, 800pt gap
  const EMERALD: RankPosition = { tier: 'Emerald', division: 3, progressPct: 0 }; // 2200, 1300pt gap
  const CHAMPION: RankPosition = { tier: 'Champion', division: 1, progressPct: 100 }; // 4500, above main

  const mainBase = withRank(statSpan(5, 28, { perDay: 3, ...HEALTHY, account: 'Main' }), GM5);
  /** altDamp for a whole acute week played on the alt at a given rank (or ranks, one per game). */
  const altDampAt = (ranks: RankPosition | RankPosition[]) => {
    const raw = statSpan(33, 35, { perDay: 3, ...HEALTHY, account: 'Smurf', hour: 19 });
    const tagged = Array.isArray(ranks) ? raw.map((g, i) => ({ ...g, rankAtStart: ranks[i % ranks.length] })) : withRank(raw, ranks);
    return perfAt([...mainBase, ...tagged], 35).altDamp;
  };

  it('at or above the main’s usual rank costs nothing — that isn’t smurfing', () => {
    expect(altDampAt(CHAMPION)).toBe(1);
    expect(altDampAt(GM5)).toBe(1); // exactly the main's own rank: gap 0
  });

  it('close below the main’s usual rank still counts fully ("mid/high master vs low gm")', () => {
    expect(altDampAt(MID_MASTER)).toBe(1); // 150pt gap ≤ altRankCloseGap (250)
  });

  it('a moderate gap tapers the weight down without hitting the floor ("low master ... weighs less")', () => {
    const d = altDampAt(LOW_MASTER); // 500pt gap, between the two thresholds
    expect(d).toBeGreaterThan(T.altRankFloorWeight);
    expect(d).toBeLessThan(1);
    // t = (500−250)/(750−250) = 0.5 ⇒ weight = 1 − 0.5·(1−0.15)
    expect(d).toBeCloseTo(1 - 0.5 * (1 - T.altRankFloorWeight), 9);
  });

  it('a large gap bottoms out at the floor ("dia/emerald is basically smurfing")', () => {
    expect(altDampAt(DIAMOND)).toBeCloseTo(T.altRankFloorWeight, 9); // 800pt gap ≥ altRankSmurfGap (750)
    expect(altDampAt(EMERALD)).toBeCloseTo(T.altRankFloorWeight, 9); // 1300pt gap, well past it
  });

  it('weighs each game by its own rank, not one verdict for the whole week', () => {
    // Half the week at the main's own level, half deep in smurf territory — an
    // even 3-3 split so the expected mean is exact — and altDamp is the plain
    // mean of the two per-game weights, not a weight computed from an average rank.
    const raw = statSpan(33, 35, { perDay: 2, ...HEALTHY, account: 'Smurf', hour: 19 }); // 3 days × 2 = 6 games
    const tagged = raw.map((g, i) => ({ ...g, rankAtStart: i % 2 === 0 ? GM5 : EMERALD }));
    const d = perfAt([...mainBase, ...tagged], 35).altDamp;
    expect(d).toBeCloseTo((1 + T.altRankFloorWeight) / 2, 9);
  });

  it('falls back to the flat altAccountWeight when no rank data exists anywhere', () => {
    const noRankMain = statSpan(5, 28, { perDay: 3, ...HEALTHY, account: 'Main' }); // no rankAtStart at all
    const altGames = statSpan(33, 35, { perDay: 3, ...HEALTHY, account: 'Smurf', hour: 19 });
    expect(perfAt([...noRankMain, ...altGames], 35).altDamp).toBeCloseTo(T.altAccountWeight, 9);
  });

  it('falls back per-game to the account’s own median when that specific game has no rankAtStart', () => {
    // The alt's rank is known from EARLIER games in the window, just not from
    // the acute ones themselves (e.g. no ±% logged on that particular match).
    const altHistory = withRank(statSpan(10, 20, { perDay: 1, ...HEALTHY, account: 'Smurf', hour: 19 }), LOW_MASTER);
    const altAcute = statSpan(33, 35, { perDay: 3, ...HEALTHY, account: 'Smurf', hour: 19 }); // untagged
    const d = perfAt([...mainBase, ...altHistory, ...altAcute], 35).altDamp;
    expect(d).toBeCloseTo(1 - 0.5 * (1 - T.altRankFloorWeight), 9); // same as a direct LOW_MASTER tag
  });

  it('the main’s "usual" rank is the median over the window, not a single outlier game', () => {
    // Mostly Grandmaster 5, with a brief hot streak to Champion mixed in — the
    // small minority must not drag the reference rank up with it.
    const steady = withRank(statSpan(5, 24, { perDay: 1, ...HEALTHY, account: 'Main' }), GM5); // 20 games
    const hotStreak = withRank(statSpan(25, 27, { perDay: 1, ...HEALTHY, account: 'Main' }), CHAMPION); // 3 games
    const altGames = withRank(statSpan(33, 35, { perDay: 3, ...HEALTHY, account: 'Smurf', hour: 19 }), GM5);
    const p = perfAt([...steady, ...hotStreak, ...altGames], 35);
    expect(p.altDamp).toBe(1); // median still reads as GM5 ⇒ the alt is exactly rank-close
  });

  it('only looks inside the trailing window — a rank from long before it does not count as "usual"', () => {
    // Ancient games at Bronze (outside mainRankWindowDays), current games at
    // the main's real level — the reference rank must come from the recent
    // window, or a long-since-outgrown rank would make every alt read as far above.
    const ancient = withRank(span(-500, -480, { perDay: 1, account: 'Main' }), { tier: 'Bronze', division: 5, progressPct: 0 });
    const p = perfAt([...ancient, ...mainBase, ...statSpan(33, 35, { perDay: 3, ...HEALTHY, account: 'Smurf', hour: 19 }).map((g) => ({ ...g, rankAtStart: LOW_MASTER }))], 35);
    expect(p.altDamp).toBeCloseTo(1 - 0.5 * (1 - T.altRankFloorWeight), 9); // reads off the recent GM5 baseline, not ancient Bronze
  });

  it('single-account bit-identity holds even with rank data present', () => {
    const p = perfAt(withRank(statSpan(5, 35, { perDay: 3, ...HEALTHY, account: 'Main' }), GM5), 35);
    expect(p.altDamp).toBe(1);
    expect(p.altShare).toBe(0);
  });

  it('a near-tie between two DIFFERENTLY-ranked accounts never damps either — not a coin-flip between two damped states', () => {
    // The case a plain plurality got wrong: whichever of two near-equal accounts happens to be
    // crowned supplies the rank the OTHER is judged against, and — unlike a flat weight — that
    // is not symmetric (the higher-ranked one always reads as "at or above main"). One extra
    // game flipping the crown must not flip the whole week between heavily damped and undamped.
    // Equal total games (31 days × 3 = 93 each, acute window included in both) ⇒ an exact tie.
    const mainGames = withRank(statSpan(5, 35, { perDay: 3, ...HEALTHY, account: 'Main' }), GM5);
    const altGames = withRank(statSpan(5, 35, { perDay: 3, ...HEALTHY, account: 'Alt', hour: 19 }), EMERALD);
    const acuteOnLow = [...mainGames, ...altGames];
    const p = perfAt(acuteOnLow, 35);
    expect(p.mainAccount).toBeNull(); // exact tie ⇒ no clear main
    expect(p.altDamp).toBe(1); // ⇒ nobody is "alt" ⇒ nothing is damped
    // A handful more games (clearing the 10% margin: 93 vs 103) restores rank-based damping, in
    // only ONE direction (whichever account actually leads), never as a jump between two
    // opposite damped states.
    const lead = [...acuteOnLow, ...withRank(statSpan(20, 29, { perDay: 1, ...HEALTHY, account: 'Main' }), GM5)];
    const q = perfAt(lead, 35);
    expect(q.mainAccount).toBe('Main');
    expect(q.altDamp).toBeLessThan(1); // now damped, because Alt (Emerald) reads against Main's GM5
  });
});

describe('single-account bit-identity — weighting is invisible with one account', () => {
  // Goldens captured from the engine BEFORE main-account weighting landed (2026-09-03). A
  // one-account history has every per-game weight ≡ 1 (rank-close or flat-fallback, doesn't
  // matter — there's no alt game to weight), so the weighted engine must reproduce them EXACTLY
  // (toEqual, no tolerance); the only additions are the three new fields (mainAccount, altShare,
  // altDamp).
  it('collapse marathon (stats regime, decline fired) reproduces its pre-weighting golden', () => {
    const p = perfAt([...statSpan(5, 28, { perDay: 2, ...HEALTHY }), ...statSpan(35, 35, { perDay: 12, ...COLLAPSED })], 35);
    expect(p).toEqual({
      available: true, statCoverage: 1, maxAccountShare: 1, mainAccount: 'Main', altShare: 0, altDamp: 1,
      declineFired: true, cusumMax: 24.647058823529417, countedGames: 12, statPenalty: 30,
      wrDip: null, wrPenalty: 0, bonus: 0, targetEvidence: false, dampened: false, stillLearning: [],
      metricMeans: { eliminations: -2.333333333333333, deaths: -2.5, damage: -2.083333333333333 },
      objectiveAdverse: true, blend: 1, blendCoverage: 12, delta: -30,
    });
  });

  it('manual winrate dip (b=0) reproduces its pre-weighting golden', () => {
    const p = perfAt([...span(5, 28, { perDay: 3 }), ...span(29, 35, { perDay: 4, result: 'Loss' })], 35);
    expect(p).toEqual({
      available: true, statCoverage: 0, maxAccountShare: 1, mainAccount: 'Main', altShare: 0, altDamp: 1,
      declineFired: false, cusumMax: 0, countedGames: 0, statPenalty: 0,
      wrDip: 1, wrPenalty: 30, bonus: 0, targetEvidence: false, dampened: false, stillLearning: [],
      metricMeans: {}, objectiveAdverse: true, blend: 0, blendCoverage: 0, delta: -30,
    });
  });

  it('stats-rich decline + winrate dip (b=1) reproduces its pre-weighting golden', () => {
    const p = perfAt(
      [
        ...statSpan(0, 24, { perDay: 5, hero: 'Tracer', result: 'Win', damage: 9000, deaths: 4, elims: 22 }),
        ...statSpan(25, 35, { perDay: 5, hero: 'Tracer', result: 'Loss', damage: 4000, deaths: 10, elims: 9 }),
      ],
      35,
    );
    expect(p).toEqual({
      available: true, statCoverage: 1, maxAccountShare: 1, mainAccount: 'Main', altShare: 0, altDamp: 1,
      declineFired: true, cusumMax: 26.25, countedGames: 35, statPenalty: 30,
      wrDip: 0.7142857142857143, wrPenalty: 15, bonus: 0, targetEvidence: false, dampened: false, stillLearning: [],
      metricMeans: { eliminations: -1, deaths: -1, damage: -1 },
      objectiveAdverse: true, blend: 1, blendCoverage: 35, delta: -45,
    });
  });

  it('renaming the one account changes nothing but mainAccount', () => {
    const games = [...statSpan(5, 28, { perDay: 2, ...HEALTHY }), ...statSpan(35, 35, { perDay: 12, ...COLLAPSED })];
    const renamed = games.map((g) => ({ ...g, account: 'Other' }));
    const a = perfAt(games, 35);
    const b = perfAt(renamed, 35);
    expect(b.mainAccount).toBe('Other');
    expect({ ...b, mainAccount: 'Main' }).toEqual(a);
  });
});

describe('account signals — mixed-accounts names the main; alt-weighted is the quiet note', () => {
  it('a materially MIXED acute window names the main account and the alt weight', () => {
    const main = statSpan(5, 35, { perDay: 3, account: 'Main' }); // acute share 0.6 < accountMixBar
    const smurf = statSpan(5, 35, { perDay: 2, account: 'Smurf', hour: 18 });
    const r = computeReadiness([...main, ...smurf], ts(35, 20));
    const sig = r.signals.find((s) => s.key === 'mixed-accounts');
    expect(sig?.severity).toBe('ok');
    expect(sig?.label).toBe('recent games span multiple accounts — Main carries the read, the rest count for less');
    expect(r.signals.some((s) => s.key === 'alt-weighted')).toBe(false); // one note or the other, never both
    expect(r.confidence).not.toBe('high'); // the confidence cap is unchanged (raw share)
  });

  it('alt games BELOW the mixed bar surface the quieter alt-weighted note instead', () => {
    const main = statSpan(5, 35, { perDay: 4, account: 'Main' }); // acute share 0.8 ≥ accountMixBar
    const smurf = statSpan(5, 35, { perDay: 1, account: 'Smurf', hour: 18 });
    const r = computeReadiness([...main, ...smurf], ts(35, 20));
    expect(r.signals.some((s) => s.key === 'mixed-accounts')).toBe(false);
    const sig = r.signals.find((s) => s.key === 'alt-weighted');
    expect(sig?.severity).toBe('ok');
    expect(sig?.label).toBe('Main is your main account — games on your other accounts move this read less');
  });

  it('a single-account history surfaces neither note', () => {
    const r = computeReadiness(statSpan(5, 35, { perDay: 4, account: 'Main' }), ts(35, 20));
    expect(r.signals.some((s) => s.key === 'mixed-accounts' || s.key === 'alt-weighted')).toBe(false);
  });

  it('never claims a weighting it did not apply — unresolved captures are not "other accounts"', () => {
    const r = computeReadiness(
      [...statSpan(5, 35, { perDay: 4, account: 'Main' }), ...statSpan(5, 35, { perDay: 1, account: UNKNOWN_ACCOUNT, hour: 18 })],
      ts(35, 20),
    );
    expect(r.signals.some((s) => s.key === 'alt-weighted')).toBe(false);
    // A mixed window with nothing to damp still says it is mixed — it just makes no claim about weight.
    const mixedNote = r.signals.find((s) => s.key === 'mixed-accounts');
    if (mixedNote) expect(mixedNote.label).toBe('recent games span multiple accounts — the read is less precise');
  });
});
