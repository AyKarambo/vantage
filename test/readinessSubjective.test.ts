import { describe, it, expect } from 'vitest';
import { subjState } from '../src/core/readiness/subjective';
import { READINESS_TUNING as T, dayOrdinal } from '../src/core/readiness';
import type { MentalState } from '../src/core/readiness/signals';
import type { GameRecord } from '../src/core/analytics';
import { ts, span } from './readinessFixtures';

const NO_MENTAL: MentalState = { coverage: 0, tiltKnown: false, acuteTilt: 0, baseTilt: 0, acutePositive: 0, fatigued: false };
const mental = (p: Partial<MentalState>): MentalState => ({ ...NO_MENTAL, ...p });

const rated = (games: GameRecord[], rating: number): GameRecord[] =>
  games.map((g) => ({ ...g, performance: rating }));

const at35 = (games: GameRecord[], m: MentalState, objectiveAdverse = false) =>
  subjState([...games].sort((a, b) => a.timestamp - b.timestamp), dayOrdinal(ts(35)), m, objectiveAdverse);

describe('subjective subscore', () => {
  it('no mental logs and no slider usage → exactly zero, unavailable', () => {
    const s = at35(span(5, 35, { perDay: 2 }), NO_MENTAL);
    expect(s.delta).toBe(0);
    expect(s.available).toBe(false);
  });

  it('tilt contributes CONTINUOUSLY under the coverage gate — a stray flag counts small, not zero', () => {
    // coverage fine, tilt rate low (one flag among many) — below both elevated bars.
    const s = at35(span(5, 35, { perDay: 2 }), mental({ coverage: 1, tiltKnown: true, acuteTilt: 0.1, baseTilt: 0.1 }));
    expect(s.tiltPen).toBeGreaterThan(0);
    expect(s.tiltPen).toBeLessThan(2);
    expect(s.delta).toBeLessThan(0);
  });

  it('below the coverage gate tilt contributes nothing', () => {
    const s = at35(span(5, 35, { perDay: 2 }), mental({ coverage: 0.2, tiltKnown: true, acuteTilt: 1 }));
    expect(s.tiltPen).toBe(0);
  });

  it("slider is compared against the player's OWN average — a chronic low-rater reads neutral", () => {
    const base = rated(span(5, 30, { perDay: 1 }), 35); // always rates ~35
    const acute = rated(span(33, 35, { perDay: 2 }), 35); // still 35
    const s = at35([...base, ...acute], NO_MENTAL);
    expect(s.sliderDiff).toBe(0);
    expect(s.sliderPen).toBe(0);
    expect(s.delta).toBe(0);
  });

  it("ratings well below one's own average → penalty; well above → bonus", () => {
    const base = rated(span(5, 30, { perDay: 1 }), 70);
    const low = at35([...base, ...rated(span(33, 35, { perDay: 2 }), 40)], NO_MENTAL);
    expect(low.sliderPen).toBeGreaterThan(0);
    expect(low.delta).toBeLessThan(0);
    const high = at35([...base, ...rated(span(33, 35, { perDay: 2 }), 95)], NO_MENTAL);
    expect(high.sliderBon).toBeGreaterThan(0);
    expect(high.delta).toBeGreaterThan(0);
  });

  it('slider needs both its sample gates (≥10 base, ≥3 acute)', () => {
    const thinBase = rated(span(25, 30, { perDay: 1 }), 70); // 6 < 10 prior ratings
    const s1 = at35([...thinBase, ...rated(span(33, 35, { perDay: 2 }), 30)], NO_MENTAL);
    expect(s1.sliderDiff).toBeNull();
    // Base ends BEFORE the acute window (day 28) so only the 2 day-35 ratings are acute.
    const thinAcute = [...rated(span(5, 28, { perDay: 1 }), 70), ...rated(span(35, 35, { perDay: 2 }), 30)];
    const s2 = at35(thinAcute, NO_MENTAL);
    expect(s2.sliderDiff).toBeNull();
  });

  it('disagreement gating: adverse subjective counts ~full alone, ~0.3× when objective already agrees', () => {
    const m = mental({ coverage: 1, tiltKnown: true, acuteTilt: 0.8, baseTilt: 0.2 });
    const games = span(5, 35, { perDay: 2 });
    const alone = at35(games, m, false);
    const agreeing = at35(games, m, true);
    expect(alone.delta).toBeLessThan(0);
    expect(Math.abs(agreeing.delta)).toBeCloseTo(Math.abs(alone.delta) * T.subjAgreeFactor, 5);
  });

  it('"feel great while objectively declining" counter-signal is capped', () => {
    const base = rated(span(5, 30, { perDay: 1 }), 50);
    const acute = rated(span(33, 35, { perDay: 2 }), 95);
    const s = at35([...base, ...acute], NO_MENTAL, true);
    expect(s.delta).toBeGreaterThan(0);
    expect(s.delta).toBeLessThanOrEqual(T.subjCounterCap);
  });

  it('bounds: maxed tilt + slider floor stays within [subjDeltaMin, subjDeltaMax]', () => {
    const base = rated(span(5, 30, { perDay: 1 }), 90);
    const acute = rated(span(33, 35, { perDay: 3 }), 5);
    const s = at35([...base, ...acute], mental({ coverage: 1, tiltKnown: true, acuteTilt: 1, baseTilt: 0, fatigued: true }));
    expect(s.raw).toBeGreaterThanOrEqual(T.subjDeltaMin);
    expect(s.raw).toBeLessThanOrEqual(T.subjDeltaMax);
    expect(s.delta).toBeGreaterThanOrEqual(T.subjDeltaMin);
  });
});
