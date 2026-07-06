/**
 * Derives the single grade the Notion `Improvement Target` column exports,
 * from a review that may carry several per-target grades. Pure and
 * storage-free: callers pass in which grade ids are "visible" (in-app
 * authored targets) so this module never needs to know about `manual.json`.
 */
import type { MatchReview, TargetGrade } from '../analytics';

/**
 * Aggregate rule (spec A1): consider only grades for visible authored targets
 * — the hidden bookkeeping id (`opts.bookkeepingId`) is always excluded from
 * aggregation. All graded visible targets `hit` → `hit`; all `missed` →
 * `missed`; any mix (or any `partial`) → `partial`. A single graded target
 * passes through unchanged.
 *
 * Precedence: the in-app aggregate wins whenever there is at least one
 * visible authored grade. Only when there are none does this fall back to the
 * imported bookkeeping grade at `review.grades[opts.bookkeepingId]`. Returns
 * `undefined` when neither is present (nothing to export).
 */
export function aggregateImprovementGrade(
  review: MatchReview | undefined,
  opts: { visibleTargetIds: ReadonlySet<string>; bookkeepingId: string },
): TargetGrade | undefined {
  if (!review) return undefined;
  const visibleGrades = Object.entries(review.grades)
    .filter(([id]) => id !== opts.bookkeepingId && opts.visibleTargetIds.has(id))
    .map(([, grade]) => grade);

  if (visibleGrades.length === 0) {
    return review.grades[opts.bookkeepingId];
  }
  if (visibleGrades.length === 1) {
    return visibleGrades[0];
  }
  const allHit = visibleGrades.every((g) => g === 'hit');
  if (allHit) return 'hit';
  const allMissed = visibleGrades.every((g) => g === 'missed');
  if (allMissed) return 'missed';
  return 'partial';
}
