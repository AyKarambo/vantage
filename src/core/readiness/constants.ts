/**
 * Central tuning for the readiness / training-load model. Every threshold lives
 * here (single source of truth — no magic numbers scattered across the module),
 * each with a one-line rationale. All values are deliberately CONSERVATIVE: the
 * research shows match outcomes are a low-sensitivity fatigue signal, streak
 * effects are tiny, and acute:chronic ratio thresholds are contested — so the
 * model biases hard against false "rest now" alarms. These are heuristics, not
 * validated predictors for Overwatch.
 */

import type { ReadinessSettings } from './types';

export const READINESS_TUNING = {
  /** Local day starts at 04:00 — a late-night session counts as one day, not two. */
  resetHour: 4,

  /** A gap larger than this between match-end timestamps starts a new session. */
  sessionGapMinutes: 90,
  /** Fallback minutes for a game with no recorded duration (END-only timestamps undercount session length). */
  defaultGameMinutes: 12,
  /** A single session at/above this length (≈2.5h) is a fatigue signal (matches the cognitive-fatigue session length in the research). */
  sessionLongMinutes: 150,

  /** Acute window (recent load) in days. */
  acuteDays: 3,
  /** Chronic baseline window in days. */
  chronicDays: 21,
  /** Mental acute window in days. */
  acuteMentalDays: 7,

  /** Need at least this span AND this many games before any verdict is offered. */
  minSpanDays: 14,
  minGames: 15,
  /** No game in this many days → treat as rested-but-unknown, not a confident verdict. */
  staleDays: 14,
  /** The acute:chronic ratio is only trusted when the chronic window has at least this many active days. */
  minChronicActiveDays: 7,

  /** Acute:chronic ratio at/above this is "elevated" (amber contributor). */
  ratioElevated: 1.3,
  /** Acute:chronic ratio at/above this is "high" (one arm of the red gate). */
  ratioHigh: 1.5,
  /** At/below this ratio (with low volume) the player reads as fresh. */
  ratioFreshMax: 1.15,

  /** Absolute games/day at/above this is "elevated" (amber contributor). */
  absElevatedPerDay: 6,
  /** Absolute games/day at/above this is "high" (the arm that lets a flat, high-volume grinder reach red without acceleration). */
  absHighPerDay: 9,
  /** At/below this games/day (with low ratio) the player reads as fresh. */
  freshPerDay: 4,

  /** Consecutive active days at/above this is the day-count arm of the red gate. */
  sustainedDays: 5,
  /** Consecutive active days at/above this is worth surfacing as a "watch" signal. */
  loadedDays: 4,

  /** Fraction of acute games that must carry a logged mental flag before the fatigue signal is trusted. */
  mentalMinCoverage: 0.4,
  /** Coverage at/above this counts toward high confidence. */
  mentalHighCoverage: 0.6,
  /** Acute tilt rate at/above this is elevated (absolute). */
  tiltElevatedAbs: 0.4,
  /** Acute tilt rate this much above baseline is elevated (relative). */
  tiltElevatedDelta: 0.15,

  /** Rest days needed to fully clear a heavy state (→ fresh). Below it → recovering. */
  restFullRecoverDays: 2,
  /** Active days (within the chronic window) needed for high confidence. */
  confidenceActiveDays: 12,

  /**
   * Undertraining (the inverse risk): rest is recovery up to a point, then it is
   * detraining. A week without a single game reads as "rusty" — mechanics and
   * game-sense sharpness decay measurably on that timescale. Conservative on
   * purpose, like everything here: a long weekend off must NOT get flagged.
   */
  rustDays: 7,
  /** At/above this many rest days the rust signal escalates from watch → high. */
  rustSevereDays: 10,
  /** Score decay per rest day past the supercompensation peak (rest day 3). */
  rustDecayPerDay: 12,
  /** Cap on the rust score penalty (keeps a long layoff amber, never red — you're rested, just dull). */
  rustPenaltyCap: 45,
  /** Fewer active days/week than this (chronic window) → consistency nudge signal. */
  lowFrequencyDaysPerWeek: 3,
  /** Below this many active days/week the nudge escalates from ok → watch. */
  lowFrequencyWatchPerWeek: 2,

  /** Score penalty caps (score is illustrative; the band is rule-gated). */
  loadPenaltyCap: 45,
  mentalPenaltyCap: 40,
  outcomePenaltyCap: 8,
  restRecoveryCap: 25,

  /** Days of readiness history plotted on the trend chart. */
  trendDays: 21,
} as const;

/** Feature settings (persisted to config.local.json, mirrors BreakReminderSettings). */
export const DEFAULT_READINESS: ReadinessSettings = {
  enabled: true,
  /** The launch tray toast on a red verdict is opt-in. */
  launchToast: false,
};

/** Coerce partial/garbage input into a valid ReadinessSettings (defensive, like normalizeBreakReminder). */
export function normalizeReadiness(s: Partial<ReadinessSettings> | undefined): ReadinessSettings {
  return {
    enabled: typeof s?.enabled === 'boolean' ? s.enabled : DEFAULT_READINESS.enabled,
    launchToast: typeof s?.launchToast === 'boolean' ? s.launchToast : DEFAULT_READINESS.launchToast,
  };
}
