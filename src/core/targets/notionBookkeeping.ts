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
import { commsTone } from '../comms';
import { isCompetitive } from '../matchFilter';

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
  const flags = mergedFlagsForSignature(game.mental, game.review?.flags);
  return JSON.stringify({ grade: grade ?? null, flags });
}

/**
 * Union of both mental sources, flattened to a sorted list of signature tokens.
 * Boolean flags contribute their own key; the three-state comms tone contributes
 * `'positiveComms'` when positive (so records exported before the tone existed
 * keep an identical signature and don't churn) or `'comms:<tone>'` for the newer
 * banter/abusive tones.
 */
function mergedFlagsForSignature(a: MatchMental | undefined, b: MatchMental | undefined): string[] {
  if (!a && !b) return [];
  const booleanKeys: (keyof MatchMental)[] = [
    'tilt',
    'toxicMates',
    'leaver',
    'leaverMyTeam',
    'leaverEnemyTeam',
  ];
  const flags = booleanKeys.filter((k) => a?.[k] || b?.[k]) as string[];
  const tone = commsTone(a) ?? commsTone(b);
  if (tone === 'positive') flags.push('positiveComms');
  else if (tone) flags.push(`comms:${tone}`);
  return flags.sort();
}

/**
 * The export-ledger facts the unsynced count needs for one match, read against
 * the configured Gametracker database: the page it was last exported to
 * (`undefined` = never exported into that database) and the content signature
 * recorded at that write.
 */
export interface MatchExportLedger {
  pageId: string | undefined;
  signature: string | undefined;
}

/**
 * Whether a game still needs to be pushed to Notion — the SAME create/update/skip
 * rule {@link ../notion/notionExporter NotionExporter} applies: it's never been
 * exported into the target database (no ledgered page id → a create) OR its
 * content changed since the last export (recorded signature ≠ the `current` one →
 * an update). Only an unchanged, already-ledgered match is "synced". Keeping this
 * in lockstep with the exporter is why the in-app count and a real sync agree.
 */
export function gameNeedsSync(current: string, ledger: MatchExportLedger): boolean {
  if (ledger.pageId === undefined) return true;
  return ledger.signature !== current;
}

/**
 * Count competitive games that still need a Notion sync. The caller passes
 * UNFILTERED history (spec E3: dashboard filters are ignored); non-competitive
 * rows — pre-update history Vantage no longer tracks — are excluded here, so the
 * count matches the exporter's competitive-only scope. `signatureOf` computes a
 * game's current export signature (grade + mental flags); `ledgerOf` returns its
 * recorded state against the configured database.
 *
 * Known transient over-count (spec E4): right after upgrading from a pre-ledger
 * install, legacy `processed[]` rows and rows the user hand-added in Notion have
 * no `records` entry yet, so `ledgerOf(...).pageId` is `undefined` and they read
 * as "needs sync" until the next `export()` adopts + ledgers them. This resolves
 * itself on the first sync; it never over-writes or duplicates anything.
 */
export function countUnsyncedGames(
  games: readonly GameRecord[],
  signatureOf: (game: GameRecord) => string,
  ledgerOf: (matchId: string) => MatchExportLedger,
): number {
  let n = 0;
  for (const g of games) {
    if (!isCompetitive(g.gameType)) continue;
    if (gameNeedsSync(signatureOf(g), ledgerOf(g.matchId))) n++;
  }
  return n;
}

/**
 * How many competitive games the (unfiltered) history holds — the denominator
 * that tells "no competitive games yet" (`0`) apart from "all synced"
 * (`countUnsyncedGames` is `0` while this is `> 0`).
 */
export function countCompetitiveGames(games: readonly GameRecord[]): number {
  let n = 0;
  for (const g of games) if (isCompetitive(g.gameType)) n++;
  return n;
}
