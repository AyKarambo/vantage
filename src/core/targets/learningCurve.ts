/**
 * The per-target "Focus Trend" — a learning J-curve. Working on something new
 * usually costs a few games before it pays off (deliberate practice / the learning
 * dip), then rebounds above where you started (supercompensation-shaped). This
 * computes a rolling winrate over the games SINCE you flagged the target, against
 * your REAL pre-flag baseline, wrapped in a Wilson uncertainty band that is wide
 * when few games back it. So a dip reads as "still building (expected)" and a
 * sustained climb back over baseline reads as "paying off".
 *
 * Two honesty guarantees drive the design:
 *  1. It NEVER fabricates a baseline — too few pre-flag games → `baseline = null`
 *     and no dip/rebound claim (the honest fix for the old win-split `|| 0.5`).
 *  2. There is deliberately NO "declining" phase: the worst reachable state is
 *     `building`, defined as expected — so the display can't discourage practice.
 *
 * Pure and I/O-free (guardrail #3), fully unit-tested.
 */
import type { GameRecord, TargetGrade } from '../analytics';
import type { Result } from '../model';
import type { AuthoredTarget, TargetMode } from './types';
import { targetTimeline } from './timeline';
import { wilson } from './wilson';

/** Trailing decided games backing each rolling-winrate point. */
export const ROLL_WINDOW = 10;
/** Fewer than this many decided games in the trailing window ⇒ the point is a gap (null). */
export const ROLL_MIN = 5;
/** Trailing pre-flag decided games that define "your form going in". */
export const BASELINE_WINDOW = 20;
/** Fewer than this many pre-flag decided games ⇒ no baseline (never 0.5 / global). */
export const MIN_BASELINE = 5;
/** Fewer than this many decided games since flagging ⇒ no chart, phase = 'gathering'. */
export const MIN_RENDER = 5;
/** Fewer than this many decided games since flagging ⇒ no building/paying-off verdict yet. */
export const MIN_VERDICT = 12;
/** Ignore sub-3-point wiggles vs baseline as "a dip". */
export const DIP_EPS = 0.03;

export type LearningPhase =
  | 'gathering' // too few decided games since flag — no phase claim yet
  | 'no-baseline' // enough games, but too little pre-flag history to compare
  | 'building' // rolling below baseline, not yet turning up (EXPECTED — the worst state)
  | 'climbing' // below baseline but risen off the trough (trajectory-positive)
  | 'paying-off' // rolling sustained back above baseline after a real dip
  | 'steady'; // never meaningfully dipped — roughly flat vs baseline

export interface LearningCurvePoint {
  /** 1..n, games-since-flag (event-aligned; a draw still advances the index). */
  index: number;
  timestamp: number;
  result: Result;
  /** For the tooltip only — never part of the winrate. */
  grade?: TargetGrade;
  /** Trailing-window decided winrate; null until ROLL_MIN decided games accrue. */
  roll: number | null;
  /** Decided games backing this point (drives the uncertainty band width). */
  rollDecided: number;
  /** Wilson 95% interval on `roll`; {0,1} when roll is null. */
  ciLow: number;
  ciHigh: number;
}

export interface TargetLearningCurve {
  targetId: string;
  mode: TargetMode;
  /** activatedAt ?? createdAt — the flag instant, t=0. */
  since: number;
  /** Pre-flag winrate over BASELINE_WINDOW decided games; null if too few. */
  baseline: number | null;
  baselineDecided: number;
  points: LearningCurvePoint[];
  /** Decided games since the flag. */
  decidedSince: number;
  /** Points below baseline at the trough (0 if never dipped); null without a baseline. */
  dipDepth: number | null;
  troughIndex: number | null;
  /** Index where the rolling winrate sustainably crossed back over baseline; null if not yet. */
  reboundIndex: number | null;
  /** Current rolling winrate minus baseline, in points (signed); null without a baseline. */
  reboundPts: number | null;
  phase: LearningPhase;
}

const isDecided = (a: { result: Result }): boolean => a.result === 'Win' || a.result === 'Loss';
const winrateOf = (arr: Array<{ result: Result }>): number => {
  const dec = arr.filter(isDecided);
  if (!dec.length) return 0;
  return dec.filter((a) => a.result === 'Win').length / dec.length;
};
const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Compute a target's learning curve from the full game history. See the module
 * doc for the honesty guarantees; the algorithm mirrors the spec step-for-step.
 */
export function targetLearningCurve(games: GameRecord[], t: AuthoredTarget): TargetLearningCurve {
  const since = t.activatedAt ?? t.createdAt;
  const timeline = targetTimeline(games, t);

  // 1. Baseline — your form over the decided games BEFORE you flagged this. Never
  //    substituted with 0.5 or the global winrate: too little history → null.
  const pre = timeline.filter((a) => a.timestamp < since && isDecided(a));
  const baselineDecided = pre.length;
  const baseline = baselineDecided < MIN_BASELINE ? null : winrateOf(pre.slice(-BASELINE_WINDOW));

  // 2. Series — games since the flag, event-indexed (draws advance the index but
  //    never enter a winrate denominator).
  const sincePts = timeline.filter((a) => a.timestamp >= since);
  const decidedSince = sincePts.filter(isDecided).length;

  const points: LearningCurvePoint[] = sincePts.map((a, i) => {
    const window = sincePts.slice(0, i + 1).filter(isDecided).slice(-ROLL_WINDOW);
    const rollDecided = window.length;
    if (rollDecided < ROLL_MIN) {
      return { index: i + 1, timestamp: a.timestamp, result: a.result, grade: a.grade, roll: null, rollDecided, ciLow: 0, ciHigh: 1 };
    }
    const wins = window.filter((w) => w.result === 'Win').length;
    const ci = wilson(wins, rollDecided);
    return { index: i + 1, timestamp: a.timestamp, result: a.result, grade: a.grade, roll: wins / rollDecided, rollDecided, ciLow: ci.low, ciHigh: ci.high };
  });

  const nonNull = points.filter((p): p is LearningCurvePoint & { roll: number } => p.roll != null);
  const currentRoll = nonNull.length ? nonNull[nonNull.length - 1].roll : null;

  // 3. Trough — the lowest rolling point (each already has ≥ROLL_MIN decided, so a
  //    lone game-1 loss can never be the trough).
  let troughIndex: number | null = null;
  let troughRoll: number | null = null;
  for (const p of nonNull) {
    if (troughRoll == null || p.roll < troughRoll) {
      troughRoll = p.roll;
      troughIndex = p.index;
    }
  }
  const dipDepth = baseline == null || troughRoll == null ? null : round1(Math.max(0, baseline - troughRoll) * 100);

  // 4. Rebound — a sustained (two consecutive) return to/above baseline that
  //    follows a real dip below it.
  let reboundIndex: number | null = null;
  if (baseline != null) {
    for (let k = 1; k < nonNull.length; k++) {
      const cur = nonNull[k];
      const prev = nonNull[k - 1];
      const dippedBefore = nonNull.some((p) => p.index < cur.index && p.roll < baseline - DIP_EPS);
      if (cur.roll >= baseline && prev.roll >= baseline && dippedBefore) {
        reboundIndex = cur.index;
        break;
      }
    }
  }
  const reboundPts = baseline == null || currentRoll == null ? null : round1((currentRoll - baseline) * 100);

  // 5. Phase (precedence order). No path yields a negative/red verdict.
  let phase: LearningPhase;
  if (decidedSince < MIN_RENDER) phase = 'gathering';
  else if (baseline == null) phase = 'no-baseline';
  else if (decidedSince < MIN_VERDICT) phase = 'gathering';
  else if (reboundIndex != null) phase = 'paying-off';
  else if (currentRoll != null && currentRoll < baseline - DIP_EPS)
    phase = troughRoll != null && currentRoll > troughRoll + DIP_EPS ? 'climbing' : 'building';
  else phase = 'steady';

  return {
    targetId: t.id,
    mode: t.mode,
    since,
    baseline,
    baselineDecided,
    points,
    decidedSince,
    dipDepth,
    troughIndex,
    reboundIndex,
    reboundPts,
    phase,
  };
}
