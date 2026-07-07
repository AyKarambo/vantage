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
import { detectSessions } from './sessions';
import { loadState, mentalState, outcomeState, type LoadState, type MentalState, type OutcomeState } from './signals';
import { EMPTY_CONTEXT, EMPTY_PERF, perfState, type PerfState, type ReadinessContext } from './performance';
import { EMPTY_SUBJ, subjState, type SubjState } from './subjective';
import { clamp } from './stats';
import type { ReadinessBand, ReadinessDriver } from './types';

export interface StateAt {
  hasData: boolean;
  lastActiveOrdinal: number;
  restDays: number;
  load: LoadState;
  mental: MentalState;
  outcome: OutcomeState;
  perf: PerfState;
  subj: SubjState;
  /** Was the player in a loaded/fatigued state when they last played? (recovering-gate input) */
  heavy: boolean;
  /** A ≥2.5h, ≥marathonMinGames session ending on the last active day — the single-session red-corroboration arm. */
  marathonSession: boolean;
  /** The three family deltas (already clamped to their bounds). */
  deltas: { load: number; perf: number; subj: number };
  /** Fade-adjusted overload penalty (drives the `overload` driver tag). */
  overloadPen: number;
  driver: ReadinessDriver;
}

const EMPTY_STATE: StateAt = {
  hasData: false,
  lastActiveOrdinal: 0,
  restDays: 0,
  load: {
    acutePerDay: 0, chronicPerDay: 0, ratio: 1, ratioTrusted: false, consecutiveDays: 0,
    chronicActiveDays: 0, activeDaysPerWeek: 0, recentLongSession: false, lastSessionGames: 0,
    lastSessionMinutes: null, highLoad: false, sustainedLoad: false,
  },
  mental: { coverage: 0, tiltKnown: false, acuteTilt: 0, baseTilt: 0, acutePositive: 0, fatigued: false },
  outcome: { lossStreak: 0 },
  perf: EMPTY_PERF,
  subj: EMPTY_SUBJ,
  heavy: false,
  marathonSession: false,
  deltas: { load: 0, perf: 0, subj: 0 },
  overloadPen: 0,
  driver: 'neutral',
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

/**
 * Behavioral load-balance delta. Volume and streak penalties are OWN-NORM
 * relative (habit is not risk — a stable 10-games/day rhythm reads neutral;
 * only surges above the player's own baseline accrue penalty), trust-gated on
 * a populated chronic window, faded by real rest days, and joined by the
 * supercompensation rest curve. Absolute-volume arms live only in the red
 * corroboration gate (`sustainedLoad`), not here.
 */
function loadParts(load: LoadState, restDays: number): { delta: number; overloadPen: number } {
  const trust = Math.min(1, load.chronicActiveDays / T.minChronicActiveDays);
  const ratioPen = load.ratio > T.ratioElevated ? Math.min((load.ratio - T.ratioElevated) * 30, T.ratioPenCap) : 0;
  const habitBar = Math.max(T.absElevatedPerDay, T.habitFactor * load.chronicPerDay);
  const volPen = Math.min(T.volPenCap, Math.max(0, load.acutePerDay - habitBar) * 3);
  const surging = ratioPen > 0 || volPen > 0;
  const streakPen = surging ? Math.min(T.streakPenCap, Math.max(0, load.consecutiveDays - T.sustainedDays) * 3) : 0;
  const longPen = load.recentLongSession ? T.longSessionPen : 0;
  const fade = Math.max(0, 1 - restDays / (T.restFullRecoverDays + 1));
  const overloadPen = Math.min(T.overloadPenCap, ratioPen + volPen + streakPen + longPen) * trust * fade;
  const freqPen =
    load.chronicActiveDays > 0 && load.activeDaysPerWeek < T.lowFrequencyDaysPerWeek
      ? Math.min(T.freqPenCap, (T.lowFrequencyDaysPerWeek - load.activeDaysPerWeek) * 3)
      : 0;
  return {
    delta: clamp(restEffectFor(restDays) - overloadPen - freqPen, T.loadDeltaMin, T.loadDeltaMax),
    overloadPen,
  };
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

  const load = loadState(upTo, lastActiveOrdinal);
  const mental = mentalState(upTo, lastActiveOrdinal);
  const outcome = outcomeState(upTo, lastActiveOrdinal);
  const perf = perfState(upTo, lastActiveOrdinal, ctx, mental.fatigued);
  const subj = subjState(upTo, lastActiveOrdinal, mental, perf.objectiveAdverse);
  const heavy = (load.sustainedLoad && mental.fatigued) || load.highLoad || mental.fatigued;
  const marathonSession = detectSessions(upTo).some(
    (s) => s.endOrdinal === lastActiveOrdinal && s.minutes >= T.sessionLongMinutes && s.games >= T.marathonMinGames,
  );

  const lp = loadParts(load, restDays);
  const driver: ReadinessDriver =
    restDays >= T.rustSignalDays ? 'rust' : restDays === 0 && lp.overloadPen >= T.driverBar ? 'overload' : 'neutral';

  // Performance/subjective states are frozen at the LAST ACTIVE day, so — like
  // the overload penalty — they must fade as real rest days pass; otherwise a
  // pre-layoff tilt or dip would drag a fully rested player's score forever.
  const fade = Math.max(0, 1 - restDays / (T.restFullRecoverDays + 1));

  return {
    hasData: true,
    lastActiveOrdinal,
    restDays,
    load,
    mental,
    outcome,
    perf,
    subj,
    heavy,
    marathonSession,
    deltas: { load: lp.delta, perf: perf.delta * fade, subj: subj.delta * fade },
    overloadPen: lp.overloadPen,
    driver,
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
