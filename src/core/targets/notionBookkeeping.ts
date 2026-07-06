/**
 * Notion export bookkeeping that pure `core/` code needs to reference — the
 * hidden internal target id (so aggregation can exclude it, see
 * {@link ../targets/aggregateGrade aggregateImprovementGrade}) and the export
 * content signature that drives changed-since-last-export detection.
 *
 * The id constant is the same value historically exported from
 * `src/notion/notionImporter.ts` as `NOTION_IMPROVEMENT_TARGET_ID` — that
 * re-export stays in place until the Wave 1 import switch-over; this module is
 * the new source of truth `core/` (and eventually the edges) import from.
 */
import type { GameRecord, MatchMental, TargetGrade } from '../analytics';

/**
 * Internal id the Notion import bookkeeping grade is stored under
 * (`review.grades[NOTION_IMPROVEMENT_TARGET_ID]`). Never shown as an
 * `AuthoredTarget` and always excluded from aggregation/scoring.
 */
export const NOTION_IMPROVEMENT_TARGET_ID = 'notion-improvement-target';

/**
 * Deterministic content signature for the fields a Notion export can change
 * after the initial `create`: the derived improvement grade (see
 * {@link aggregateImprovementGrade}) and the merged mental flags. Two calls
 * with the same grade and the same set of true flags produce the same string
 * regardless of key order, so it is safe to compare across syncs to detect
 * "nothing changed" (skip) vs. "changed" (update) vs. "cleared" (blank the
 * Notion cell). Scalar game facts (map/result/etc.) are intentionally excluded
 * — they never change after export for GEP rows, so including them would only
 * ever add noise, not correctness.
 */
export function matchExportSignature(game: GameRecord, grade: TargetGrade | undefined): string {
  const mental = mergedMentalForSignature(game.mental, game.review?.flags);
  const flags = Object.keys(mental)
    .filter((k) => mental[k as keyof MatchMental])
    .sort();
  return JSON.stringify({ grade: grade ?? null, flags });
}

/** Union of both mental sources, flattened to just the keys that are `true`. */
function mergedMentalForSignature(a: MatchMental | undefined, b: MatchMental | undefined): MatchMental {
  if (!a && !b) return {};
  const merged: MatchMental = {};
  const keys: (keyof MatchMental)[] = [
    'tilt',
    'toxicMates',
    'leaver',
    'leaverMyTeam',
    'leaverEnemyTeam',
    'positiveComms',
  ];
  for (const k of keys) {
    if (a?.[k] || b?.[k]) merged[k] = true;
  }
  return merged;
}
