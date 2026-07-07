/**
 * The regime dial: a single continuous blend factor `b ∈ [0,1]` measuring how much of the
 * acute window the outcome-watching objective (GEP) family can actually SEE, plus the
 * display-only label derived from it.
 *
 * `b = 1` (full per-10 coverage) makes every regime-aware term collapse to its shipped value —
 * the engine is bit-identical to the pre-regime model. `b = 0` (manual-only, today's universal
 * reality) shifts weight onto the absolute-load arm, the promoted winrate ceiling, and the
 * widened subjective cap. Pure — no imports beyond constants/types.
 */

import { READINESS_TUNING as T } from './constants';
import type { ReadinessRegime } from './types';

/**
 * Blend factor from the acute window's comparable-per-10 coverage.
 *
 * `blendCoverage` is the SUM of per-game trust weights (each `trustFor(base.n)`, already ramping
 * 0→1 over baseline n 15→20), NOT a binary counted-game count: a hero whose baseline just crossed
 * the trust floor contributes a fraction, so `b` ramps smoothly in the day index instead of
 * cliff-jumping when a whole hero cohort reclassifies at once. Saturating-linear (min(1,·) attains
 * 1.0 exactly, so the b=1 bit-identity is provable); floor `blendMinCounted` caps the per-game step.
 */
export function blendFor(blendCoverage: number, acuteGameCount: number): number {
  return Math.min(1, blendCoverage / Math.max(T.blendMinCounted, T.blendCoverageTarget * acuteGameCount));
}

/** Display-only regime label. Never feeds the math — only the badge and methodology copy. */
export function regimeFor(blend: number): ReadinessRegime {
  if (blend >= T.regimeStatsMin) return 'stats';
  if (blend <= T.regimeManualMax) return 'manual';
  return 'hybrid';
}
