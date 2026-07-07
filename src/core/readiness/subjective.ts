/**
 * Subjective subscore: self-reported tilt + the 0–100 performance slider, both
 * against the player's OWN norms, hard-capped and disagreement-gated per the
 * research — subjective input adds information when it disagrees with the
 * objective read, and is mostly double-counting when it agrees.
 */

import type { GameRecord } from '../analytics';
import { READINESS_TUNING as T } from './constants';
import { dayOrdinal } from './day';
import type { MentalState } from './signals';
import { clamp } from './stats';

export interface SubjState {
  /** Whether any subjective component had usable data. */
  available: boolean;
  /** Continuous, coverage-gated tilt penalty (NOT gated on the elevated bar — that bar only voids the dampener). */
  tiltPen: number;
  /** Slider points below the player's own average (null when under-sampled on either side). */
  sliderDiff: number | null;
  sliderPen: number;
  sliderBon: number;
  /** Pre-gating clamped raw value. */
  raw: number;
  /** Final subjDelta ∈ [subjDeltaMin, subjDeltaMax]. */
  delta: number;
}

export const EMPTY_SUBJ: SubjState = {
  available: false, tiltPen: 0, sliderDiff: null, sliderPen: 0, sliderBon: 0, raw: 0, delta: 0,
};

/** Evaluate the subjective subscore as-of `refOrdinal`. */
export function subjState(
  games: GameRecord[],
  refOrdinal: number,
  mental: MentalState,
  objectiveAdverse: boolean,
): SubjState {
  const acuteStart = refOrdinal - T.acuteMentalDays + 1;

  // Tilt: continuous with the rate, gated only on coverage (a stray flag
  // contributes its small share instead of being cliffed to zero).
  const tiltUsable = mental.coverage >= T.mentalMinCoverage && mental.tiltKnown;
  const tiltPen = tiltUsable
    ? Math.min(
        T.tiltPenCap,
        mental.acuteTilt * T.tiltPenSlope + Math.max(0, mental.acuteTilt - mental.baseTilt) * T.tiltPenSlope,
      )
    : 0;

  // Slider vs the player's own average (chronic pessimists/optimists stay neutral).
  const rated = games.filter((g) => typeof g.performance === 'number');
  const before = rated.filter((g) => dayOrdinal(g.timestamp) < acuteStart);
  const acute = rated.filter((g) => {
    const ord = dayOrdinal(g.timestamp);
    return ord >= acuteStart && ord <= refOrdinal;
  });
  const mean = (list: GameRecord[]): number => list.reduce((a, g) => a + (g.performance ?? 0), 0) / list.length;

  let sliderDiff: number | null = null;
  let sliderPen = 0;
  let sliderBon = 0;
  if (before.length >= T.sliderMinBase && acute.length >= T.sliderMinAcute) {
    sliderDiff = mean(before) - mean(acute); // positive = rating below own average
    if (sliderDiff >= T.sliderDipMin) sliderPen = Math.min(T.sliderPenCap, (sliderDiff - 5) * 0.4);
    else if (sliderDiff <= -T.sliderDipMin) sliderBon = Math.min(T.sliderBonCap, (-sliderDiff - 5) * 0.4);
  }

  const raw = clamp(-(tiltPen + sliderPen) + sliderBon, T.subjDeltaMin, T.subjDeltaMax);

  // Disagreement gating (research): full weight only when subjective DISAGREES
  // with the objective read; mostly-redundant when it agrees.
  const delta =
    raw < 0 && objectiveAdverse
      ? T.subjAgreeFactor * raw
      : raw > 0 && objectiveAdverse
        ? Math.min(T.subjCounterCap, 0.5 * raw)
        : raw;

  return {
    available: tiltUsable || sliderDiff !== null,
    tiltPen,
    sliderDiff,
    sliderPen,
    sliderBon,
    raw,
    delta,
  };
}
