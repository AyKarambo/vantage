import { APIResponseError, APIErrorCode, Client } from '@notionhq/client';
import { emptyMatch, type MatchRecord, type Result } from '../core/model';
import type { GameRecord, MatchMental } from '../core/analytics';
import { leaverFlags, mergeLeaver } from '../core/leaver';
import { commsTone } from '../core/comms';
import { aggregateImprovementGrade, matchExportSignature, effectiveImprovementGrade, DEFAULT_PARTIAL_MARGIN, type AuthoredTarget } from '../core/targets';
import { NotionWriter } from './notionWriter';
import { classifyNetworkError, friendlyNetworkMessage } from '../core/netError';
import { queryAllPages, queryDataSourcePages } from './pageScan';
import { groupByEffectiveMatchId, pickCanonicalRow, rowRefOf, type RowRef } from './dedup';
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
 * Notion page against the lazy existing-rows index (`existingRowsIndex`).
 *
 * Never blind-creates for a match with no ledger record: both the ordinary
 * create path and the legacy backfill first consult that index (one lazy
 * paged scan of the configured database per `export()` call, built only when
 * the first unledgered match needs it) so a hand-added or ledger-lost row
 * already sitting in Notion is adopted instead of duplicated
 * (`specs/notion-sync-dedup.spec.md`).
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
     * The Notion client + resolved Gametracker location, needed for the
     * legacy backfill AND the create-guard's existing-rows index (both resolve
     * hand-added/id-less rows the same way — see {@link existingRowsIndex}).
     * Omit to skip both (e.g. minimal tests that don't exercise them): the
     * backfill no-ops and the create-guard degrades to today's blind create —
     * every other export path works without it. The real runtime always
     * supplies this.
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
    /**
     * Getter for the user's visible authored targets WITH their rules, so
     * measured (⚡) targets can be auto-graded from each match's stats and folded
     * into the exported Improvement Target grade (via `effectiveImprovementGrade`).
     * Re-read on every `export()` call, never cached. Defaults to none, so callers
     * that don't thread targets keep today's self-rated-only behavior.
     */
    private readonly authoredTargets: () => readonly AuthoredTarget[] = () => [],
    /**
     * The user's partial-credit margin, so a measured target's exported grade
     * matches the in-app one (measured.ts's single-evaluator invariant). Re-read
     * per export; defaults to {@link DEFAULT_PARTIAL_MARGIN}.
     */
    private readonly authoredPartialMargin: () => number = () => DEFAULT_PARTIAL_MARGIN,
    /**
     * Set when the database's shape could not be VERIFIED at all (the validate
     * request never reached Notion), as opposed to being verified and found wrong.
     * Short-circuits the export with this reason verbatim.
     *
     * Not the same failure as `shapeIssues`, and deliberately not folded into it:
     * the writer's capabilities (`Played At`, `SR Delta`, the Map relation, the
     * subjective columns) are only ever learned from a validate that SUCCEEDS.
     * Exporting without them writes rows missing those fields — and the exporter
     * then ledgers those rows, so every later sync skips them and Notion keeps the
     * damaged data forever. Refusing to export is recoverable; a lossy write isn't.
     *
     * (Last in the list purely so the existing positional call sites keep their
     * meaning — this is semantically `shapeIssues`' sibling.)
     */
    private readonly unavailableReason?: string,
  ) {}

  /**
   * Lazy existing-rows index (`effectiveMatchId → RowRef[]`), built at most
   * once per {@link export} call — reset to `undefined` at the top of every
   * `export()` so a later call on the same exporter instance re-scans rather
   * than serving a stale result. Within one call, the promise itself is
   * cached (not just its result) so concurrent/subsequent lookups reuse the
   * single in-flight scan instead of racing a second one — the paged scan
   * runs exactly once even across many unledgered games in one sync.
   */
  private existingRowsIndexPromise?: Promise<Map<string, RowRef[]>>;

  /**
   * Build (once) the existing-rows index the create-guard and legacy backfill
   * both resolve against: every row of the configured Gametracker database,
   * projected via `rowRefOf` and grouped by `effectiveMatchId` — so a hand-
   * added row with an empty `Match ID` cell is still found, keyed by the same
   * derived id the importer would generate for it. Requires `legacyLookup`
   * (the caller's contract: absent → this is never called, see
   * {@link lookupExistingRow}). Prefers `legacyLookup.dataSourceId` when
   * supplied (already resolved by the runtime — pages directly via
   * `queryDataSourcePages`, no redundant resolve round trip); falls back to
   * `queryAllPages`, which resolves `gametrackerDatabaseId` itself.
   */
  private existingRowsIndex(): Promise<Map<string, RowRef[]>> {
    if (!this.existingRowsIndexPromise) {
      this.existingRowsIndexPromise = (async () => {
        const { client, gametrackerDatabaseId, dataSourceId } = this.legacyLookup!;
        const pages = dataSourceId
          ? await queryDataSourcePages(client, dataSourceId)
          : await queryAllPages(client, gametrackerDatabaseId);
        return groupByEffectiveMatchId(pages.map(rowRefOf));
      })();
    }
    return this.existingRowsIndexPromise;
  }

  /**
   * Resolve `matchId` against the existing-rows index, building it on first
   * use. `undefined` when `legacyLookup` is absent (the guard is skipped
   * entirely — today's blind create; documented on the constructor) so a
   * caller never needs to distinguish "no lookup available" from "index says
   * not found". Multi-row groups (duplicates already in Notion) resolve to
   * the canonical row via `pickCanonicalRow`; this method does not favor a
   * ledgered page id, since a match reaching this lookup has none.
   */
  private async lookupExistingRow(matchId: string): Promise<{ pageId: string; hadMatchIdText: boolean } | undefined> {
    if (!this.legacyLookup) return undefined;
    const index = await this.existingRowsIndex();
    const rows = index.get(matchId);
    if (!rows || rows.length === 0) return undefined;
    const canonical = pickCanonicalRow(rows, { ledgeredPageId: undefined });
    return { pageId: canonical.pageId, hadMatchIdText: Boolean(canonical.matchIdText) };
  }

  /**
   * Export/update each in-scope game against the ledger + signature, running
   * the one-time legacy backfill first. Per-game failures are counted, not
   * thrown.
   */
  async export(
    games: GameRecord[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<ExportResult> {
    // Couldn't verify the shape at all — refuse rather than write rows whose
    // missing columns we'd never notice and could never re-fill (see the
    // constructor doc for why this is not the same as a shape mismatch).
    if (this.unavailableReason) {
      return { ok: 0, failed: 0, skipped: 0, unavailable: true, error: this.unavailableReason };
    }
    if (this.shapeIssues && this.shapeIssues.length) {
      return { ok: 0, failed: 0, skipped: 0, error: `Database is missing: ${this.shapeIssues.join(', ')}` };
    }
    // The existing-rows index is scoped to THIS export() call, not the exporter
    // instance's lifetime — a later call must re-scan (Notion may have changed
    // since, e.g. a row created by the previous call) rather than serve stale
    // results from a promise cached across calls.
    this.existingRowsIndexPromise = undefined;
    let ok = 0;
    let failed = 0;
    let skipped = 0;
    let updated = 0;
    let recreated = 0;
    // The FIRST per-game failure's classified, friendly reason (never
    // `String(err)`) — a total outage must not report "0 synced, 12 failed"
    // with no explanation. Captured once (not once per failure): the loop
    // keeps counting every subsequent failure, it just doesn't keep
    // overwriting the reason with the same (or a noisier) one.
    let firstError: string | undefined;
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
      } catch (err) {
        failed++;
        if (firstError === undefined) firstError = friendlyNetworkMessage(classifyNetworkError(err), 'sync to Notion');
      }
      tick();
    }

    for (const game of games) {
      // Already handled by the backfill above (and ledgered there) — re-running
      // it here would double-count the same match in both the tick total and
      // the returned buckets.
      if (backfilled.has(game.matchId)) continue;
      try {
        const grade = effectiveImprovementGrade(game, this.authoredTargets(), this.authoredTargetIds(), this.authoredPartialMargin());
        const signature = matchExportSignature(game, grade);
        const pageId = this.outbox.pageIdFor(game.matchId, this.configuredDatabaseId);

        if (pageId === undefined) {
          // Not in the ledger at all (or ledgered against a different,
          // previously-configured database). Before blind-creating, consult
          // the existing-rows index — a hand-added or ledger-lost row may
          // already be sitting in the configured database (AC4/AC5). A
          // duplicate is worse than a retryable failure: if the scan itself
          // throws, this `try` propagates it to the per-game `catch` below
          // (→ failed++) rather than falling back to create.
          const found = await this.lookupExistingRow(game.matchId);
          if (found) {
            const outcome = await this.adoptExistingRow(found, game, grade, signature);
            if (outcome === 'recreated') recreated++;
            else if (outcome === 'updated') updated++;
            else ok++;
          } else {
            const newPageId = await this.createPage(game, grade);
            this.outbox.recordExport(game.matchId, { pageId: newPageId, signature, databaseId: this.configuredDatabaseId });
            ok++;
          }
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
      } catch (err) {
        failed++;
        if (firstError === undefined) firstError = friendlyNetworkMessage(classifyNetworkError(err), 'sync to Notion');
      }
      tick();
    }
    return { ok, failed, skipped, updated, recreated, error: firstError };
  }

  /** Create a new page and build its `ResolvedMatch` (shared by create + recreate). */
  private async createPage(game: GameRecord, grade: ReturnType<typeof aggregateImprovementGrade>): Promise<string> {
    const resolved = await this.resolveMatch(game, grade);
    return this.writer.createMatchPage(resolved);
  }

  /**
   * Try `updateMatchPage`; if the linked page is gone (either error shape), recreate it.
   * `opts.stampMatchId` threads through to `updateMatchPage` — set when adopting a
   * found row (create-guard or legacy backfill) whose `Match ID` cell was empty, so
   * the adoption heals the row instead of leaving it id-less for the next scan.
   */
  private async updateOrRecreate(
    pageId: string,
    game: GameRecord,
    grade: ReturnType<typeof aggregateImprovementGrade>,
    signature: string,
    opts?: { stampMatchId?: boolean },
  ): Promise<'updated' | 'recreated'> {
    const resolved = await this.resolveMatch(game, grade);
    try {
      // Pass `opts` only when actually set — keeps the ordinary (non-adopting)
      // update call a plain 2-arg call, matching `updateMatchPage`'s contract
      // that `stampMatchId` is opt-in, not a third positional always sent.
      if (opts) await this.writer.updateMatchPage(pageId, resolved, opts);
      else await this.writer.updateMatchPage(pageId, resolved);
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

  /**
   * One legacy-backfill row: resolve its existing page via the same
   * existing-rows index the create-guard uses (so a hand-added row with an
   * empty `Match ID` cell is found by its derived id, fixing the reported
   * duplicate bug — AC3), update or recreate + adopt the ledger baseline.
   */
  private async backfillLegacy(game: GameRecord): Promise<'updated' | 'recreated' | 'ok'> {
    const grade = effectiveImprovementGrade(game, this.authoredTargets(), this.authoredTargetIds(), this.authoredPartialMargin());
    const signature = matchExportSignature(game, grade);
    const found = await this.lookupExistingRow(game.matchId);

    if (found) return this.adoptExistingRow(found, game, grade, signature);
    // Row truly gone — recreate it.
    const newPageId = await this.createPage(game, grade);
    this.outbox.recordExport(game.matchId, { pageId: newPageId, signature, databaseId: this.configuredDatabaseId });
    return 'recreated';
  }

  /**
   * Adopt a row the existing-rows index resolved for an unledgered match —
   * shared by the create-guard and the legacy backfill so the two paths can
   * never diverge on write semantics. With an EMPTY signature there is nothing
   * to push, and `updateMatchPage`'s forUpdate contract would actively BLANK
   * the row's subjective cells (`select: null` / `checkbox: false`) — on a
   * hand-added row those cells are the user's hand-authored data and the blank
   * is not trash-recoverable. So the empty-signature adopt only stamps the
   * `Match ID` cell (when it was empty) and records the ledger baseline
   * (→ 'ok'); only a non-empty signature performs the full update.
   */
  private async adoptExistingRow(
    found: { pageId: string; hadMatchIdText: boolean },
    game: GameRecord,
    grade: ReturnType<typeof aggregateImprovementGrade>,
    signature: string,
  ): Promise<'updated' | 'recreated' | 'ok'> {
    if (signature === EMPTY_EXPORT_SIGNATURE) {
      if (!found.hadMatchIdText) await this.writer.stampMatchId(found.pageId, game.matchId);
      this.outbox.recordExport(game.matchId, { pageId: found.pageId, signature, databaseId: this.configuredDatabaseId });
      return 'ok';
    }
    return this.updateOrRecreate(found.pageId, game, grade, signature, {
      stampMatchId: !found.hadMatchIdText,
    });
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
  const tone = commsTone(a) ?? commsTone(b);
  if (tone) mental.comms = tone;
  if (leaver.myTeam) mental.leaverMyTeam = true;
  if (leaver.enemyTeam) mental.leaverEnemyTeam = true;
  return Object.keys(mental).length ? mental : undefined;
}
