/**
 * T4 / AC4 — the deep tier's single source of truth. Three layers:
 *  (a) numeric-LITERAL pins — a retune diverges the literal from the derived
 *      constant and fails here, forcing doc re-review (not a tautology);
 *  (b) a cross-check that every constant is still derived from READINESS_TUNING;
 *  (c) prose-drift — the rendered deep-tier copy actually contains the numbers.
 * deepConstants/deepCopy are DOM-free, so this runs in the node test env.
 */
import { describe, it, expect } from 'vitest';
import { READINESS_TUNING as T } from '../src/core/readiness';
import { deepConstants as dc } from '../renderer/src/app/readinessWiki/deepConstants';
import { deepCopy } from '../renderer/src/app/readinessWiki/deepCopy';

describe('deep-tier constants — numeric-literal pins (AC4a)', () => {
  const expected: Record<keyof typeof dc, number> = {
    anchor: 75,
    loadCapDown: 40,
    loadCapUp: 25,
    perfCapDown: 45,
    perfCapUp: 8,
    subjCapDown: 15,
    subjCapUp: 8,
    subjCapDownManual: 25,
    ratioElevated: 1.3,
    ratioHigh: 1.5,
    ratioFreshMax: 1.15,
    cusumThreshold: 2.5,
    cusumSlack: 0.25,
    evidenceMinGames: 8,
    heroLearnGames: 12,
    tiltPenCap: 10,
    tiltPenCapManual: 16,
    dampFactor: 0.5,
    wrPenaltyCap: 15,
    restRecoveryCap: 25,
    rustFloor: 40,
    rustDecayPerDay: 12,
    rustDays: 7,
    lowFrequencyDaysPerWeek: 3,
    freqPenCap: 5,
    rankStagnationWindowDays: 14,
    rankEvidenceMinDays: 7,
    rankEvidenceMinDeltas: 5,
    rankClimbMinPoints: 1,
  };
  for (const [k, v] of Object.entries(expected) as Array<[keyof typeof dc, number]>) {
    it(`${k} === ${v}`, () => expect(dc[k]).toBe(v));
  }
});

describe('deep-tier constants — still derived from READINESS_TUNING (AC4b)', () => {
  it('every constant tracks the tuning table (a retune moves both, then breaks the literal pins above)', () => {
    expect(dc.anchor).toBe(T.baseScore);
    expect(dc.loadCapDown).toBe(-T.loadDeltaMin);
    expect(dc.loadCapUp).toBe(T.loadDeltaMax);
    expect(dc.perfCapDown).toBe(-T.perfDeltaMin);
    expect(dc.perfCapUp).toBe(T.perfDeltaMax);
    expect(dc.subjCapDown).toBe(-T.subjDeltaMin);
    expect(dc.subjCapDownManual).toBe(-T.subjDeltaMinManual);
    expect(dc.tiltPenCap).toBe(T.tiltPenCap);
    expect(dc.tiltPenCapManual).toBe(T.tiltPenCapManual);
    expect(dc.dampFactor).toBe(T.dampFactor);
    expect(dc.wrPenaltyCap).toBe(T.wrPenaltyCap);
    expect(dc.cusumThreshold).toBe(T.cusumThreshold);
    expect(dc.restRecoveryCap).toBe(T.restRecoveryCap);
    expect(dc.rustFloor).toBe(T.baseScore - T.rustPenaltyCap);
    expect(dc.rankStagnationWindowDays).toBe(T.rankStagnationWindowDays);
  });
});

describe('deep-tier copy — prose contains the interpolated constants (AC4c)', () => {
  const cases: Array<[string, () => string, Array<keyof typeof dc>]> = [
    ['anchorAndCaps', deepCopy.anchorAndCaps, ['anchor', 'loadCapDown', 'loadCapUp', 'perfCapDown', 'perfCapUp', 'subjCapDown', 'subjCapUp', 'subjCapDownManual']],
    ['loadRatio', deepCopy.loadRatio, ['ratioFreshMax', 'ratioElevated', 'ratioHigh']],
    ['declineDetection', deepCopy.declineDetection, ['cusumSlack', 'cusumThreshold', 'evidenceMinGames', 'heroLearnGames']],
    ['tiltCaps', deepCopy.tiltCaps, ['tiltPenCap', 'tiltPenCapManual']],
    ['dampenerAndOutcomeCap', deepCopy.dampenerAndOutcomeCap, ['dampFactor', 'wrPenaltyCap']],
    ['restAndRust', deepCopy.restAndRust, ['restRecoveryCap', 'rustDecayPerDay', 'rustDays', 'rustFloor']],
    ['rankNudge', deepCopy.rankNudge, ['rankStagnationWindowDays', 'rankEvidenceMinDays', 'rankEvidenceMinDeltas', 'rankClimbMinPoints', 'lowFrequencyDaysPerWeek', 'freqPenCap']],
  ];
  for (const [name, fn, keys] of cases) {
    it(`${name} interpolates ${keys.join(', ')}`, () => {
      const text = fn();
      for (const k of keys) expect(text).toContain(String(dc[k]));
    });
  }
});
