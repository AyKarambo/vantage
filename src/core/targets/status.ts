/**
 * The ONE-line plain-language status sentence for a target list row. No stats
 * jargon here — no "CI", "baseline", "n=", "rolling"; the detail view (Focus
 * Trend panel) owns the numbers. This is the row's single takeaway: what's
 * going on with this target right now, in plain words.
 */
import { MIN_VERDICT, type LearningPhase, type TargetLearningCurve } from './learningCurve';
import type { TargetSummary } from './types';

/** Per-phase copy, keyed exhaustively so a future LearningPhase is a compile error. */
const PHASE_SENTENCE: Record<LearningPhase, (c: TargetLearningCurve) => string> = {
  gathering: (c) => `Early days — ${c.decidedSince} of ${MIN_VERDICT} games in.`,
  'no-baseline': () => 'Fresh focus — your next games set the starting point.',
  building: () => 'Practice dip — normal while a new habit settles.',
  climbing: () => 'Climbing back — the habit is starting to stick.',
  'paying-off': () => 'Paying off — you win more when you hit it.',
  steady: () => 'Holding steady — no big shift since you started.',
};

/**
 * The plain-language status sentence for a target row. Checks attempts === 0
 * first (even when a learning curve is present — a target can be re-flagged
 * before any new attempts land), then the learning phase, then falls back to
 * a hit-rate band for targets with attempts but no learning model (the demo/
 * sample library and archived targets).
 */
export function targetStatusSentence(t: Pick<TargetSummary, 'attempts' | 'hitRate' | 'learning'>): string {
  if (t.attempts === 0) return 'New — grade it after your next game.';

  if (t.learning) return PHASE_SENTENCE[t.learning.phase](t.learning);

  if (t.hitRate >= 0.6) return 'You hit this most games — strong consistency.';
  if (t.hitRate >= 0.35) return 'Hit some, missed some — keep at it.';
  return 'Still clicking into place — misses are part of learning.';
}
