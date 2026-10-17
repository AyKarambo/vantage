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
    formLambda: 0.1,
    formDeadband: 0.3,
    evidenceMinGames: 8,
    heroLearnGames: 12,
    dominantHeroSharePct: 60,
    altRankCloseGapDivisions: 2.5,
    altRankSmurfGapDivisions: 7.5,
    altRankFloorWeight: 0.15,
    mainRankWindowDays: 90,
    altAccountWeight: 0.35,
    tiltPenCap: 10,
    tiltPenCapManual: 16,
    dampFactor: 0.5,
    wrDipMinPoints: 10,
    wrSignificanceZ: 2,
    wrPenaltyCap: 15,
    wrPenaltyCapManual: 30,
    restRecoveryCap: 25,
    restCarryPct: 50,
    restCarryMinGames: 3,
    restCarryMaxGames: 10,
    rustFloor: 40,
    rustDecayPerDay: 12,
    rustDays: 7,
    longSessionFloorHours: 2.5,
    longSessionPercentile: 90,
    longSessionWindowDays: 30,
    longSessionMinSessions: 10,
    longSessionRampMultiple: 1.5,
    longSessionPen: 8,
    confidenceActiveDays: 12,
    confidenceWindowDays: 21,
    statCoverageHighPct: 50,
    wrMinDecidedAcute: 20,
    wrMinDecidedBase: 30,
    accountMixBarPct: 70,
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
    expect(dc.wrPenaltyCapManual).toBe(T.wrPenaltyCap + T.wrManualCapBoost);
    expect(dc.wrDipMinPoints).toBe(T.wrDipMin * 100);
    expect(dc.wrSignificanceZ).toBe(T.wrSignificanceZ);
    expect(dc.formLambda).toBe(T.formLambda);
    expect(dc.formDeadband).toBe(T.formDeadband);
    expect(dc.heroLearnGames).toBe(T.heroLearnGames);
    expect(dc.dominantHeroSharePct).toBe(T.dominantHeroShare * 100);
    expect(dc.altRankCloseGapDivisions).toBe(T.altRankCloseGap / 100);
    expect(dc.altRankSmurfGapDivisions).toBe(T.altRankSmurfGap / 100);
    expect(dc.altRankFloorWeight).toBe(T.altRankFloorWeight);
    expect(dc.mainRankWindowDays).toBe(T.mainRankWindowDays);
    expect(dc.altAccountWeight).toBe(T.altAccountWeight);
    expect(dc.restRecoveryCap).toBe(T.restRecoveryCap);
    expect(dc.restCarryPct).toBe(T.restCarryShare * 100);
    expect(dc.restCarryMinGames).toBe(T.restCarryMinGames);
    expect(dc.restCarryMaxGames).toBe(T.restCarryMaxGames);
    expect(dc.longSessionFloorHours).toBe(T.sessionLongMinutes / 60);
    expect(dc.longSessionPercentile).toBe(T.longSessionPercentile * 100);
    expect(dc.longSessionWindowDays).toBe(T.longSessionWindowDays);
    expect(dc.longSessionMinSessions).toBe(T.longSessionMinSessions);
    expect(dc.longSessionRampMultiple).toBe(1 + T.longSessionRampShare);
    expect(dc.longSessionPen).toBe(T.longSessionPen);
    expect(dc.confidenceActiveDays).toBe(T.confidenceActiveDays);
    expect(dc.confidenceWindowDays).toBe(T.chronicDays);
    expect(dc.statCoverageHighPct).toBe(T.statCoverageHigh * 100);
    expect(dc.wrMinDecidedAcute).toBe(T.wrMinDecidedAcute);
    expect(dc.wrMinDecidedBase).toBe(T.wrMinDecidedBase);
    expect(dc.accountMixBarPct).toBe(T.accountMixBar * 100);
    expect(dc.rustFloor).toBe(T.baseScore - T.rustPenaltyCap);
    expect(dc.rankStagnationWindowDays).toBe(T.rankStagnationWindowDays);
  });
});

describe('deep-tier copy — prose contains the interpolated constants (AC4c)', () => {
  const cases: Array<[string, () => string, Array<keyof typeof dc>]> = [
    ['anchorAndCaps', deepCopy.anchorAndCaps, ['anchor', 'loadCapDown', 'loadCapUp', 'perfCapDown', 'perfCapUp', 'subjCapDown', 'subjCapUp', 'subjCapDownManual']],
    ['loadRatio', deepCopy.loadRatio, ['ratioFreshMax', 'ratioElevated', 'ratioHigh']],
    ['declineDetection', deepCopy.declineDetection, ['formLambda', 'formDeadband', 'evidenceMinGames', 'heroLearnGames', 'dominantHeroSharePct']],
    ['accountWeighting', deepCopy.accountWeighting, ['altRankCloseGapDivisions', 'altRankSmurfGapDivisions', 'altRankFloorWeight', 'mainRankWindowDays', 'altAccountWeight']],
    ['tiltCaps', deepCopy.tiltCaps, ['tiltPenCap', 'tiltPenCapManual']],
    ['dampenerAndOutcomeCap', deepCopy.dampenerAndOutcomeCap, ['dampFactor', 'wrPenaltyCap', 'wrPenaltyCapManual', 'wrDipMinPoints', 'wrSignificanceZ']],
    ['restAndRust', deepCopy.restAndRust, ['restRecoveryCap', 'rustDecayPerDay', 'rustDays', 'rustFloor', 'restCarryPct', 'restCarryMinGames', 'restCarryMaxGames']],
    ['longSessions', deepCopy.longSessions, ['longSessionFloorHours', 'longSessionPercentile', 'longSessionWindowDays', 'longSessionMinSessions', 'longSessionRampMultiple', 'longSessionPen']],
    ['confidenceGates', deepCopy.confidenceGates, ['confidenceActiveDays', 'confidenceWindowDays', 'statCoverageHighPct', 'wrMinDecidedAcute', 'wrMinDecidedBase', 'accountMixBarPct']],
    ['rankNudge', deepCopy.rankNudge, ['rankStagnationWindowDays', 'rankEvidenceMinDays', 'rankEvidenceMinDeltas', 'rankClimbMinPoints', 'lowFrequencyDaysPerWeek', 'freqPenCap']],
  ];
  for (const [name, fn, keys] of cases) {
    it(`${name} interpolates ${keys.join(', ')}`, () => {
      const text = fn();
      for (const k of keys) expect(text).toContain(String(dc[k]));
    });
  }

  it('the account-weighting copy is honest about rank-proximity, not a flat multiplier, and the learning window pools accounts', () => {
    const copy = deepCopy.accountWeighting();
    expect(copy).toContain('played most'); // names how the main account is picked
    expect(copy).toContain('not smurfing'); // a rank-close alt is explicitly exempted
    expect(copy).toContain('×0.15'); // the genuine floor for a large gap
    expect(copy).toContain('×0.35'); // the no-rank-data fallback, distinct from the floor
    expect(deepCopy.declineDetection()).toContain('ALL your accounts');
  });

  it('the readiness-accuracy copy (#307) says what changed, not just the numbers', () => {
    // A hero-swap game counts for the hero mostly played; games without per-hero minutes stay out.
    expect(deepCopy.declineDetection()).toContain('swapped heroes');
    expect(deepCopy.declineDetection()).toContain("don't record time per hero");
    // Winrate: significance AND corroboration, with the outcome cap kept as the ceiling.
    const guardrails = deepCopy.dampenerAndOutcomeCap();
    expect(guardrails).toContain('standard errors');
    expect(guardrails).toContain('a note, not a penalty');
    expect(guardrails).toContain('manual logs');
    // The rest bonus is used up over the first games, not dropped by the first one.
    expect(deepCopy.restAndRust()).toContain('used up over your first games');
    // Long sessions are relative to the player's own habit, with a floor and a ramp.
    const sessions = deepCopy.longSessions();
    expect(sessions).toContain('your own sessions');
    expect(sessions).toContain('no cliff');
    // Confidence: four gates, and total history size does not count.
    const gates = deepCopy.confidenceGates();
    expect(gates).toContain('all four');
    expect(gates).toContain('main account');
    expect(gates).toContain("history you have in total doesn't count");
  });
});
