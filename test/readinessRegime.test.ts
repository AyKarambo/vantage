import { describe, it, expect } from 'vitest';
import { blendFor, regimeFor } from '../src/core/readiness/regime';
import { manualLerp, READINESS_TUNING as T } from '../src/core/readiness/constants';
import { perfState, EMPTY_CONTEXT } from '../src/core/readiness/performance';
import { loadState } from '../src/core/readiness/signals';
import { loadParts } from '../src/core/readiness/score';
import { computeReadiness } from '../src/core/readiness';
import { dayOrdinal } from '../src/core/readiness/day';
import { ts, statSpan, span, CALM } from './readinessFixtures';
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
    expect(atManual.delta).toBeLessThanOrEqual(-10); // material penalty
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
