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

/** The family states as of one day ordinal, plus that day's marathon flag. */
interface Frame {
  load: LoadState;
  mental: MentalState;
  outcome: OutcomeState;
  perf: PerfState;
  subj: SubjState;
  /** A ≥2.5h, ≥marathonMinGames session ending on that day — the single-session red-corroboration arm. */
  marathon: boolean;
}

export interface StateAt {
  hasData: boolean;
  lastActiveOrdinal: number;
  restDays: number;
  /** The family states, evaluated as of the LAST ACTIVE day (rest days fade them, see `computeStateAt`). */
  load: LoadState;
  mental: MentalState;
  outcome: OutcomeState;
  perf: PerfState;
  subj: SubjState;
  /** Was the player in a loaded/fatigued state when they last played? (recovering-gate input) */
  heavy: boolean;
  /** A ≥2.5h, ≥marathonMinGames session ending on the last active day — the single-session red-corroboration arm. */
  marathonSession: boolean;
  /**
   * On a play day, the share of the MORNING read (the score before today's first game) still
   * blended into the deltas: 1 → 0 over the first N games (see `morningRead`). 0 on rest days,
   * once N games are played, and without an earlier active day.
   */
  morningShare: number;
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

const EMPTY_STATE: StateAt = {
  hasData: false,
  lastActiveOrdinal: 0,
  restDays: 0,
  load: {
    acutePerDay: 0, chronicPerDay: 0, ratio: 1, ratioTrusted: false, consecutiveDays: 0,
    chronicActiveDays: 0, activeDaysPerWeek: 0, longSession: null, recentLongSession: false, lastSessionGames: 0,
    lastSessionMinutes: null, highLoad: false, sustainedLoad: false, historySpanDays: 0,
  },
  mental: { coverage: 0, tiltKnown: false, acuteTilt: 0, baseTilt: 0, acutePositive: 0, fatigued: false },
  outcome: { lossStreak: 0 },
  perf: EMPTY_PERF,
  subj: EMPTY_SUBJ,
  heavy: false,
  marathonSession: false,
  morningShare: 0,
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

/** Usual games per ACTIVE day over the chronic window before `dayOrd` (0 with none). */
function usualGamesPerActiveDay(byDay: Map<number, number>, dayOrd: number): number {
  let total = 0;
  let activeDays = 0;
  for (let d = dayOrd - T.chronicDays; d < dayOrd; d += 1) {
    const n = byDay.get(d) ?? 0;
    if (n > 0) {
      total += n;
      activeDays += 1;
    }
  }
  return activeDays > 0 ? total / activeDays : 0;
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
): { delta: number; overloadPen: number; streakFired: boolean } {
  const trust = Math.min(1, load.chronicActiveDays / T.minChronicActiveDays);
  const ratioPen = load.ratio > T.ratioElevated ? Math.min((load.ratio - T.ratioElevated) * 30, T.ratioPenCap) : 0;
  const habitBar = Math.max(T.absElevatedPerDay, T.habitFactor * load.chronicPerDay);
  const volPen = Math.min(T.volPenCap, Math.max(0, load.acutePerDay - habitBar) * 3);
  const surging = ratioPen > 0 || volPen > 0;
  const streakPen = surging ? Math.min(T.streakPenCap, Math.max(0, load.consecutiveDays - T.sustainedDays) * 3) : 0;
  const longPen = T.longSessionPen * (load.longSession?.severity ?? 0);
  const fade = restFadeFor(restDays);

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
    delta: clamp(restEffectFor(restDays) - overloadPen - freqPen, T.loadDeltaMin, T.loadDeltaMax),
    overloadPen,
    // Did the day-streak penalty itself actually contribute (C8), not just
    // "is the streak long" — the consecutive-days signal's severity reads
    // off this, not `load.consecutiveDays >= sustainedDays` alone, so it
    // can no longer read 'high' while the score never charged for it.
    streakFired: streakPen > 0,
  };
}

/** The family states as of `dayOrd` (windows end on that day; `games` must already be cut at it). */
function frameAt(games: GameRecord[], dayOrd: number, ctx: ReadinessContext): Frame {
  const load = loadState(games, dayOrd);
  const mental = mentalState(games, dayOrd);
  const outcome = outcomeState(games, dayOrd);
  const marathon = detectSessions(games).some(
    (s) => s.endOrdinal === dayOrd && s.minutes >= T.sessionLongMinutes && s.games >= T.marathonMinGames,
  );
  // Heavy, uninterrupted play — the red gate's own load corroboration — is where losing counts in
  // full even while the per-10 stats hold (see the winrate note in performance.ts).
  const perf = perfState(games, dayOrd, ctx, mental.fatigued, load.sustainedLoad || marathon);
  const subj = subjState(games, dayOrd, mental, perf.objectiveAdverse, perf.blend);
  return { load, mental, outcome, perf, subj, marathon };
}

interface Read {
  deltas: { load: number; perf: number; subj: number };
  overloadPen: number;
  streakFired: boolean;
}

/**
 * The family deltas of a frame read `restDays` after its day: the load family with the
 * supercompensation rest curve and its rest fade (see `loadParts`), and the performance and
 * self-report reads faded by the same rest days — a pre-layoff tilt or dip must not drag a fully
 * rested player's score forever.
 */
function readOf(frame: Frame, restDays: number, rankTrend: RankTrend): Read {
  const lp = loadParts(frame.load, restDays, frame.perf.blend, rankTrend);
  const fade = restFadeFor(restDays);
  return {
    deltas: { load: lp.delta, perf: frame.perf.delta * fade, subj: frame.subj.delta * fade },
    overloadPen: lp.overloadPen,
    streakFired: lp.streakFired,
  };
}

/**
 * The read this play day started from — exactly what the score showed before today's first game —
 * and how much of it is still blended in. Switching from that rest-day read to the live read used
 * to happen all at once with the first game: a median 18-point cliff on a real history, win or lose.
 * Instead the score now crossfades from the morning read to the live read over the first N games
 * (N = half the player's usual games per active day, 3–10), so one game moves it by about 1/N of
 * the difference, and rest days keep their own recovery curve (a surge fades over 1–2 days, not
 * overnight). Only a morning carrying a positive rest effect crossfades: a layoff's rust keeps its
 * existing rule. Null without an earlier active day or once N games are played.
 */
function morningRead(upTo: GameRecord[], today: number, ctx: ReadinessContext): { share: number; read: Read } | null {
  const byDay = gamesByDay(upTo);
  let previous = -Infinity;
  for (const d of byDay.keys()) if (d < today && d > previous) previous = d;
  if (!Number.isFinite(previous)) return null;
  const gapDays = today - previous;
  if (restEffectFor(gapDays) < 0) return null;
  const share = Math.max(0, 1 - (byDay.get(today) ?? 0) / restCarryGames(usualGamesPerActiveDay(byDay, today)));
  if (share <= 0) return null;
  const before = upTo.filter((g) => dayOrdinal(g.timestamp) < today);
  const rankTrend = rankTrendFor(before, today, ctx.rankAnchors, ctx.suppressed);
  return { share, read: readOf(frameAt(before, previous, ctx), gapDays, rankTrend) };
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

  // State is evaluated as of the LAST ACTIVE day; rest days then fade it and add the rest curve.
  const frame = frameAt(upTo, lastActiveOrdinal, ctx);
  const { load, mental, outcome, perf, subj } = frame;
  const heavy = (load.sustainedLoad && mental.fatigued) || load.highLoad || mental.fatigued;

  const rankTrend = rankTrendFor(upTo, refOrdinal, ctx.rankAnchors, ctx.suppressed);
  const live = readOf(frame, restDays, rankTrend);
  const morning = restDays === 0 ? morningRead(upTo, lastActiveOrdinal, ctx) : null;
  const share = morning ? morning.share : 0;
  const mix = (m: number, l: number): number => share * m + (1 - share) * l;
  const read: Read = morning
    ? {
        deltas: {
          load: mix(morning.read.deltas.load, live.deltas.load),
          perf: mix(morning.read.deltas.perf, live.deltas.perf),
          subj: mix(morning.read.deltas.subj, live.deltas.subj),
        },
        overloadPen: mix(morning.read.overloadPen, live.overloadPen),
        streakFired: live.streakFired,
      }
    : live;
  const driver: ReadinessDriver =
    restDays >= T.rustSignalDays ? 'rust' : restDays === 0 && read.overloadPen >= T.driverBar ? 'overload' : 'neutral';

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
    marathonSession: frame.marathon,
    morningShare: share,
    deltas: read.deltas,
    overloadPen: read.overloadPen,
    streakFired: read.streakFired,
    driver,
    blend: perf.blend,
    regime: regimeFor(perf.blend),
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
