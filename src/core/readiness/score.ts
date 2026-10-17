/**
 * The composite readiness engine: three signed subscore deltas on a neutral
 * anchor, and a band DERIVED from (score, driver, hard gates) — one engine,
 * so score and verdict can no longer contradict each other.
 *
 *   score = clamp(baseScore + loadDelta + perfDelta + subjDelta, 0, 100)
 *
 * The delta bounds ARE the family weights: load ∈ [−40,+25], objective
 * performance ∈ [−45,+8], subjective ∈ [−15,+8] (hard cap).
 *
 * State is evaluated as-of the player's LAST ACTIVE day; `restDays` (the
 * distance from that day to the reference day) then modulates it. This keeps
 * the verdict from being diluted by the current partial day, so "in-the-hole"
 * is reachable during an active grind and de-escalates cleanly once real rest
 * days pass.
 */

import type { GameRecord } from '../analytics';
import { READINESS_TUNING as T } from './constants';
import { dayOrdinal } from './day';
import { detectSessions, gamesByDay } from './sessions';
import { loadState, mentalState, outcomeState, type LoadState, type MentalState, type OutcomeState } from './signals';
import { EMPTY_CONTEXT, EMPTY_PERF, perfState, type PerfState, type ReadinessContext } from './performance';
import { EMPTY_SUBJ, subjState, type SubjState } from './subjective';
import { clamp } from './stats';
import { regimeFor } from './regime';
import { rankTrendFor, type RankTrend } from './rankTrend';
import type { ReadinessBand, ReadinessDriver, ReadinessRegime } from './types';

/** The five family states, evaluated as of one day ordinal. */
export interface Frame {
  load: LoadState;
  mental: MentalState;
  outcome: OutcomeState;
  perf: PerfState;
  subj: SubjState;
}

/** A rest bonus carried into the first games of a play day (see `restCarryAt`). */
export interface RestCarry {
  /** The rest effect still in force (the morning's bonus × the share of the carry left). */
  restEffect: number;
  /** The multiplier on the pre-rest performance/self-report reads: the morning's rest fade, giving way to 1 as the carry is used up. */
  fade: number;
}

/** Overrides `loadParts`' rest handling: the rest effect to add and the fade on the overload penalty. */
export interface RestOverride {
  restEffect: number;
  fade: number;
}

export interface StateAt {
  hasData: boolean;
  lastActiveOrdinal: number;
  restDays: number;
  /**
   * The family states as of the REFERENCE day ("now"): rest days sit in every window as
   * zero-load days, so the read moves continuously from a rest-day morning into the first
   * game instead of jumping between two frames. Drives the deltas and the signals.
   */
  load: LoadState;
  mental: MentalState;
  outcome: OutcomeState;
  perf: PerfState;
  subj: SubjState;
  /**
   * The family states as of the LAST ACTIVE day — what the player's data looked like when
   * they last played. Feeds what describes that session rather than today: the recovering
   * gate (`heavy`), confidence and its data notes, and the main account. The same object as
   * the now-frame on a play day.
   */
  last: Frame;
  /** Was the player in a loaded/fatigued state when they last played? (recovering-gate input) */
  heavy: boolean;
  /** A ≥2.5h, ≥marathonMinGames session ending on the last active day — the single-session red-corroboration arm. */
  marathonSession: boolean;
  /** The three family deltas (already clamped to their bounds). */
  deltas: { load: number; perf: number; subj: number };
  /** Fade-adjusted overload penalty (drives the `overload` driver tag). */
  overloadPen: number;
  /** Did the day-streak penalty (own-norm surge, sustained) actually contribute to `deltas.load` (C8)? Drives the consecutive-days signal's severity — see `loadParts`. */
  streakFired: boolean;
  driver: ReadinessDriver;
  /** Regime blend b ∈ [0,1] (from perf.blend) — how much of the acute window has comparable per-10 coverage. */
  blend: number;
  /** Display-only regime label derived from `blend`. */
  regime: ReadinessRegime;
  /** Rank evidence over the stagnation window — gates the undertraining nudge (spec §7b). */
  rankTrend: RankTrend;
}

const EMPTY_FRAME: Frame = {
  load: {
    acutePerDay: 0, chronicPerDay: 0, ratio: 1, ratioTrusted: false, consecutiveDays: 0,
    chronicActiveDays: 0, activeDaysPerWeek: 0, longSession: null, recentLongSession: false, lastSessionGames: 0,
    lastSessionMinutes: null, highLoad: false, sustainedLoad: false, historySpanDays: 0,
  },
  mental: { coverage: 0, tiltKnown: false, acuteTilt: 0, baseTilt: 0, acutePositive: 0, fatigued: false },
  outcome: { lossStreak: 0 },
  perf: EMPTY_PERF,
  subj: EMPTY_SUBJ,
};

const EMPTY_STATE: StateAt = {
  hasData: false,
  lastActiveOrdinal: 0,
  restDays: 0,
  ...EMPTY_FRAME,
  last: EMPTY_FRAME,
  heavy: false,
  marathonSession: false,
  deltas: { load: 0, perf: 0, subj: 0 },
  overloadPen: 0,
  streakFired: false,
  driver: 'neutral',
  blend: 0,
  regime: 'manual',
  rankTrend: 'unknown',
};

/**
 * Rest follows the supercompensation curve, not a straight line: recovery climbs
 * to a +25 peak on rest day 3, then decays continuously — a long layoff is
 * detraining, not extra rest. Turns negative (rust) from rest day 6, floored at
 * −rustPenaltyCap so even months away read "dull", never "wrecked".
 */
export function restEffectFor(restDays: number): number {
  if (restDays <= 0) return 0;
  const peakDay = T.restFullRecoverDays + 1;
  if (restDays <= peakDay) return Math.min(restDays * 12, T.restRecoveryCap);
  return Math.max(-T.rustPenaltyCap, T.restRecoveryCap - (restDays - peakDay) * T.rustDecayPerDay);
}

/** How much of a pre-rest penalty still applies after `restDays` days off: 1 → 0 by the full-recovery day. */
export function restFadeFor(restDays: number): number {
  return Math.max(0, 1 - restDays / (T.restFullRecoverDays + 1));
}

/**
 * Over how many of today's games the morning's rest bonus is used up: half the player's usual
 * games per active day, within [restCarryMinGames, restCarryMaxGames] — a heavy player keeps the
 * bonus through more games, a light one uses it up sooner.
 */
export function restCarryGames(usualGamesPerActiveDay: number): number {
  return clamp(Math.round(T.restCarryShare * usualGamesPerActiveDay), T.restCarryMinGames, T.restCarryMaxGames);
}

/**
 * The rest bonus a play day carries from its morning. Before the first game the read already
 * holds the rest effect of the gap since the previous active day (and that gap's penalty fade);
 * one game used to drop both at once — a median 18-point cliff on a real history, win or lose.
 * Now the bonus is used up linearly over the first N games and the fade gives way the same way,
 * so the score moves with the games actually played. Only the positive bonus carries — rust
 * (a long layoff's negative effect) keeps its existing rule. Undefined without a prior active day.
 */
export function restCarryAt(games: GameRecord[], dayOrd: number): RestCarry | undefined {
  const byDay = gamesByDay(games);
  let previous = -Infinity;
  for (const d of byDay.keys()) if (d < dayOrd && d > previous) previous = d;
  if (!Number.isFinite(previous)) return undefined;

  let total = 0;
  let activeDays = 0;
  for (let d = dayOrd - T.chronicDays; d < dayOrd; d += 1) {
    const n = byDay.get(d) ?? 0;
    if (n > 0) {
      total += n;
      activeDays += 1;
    }
  }
  const gapDays = dayOrd - previous;
  const share = Math.max(0, 1 - (byDay.get(dayOrd) ?? 0) / restCarryGames(activeDays > 0 ? total / activeDays : 0));
  return {
    restEffect: Math.max(0, restEffectFor(gapDays)) * share,
    fade: share * restFadeFor(gapDays) + (1 - share),
  };
}

/**
 * Behavioral load-balance delta. Volume and streak penalties are OWN-NORM
 * relative (habit is not risk — a stable 10-games/day rhythm reads neutral;
 * only surges above the player's own baseline accrue penalty), trust-gated on
 * a populated chronic window, faded by real rest days, and joined by the
 * supercompensation rest curve. Own-norm absolute-volume arms live only in the
 * red corroboration gate (`sustainedLoad`), not here.
 *
 * The manual-regime ABSOLUTE-load arm (`absArm`) is the one exception: when the
 * objective family can't see outcomes (blend b < 1), raw exposure — days without
 * rest, absolute daily volume, rest-day scarcity — becomes evidence on its own,
 * scaled by (1−b). It is volume-gated (a calm daily player stays green) and
 * tenure-gated (a newcomer isn't flagged in week 3), joins the SAME `overloadPen`
 * sum (inheriting its cap, the outer trust gate, the rest-day fade, and the
 * `overload` driver), and is EXACTLY zero at b=1 — so `loadParts` is bit-identical
 * to the shipped engine in the stats regime. It never feeds a red gate: max
 * abs-only load (24 + longSession 8) leaves the score at 43 > redCut.
 */
export function loadParts(
  load: LoadState,
  restDays: number,
  blend: number,
  rankTrend: RankTrend = 'unknown',
  rest?: RestOverride,
): { delta: number; overloadPen: number; streakFired: boolean } {
  const trust = Math.min(1, load.chronicActiveDays / T.minChronicActiveDays);
  const ratioPen = load.ratio > T.ratioElevated ? Math.min((load.ratio - T.ratioElevated) * 30, T.ratioPenCap) : 0;
  const habitBar = Math.max(T.absElevatedPerDay, T.habitFactor * load.chronicPerDay);
  const volPen = Math.min(T.volPenCap, Math.max(0, load.acutePerDay - habitBar) * 3);
  const surging = ratioPen > 0 || volPen > 0;
  const streakPen = surging ? Math.min(T.streakPenCap, Math.max(0, load.consecutiveDays - T.sustainedDays) * 3) : 0;
  const longPen = T.longSessionPen * (load.longSession?.severity ?? 0);
  // computeStateAt overrides both (see there); direct callers keep the frozen-frame rest fade.
  const fade = rest ? rest.fade : restFadeFor(restDays);

  // Absolute-load arm (manual regime). absTrust ramps on BOTH active-day density and
  // uncapped history span, so norm-free claims need a genuinely established player.
  const absTrust =
    clamp((load.chronicActiveDays - T.minChronicActiveDays) / T.absTrustRampDays, 0, 1) *
    clamp((load.historySpanDays - T.minSpanDays) / T.absTenureRampDays, 0, 1);
  // Volume-gated: the streak arm only fires above a real daily volume — a calm 4-games/day daily
  // habit accrues nothing here (only own-norm surges or rest scarcity can), preventing a false alarm
  // on mere consistency. `surging` is deliberately NOT set by this arm (it must not trip the own-norm
  // streak arm above).
  const restlessPen =
    load.acutePerDay >= T.absElevatedPerDay
      ? Math.min(T.absStreakPenCap, Math.max(0, load.consecutiveDays - T.absStreakFreeDays) * T.absStreakSlope)
      : 0;
  const absVolPen = Math.min(T.absVolPenCap, Math.max(0, load.acutePerDay - T.absElevatedPerDay) * T.absVolSlope);
  const scarcityPen = Math.min(T.restScarcityPenCap, Math.max(0, load.activeDaysPerWeek - T.restScarcityFreePerWeek) * T.restScarcitySlope);
  const absRaw = Math.min(T.absArmCap, restlessPen + absVolPen + scarcityPen);
  const absArm = blend >= 1 ? 0 : (1 - blend) * absTrust * absRaw; // exact 0 at b=1 (bit-identity)

  // Ratio and volume measure the same surge, so only the larger arm counts (summing double-counts it).
  const overloadPen = Math.min(T.overloadPenCap, Math.max(ratioPen, volPen) + streakPen + longPen + absArm) * trust * fade;
  // The low-frequency nudge fires only on PROVEN rank stagnation (spec §7b): with the trend
  // unknown (no rank data) or climbing, both the penalty and its signal stay silent — the app
  // never encourages volume on zero evidence, and low-volume climbing is the healthy pattern.
  // Rust days are excluded exactly like the signal (the rust-gap owns a layoff, and
  // restEffectFor already charges it) — pen and signal share the FULL gate, so the score
  // can never dip without its explanation showing.
  const freqPen =
    rankTrend === 'stagnant' &&
    restDays < T.rustDays &&
    load.chronicActiveDays > 0 &&
    load.activeDaysPerWeek < T.lowFrequencyDaysPerWeek
      ? Math.min(T.freqPenCap, (T.lowFrequencyDaysPerWeek - load.activeDaysPerWeek) * 3)
      : 0;
  return {
    delta: clamp((rest ? rest.restEffect : restEffectFor(restDays)) - overloadPen - freqPen, T.loadDeltaMin, T.loadDeltaMax),
    overloadPen,
    // Did the day-streak penalty itself actually contribute (C8), not just
    // "is the streak long" — the consecutive-days signal's severity reads
    // off this, not `load.consecutiveDays >= sustainedDays` alone, so it
    // can no longer read 'high' while the score never charged for it.
    streakFired: streakPen > 0,
  };
}

/** The five family states as of `dayOrd` (windows end on that day; `games` must already be cut at the reference day). */
function frameAt(games: GameRecord[], dayOrd: number, ctx: ReadinessContext): Frame {
  const load = loadState(games, dayOrd);
  const mental = mentalState(games, dayOrd);
  const outcome = outcomeState(games, dayOrd);
  const perf = perfState(games, dayOrd, ctx, mental.fatigued);
  const subj = subjState(games, dayOrd, mental, perf.objectiveAdverse, perf.blend);
  return { load, mental, outcome, perf, subj };
}

/** Evaluate the player's full training state as of `refOrdinal` (uses only games on or before that day). */
export function computeStateAt(
  games: GameRecord[],
  refOrdinal: number,
  ctx: ReadinessContext = EMPTY_CONTEXT,
): StateAt {
  const upTo = games.filter((g) => dayOrdinal(g.timestamp) <= refOrdinal);
  if (upTo.length === 0) return EMPTY_STATE;

  const lastActiveOrdinal = upTo.reduce((m, g) => Math.max(m, dayOrdinal(g.timestamp)), -Infinity);
  const restDays = Math.max(0, refOrdinal - lastActiveOrdinal);

  // Two frames, one engine: on a play day they are the same object; on a rest day the now-frame
  // carries the rest days inside its windows, while the last frame still describes the session the
  // player last played (the recovering gate and data-quality reads are about THAT session).
  const last = frameAt(upTo, lastActiveOrdinal, ctx);
  const now = restDays === 0 ? last : frameAt(upTo, refOrdinal, ctx);
  const { load, mental, outcome, perf, subj } = now;
  const heavy = (last.load.sustainedLoad && last.mental.fatigued) || last.load.highLoad || last.mental.fatigued;
  const marathonSession = detectSessions(upTo).some(
    (s) => s.endOrdinal === lastActiveOrdinal && s.minutes >= T.sessionLongMinutes && s.games >= T.marathonMinGames,
  );

  const rankTrend = rankTrendFor(upTo, refOrdinal, ctx.rankAnchors, ctx.suppressed);
  // A play day carries its morning's rest bonus through its first games (see restCarryAt).
  const carry = restDays === 0 ? restCarryAt(upTo, lastActiveOrdinal) : undefined;
  // The now-frame's load windows already hold the rest days as zero-load days, so the load
  // family's own decay IS its recovery: no rest fade on the overload (fading it as well would
  // count every rest day twice). The rest effect itself is today's, or the carried bonus.
  const lp = loadParts(load, restDays, perf.blend, rankTrend, {
    restEffect: carry ? carry.restEffect : restEffectFor(restDays),
    fade: 1,
  });
  const driver: ReadinessDriver =
    restDays >= T.rustSignalDays ? 'rust' : restDays === 0 && lp.overloadPen >= T.driverBar ? 'overload' : 'neutral';

  // Performance/subjective reads still hold the games from before the rest, so — like the
  // overload penalty — they fade as real rest days pass (and fade back in with the carry over
  // the first games of a play day); otherwise a pre-layoff tilt or dip would drag a fully rested
  // player's score forever.
  const fade = carry ? carry.fade : restFadeFor(restDays);

  return {
    hasData: true,
    lastActiveOrdinal,
    restDays,
    load,
    mental,
    outcome,
    perf,
    subj,
    last,
    heavy,
    marathonSession,
    deltas: { load: lp.delta, perf: perf.delta * fade, subj: subj.delta * fade },
    overloadPen: lp.overloadPen,
    streakFired: lp.streakFired,
    driver,
    // The regime badge (and the confidence it caps) describes the data behind the read: the last frame.
    blend: last.perf.blend,
    regime: regimeFor(last.perf.blend),
    rankTrend,
  };
}

/** The composite 0..100 readiness score — the primary output the band derives from. */
export function scoreFromState(state: StateAt): number {
  const { deltas } = state;
  return clamp(Math.round(T.baseScore + deltas.load + deltas.perf + deltas.subj), 0, 100);
}

/** Fresh vs steady — both green, cosmetic label only. */
function greenSplit(state: StateAt): ReadinessBand {
  if (state.restDays >= 1) return 'fresh';
  return state.load.ratio <= T.ratioFreshMax && state.load.acutePerDay <= T.freshPerDay ? 'fresh' : 'steady';
}

/**
 * Band = pure function of (score, driver, hard gates). Red is the highest-stakes
 * claim and keeps two hard gates: load corroboration (sustained multi-day load
 * OR a same-day marathon session) and a fully populated chronic window — the
 * score degrades continuously below full trust, but the red LABEL never fires
 * off a thin baseline (deliberate cliff, documented in the methodology copy).
 */
export function bandForState(state: StateAt): ReadinessBand {
  const { load, restDays } = state;
  const score = scoreFromState(state);
  if (restDays === 0) {
    const corroborated = load.sustainedLoad || state.marathonSession;
    // Red needs load corroboration AND at least one independent adverse family
    // (objective decline or elevated tilt) — a pure behavioral volume spike
    // with zero evidence of a problem stays amber (anti-false-alarm bias).
    const adverseBeyondLoad = state.perf.objectiveAdverse || state.mental.fatigued;
    if (score <= T.redCut && corroborated && adverseBeyondLoad && load.chronicActiveDays >= T.minChronicActiveDays) {
      return 'in-the-hole';
    }
    if (score <= T.amberCut) return 'loaded';
    return greenSplit(state);
  }
  // Resting past the recovery window is detraining — rust wins over "fresh"
  // whatever state the layoff started from.
  if (restDays >= T.rustDays) return 'rusty';
  // Resting: a heavy pre-rest state recovers, otherwise the player is simply fresh.
  if (state.heavy) return restDays >= T.restFullRecoverDays ? 'fresh' : 'recovering';
  return greenSplit(state);
}

/** Numeric readiness score at a reference day, or null when there is no prior history. */
export function scoreAt(games: GameRecord[], refOrdinal: number, ctx: ReadinessContext = EMPTY_CONTEXT): number | null {
  const state = computeStateAt(games, refOrdinal, ctx);
  return state.hasData ? scoreFromState(state) : null;
}
