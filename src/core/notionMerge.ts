/**
 * Pure decision for what an imported Notion row applies onto an existing
 * local match. Local data always wins: a review or mental record already
 * present locally is never touched, even partially. Used by the store's
 * `HistoryStore.mergeImported` bulk op so re-imports pick up grades added in
 * Notion after the original export without flooding the Review queue with
 * matches that already have a local read.
 */
import type { GameRecord, MatchMental, MatchReview } from './analytics';
import { NOTION_IMPROVEMENT_TARGET_ID } from './targets/notionBookkeeping';

/** What to patch onto the local record, or `null` when nothing changes. */
export interface ImportMergePatch {
  /** Set only when applying a bookkeeping grade (local had no review). */
  review?: MatchReview;
  /** Set only when adopting the imported mental record wholesale. */
  mental?: MatchMental;
}

/**
 * Decide the merge of `imported` (a freshly-fetched Notion row) into `local`
 * (the already-stored match with the same `matchId`). Local wins wholesale
 * for both review and mental — only fields entirely absent locally are ever
 * filled in from the import.
 */
export function mergeImportedIntoLocal(
  local: GameRecord,
  imported: GameRecord,
): ImportMergePatch | null {
  const patch: ImportMergePatch = {};

  const importedGrade = imported.review?.grades[NOTION_IMPROVEMENT_TARGET_ID];
  if (local.review === undefined && importedGrade !== undefined) {
    patch.review = {
      at: imported.review!.at,
      grades: { [NOTION_IMPROVEMENT_TARGET_ID]: importedGrade },
      flags: {},
    };
  }

  if (local.mental === undefined && imported.mental !== undefined) {
    patch.mental = imported.mental;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}
