import { APIResponseError, APIErrorCode, Client } from '@notionhq/client';
import { emptyMatch, type MatchRecord, type Result } from '../core/model';
import type { GameRecord, MatchMental } from '../core/analytics';
import { leaverFlags, mergeLeaver } from '../core/leaver';
import { aggregateImprovementGrade, matchExportSignature, NOTION_IMPROVEMENT_TARGET_ID } from '../core/targets';
import { NotionWriter } from './notionWriter';
import { resolveDataSourceId } from './dataSourceResolver';
import { MapsCache } from './mapsCache';
import type { OutboxStore } from '../store/outbox';
import type { ExportResult } from '../shared/contract';

/**
 * On-demand export of analyzed games to the Notion Gametracker (one of several
 * outputs). Drives create/update/skip/recreate off the export ledger
 * (`OutboxStore`) and a content signature (`matchExportSignature`), derives the
 * `Improvement Target` grade via the aggregate rule, and — on the first sync
 * after upgrading from a pre-ledger install — backfills legacy exported rows
 * (tracked only in the old `processed[]` list) by resolving their existing
 * Notion page via a one-time `Match ID` query.
 */
export class NotionExporter {
  constructor(
    private readonly writer: NotionWriter,
    private readonly maps: MapsCache,
    private readonly outbox: OutboxStore,
    /** Cached shape-validation issues (e.g. from `rebuildNotion`'s async validate); short-circuits the export when set. */
    private readonly shapeIssues?: string[],
    /**
     * Getter for the ids of the user's in-app authored targets, so the
     * aggregate-grade rule can tell them apart from the hidden bookkeeping
     * id. Re-read on every `export()` call (never cached at construction)
     * so a target authored after the exporter was built is still visible at
     * sync time. Defaults to an empty set so callers that don't yet thread
     * authored ids still compile and behave sensibly.
     */
    private readonly authoredTargetIds: () => ReadonlySet<string> = () => new Set(),
    /**
     * The Notion client + resolved Gametracker location, needed only for the
     * one-time legacy backfill's `Match ID` query. Omit to skip the backfill
     * (e.g. in tests that don't exercise it) — every other export path works
     * without it.
     */
    private readonly legacyLookup?: { client: Client; gametrackerDatabaseId: string; dataSourceId?: string },
    /**
     * The currently-configured Gametracker database id, so ledger records can
     * be checked for database affinity: after the user switches Gametracker
     * databases, a `pageId` ledgered against the OLD database must not be
     * reused (that page lives in a database no longer configured) — it's
     * treated as not-in-the-ledger, so export creates fresh in the new
     * database and the record is re-stamped with it. Omit (e.g. in tests that
     * don't exercise database switching) to disable the affinity check
     * entirely — every ledger record matches, as before this existed.
     */
    private readonly configuredDatabaseId?: string,
  ) {}

  /**
   * Export/update each in-scope game against the ledger + signature, running
   * the one-time legacy backfill first. Per-game failures are counted, not
   * thrown.
   */
  async export(
    games: GameRecord[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<ExportResult> {
    if (this.shapeIssues && this.shapeIssues.length) {
      return { ok: 0, failed: 0, skipped: 0, error: `Database is missing: ${this.shapeIssues.join(', ')}` };
    }
    let ok = 0;
    let failed = 0;
    let skipped = 0;
    let updated = 0;
    let recreated = 0;
    // "Done" must include every outcome bucket, not just ok/failed/skipped —
    // otherwise progress stalls on an update-heavy sync (every row lands in
    // `updated`, so done never advances even though work is completing).
    const tick = () => onProgress?.(ok + failed + skipped + updated + recreated, total);

    // One-time backfill: legacy exported rows have no ledger record (only the
    // old `processed[]` marker). Resolve each one's existing page, push any
    // offline-completed review/mental into it, and adopt the ledger baseline.
    // Only ids with a matching game in the current set are actually attempted
    // (backfillLegacy needs the game) — a legacy id with no matching game is
    // skipped below without ever ticking, so it must not inflate `total`.
    // Every attempted match — backfilled or not — appears exactly once in
    // `games`, so `total` is simply `games.length`: work actually attempted,
    // matching the finding's requirement (no double-count, no phantom ids).
    const byId = new Map(games.map((g) => [g.matchId, g]));
    const legacyIds = this.outbox.legacyProcessed();
    const backfilled = new Set<string>();
    const total = games.length;

    for (const matchId of legacyIds) {
      const game = byId.get(matchId);
      if (!game) continue; // no longer in the tracked set; nothing to backfill against — not attempted, no tick
      backfilled.add(matchId);
      try {
        const outcome = await this.backfillLegacy(game);
        if (outcome === 'updated') updated++;
        else if (outcome === 'recreated') recreated++;
        else ok++;
      } catch {
        failed++;
      }
      tick();
    }

    for (const game of games) {
      // Already handled by the backfill above (and ledgered there) — re-running
      // it here would double-count the same match in both the tick total and
      // the returned buckets.
      if (backfilled.has(game.matchId)) continue;
      try {
        const grade = aggregateImprovementGrade(game.review, {
          visibleTargetIds: this.authoredTargetIds(),
          bookkeepingId: NOTION_IMPROVEMENT_TARGET_ID,
        });
        const signature = matchExportSignature(game, grade);
        const pageId = this.outbox.pageIdFor(game.matchId, this.configuredDatabaseId);

        if (pageId === undefined) {
          // Not in the ledger at all (or ledgered against a different,
          // previously-configured database) → create in the current database.
          const newPageId = await this.createPage(game, grade);
          this.outbox.recordExport(game.matchId, { pageId: newPageId, signature, databaseId: this.configuredDatabaseId });
          ok++;
        } else if (this.outbox.signatureFor(game.matchId, this.configuredDatabaseId) === signature) {
          // Ledger record, nothing changed since the last write → skip.
          skipped++;
        } else {
          // Ledger record, content changed → update in place, recreating if
          // the linked page is gone.
          const outcome = await this.updateOrRecreate(pageId, game, grade, signature);
          if (outcome === 'recreated') recreated++;
          else updated++;
        }
      } catch {
        failed++;
      }
      tick();
    }
    return { ok, failed, skipped, updated, recreated };
  }

  /** Create a new page and build its `ResolvedMatch` (shared by create + recreate). */
  private async createPage(game: GameRecord, grade: ReturnType<typeof aggregateImprovementGrade>): Promise<string> {
    const resolved = await this.resolveMatch(game, grade);
    return this.writer.createMatchPage(resolved);
  }

  /** Try `updateMatchPage`; if the linked page is gone (either error shape), recreate it. */
  private async updateOrRecreate(
    pageId: string,
    game: GameRecord,
    grade: ReturnType<typeof aggregateImprovementGrade>,
    signature: string,
  ): Promise<'updated' | 'recreated'> {
    const resolved = await this.resolveMatch(game, grade);
    try {
      await this.writer.updateMatchPage(pageId, resolved);
      this.outbox.recordExport(game.matchId, { pageId, signature, databaseId: this.configuredDatabaseId });
      return 'updated';
    } catch (err) {
      if (!(await this.isPageGone(pageId, err))) throw err;
      const newPageId = await this.writer.createMatchPage(resolved);
      this.outbox.recordExport(game.matchId, { pageId: newPageId, signature, databaseId: this.configuredDatabaseId });
      return 'recreated';
    }
  }

  /**
   * Whether an `updateMatchPage` failure means "the page is gone" (permanently
   * deleted/unshared, or archived/in-trash — see Decision A.5) rather than a
   * real failure (bad property, wrong type, etc.).
   */
  private async isPageGone(pageId: string, err: unknown): Promise<boolean> {
    if (!(err instanceof APIResponseError)) return false;
    if (err.code === APIErrorCode.ObjectNotFound) return true;
    if (err.code !== APIErrorCode.ValidationError) return false;
    // A generic validation_error is a real failure UNLESS the page turns out to
    // be archived/in-trash — the common "user deleted the row in the Notion UI"
    // case, which does not surface as object_not_found.
    if (!this.legacyLookup) return false;
    try {
      const page: any = await this.legacyLookup.client.pages.retrieve({ page_id: pageId });
      return Boolean(page?.in_trash || page?.archived);
    } catch {
      return false;
    }
  }

  /** One legacy-backfill row: resolve its existing page by `Match ID`, update or recreate + adopt the ledger baseline. */
  private async backfillLegacy(game: GameRecord): Promise<'updated' | 'recreated' | 'ok'> {
    const grade = aggregateImprovementGrade(game.review, {
      visibleTargetIds: this.authoredTargetIds(),
      bookkeepingId: NOTION_IMPROVEMENT_TARGET_ID,
    });
    const signature = matchExportSignature(game, grade);
    const foundPageId = await this.findLegacyPage(game.matchId);

    if (foundPageId) {
      // Skip the write when there's nothing to complete (empty signature) to
      // minimize outbound traffic; either way adopt the found page as the
      // ledger baseline so the query is never repeated for this match.
      if (signature !== EMPTY_EXPORT_SIGNATURE) {
        const resolved = await this.resolveMatch(game, grade);
        await this.writer.updateMatchPage(foundPageId, resolved);
      }
      this.outbox.recordExport(game.matchId, { pageId: foundPageId, signature, databaseId: this.configuredDatabaseId });
      return signature !== EMPTY_EXPORT_SIGNATURE ? 'updated' : 'ok';
    }
    // Row truly gone — recreate it.
    const newPageId = await this.createPage(game, grade);
    this.outbox.recordExport(game.matchId, { pageId: newPageId, signature, databaseId: this.configuredDatabaseId });
    return 'recreated';
  }

  /** Resolve `matchId`'s existing Notion page via a `Match ID` query, or undefined if none exists. */
  private async findLegacyPage(matchId: string): Promise<string | undefined> {
    if (!this.legacyLookup) return undefined;
    const { client, gametrackerDatabaseId, dataSourceId } = this.legacyLookup;
    const sourceId = dataSourceId ?? (await resolveDataSourceId(client, gametrackerDatabaseId));
    const res: any = await client.dataSources.query({
      data_source_id: sourceId,
      filter: { property: 'Match ID', rich_text: { equals: matchId } },
      page_size: 1,
    });
    const page = res.results?.[0];
    return page ? String(page.id) : undefined;
  }

  /** Build the `ResolvedMatch` the writer expects, shared by create/update/recreate. */
  private async resolveMatch(game: GameRecord, grade: ReturnType<typeof aggregateImprovementGrade>) {
    const map = await this.maps.resolve(game.map);
    return {
      record: gameToMatchRecord(game),
      account: game.account,
      role: game.role,
      result: game.result,
      mapPageId: map.pageId,
      mental: exportMental(game),
      improvementGrade: grade,
    };
  }
}

/**
 * The signature of a match with no grade and no mental flags — mirrors
 * `matchExportSignature`'s own encoding so the legacy backfill can skip a
 * no-op write when there is nothing to complete.
 */
const EMPTY_EXPORT_SIGNATURE = JSON.stringify({ grade: null, flags: [] });

/** Flatten a GameRecord (with per-hero rows) into the MatchRecord the writer expects. */
export function gameToMatchRecord(game: GameRecord): MatchRecord {
  const totals = (game.perHero ?? []).reduce(
    (acc, h) => ({
      eliminations: acc.eliminations + h.eliminations,
      deaths: acc.deaths + h.deaths,
      assists: acc.assists + h.assists,
      damage: acc.damage + h.damage,
      healing: acc.healing + h.healing,
      mitigation: acc.mitigation + h.mitigation,
    }),
    { eliminations: 0, deaths: 0, assists: 0, damage: 0, healing: 0, mitigation: 0 },
  );
  const hasStats = (game.perHero?.length ?? 0) > 0;
  return {
    ...emptyMatch(game.matchId),
    // The match-end time, so a `Played At`-capable database round-trips it back
    // on import instead of the row-creation time.
    endedAt: game.timestamp,
    mapName: game.map,
    outcome: resultToOutcome(game.result),
    heroRole: game.role,
    gameType: game.gameType,
    heroes: game.heroes,
    durationMinutes: game.durationMinutes,
    // Carry the round score and SR change through — both have Notion columns and
    // importer readers, so they round-trip (finalScore was silently dropped before).
    finalScore: game.finalScore,
    srDelta: game.srDelta,
    eliminations: hasStats ? totals.eliminations : undefined,
    deaths: hasStats ? totals.deaths : undefined,
    assists: hasStats ? totals.assists : undefined,
    damage: hasStats ? totals.damage : undefined,
    healing: hasStats ? totals.healing : undefined,
    mitigation: hasStats ? totals.mitigation : undefined,
  };
}

function resultToOutcome(result: Result): string {
  return result === 'Win' ? 'Victory' : result === 'Loss' ? 'Defeat' : 'Draw';
}

/**
 * The after-game self-report to export, merged from both places it can live: the
 * quick-log `mental` and the Review screen's `review.flags`. Leaver is normalised
 * to the team-specific flags (folding the legacy single flag). Undefined when the
 * player flagged nothing, so a blank match writes no subjective columns.
 */
export function exportMental(game: GameRecord): MatchMental | undefined {
  const a = game.mental;
  const b = game.review?.flags;
  if (!a && !b) return undefined;
  const leaver = mergeLeaver(leaverFlags(a), leaverFlags(b));
  const mental: MatchMental = {};
  if (a?.tilt || b?.tilt) mental.tilt = true;
  if (a?.toxicMates || b?.toxicMates) mental.toxicMates = true;
  if (a?.positiveComms || b?.positiveComms) mental.positiveComms = true;
  if (leaver.myTeam) mental.leaverMyTeam = true;
  if (leaver.enemyTeam) mental.leaverEnemyTeam = true;
  return Object.keys(mental).length ? mental : undefined;
}
