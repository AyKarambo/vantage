/**
 * The chronological in-scope game series for one improvement target — the single
 * source both the scored summary and the learning curve read from, so the two can
 * never drift on which games "count" for a target. Pure and I/O-free.
 */
import type { GameRecord, TargetGrade } from '../analytics';
import type { Result } from '../model';
import type { AuthoredTarget } from './types';
import { evaluateMeasured } from './measured';

/** One in-scope game for a target, ascending by timestamp. */
export interface OrderedAttempt {
  timestamp: number;
  result: Result;
  /**
   * hit | partial | missed. Self-rated: the user's Review grade (present only where
   * they graded it). Measured: the auto-grade. Carried for tooltips — it never
   * enters the winrate math (the learning curve is games *played*, not *graded*).
   */
  grade?: TargetGrade;
  /** Measured only: the per-10 / KDA value behind the grade. Carried for future use. */
  value?: number;
}

/**
 * The games that count toward a target, ascending by timestamp.
 *  - self-rated: every game; `grade` is set only where the user graded it on Review.
 *  - measured:  only games where {@link evaluateMeasured} resolves — the bound stat
 *    is present AND the game is inside the target's role/hero scope — so an off-hero
 *    or unmeasurable game never pollutes the series.
 */
export function targetTimeline(games: GameRecord[], t: AuthoredTarget): OrderedAttempt[] {
  const ordered = [...games].sort((a, b) => a.timestamp - b.timestamp);
  if (t.mode === 'measured') {
    const out: OrderedAttempt[] = [];
    for (const g of ordered) {
      const res = evaluateMeasured(g, t);
      if (!res) continue;
      out.push({ timestamp: g.timestamp, result: g.result, grade: res.grade, value: res.value });
    }
    return out;
  }
  return ordered.map((g) => ({
    timestamp: g.timestamp,
    result: g.result,
    grade: g.review?.grades[t.id],
  }));
}
