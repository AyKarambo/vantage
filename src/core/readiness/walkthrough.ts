/**
 * Personalized score walkthrough — turns a live `ReadinessSummary` into the
 * facts the "Your readiness right now" article narrates: which of the three
 * families are pulling, and a step-through that rebuilds the score from the
 * neutral 75 anchor using each family's ACTUAL delta.
 *
 * Pure, uses ONLY existing contract fields (no engine change). Returns `null` on
 * data-suppressed states (null/hidden score, insufficient data, low confidence)
 * — the same gate the matcher uses — so the article never fabricates a
 * walkthrough. "Feature disabled" is caller-gated in the renderer, NOT here: a
 * `ReadinessSummary` cannot express it (the engine always computes a summary).
 */

import { READINESS_TUNING as T } from './constants';
import type { ReadinessBand, ReadinessConfidence, ReadinessRegime, ReadinessSummary } from './types';

export type PullFamily = 'load' | 'performance' | 'subjective';
export type PullDirection = 'up' | 'down' | 'flat';

export interface FamilyPull {
  family: PullFamily;
  /** The family's signed contribution (as displayed — one decimal). */
  delta: number;
  direction: PullDirection;
}

export interface WalkthroughDerivation {
  narrative: {
    regime: ReadinessRegime;
    band: ReadinessBand;
    confidence: ReadinessConfidence;
    pulls: FamilyPull[];
  };
  reconstruction: {
    anchor: number;
    deltas: { load: number; performance: number; subjective: number };
    /** clamp(round(anchor + Σdeltas), 0, 100) from the displayed (rounded) deltas. */
    reconstructed: number;
    /** The authoritative score the view shows. */
    shown: number;
    /** shown − reconstructed ∈ {−1, 0, 1} (the displayed deltas are pre-rounded). */
    roundingResidual: number;
    /** Whether the pieces' bare total was capped to the 0–100 range — so the UI can
     *  explain why the displayed deltas don't sum to the shown score at a boundary. */
    clamped: 'low' | 'high' | null;
  };
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

function directionOf(delta: number): PullDirection {
  if (delta >= 1) return 'up';
  if (delta <= -1) return 'down';
  return 'flat';
}

/**
 * Build the walkthrough facts, or `null` when personalization can't be produced
 * honestly (null/hidden score, insufficient data, low confidence).
 */
export function deriveWalkthrough(summary: ReadinessSummary): WalkthroughDerivation | null {
  if (summary.score === null || summary.band === 'insufficient-data' || summary.confidence === 'low') {
    return null;
  }

  const load = summary.subscores.load.delta;
  const performance = summary.subscores.performance.delta;
  const subjective = summary.subscores.subjective.delta;
  const bare = Math.round(T.baseScore + load + performance + subjective);
  const reconstructed = clamp(bare, 0, 100);

  return {
    narrative: {
      regime: summary.regime,
      band: summary.band,
      confidence: summary.confidence,
      pulls: [
        { family: 'load', delta: load, direction: directionOf(load) },
        { family: 'performance', delta: performance, direction: directionOf(performance) },
        { family: 'subjective', delta: subjective, direction: directionOf(subjective) },
      ],
    },
    reconstruction: {
      anchor: T.baseScore,
      deltas: { load, performance, subjective },
      reconstructed,
      shown: summary.score,
      roundingResidual: summary.score - reconstructed,
      clamped: bare < 0 ? 'low' : bare > 100 ? 'high' : null,
    },
  };
}
