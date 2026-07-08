/**
 * Central tuning for the readiness / training-load model. Every threshold lives
 * here (single source of truth — no magic numbers scattered across the module),
 * each with a one-line rationale. All values are deliberately CONSERVATIVE: the
 * research shows match outcomes are a low-sensitivity fatigue signal, streak
 * effects are tiny, and acute:chronic ratio thresholds are contested — so the
 * model biases hard against false "rest now" alarms. These are heuristics, not
 * validated predictors for Overwatch.
 *
 * The composite model (see `score.ts`): `score = baseScore + loadDelta +
 * perfDelta + subjDelta`, each delta bounded so the bounds ARE the family
 * weights (load ~40%, objective performance ~45%, subjective ≤15%).
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
  /** Mental/performance acute window in days. */
  acuteMentalDays: 7,

  /** Need at least this span AND this many games before any verdict is offered. */
  minSpanDays: 14,
  minGames: 15,
  /** No game in this many days → treat as rested-but-unknown, not a confident verdict. */
  staleDays: 14,
  /** Overload arms (ratio AND absolute volume) are only trusted when the chronic window has at least this many active days. */
  minChronicActiveDays: 7,

  /** Acute:chronic ratio at/above this is "elevated" (amber contributor). */
  ratioElevated: 1.3,
  /** Acute:chronic ratio at/above this is "high" (one arm of the red-corroboration gate). */
  ratioHigh: 1.5,
  /** At/below this ratio (with low volume) the player reads as fresh. */
  ratioFreshMax: 1.15,

  /** Absolute games/day at/above this is "elevated" — the floor of the own-norm volume bar. */
  absElevatedPerDay: 6,
  /** Absolute games/day at/above this is "high" (the arm that lets a flat, high-volume grinder corroborate red). */
  absHighPerDay: 9,
  /** At/below this games/day (with low ratio) the player reads as fresh. */
  freshPerDay: 4,

  /** Consecutive active days at/above this is the day-count arm of the red-corroboration gate. */
  sustainedDays: 5,
  /** Consecutive active days at/above this is worth surfacing as a "watch" signal. */
  loadedDays: 4,

  /** Fraction of acute games that must carry a logged mental flag before tilt signals are trusted. */
  mentalMinCoverage: 0.4,
  /** Coverage at/above this counts toward high confidence (secondary factor now). */
  mentalHighCoverage: 0.6,
  /** Acute tilt rate at/above this is elevated (absolute) — the dampener void bar. */
  tiltElevatedAbs: 0.4,
  /** Acute tilt rate this much above baseline is elevated (relative) — the dampener void bar. */
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
  /** At/above this many rest days the dominant driver reads as rust (restEffect has turned negative). */
  rustSignalDays: 6,
  /** Score decay per rest day past the supercompensation peak (rest day 3). */
  rustDecayPerDay: 12,
  /** Floor of the rust decay (keeps a long layoff "dull", never "wrecked" — score floor = baseScore − this). */
  rustPenaltyCap: 35,
  /** Fewer active days/week than this (chronic window) → consistency nudge signal + small penalty. */
  lowFrequencyDaysPerWeek: 3,
  /** Below this many active days/week the nudge escalates from ok → watch. */
  lowFrequencyWatchPerWeek: 2,
  /** Cap on the low-frequency penalty (a thin weekly rhythm is a nudge, not an alarm). */
  freqPenCap: 5,

  // --- rank-gated undertraining nudge (owner revision 2026-07-08: never encourage volume on zero evidence) ---

  /** Days over which net rank movement decides climbing vs stagnant ("a couple weeks"). */
  rankStagnationWindowDays: 14,
  /** A key's measurable sub-window (anchor-clipped) must span at least this many days to count as evidence. */
  rankEvidenceMinDays: 7,
  /** ...and contain at least this many srDelta-carrying competitive games — the engine moves by srDelta, so a window without logged deltas is UNLOGGED, not stagnant. */
  rankEvidenceMinDeltas: 5,
  /** Net rank-scalar gain (100 pts = one division) at/above this counts as climbing — any real net-positive movement silences the nudge (generous bar, err toward silence). */
  rankClimbMinPoints: 1,

  // --- composite anchors (score = baseScore + loadDelta + perfDelta + subjDelta) ---

  /** Neutral anchor: a healthy, in-rhythm player with no signals sits here-ish (plus rest bonus). */
  baseScore: 75,
  /** Score at/below this (plus load corroboration, played today) → in-the-hole. */
  redCut: 40,
  /** Score at/below this (played today) → loaded (amber). */
  amberCut: 60,
  /** Overload penalty at/above this makes "overload" the dominant driver. */
  driverBar: 8,

  // --- load-balance subscore (loadDelta ∈ [−40, +25]) ---

  /** Cap on the summed overload penalty (ratio + volume + streak + long-session). */
  overloadPenCap: 40,
  /** Cap on the ratio arm of the overload penalty. */
  ratioPenCap: 22,
  /** Cap on the own-norm-relative volume arm. */
  volPenCap: 22,
  /** Cap on the consecutive-days arm (only fires during a genuine surge). */
  streakPenCap: 12,
  /** Flat penalty for a recent ≥2.5h session. */
  longSessionPen: 8,
  /** Volume only penalizes above max(absElevatedPerDay, habitFactor × own chronic norm) — habit is not risk. */
  habitFactor: 1.25,
  /** Cap on the rest-recovery bonus (supercompensation peak at rest day 3). */
  restRecoveryCap: 25,
  /** Hard bounds on the whole load delta (critique: unclamped stacking reached −42). */
  loadDeltaMin: -40,
  loadDeltaMax: 25,

  // --- absolute training-load arm (manual-regime only; scaled by (1−b)·absTrust, joins the overloadPen sum) ---
  // Exposure is the only fatigue evidence when outcomes are unmeasurable; contributes EXACTLY zero at b=1
  // ("habit is not risk" holds where consequences are observable). Volume-gated + tenure-gated against false alarms.

  /** First N consecutive active days are free — a full week of daily play never accrues manual penalty. */
  absStreakFreeDays: 6,
  /** Points per rest-less day past the free week (b=0) — slow, sustained-evidence accrual. */
  absStreakSlope: 1,
  /** Cap on the streak arm (saturates ~18 straight days). The streak arm is VOLUME-GATED on acutePerDay ≥ absElevatedPerDay. */
  absStreakPenCap: 12,
  /** Points per game/day above absElevatedPerDay (b=0) — a third of the own-norm slope (norm-free volume is weaker evidence). */
  absVolSlope: 1,
  /** Cap on the absolute-volume arm — volume alone stays a sub-amber nudge; days-without-rest carries the arm. */
  absVolPenCap: 10,
  /** Active-days/week below this read as rest-punctuated and free; ramp starts above it (continuous, no cliff). */
  restScarcityFreePerWeek: 5.5,
  /** Points per active-day/week above the free bar — steep because the risk band (5.5→7.0) is narrow. */
  restScarcitySlope: 4,
  /** Cap on the rest-scarcity arm — corroborates the streak arm, never alarms alone. */
  restScarcityPenCap: 5,
  /** Cap on the whole absolute arm before (1−b)·absTrust·trust·fade — max abs-only load (24+8 long-session) leaves score 43 > redCut. */
  absArmCap: 24,
  /** Active-day ramp for absTrust: 0 at minChronicActiveDays (7), full at 7+this — norm-free claims need a populated window. */
  absTrustRampDays: 7,
  /** History-span ramp for absTrust: full weight only ~this many days past minSpanDays — a daily newcomer isn't flagged in week 3. */
  absTenureRampDays: 21,

  // --- objective-performance subscore (perfDelta ∈ [−45, +8]) ---

  /** Games below this duration are excluded from per-10 rates (a 4-minute stomp explodes the denominator). */
  minPer10Minutes: 6,
  /** A hero with fewer lifetime games (per account) is "still learning" — excluded from decline detection. */
  heroLearnGames: 12,
  /** Minimum baseline games before a stat bucket is trusted at all. */
  statMinGames: 15,
  /** Trust ramps linearly from statMinGames to statMinGames + this (no on/off cliff). */
  statTrustRamp: 5,
  /** Trailing baseline window per bucket (uncoupled — excludes the acute window). */
  baseWindowGames: 40,
  /** SD floor as a fraction of the baseline mean (ultra-consistent stats must not z-blow-up). */
  sdFloorFrac: 0.15,
  /** Per-game metric z-scores are winsorized to ±this (one absurd game cannot dominate). */
  zWinsor: 2.5,
  /** Fixed metric weights, renormalized over the metrics active for a game. */
  metricWeights: { damage: 0.3, deaths: 0.3, eliminations: 0.25, healing: 0.15 },
  /** A metric with a baseline mean below its floor is skipped (e.g. healing on a DPS baseline). */
  metricSkipMin: { damage: 50, healing: 50, eliminations: 0.5, deaths: 0.5 },
  /** Passivity guard: deaths' FAVORABLE credit ramps to zero as output falls from baseline (z 0) to −this — "playing scared" (damage+elims down, deaths down) must read as the output decline it is, not cancel out. Deaths above baseline stays fully adverse in every context. */
  passivityRampZ: 0.5,
  /** The guard engages gradually over the DEATHS dimension too (0 → full as deaths-favorable z grows 0 → this): deaths exactly at baseline must keep full weight, or one-hundredth fewer deaths could flip a whole verdict (strictly better play must never score worse). */
  passivityDeathsRampZ: 0.25,
  /** One-sided CUSUM slack: only game-scores worse than baseline by more than this accumulate. */
  cusumSlack: 0.25,
  /** CUSUM decision threshold (in cumulative z units). One winsorized game ≤ 2.25 < this by construction. */
  cusumThreshold: 2.5,
  /** Minimum qualifying acute games before the decline index may fire (independent AND-gate). */
  evidenceMinGames: 8,
  /** Penalty when the decline index fires, at the threshold... */
  statPenaltyBase: 10,
  /** ...plus this per cumulative z unit above the threshold... */
  statPenaltySlope: 4,
  /** ...capped here. */
  statPenaltyCap: 30,
  /** Minimum decided games in the acute window before an account's winrate dip is trusted. */
  wrMinDecidedAcute: 20,
  /** Minimum decided games in the (uncoupled) baseline window before the account's baseline winrate is trusted. */
  wrMinDecidedBase: 30,
  /** Winrate dips below this (in winrate fraction) are ordinary variance — no penalty. */
  wrDipMin: 0.1,
  /** Penalty slope above the dip floor (dip 0.10 → 5, dip 0.20 → 15). */
  wrPenaltySlope: 100,
  /** Cap on the winrate penalty — the named "outcome cap": losses alone can never move the score more than this. */
  wrPenaltyCap: 15,
  /** Manual-regime extra winrate cap phased in by (1−b): 15 at b=1 (corroboration, bit-identical) → 30 at b=0 (promoted primary). Slope & wrDipMin stay regime-invariant so objectiveAdverse never flips with b. */
  wrManualCapBoost: 15,
  /** Mean acute game-z above this (with a quiet CUSUM) earns a small "playing above your usual" bonus. */
  perfBonusMinZ: 0.5,
  /** Cap on that bonus. */
  perfBonusCap: 8,
  /** Role-fallback comparisons need at least this acute-vs-baseline hero-mix overlap (a mix shift is not a decline). */
  mixOverlapMin: 0.5,
  /** Hard bounds on the whole performance delta. */
  perfDeltaMin: -45,
  perfDeltaMax: 8,
  /** A session on the reference day with ≥ sessionLongMinutes AND this many games corroborates red (marathon arm). */
  marathonMinGames: 10,

  // --- subjective subscore (subjDelta ∈ [−15, +8], disagreement-gated) ---

  /** Cap on the continuous tilt penalty (coverage-gated, no elevated-bar cliff). */
  tiltPenCap: 10,
  /** Manual endpoint of tiltPenCap (lerped by b) — exactly the slope-8 theoretical max, so a bound not a new sensitivity; slopes stay regime-invariant. */
  tiltPenCapManual: 16,
  /** Tilt-rate slopes: acuteTilt × this + max(0, acuteTilt − baseTilt) × this. */
  tiltPenSlope: 8,
  /** Minimum prior rated games before the player's own slider average is a usable baseline. */
  sliderMinBase: 10,
  /** Minimum rated games in the acute window before the slider read is trusted. */
  sliderMinAcute: 3,
  /** Slider points below the personal average before the penalty engages. */
  sliderDipMin: 10,
  /** Cap on the slider penalty. */
  sliderPenCap: 8,
  /** Manual endpoint of sliderPenCap (lerped by b) — same widening as the family cap; slider slope, engage threshold, and sample gates unchanged. */
  sliderPenCapManual: 12,
  /** Cap on the slider bonus (rating well above one's own average). */
  sliderBonCap: 8,
  /** Hard bounds on the whole subjective delta (the spec's ≤15% hard cap). */
  subjDeltaMin: -15,
  subjDeltaMax: 8,
  /** Manual endpoint of subjDeltaMin (lerped by b): −15 at b=1 → −25 at b=0; component caps (16+12) over-provision it so it isn't dead code. Positive side (subjDeltaMax) unchanged. */
  subjDeltaMinManual: -25,
  /** When subjective agrees with an already-detected objective decline it is mostly double-counting — scale by this. */
  subjAgreeFactor: 0.3,
  /** Cap on the "feel great while objectively declining" counter-signal. */
  subjCounterCap: 4,

  // --- confidence ---

  /** Share of acute games with usable per-10 stats needed (with the other gates) for high confidence. */
  statCoverageHigh: 0.5,
  /** Below this stat coverage (with no mental/slider data either) confidence is low. */
  statCoverageLow: 0.2,
  /** The largest single account must carry at least this share of the acute window for high confidence. */
  accountMixBar: 0.7,

  // --- regime dial (continuous stats↔manual blend b ∈ [0,1]) ---

  /** Blend-denominator floor: caps the per-game blend step at 1/this and is the MAX safe floor — statCoverageHigh(0.5)×wrMinDecidedAcute(20)=10 guarantees b=1 at today's high-confidence bars (any higher breaks b=1 bit-identity). */
  blendMinCounted: 10,
  /** Acute comparable-per-10 coverage at/above which b saturates to 1 (mirrors statCoverageHigh as an independent knob); headroom above it absorbs manual-logging bursts and ~3.5 outage days at b=1. */
  blendCoverageTarget: 0.5,
  /** b at/below this labels 'manual' AND caps confidence at medium (one constant feeds both, so badge and cap never disagree). ≈ statCoverageLow/blendCoverageTarget. */
  regimeManualMax: 0.4,
  /** b at/above this labels 'stats'; below 1.0 so one stray non-qualifying game (max step 0.1) can't flap the badge. */
  regimeStatsMin: 0.8,

  // --- target-focus dampener ---

  /** Minimum DISTINCT graded games in the acute window (N targets on one game = one game of evidence). */
  dampMinGraded: 5,
  /** Mean per-game grade credit (hit=1, partial=0.5) at/above this = positive evidence of hitting targets. */
  dampHitRate: 0.6,
  /** The fixed dampening factor on the objective-performance penalty. Never stacks, never zeroes the penalty. */
  dampFactor: 0.5,

  /** Days of readiness history plotted on the trend chart. */
  trendDays: 21,
} as const;

/**
 * Linear interpolation between a stats-regime value and a manual-regime value by the blend `b`.
 * `manualLerp(stats, manual, 1) === stats` exactly (IEEE754: 1·x+0·y = x), so every `b=1` call
 * site reduces to its shipped constant bit-for-bit — the regression guarantee holds by construction.
 */
export const manualLerp = (stats: number, manual: number, b: number): number => b * stats + (1 - b) * manual;

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
