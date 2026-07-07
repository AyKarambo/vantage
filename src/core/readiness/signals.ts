/**
 * Pure signal extractors, all evaluated at a reference day ordinal (the player's
 * last active day). Split into three families per the spec: behavioural load and
 * self-reported mental state are PRIMARY; match outcomes are weak corroboration
 * that can never enter the band gate.
 */

import type { GameRecord } from '../analytics';
import { streak } from '../analytics';
import { isPositiveComms } from '../comms';
import { READINESS_TUNING as T } from './constants';
import { dayOrdinal } from './day';
import { detectSessions, gamesByDay } from './sessions';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Exponentially weighted moving average over an oldest→newest series. Recent days weigh more. */
function ewma(series: number[], windowDays: number): number {
  if (series.length === 0) return 0;
  const lambda = 2 / (windowDays + 1);
  let value = series[0];
  for (let i = 1; i < series.length; i += 1) {
    value = series[i] * lambda + value * (1 - lambda);
  }
  return value;
}

/** True when the player logged any mental state for this game (from quick-log or the Review screen). */
function mentalLogged(g: GameRecord): boolean {
  return g.mental !== undefined || g.review?.flags !== undefined;
}

function tiltFlagged(g: GameRecord): boolean {
  return Boolean(g.mental?.tilt || g.review?.flags?.tilt);
}

function positiveFlagged(g: GameRecord): boolean {
  return isPositiveComms(g.mental) || isPositiveComms(g.review?.flags);
}

export interface LoadState {
  acutePerDay: number;
  chronicPerDay: number;
  ratio: number;
  ratioTrusted: boolean;
  consecutiveDays: number;
  chronicActiveDays: number;
  /** Active days per week over the chronic window — the play-frequency read behind the undertraining nudge. */
  activeDaysPerWeek: number;
  recentLongSession: boolean;
  lastSessionGames: number;
  lastSessionMinutes: number | null;
  highLoad: boolean;
  sustainedLoad: boolean;
}

export function loadState(games: GameRecord[], refOrdinal: number): LoadState {
  const byDay = gamesByDay(games);

  // Daily-games series over the chronic window, oldest → newest (0 on rest days).
  const series: number[] = [];
  let chronicActiveDays = 0;
  for (let d = refOrdinal - T.chronicDays + 1; d <= refOrdinal; d += 1) {
    const n = byDay.get(d) ?? 0;
    series.push(n);
    if (n > 0) chronicActiveDays += 1;
  }

  // Frequency is rated over the days the history can actually witness — a
  // 15-day-old account has 15 observable days, not 21, and must not read as
  // playing ~30% less than it does.
  const firstOrdinal = games.length ? dayOrdinal(games[0].timestamp) : refOrdinal;
  const observedDays = Math.max(1, Math.min(T.chronicDays, refOrdinal - firstOrdinal + 1));

  const acuteLoad = ewma(series, T.acuteDays);
  const chronicLoad = ewma(series, T.chronicDays);
  const acuteSlice = series.slice(-T.acuteDays);
  const acutePerDay = round2(acuteSlice.reduce((a, b) => a + b, 0) / Math.max(1, acuteSlice.length));

  // The acute:chronic ratio is only trusted with a populated baseline — otherwise a
  // recent spike over a mostly-empty window mechanically exceeds the threshold.
  const ratioTrusted = chronicActiveDays >= T.minChronicActiveDays;
  const ratio = ratioTrusted ? round2(acuteLoad / Math.max(chronicLoad, 1e-6)) : 1;

  // Consecutive active days ending at the last active day.
  let consecutiveDays = 0;
  for (let d = refOrdinal; (byDay.get(d) ?? 0) > 0; d -= 1) consecutiveDays += 1;

  const sessions = detectSessions(games);
  const last = sessions[sessions.length - 1];
  const recentLongSession = sessions.some(
    (s) => s.endOrdinal >= refOrdinal - T.acuteMentalDays + 1 && s.minutes >= T.sessionLongMinutes,
  );

  const highLoad = ratio >= T.ratioElevated || acutePerDay >= T.absElevatedPerDay || recentLongSession;
  const sustainedLoad =
    consecutiveDays >= T.sustainedDays && (ratio >= T.ratioHigh || acutePerDay >= T.absHighPerDay);

  return {
    acutePerDay,
    chronicPerDay: round2(chronicLoad),
    ratio,
    ratioTrusted,
    consecutiveDays,
    chronicActiveDays,
    activeDaysPerWeek: round2(chronicActiveDays / (observedDays / 7)),
    recentLongSession,
    lastSessionGames: last?.games ?? 0,
    lastSessionMinutes: last ? last.minutes : null,
    highLoad,
    sustainedLoad,
  };
}

export interface MentalState {
  coverage: number;
  tiltKnown: boolean;
  acuteTilt: number;
  baseTilt: number;
  acutePositive: number;
  fatigued: boolean;
}

export function mentalState(games: GameRecord[], refOrdinal: number): MentalState {
  const acute = games.filter((g) => dayOrdinal(g.timestamp) >= refOrdinal - T.acuteMentalDays + 1);
  const base = games.filter((g) => dayOrdinal(g.timestamp) >= refOrdinal - T.chronicDays + 1);

  const flaggedAcute = acute.filter(mentalLogged);
  const flaggedBase = base.filter(mentalLogged);

  const coverage = acute.length > 0 ? flaggedAcute.length / acute.length : 0;
  const tiltKnown = flaggedAcute.length > 0;
  // Tilt rate is over games that carry a logged flag — NEVER over decided (non-draw)
  // games, so an all-draw window can't produce a 0/0 NaN.
  const acuteTilt = tiltKnown ? flaggedAcute.filter(tiltFlagged).length / flaggedAcute.length : 0;
  const baseTilt = flaggedBase.length > 0 ? flaggedBase.filter(tiltFlagged).length / flaggedBase.length : 0;
  const acutePositive = tiltKnown ? flaggedAcute.filter(positiveFlagged).length / flaggedAcute.length : 0;

  const fatigued =
    coverage >= T.mentalMinCoverage &&
    tiltKnown &&
    (acuteTilt >= T.tiltElevatedAbs || acuteTilt - baseTilt >= T.tiltElevatedDelta);

  return {
    coverage: round2(coverage),
    tiltKnown,
    acuteTilt: round2(acuteTilt),
    baseTilt: round2(baseTilt),
    acutePositive: round2(acutePositive),
    fatigued,
  };
}

export interface OutcomeState {
  lossStreak: number;
}

/**
 * Weak corroboration only: the loss streak feeds a capped `watch` signal and
 * nothing else. Winrate-vs-baseline moved into the objective-performance
 * subscore (per-account, sample-gated — see `performance.ts`).
 */
export function outcomeState(games: GameRecord[], refOrdinal: number): OutcomeState {
  const acute = games.filter((g) => dayOrdinal(g.timestamp) >= refOrdinal - T.acuteMentalDays + 1);

  // Window the streak to the acute range so we never label a stale run of losses
  // (buried behind more-recent wins/draws) as a "recent" losing streak. streak()
  // strips draws, so an unwindowed call can reach losses from days ago.
  const s = streak(acute);
  return { lossStreak: s.type === 'L' ? s.count : 0 };
}
