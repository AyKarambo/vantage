/** Collapsing a match's several per-target grades into one summary grade. */
import type { TargetGrade } from './types';

/** Ordinal rank worst→best — the axis the aggregate averages over. */
const GRADE_RANK: Record<TargetGrade, number> = { missed: 0, partial: 1, hit: 2 };
const RANK_GRADE: readonly TargetGrade[] = ['missed', 'partial', 'hit'];

/**
 * Collapse a match's per-target grades into a single grade, so a compact row
 * can show one pill instead of a run of them. Averages the ordinal ranks and
 * **rounds down** (floor) toward the worse grade — so a `hit` + a `missed`
 * reads `partial`, and a `partial` + a `missed` reads `missed` (never the
 * flattering side of a tie). Returns `undefined` for an empty list.
 */
export function aggregateGrade(grades: readonly TargetGrade[]): TargetGrade | undefined {
  if (!grades.length) return undefined;
  const mean = grades.reduce((sum, g) => sum + GRADE_RANK[g], 0) / grades.length;
  return RANK_GRADE[Math.floor(mean)];
}
