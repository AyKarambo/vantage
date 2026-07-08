/**
 * Deep-tier constants — every number the wiki's "deep dive" quotes, DERIVED from
 * `READINESS_TUNING` so the shipped copy can never show a stale value. DOM-free
 * on purpose: the `test/readinessDocsConstants.test.ts` guard pins each to a
 * numeric literal (so an engine retune breaks the test and forces doc re-review)
 * and cross-checks it against the tuning table.
 *
 * These are the STATS-regime bounds (full live-stat coverage). Where a bound
 * widens on manual logs, both endpoints are surfaced (`*Manual`) so the copy can
 * be honest about the common manual case rather than implying a false invariant.
 */

import { READINESS_TUNING as T } from '../../../../src/core/readiness';

export const deepConstants = {
  // Composite anchor + family caps (stats regime; down/up are asymmetric).
  anchor: T.baseScore, // 75
  loadCapDown: -T.loadDeltaMin, // 40
  loadCapUp: T.loadDeltaMax, // 25
  perfCapDown: -T.perfDeltaMin, // 45
  perfCapUp: T.perfDeltaMax, // 8
  subjCapDown: -T.subjDeltaMin, // 15
  subjCapUp: T.subjDeltaMax, // 8
  subjCapDownManual: -T.subjDeltaMinManual, // 25 (manual endpoint)

  // Training-load / acute:chronic ratio.
  ratioElevated: T.ratioElevated, // 1.3
  ratioHigh: T.ratioHigh, // 1.5
  ratioFreshMax: T.ratioFreshMax, // 1.15

  // Sustained-decline (one-sided CUSUM) detection.
  cusumThreshold: T.cusumThreshold, // 2.5
  cusumSlack: T.cusumSlack, // 0.25
  evidenceMinGames: T.evidenceMinGames, // 8
  heroLearnGames: T.heroLearnGames, // 12

  // Self-report / tilt (both regime endpoints).
  tiltPenCap: T.tiltPenCap, // 10
  tiltPenCapManual: T.tiltPenCapManual, // 16

  // Deliberate-practice dampener + outcome cap.
  dampFactor: T.dampFactor, // 0.5
  wrPenaltyCap: T.wrPenaltyCap, // 15

  // Rest, supercompensation & rust.
  restRecoveryCap: T.restRecoveryCap, // 25
  rustFloor: T.baseScore - T.rustPenaltyCap, // 40
  rustDecayPerDay: T.rustDecayPerDay, // 12
  rustDays: T.rustDays, // 7

  // Rank-gated undertraining nudge.
  lowFrequencyDaysPerWeek: T.lowFrequencyDaysPerWeek, // 3
  freqPenCap: T.freqPenCap, // 5
  rankStagnationWindowDays: T.rankStagnationWindowDays, // 14
  rankEvidenceMinDays: T.rankEvidenceMinDays, // 7
  rankEvidenceMinDeltas: T.rankEvidenceMinDeltas, // 5
  rankClimbMinPoints: T.rankClimbMinPoints, // 1
} as const;

export type DeepConstants = typeof deepConstants;
