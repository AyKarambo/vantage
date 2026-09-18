/**
 * Personal measured-target threshold suggestions (R7) — "what do I actually
 * average?" instead of the player having to guess a number, or a fixed
 * library entry ("~9k/10 is a solid DPS floor at most ranks") being equally
 * wrong for a GM Genji and a Bronze Reaper. Reuses {@link matchStatValue}, the
 * exact evaluator the target itself will be graded with, so the suggestion
 * and the grade can never disagree about what a match's stat value was.
 *
 * Pure and Electron-free — the same per-10/scope math as scoring, on the
 * player's OWN account only (a smurf's easy-lobby numbers must never inflate
 * the main account's suggestion) and over UNFILTERED history, like the
 * readiness baselines.
 */
import type { GameRecord } from '../analytics';
import { matchStatValue, type MeasuredScope } from './measured';
import { stepFor } from './stepSizes';

export interface ThresholdSuggestion {
  /** The stat's per-10 (or KDA ratio) median over the qualifying games. */
  median: number;
  /** The 75th percentile — a stretch goal a step above the median. */
  p75: number;
  /** How many of the last `window` games on this account actually measured the stat (in scope, with a usable value). */
  n: number;
}

/** Linear-interpolation percentile (numpy's default) over an ascending-sorted array. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * The player's own median/75th-percentile value for `stat` over their last
 * `window` games on `account` that fall inside `scope` and actually measure
 * (mirrors how a real measured target would be graded — an unmeasurable game,
 * e.g. no duration, is skipped, not a data point). `null` when nothing
 * qualifies at all (a brand-new account, or a stat with zero coverage).
 * Looks back over the last `window` games by recency, not the last `window`
 * MEASURED values — a stable, predictable lookback rather than one that
 * silently reaches arbitrarily far into history to fill a quota.
 */
export function suggestMeasuredThreshold(
  games: readonly GameRecord[],
  stat: string,
  account: string,
  scope: MeasuredScope = {},
  window = 30,
): ThresholdSuggestion | null {
  const recent = games
    .filter((g) => g.account === account)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, window);
  const values = recent
    .map((g) => matchStatValue(g, stat, scope))
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  if (!values.length) return null;
  return { median: percentile(values, 0.5), p75: percentile(values, 0.75), n: values.length };
}

/** Round a raw suggested value to the threshold field's own step (R7) — the
 *  suggestion should land somewhere the wheel/arrow stepper would too, not an
 *  odd-looking value like "8,247". */
export function roundToStep(value: number, stat: string): number {
  const step = stepFor(stat);
  return Math.round(value / step) * step;
}
