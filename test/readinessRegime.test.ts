import { describe, it, expect } from 'vitest';
import { blendFor, regimeFor } from '../src/core/readiness/regime';
import { manualLerp, READINESS_TUNING as T } from '../src/core/readiness/constants';
import { perfState, EMPTY_CONTEXT } from '../src/core/readiness/performance';
import { loadState } from '../src/core/readiness/signals';
import { loadParts } from '../src/core/readiness/score';
import { computeReadiness } from '../src/core/readiness';
import { dayOrdinal } from '../src/core/readiness/day';
import { ts, statSpan, span, graded, target, CALM, TILT } from './readinessFixtures';
import type { GameRecord } from '../src/core/analytics';

/** A rest-punctuated history: `perDay` games Mon–Fri each week, weekends off. */
function restPunctuated(weeks: number, perDay: number, lastDay: number): GameRecord[] {
  const out: GameRecord[] = [];
  for (let w = 0; w < weeks; w += 1) {
    const monday = lastDay - (weeks - 1 - w) * 7 - 4; // Mon..Fri block ending Friday
    out.push(...span(monday, monday + 4, { perDay, mental: CALM }));
  }
  return out;
}

const refOf = (games: GameRecord[]): number =>
  dayOrdinal(games.reduce((m, g) => Math.max(m, g.timestamp), 0));

describe('manualLerp', () => {
  it('returns the stats value at b=1 exactly (bit-identity anchor)', () => {
    expect(manualLerp(15, 30, 1)).toBe(15);
    expect(manualLerp(-15, -25, 1)).toBe(-15);
    expect(manualLerp(10, 16, 1)).toBe(10);
  });
  it('returns the manual value at b=0', () => {
    expect(manualLerp(15, 30, 0)).toBe(30);
    expect(manualLerp(-15, -25, 0)).toBe(-25);
  });
  it('interpolates linearly in between', () => {
    expect(manualLerp(15, 30, 0.5)).toBeCloseTo(22.5, 10);
  });
});

describe('blendFor', () => {
  it('is 0 with zero comparable coverage', () => {
    expect(blendFor(0, 133)).toBe(0);
    expect(blendFor(0, 0)).toBe(0);
  });
  it('saturates to exactly 1.0 at/above the coverage target (attains 1, not asymptotic)', () => {
    // coverage = blendCoverage / acute ≥ blendCoverageTarget(0.5) ⇒ b = 1
    expect(blendFor(10, 20)).toBe(1); // 10 / max(10, 10) = 1
    expect(blendFor(70, 70)).toBe(1); // full coverage
    expect(blendFor(40, 70)).toBe(1); // 40 / max(10, 35) = 40/35 clamps to 1
  });
  it('uses the floor denominator for small acute windows (caps per-game step at 1/floor)', () => {
    expect(blendFor(1, 4)).toBeCloseTo(0.1, 10); // 1 / max(10, 2) = 1/10
    expect(blendFor(5, 4)).toBeCloseTo(0.5, 10); // 5 / max(10, 2) = 5/10
  });
  it('is monotone non-decreasing in coverage', () => {
    let prev = -1;
    for (let c = 0; c <= 40; c += 1) {
      const b = blendFor(c, 40);
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });
  it('never exceeds 1 or drops below 0', () => {
    for (let c = 0; c <= 200; c += 7) {
      const b = blendFor(c, 40);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
  });
});

describe('regimeFor label cuts', () => {
  it('labels the endpoints and the hybrid middle', () => {
    expect(regimeFor(0)).toBe('manual');
    expect(regimeFor(T.regimeManualMax)).toBe('manual'); // inclusive at the manual cut
    expect(regimeFor(0.5)).toBe('hybrid');
    expect(regimeFor(T.regimeStatsMin)).toBe('stats'); // inclusive at the stats cut
    expect(regimeFor(1)).toBe('stats');
  });
});

describe('perfState blend — regime endpoints on real data shapes', () => {
  it('manual-only history (no perHero/durations) ⇒ blend 0 ⇒ manual regime', () => {
    const games = span(0, 20, { perDay: 8 });
    const ref = refOf(games);
    const p = perfState(games, ref, EMPTY_CONTEXT, false);
    expect(p.blendCoverage).toBe(0);
    expect(p.blend).toBe(0);
    expect(regimeFor(p.blend)).toBe('manual');
  });

  it('stats-rich single-hero history ⇒ blend 1 ⇒ stats regime (bit-identity anchor)', () => {
    const games = statSpan(0, 30, { perDay: 2, hero: 'Tracer' });
    const ref = refOf(games);
    const p = perfState(games, ref, EMPTY_CONTEXT, false);
    expect(p.blend).toBe(1);
    expect(regimeFor(p.blend)).toBe('stats');
  });
});

describe('T3 — regime field on every ReadinessSummary producer', () => {
  it('manual-only history ⇒ regime "manual" and load subscore coverage = b (0)', () => {
    const games = span(0, 20, { perDay: 8 });
    const r = computeReadiness(games, ts(20, 20));
    expect(r.regime).toBe('manual');
    expect(r.subscores.load.coverage).toBe(0);
  });
  it('stats-rich history ⇒ regime "stats"', () => {
    const games = statSpan(0, 30, { perDay: 2, hero: 'Tracer' });
    const r = computeReadiness(games, ts(30, 20));
    expect(r.regime).toBe('stats');
    expect(r.subscores.load.coverage).toBe(1);
  });
  it('insufficient-data summary carries regime "manual" and null score', () => {
    const r = computeReadiness(span(0, 3, { perDay: 2 }), ts(3, 20));
    expect(r.band).toBe('insufficient-data');
    expect(r.score).toBeNull();
    expect(r.regime).toBe('manual');
  });
  it('stale summary carries regime "manual"', () => {
    // Enough span/games to clear the insufficient gate, but the last game is >14 days before `now`.
    const r = computeReadiness(span(0, 20, { perDay: 4 }), ts(40, 20)); // last game 20 days ago
    expect(r.band).toBe('rusty');
    expect(r.regime).toBe('manual');
  });
});

describe('T4 — absolute-load arm (the core manual-regime lever)', () => {
  it('heavy manual grind (12/day, ~5 weeks, no rest) ⇒ amber `loaded`, one family ⇒ never red', () => {
    // ≥21 consecutive active days at ≥12 games/day, results at baseline (all wins ⇒ no wr dip),
    // calm mental. Spec AC: must land ≤ amber cut and read 'loaded', NOT 'steady'.
    const games = span(0, 35, { perDay: 12, result: 'Win', mental: CALM });
    const r = computeReadiness(games, ts(35, 20));
    expect(r.regime).toBe('manual');
    expect(r.score!).toBeLessThanOrEqual(T.amberCut); // ≤ 60
    expect(r.band).toBe('loaded');
    expect(r.band).not.toBe('in-the-hole'); // one adverse family (load) can never red
    expect(r.driver).toBe('overload');
  });

  it('R2 — calm hobbyist at 4 games/day EVERY day stays GREEN (volume gate zeros the streak arm)', () => {
    // Same daily consistency as a grinder but low volume: the streak/volume arms must stay silent;
    // only the mild rest-scarcity nudge applies. Regression the red team caught (ungated ⇒ 58 amber).
    const games = span(0, 35, { perDay: 4, result: 'Win', mental: CALM });
    const r = computeReadiness(games, ts(35, 20));
    expect(r.score!).toBeGreaterThan(T.amberCut); // > 60, green
    expect(['steady', 'fresh']).toContain(r.band);
  });

  it('R3 — daily newcomer at 6/day, only ~17 days of history, stays GREEN (tenure ramp defers the arm)', () => {
    // Passes the insufficient gate (span 17 ≥ 14, games ≥ 15) but the absolute arm is tenure-gated,
    // so an engaged newcomer in week 3 isn't flagged. (Without the tenure ramp this reads ~59 amber.)
    const games = span(0, 16, { perDay: 6, result: 'Win', mental: CALM });
    const r = computeReadiness(games, ts(16, 20));
    expect(r.band).not.toBe('insufficient-data');
    expect(r.score!).toBeGreaterThan(T.amberCut); // green
  });

  it('rest-punctuated play (4/day, Mon–Fri, weekends off) stays GREEN — the arm penalizes restlessness, not regularity', () => {
    const games = restPunctuated(5, 4, 32); // last active day 32
    const r = computeReadiness(games, ts(32, 20));
    expect(r.score!).toBeGreaterThan(T.amberCut);
  });

  it('b=1 bit-identity: loadParts gains ZERO from the absolute arm at full stats coverage', () => {
    // A heavy-grind LoadState: at b=1 the arm is exactly 0 (own-norm arms silent at ratio≈1) ⇒ delta 0,
    // identical to the shipped engine; at b=0 the same state accrues the arm. The fact that the b=0
    // delta equals exactly −absRaw (no extra) also proves `surging` is NOT set by the arm (else the
    // own-norm streak arm would pile on).
    const grind = span(0, 35, { perDay: 12, result: 'Win', mental: CALM });
    const ref = refOf(grind);
    const load = loadState(grind, ref);
    const atStats = loadParts(load, 0, 1);
    const atManual = loadParts(load, 0, 0);
    expect(atStats.delta).toBe(0); // bit-identical to pre-regime engine (no own-norm surge here)
    expect(atStats.overloadPen).toBe(0);
    expect(atManual.delta).toBeLessThan(atStats.delta); // manual regime penalizes the exposure
    // EXACT pin: loadDelta at b=0 equals −(absTrust·absRaw) and nothing more. If the arm wrongly set
    // `surging`, the own-norm streak arm ((consecutiveDays−5)·3) would pile on and this would be far
    // more negative — so exact equality proves surging stays unset (R2 invariant).
    const absRaw = Math.min(
      T.absArmCap,
      (load.acutePerDay >= T.absElevatedPerDay
        ? Math.min(T.absStreakPenCap, Math.max(0, load.consecutiveDays - T.absStreakFreeDays) * T.absStreakSlope)
        : 0) +
        Math.min(T.absVolPenCap, Math.max(0, load.acutePerDay - T.absElevatedPerDay) * T.absVolSlope) +
        Math.min(T.restScarcityPenCap, Math.max(0, load.activeDaysPerWeek - T.restScarcityFreePerWeek) * T.restScarcitySlope),
    );
    const absTrust =
      Math.min(1, Math.max(0, (load.chronicActiveDays - T.minChronicActiveDays) / T.absTrustRampDays)) *
      Math.min(1, Math.max(0, (load.historySpanDays - T.minSpanDays) / T.absTenureRampDays));
    expect(atManual.delta).toBeCloseTo(-(absTrust * absRaw), 6);
  });
});

describe('T5 — promoted results (winrate) ceiling', () => {
  // Base wins → acute losses ⇒ a deep, sample-adequate winrate dip. Same shape stats-rich vs manual.
  const manualDip = [
    ...span(0, 28, { perDay: 12, result: 'Win', mental: CALM }),
    ...span(29, 35, { perDay: 12, result: 'Loss', mental: CALM }),
  ];
  const statsDip = [
    ...statSpan(0, 28, { perDay: 12, result: 'Win', mental: CALM }),
    ...statSpan(29, 35, { perDay: 12, result: 'Loss', mental: CALM }),
  ];

  it('manual regime lifts the winrate penalty above the shipped cap (up to 30)', () => {
    const p = perfState(manualDip, refOf(manualDip), EMPTY_CONTEXT, false);
    expect(p.blend).toBe(0);
    expect(p.wrPenalty).toBeGreaterThan(T.wrPenaltyCap); // promoted beyond 15
    expect(p.wrPenalty).toBeLessThanOrEqual(T.wrPenaltyCap + T.wrManualCapBoost); // ≤ 30
    expect(p.objectiveAdverse).toBe(true);
  });

  it('b=1: the same dip stays capped at the shipped 15 (bit-identical corroboration role)', () => {
    const p = perfState(statsDip, refOf(statsDip), EMPTY_CONTEXT, false);
    expect(p.blend).toBe(1);
    expect(p.wrPenalty).toBeLessThanOrEqual(T.wrPenaltyCap); // ≤ 15
    expect(p.wrPenalty).toBeGreaterThan(0); // the dip still fired
  });

  it('two adverse families (sustained load + results dip) ⇒ red reachable in the manual regime', () => {
    const r = computeReadiness(manualDip, ts(35, 20));
    expect(r.regime).toBe('manual');
    expect(r.band).toBe('in-the-hole');
    expect(r.score!).toBeLessThanOrEqual(T.redCut);
  });
});

describe('T6 — tilt as the second adverse family unlocks red on a manual grind', () => {
  it('sustained load + elevated acute tilt (calm baseline) ⇒ in-the-hole', () => {
    // Heavy manual grind, results at baseline (wins ⇒ no wr dip), but the acute week is tilted while
    // the baseline was calm — fatigued fires as the independent adverse family alongside the load gate.
    const games = [
      ...span(0, 28, { perDay: 12, result: 'Win', mental: CALM }),
      ...span(29, 35, { perDay: 12, result: 'Win', mental: TILT }),
    ];
    const r = computeReadiness(games, ts(35, 20));
    expect(r.regime).toBe('manual');
    expect(r.subscores.performance.delta).toBe(0); // results are fine — tilt is the second family
    expect(r.band).toBe('in-the-hole');
  });

  it('the SAME grind with a calm acute week stays amber (load alone never reds)', () => {
    const games = span(0, 35, { perDay: 12, result: 'Win', mental: CALM });
    const r = computeReadiness(games, ts(35, 20));
    expect(r.band).toBe('loaded');
  });
});

describe('T9 — deaths metric direction (owner amendment: fewer deaths = better)', () => {
  const HEALTHY = { damage: 8000, deaths: 5, elims: 20, healing: 0 };
  it('acute deaths BELOW baseline (fewer) is favorable — never fires a decline', () => {
    const games = [
      ...statSpan(0, 24, { perDay: 3, hero: 'Tracer', ...HEALTHY }),
      ...statSpan(25, 35, { perDay: 3, hero: 'Tracer', ...HEALTHY, deaths: 2 }), // fewer deaths
    ];
    const p = perfState(games, refOf(games), EMPTY_CONTEXT, false);
    expect(p.declineFired).toBe(false);
    expect(p.metricMeans.deaths ?? 0).toBeGreaterThanOrEqual(0); // sign-aligned: lower deaths reads positive
  });
  it('acute deaths ABOVE baseline (more) reads adverse on the deaths metric', () => {
    const games = [
      ...statSpan(0, 24, { perDay: 3, hero: 'Tracer', ...HEALTHY }),
      ...statSpan(25, 35, { perDay: 3, hero: 'Tracer', ...HEALTHY, deaths: 11 }), // more deaths
    ];
    const p = perfState(games, refOf(games), EMPTY_CONTEXT, false);
    expect(p.metricMeans.deaths ?? 0).toBeLessThan(0); // more deaths ⇒ negative (worse)
  });
});

describe('T9 — b=1 golden regression (stats regime is bit-identical to the shipped engine)', () => {
  it('a healthy stats-rich history pins its full verdict', () => {
    const games = statSpan(0, 30, { perDay: 4, hero: 'Tracer', result: 'Win' });
    const r = computeReadiness(games, ts(30, 20));
    // Deep-ish snapshot: if any b=1 expression is restructured (arm/cap/floor no longer exactly zero),
    // one of these moves. Pins the regression guarantee the whole design rests on.
    expect(r.regime).toBe('stats');
    expect(r.band).toBe('fresh'); // low daily volume ⇒ the fresh split (cosmetic, green)
    expect(r.confidence).toBe('high');
    expect(r.driver).toBe('neutral');
    expect(r.score).toBe(75);
    expect(r.subscores.load.coverage).toBe(1);
  });

  it('a stats-rich history with an ACTIVE per-10 decline pins its exact score (catches a b=1 leak)', () => {
    // A trivial all-zero golden can hide a b=1 leak that only shows when a stats-regime penalty is
    // live. Here the acute per-10 stats fall below baseline, so the decline penalty fires — the score
    // is < 75 and must be EXACTLY the pre-regime value (the manual arm/caps stay off at b=1).
    const games = [
      ...statSpan(0, 24, { perDay: 5, hero: 'Tracer', result: 'Win', damage: 9000, deaths: 4, elims: 22 }),
      ...statSpan(25, 35, { perDay: 5, hero: 'Tracer', result: 'Win', damage: 4000, deaths: 10, elims: 9 }), // worse
    ];
    const r = computeReadiness(games, ts(35, 20));
    expect(r.regime).toBe('stats');
    expect(r.subscores.performance.delta).toBeLessThan(0); // a real decline is active
    expect(r.subscores.load.coverage).toBe(1); // b = 1 (bit-identity path)
    expect(r.score).toBe(45); // exact regression pin (75 − capped decline penalty) — a b=1 leak would move this
  });
});

describe('T9 — target grades stay dampener-only: all-missed grades never penalize', () => {
  it('an active target graded all-missed adds no penalty in any regime (dampener withheld, nothing more)', () => {
    const tgt = target('t-miss', 0, { mode: 'self' });
    const base = span(0, 28, { perDay: 12, result: 'Win', mental: CALM });
    const acute = span(29, 35, { perDay: 12, result: 'Loss', mental: CALM }).map((g) => graded(g, { 't-miss': 'missed' }));
    const games = [...base, ...acute];
    const withTarget = computeReadiness(games, ts(35, 20), { targets: [tgt] });
    const without = computeReadiness(games, ts(35, 20), { targets: [] });
    // All-missed ⇒ no positive evidence ⇒ dampener never engages ⇒ the objective penalty is identical
    // to having no target at all. Grades only ever SOFTEN; a miss is never adverse on its own.
    expect(withTarget.subscores.performance.delta).toBe(without.subscores.performance.delta);
    expect(withTarget.score).toBe(without.score);
  });
});

describe('T9 — GEP outage: smooth blend down and back, no adverse from missing stats', () => {
  // Stats-rich era (per-10) then a manual era (game updates broke capture; logging continues).
  const games = [
    ...statSpan(0, 24, { perDay: 5, hero: 'Tracer', result: 'Win' }),
    ...span(25, 40, { perDay: 5, result: 'Win', mental: CALM }), // outage: manual-only, still logging
  ];
  const scoreAtDay = (d: number) => computeReadiness(games, ts(d, 20));

  it('regime eases stats → (hybrid) → manual as the acute window loses coverage, never jumping the score', () => {
    const days = [24, 26, 28, 30, 32, 34];
    const rs = days.map(scoreAtDay);
    // Regime monotonically loses coverage (stats-ish early, manual late).
    expect(rs[0].regime).toBe('stats');
    expect(rs[rs.length - 1].regime).toBe('manual');
    // No single day's score jumps by more than a bounded amount from the blend shift.
    for (let i = 1; i < rs.length; i += 1) {
      expect(Math.abs(rs[i].score! - rs[i - 1].score!)).toBeLessThanOrEqual(8);
    }
  });

  it('missing stats never manufacture a decline — the outage can only raise or hold the verdict, never red', () => {
    for (const d of [26, 28, 30, 32, 34, 40]) {
      const r = scoreAtDay(d);
      expect(r.band).not.toBe('in-the-hole'); // absence of stats is never adverse evidence
      expect(r.subscores.performance.delta).toBeGreaterThanOrEqual(0); // no per-10 penalty from the gap
    }
  });

  it('recovery: once capture resumes, the blend climbs back toward stats with the same bounded steps', () => {
    // Stats era → manual outage → stats resumes. Same hero throughout so the baseline is already
    // established when capture returns and the resumed games count immediately.
    const recov = [
      ...statSpan(0, 20, { perDay: 5, hero: 'Tracer', result: 'Win' }),
      ...span(21, 27, { perDay: 5, result: 'Win', mental: CALM }), // outage
      ...statSpan(28, 40, { perDay: 5, hero: 'Tracer', result: 'Win' }), // capture resumes
    ];
    const days = [28, 30, 32, 34]; // acute window fills back up with per-10 games
    const rs = days.map((d) => computeReadiness(recov, ts(d, 20)));
    expect(rs[0].subscores.load.coverage!).toBeLessThan(0.5); // still mostly manual right after resume
    expect(rs[rs.length - 1].regime).toBe('stats'); // fully recovered
    // Monotone climb back, no jump.
    for (let i = 1; i < rs.length; i += 1) {
      expect(rs[i].subscores.load.coverage!).toBeGreaterThanOrEqual(rs[i - 1].subscores.load.coverage!);
      expect(Math.abs(rs[i].score! - rs[i - 1].score!)).toBeLessThanOrEqual(8);
    }
  });

  it('mixed history: trend points are scored under the blend that existed on each day', () => {
    // Stats era then a manual grind era: the recent (manual) trend days carry the absolute-load arm,
    // the early (stats) days don't — so a late point must score below an early point, proving each
    // day is evaluated under its own coverage rather than one global regime.
    const mixed = [
      ...statSpan(0, 18, { perDay: 5, hero: 'Tracer', result: 'Win' }),
      ...span(19, 34, { perDay: 12, result: 'Win', mental: CALM }), // manual grind, no rest
    ];
    const r = computeReadiness(mixed, ts(34, 20));
    const pts = r.trend.filter((p) => p.score !== null);
    const early = pts[0].score!;
    const late = pts[pts.length - 1].score!;
    expect(late).toBeLessThan(early); // the manual arm bites only on the recent days
    // And each trend point equals a full recompute as-of that day (per-day blend, not a global one).
    const lastDate = r.trend[r.trend.length - 1].date;
    expect(r.trend[r.trend.length - 1].score).toBe(computeReadiness(mixed, ts(34, 20)).trend.at(-1)!.score);
    expect(lastDate).toBeTruthy();
  });
});

describe('T9 — one-game epsilon: adding a single game moves the score only a little', () => {
  it('bounded per-game step in a partial-coverage window', () => {
    const base = [
      ...statSpan(0, 24, { perDay: 4, hero: 'Tracer', result: 'Win' }),
      ...span(25, 31, { perDay: 4, result: 'Win', mental: CALM }), // hybrid-ish acute
    ];
    const before = computeReadiness(base, ts(31, 20));
    const after = computeReadiness([...base, ...statSpan(31, 31, { perDay: 1, hero: 'Tracer', result: 'Win' })], ts(31, 20));
    expect(Math.abs(after.score! - before.score!)).toBeLessThanOrEqual(5);
  });
});

describe('T7 — confidence capped at medium in the manual regime', () => {
  it('manual-only history with FULL mental coverage is capped below high', () => {
    const games = span(0, 35, { perDay: 8, result: 'Win', mental: CALM }); // 100% mental coverage
    const r = computeReadiness(games, ts(35, 20));
    expect(r.regime).toBe('manual');
    expect(r.confidence).not.toBe('high'); // capped whatever the mental coverage
  });

  it('stats-rich single-account history can still reach high confidence', () => {
    const games = statSpan(0, 30, { perDay: 4, hero: 'Tracer', result: 'Win' });
    const r = computeReadiness(games, ts(30, 20));
    expect(r.regime).toBe('stats');
    expect(r.confidence).toBe('high');
  });
});

describe('R1 — onboarding trust ramp: b rises smoothly as a baseline crosses the trust floor (no cliff)', () => {
  // A single-hero stats history: K acute games on the last day, N comparable baseline games before
  // the acute window. As N crosses trustFor's floor (n 15→20), blend must RAMP, not cliff-jump the
  // whole cohort at once (the binary-countedGames failure mode the red team found).
  const K = 8;
  function blendForBaseline(n: number): number {
    // n baseline games (days 0..n-1, one hero, one/day) + K acute games on a single recent day,
    // separated by a clear gap so the baseline sits strictly before the acute window.
    const baseline = statSpan(0, n - 1, { perDay: 1, hero: 'Tracer' });
    const acuteDay = n - 1 + 10; // ≥7 days later ⇒ baseline is entirely pre-acute
    const acute = statSpan(acuteDay, acuteDay, { perDay: K, hero: 'Tracer' });
    const games = [...baseline, ...acute];
    return perfState(games, refOf(games), EMPTY_CONTEXT, false).blend;
  }

  it('ramps in bounded steps instead of a single binary jump', () => {
    const bs = [15, 16, 17, 18, 19, 20].map(blendForBaseline);
    // Below the trust floor: nothing comparable yet.
    expect(bs[0]).toBe(0); // n=15 ⇒ trustFor=0
    // The ramp climbs and the top of the window is meaningfully covered.
    expect(bs[5]).toBeGreaterThan(bs[1]);
    // KEY PROPERTY: each one-game step in the baseline moves b by a BOUNDED amount — nowhere near
    // the ~0.8 single-jump a binary countedGames numerator would produce for an 8-game cohort.
    for (let i = 1; i < bs.length; i += 1) {
      expect(bs[i]).toBeGreaterThanOrEqual(bs[i - 1]);
      expect(bs[i] - bs[i - 1]).toBeLessThanOrEqual(0.2 + 1e-9);
    }
  });
});
