/**
 * The ONE-line plain-language status sentence for a target list row. No stats
 * jargon here — no "CI", "baseline", "n=", "rolling"; the detail view (Focus
 * Trend panel) owns the numbers. This is the row's single takeaway: what's
 * going on with this target right now, in plain words.
 */
import { MIN_VERDICT, type LearningPhase, type TargetLearningCurve } from './learningCurve';
import type { TargetSummary } from './types';

/** Minimum decided (Win/Loss) games on EACH side before a lift claim is trusted (R6) — below this, a hit-rate band is honest; a lift number from a handful of games isn't. */
const MIN_DECIDED_PER_SIDE = 8;

/** The lift magnitude (winWhenHit − winWhenMissed, in winrate fraction) that counts as a real effect either way (R6) — mirrors the row chip's own green/red cutoff, so the sentence and the chip never disagree. */
const LIFT_THRESHOLD = 0.05;

/** Total attempts + hit-rate past which a target is essentially automatic (R6) — the missed side rarely has enough games left to say anything about lift, and grading it longer teaches nothing new. */
const HABIT_MIN_ATTEMPTS = 20;
const HABIT_HIT_RATE = 0.8;

const signedPts = (frac: number): string => {
  const pts = Math.round(Math.abs(frac) * 100);
  return frac < 0 ? `−${pts} pts` : `+${pts} pts`;
};

/** Per-phase copy, keyed exhaustively so a future LearningPhase is a compile error.
 *  Gathering promises the {@link MIN_VERDICT} countdown only when a pre-flag
 *  baseline exists — without one the curve exits gathering into 'no-baseline'
 *  long before 12 games, so the countdown would be a lie. */
const PHASE_SENTENCE: Record<LearningPhase, (c: TargetLearningCurve) => string> = {
  gathering: (c) => c.baseline != null
    ? `Early days — ${c.decidedSince} of ${MIN_VERDICT} games in.`
    : `Early days — ${c.decidedSince} ${c.decidedSince === 1 ? 'game' : 'games'} in so far.`,
  'no-baseline': () => 'Fresh focus — your next games set the starting point.',
  building: () => 'Practice dip — normal while a new habit settles.',
  climbing: () => 'Climbing back — the habit is starting to stick.',
  'paying-off': () => 'Paying off — you win more when you hit it.',
  steady: () => 'Holding steady — no big shift since you started.',
};

/**
 * The plain-language status sentence for a target row. Checks attempts === 0
 * first (even when a learning curve is present — a target can be re-flagged
 * before any new attempts land), then the learning phase; for targets with
 * attempts but no learning model (the demo/sample library and archived
 * targets), a real, well-evidenced lift (R6) drives the verdict instead of a
 * bare hit-rate band — hitting a target most games says nothing about
 * whether hitting it actually wins more, and a hit-rate band used to be the
 * only read offered. The zero-attempts copy is mode-aware: measured targets
 * grade themselves, so "grade it" would be an instruction the user cannot
 * follow.
 */
export function targetStatusSentence(
  t: Pick<TargetSummary, 'mode' | 'attempts' | 'hitRate' | 'learning' | 'winWhenHit' | 'winWhenMissed' | 'hitDecided' | 'missDecided'>,
): string {
  if (t.attempts === 0) {
    return t.mode === 'measured'
      ? 'New — auto-graded from your next game.'
      : 'New — grade it after your next game.';
  }

  if (t.learning) return PHASE_SENTENCE[t.learning.phase](t.learning);

  // Essentially automatic — the missed side rarely has enough games left to
  // say anything about lift, and grading it longer teaches nothing new.
  if (t.attempts >= HABIT_MIN_ATTEMPTS && t.hitRate >= HABIT_HIT_RATE) {
    return `Habit is set — ${Math.round(t.hitRate * 100)}% hit over ${t.attempts} games, rotate it out.`;
  }

  if (t.hitDecided >= MIN_DECIDED_PER_SIDE && t.missDecided >= MIN_DECIDED_PER_SIDE) {
    const lift = t.winWhenHit - t.winWhenMissed;
    return lift >= LIFT_THRESHOLD
      ? `Worth keeping — ${signedPts(lift)} when you hit it (${t.hitDecided} games).`
      : "No effect yet — hitting it hasn't moved your winrate; consider swapping it.";
  }

  if (t.hitRate >= 0.6) return 'You hit this most games — strong consistency.';
  if (t.hitRate >= 0.35) return 'Hit some, missed some — keep at it.';
  return 'Still clicking into place — misses are part of learning.';
}
