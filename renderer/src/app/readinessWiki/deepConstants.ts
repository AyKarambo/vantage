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

  // Form curve (EWMA of per-game scores) — sustained slumps and good stretches alike.
  formLambda: T.formLambda, // 0.1
  formDeadband: T.formDeadband, // 0.3
  evidenceMinGames: T.evidenceMinGames, // 8
  heroLearnGames: T.heroLearnGames, // 12
  // A hero-swap game counts for the hero that holds at least this share of its played time.
  dominantHeroSharePct: T.dominantHeroShare * 100, // 60

  // Several accounts, one player: the main account (most games played recently) carries the
  // verdict; an alt game's weight depends on how close its rank was to the main's usual one.
  altRankCloseGapDivisions: T.altRankCloseGap / 100, // 2.5
  altRankSmurfGapDivisions: T.altRankSmurfGap / 100, // 7.5
  altRankFloorWeight: T.altRankFloorWeight, // 0.15
  mainRankWindowDays: T.mainRankWindowDays, // 90
  altAccountWeight: T.altAccountWeight, // 0.35 (fallback when a rank can't be read)

  // Self-report / tilt (both regime endpoints).
  tiltPenCap: T.tiltPenCap, // 10
  tiltPenCapManual: T.tiltPenCapManual, // 16

  // Deliberate-practice dampener + outcome cap + winrate significance (a dip must be big AND beyond luck).
  dampFactor: T.dampFactor, // 0.5
  wrDipMinPoints: T.wrDipMin * 100, // 10
  wrSignificanceZ: T.wrSignificanceZ, // 2
  wrPenaltyCap: T.wrPenaltyCap, // 15
  wrPenaltyCapManual: T.wrPenaltyCap + T.wrManualCapBoost, // 30 (manual endpoint)

  // Rest, supercompensation & rust. The morning's rest bonus is used up over the first games of a play day.
  restRecoveryCap: T.restRecoveryCap, // 25
  restCarryPct: T.restCarryShare * 100, // 50
  restCarryMinGames: T.restCarryMinGames, // 3
  restCarryMaxGames: T.restCarryMaxGames, // 10
  rustFloor: T.baseScore - T.rustPenaltyCap, // 40
  rustDecayPerDay: T.rustDecayPerDay, // 12
  rustDays: T.rustDays, // 7

  // Long sessions: judged against the player's own habit, never below the floor.
  longSessionFloorHours: T.sessionLongMinutes / 60, // 2.5
  longSessionPercentile: T.longSessionPercentile * 100, // 90
  longSessionWindowDays: T.longSessionWindowDays, // 30
  longSessionMinSessions: T.longSessionMinSessions, // 10
  longSessionRampMultiple: 1 + T.longSessionRampShare, // 1.5
  longSessionPen: T.longSessionPen, // 8

  // Confidence: 'high' needs all four gates, judged on the recent windows only.
  confidenceActiveDays: T.confidenceActiveDays, // 12
  confidenceWindowDays: T.chronicDays, // 21
  statCoverageHighPct: T.statCoverageHigh * 100, // 50
  wrMinDecidedAcute: T.wrMinDecidedAcute, // 20
  wrMinDecidedBase: T.wrMinDecidedBase, // 30
  accountMixBarPct: T.accountMixBar * 100, // 70

  // Rank-gated undertraining nudge.
  lowFrequencyDaysPerWeek: T.lowFrequencyDaysPerWeek, // 3
  freqPenCap: T.freqPenCap, // 5
  rankStagnationWindowDays: T.rankStagnationWindowDays, // 14
  rankEvidenceMinDays: T.rankEvidenceMinDays, // 7
  rankEvidenceMinDeltas: T.rankEvidenceMinDeltas, // 5
  rankClimbMinPoints: T.rankClimbMinPoints, // 1
} as const;

export type DeepConstants = typeof deepConstants;
