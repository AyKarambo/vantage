/**
 * State evaluation at a reference day, the readiness score, and the gated band
 * decision. The band is rule-gated (not a naive score cut) so the acceptance
 * criteria hold precisely; the score is illustrative (chip + curve).
 *
 * State is evaluated as-of the player's LAST ACTIVE day; `restDays` (the distance
 * from that day to the reference day) then modulates it. This keeps the verdict
 * from being diluted by the current partial day, so "in-the-hole" is reachable
 * during an active grind and de-escalates cleanly once real rest days pass.
 */

import type { GameRecord } from '../analytics';
import { READINESS_TUNING as T } from './constants';
import { dayOrdinal } from './day';
import { loadState, mentalState, outcomeState, type LoadState, type MentalState, type OutcomeState } from './signals';
import type { ReadinessBand } from './types';

export interface StateAt {
  hasData: boolean;
  lastActiveOrdinal: number;
  restDays: number;
  load: LoadState;
  mental: MentalState;
  outcome: OutcomeState;
  /** Was the player in a loaded/fatigued/in-the-hole state when they last played? */
  heavy: boolean;
}

const EMPTY_STATE: StateAt = {
  hasData: false,
  lastActiveOrdinal: 0,
  restDays: 0,
  load: {
    acutePerDay: 0, chronicPerDay: 0, ratio: 1, ratioTrusted: false, consecutiveDays: 0,
    chronicActiveDays: 0, recentLongSession: false, lastSessionGames: 0, lastSessionMinutes: null,
    highLoad: false, sustainedLoad: false,
  },
  mental: { coverage: 0, tiltKnown: false, acuteTilt: 0, baseTilt: 0, acutePositive: 0, fatigued: false },
  outcome: { lossStreak: 0, winrateDip: 0, srTrend: null },
  heavy: false,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Evaluate the player's training state as of `refOrdinal` (uses only games on or before that day). */
export function computeStateAt(games: GameRecord[], refOrdinal: number): StateAt {
  const upTo = games.filter((g) => dayOrdinal(g.timestamp) <= refOrdinal);
  if (upTo.length === 0) return EMPTY_STATE;

  const lastActiveOrdinal = upTo.reduce((m, g) => Math.max(m, dayOrdinal(g.timestamp)), -Infinity);
  const restDays = Math.max(0, refOrdinal - lastActiveOrdinal);

  const load = loadState(upTo, lastActiveOrdinal);
  const mental = mentalState(upTo, lastActiveOrdinal);
  const outcome = outcomeState(upTo, lastActiveOrdinal);
  const heavy = (load.sustainedLoad && mental.fatigued) || load.highLoad || mental.fatigued;

  return { hasData: true, lastActiveOrdinal, restDays, load, mental, outcome, heavy };
}

/** 0..100 readiness score for a state. Illustrative; the band is gated separately. */
export function scoreFromState(state: StateAt): number {
  const { load, mental, outcome, restDays } = state;

  const ratioPen = load.ratio > T.ratioElevated ? Math.min((load.ratio - T.ratioElevated) * 30, 25) : 0;
  const volPen = load.acutePerDay > T.absElevatedPerDay ? Math.min((load.acutePerDay - T.absElevatedPerDay) * 3, 25) : 0;
  const streakPen = load.consecutiveDays > T.sustainedDays ? Math.min((load.consecutiveDays - T.sustainedDays) * 3, 15) : 0;
  const longPen = load.recentLongSession ? 8 : 0;
  const loadPenalty = Math.min(ratioPen + volPen + streakPen + longPen, T.loadPenaltyCap);

  const mentalPenalty =
    mental.coverage >= T.mentalMinCoverage && mental.tiltKnown
      ? Math.min(mental.acuteTilt * 40 + Math.max(0, mental.acuteTilt - mental.baseTilt) * 30, T.mentalPenaltyCap)
      : 0;

  const outcomePenalty = Math.min(
    (outcome.lossStreak >= 3 ? (outcome.lossStreak - 2) * 2 : 0) + Math.max(0, outcome.winrateDip) * 10,
    T.outcomePenaltyCap,
  );

  const restRecovery = Math.min(restDays * 12, T.restRecoveryCap);

  return clamp(Math.round(100 - loadPenalty - mentalPenalty - outcomePenalty + restRecovery), 0, 100);
}

/** Fresh vs steady — both green, cosmetic label only. */
function greenSplit(state: StateAt): ReadinessBand {
  if (state.restDays >= 1) return 'fresh';
  return state.load.ratio <= T.ratioFreshMax && state.load.acutePerDay <= T.freshPerDay ? 'fresh' : 'steady';
}

/** Map a training state + rest days onto a band (excludes insufficient/stale, handled upstream). */
export function bandForState(state: StateAt): ReadinessBand {
  const { load, mental, restDays } = state;
  if (restDays === 0) {
    if (load.sustainedLoad && mental.fatigued) return 'in-the-hole';
    if (load.highLoad || mental.fatigued) return 'loaded';
    return greenSplit(state);
  }
  // Resting: a heavy pre-rest state recovers, otherwise the player is simply fresh.
  if (state.heavy) return restDays >= T.restFullRecoverDays ? 'fresh' : 'recovering';
  return greenSplit(state);
}

/** Numeric readiness score at a reference day, or null when there is no prior history. */
export function scoreAt(games: GameRecord[], refOrdinal: number): number | null {
  const state = computeStateAt(games, refOrdinal);
  return state.hasData ? scoreFromState(state) : null;
}
