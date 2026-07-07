import { describe, it, expect } from 'vitest';
import { blendFor, regimeFor } from '../src/core/readiness/regime';
import { manualLerp, READINESS_TUNING as T } from '../src/core/readiness/constants';
import { perfState, EMPTY_CONTEXT } from '../src/core/readiness/performance';
import { dayOrdinal } from '../src/core/readiness/day';
import { statSpan, span } from './readinessFixtures';
import type { GameRecord } from '../src/core/analytics';

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
