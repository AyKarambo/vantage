import { Client } from '@notionhq/client';
import { NotionWriter } from '../notion/notionWriter';
import { MapsCache } from '../notion/mapsCache';
import { NotionExporter } from '../notion/notionExporter';
import { NotionImporter, type ImportOutcome } from '../notion/notionImporter';
import { NotionAdmin } from '../notion/notionAdmin';
import { queryAllPages, queryDataSourcePages } from '../notion/pageScan';
import { groupByEffectiveMatchId, pickCanonicalRow, rowRefOf } from '../notion/dedup';
import type { OutboxStore } from '../store/outbox';
import {
  getNotionToken, setNotionToken, clearNotionToken, saveLocalNotionConfig, notionDatabaseSource,
  type AppConfig,
} from './config';
import type { GameRecord } from '../core/analytics';
import {
  matchExportSignature, effectiveImprovementGrade, countUnsyncedGames, countCompetitiveGames,
  type AuthoredTarget,
} from '../core/targets';
import type {
  CleanupDuplicatesResult, ExportResult, NotionDatabaseSummary, NotionPageSummary, NotionStatus,
  SchemaProvisionStatus, SubjectiveColumnDiag,
} from '../shared/contract';

/**
 * The Notion API version every request pins (the `Notion-Version` header).
 * 2026-03-11 is the latest per developers.notion.com/reference/versioning;
 * SDK 5.12+ supports it but still DEFAULTS to 2025-09-03, so it must be opted
 * into explicitly. Safe for Vantage's surface: the 2026-03-11 breaking changes
 * (archived→in_trash, block `after`→`position`, transcription→meeting_notes)
 * touch fields/endpoints this app never reads or calls.
 */
const NOTION_API_VERSION = '2026-03-11';

export interface NotionRuntimeDeps {
  outbox: OutboxStore;
  /** Live app config — re-read through this on every use, never cached. */
  config: () => AppConfig;
  /** Re-load config.local.json into the owner after this runtime persisted to it. */
  reloadConfig: () => void;
  /**
   * The UNFILTERED local history, so the status card can count competitive games
   * that still need syncing (never-exported OR changed-since-export) against the
   * configured database, ignoring dashboard filters (spec E3). Non-competitive
   * rows are filtered out inside the count helper.
   */
  historyGames: () => GameRecord[];
  /** How many local matches came from a Notion import (deletable for a clean re-import). */
  importedMatches: () => number;
  /** Mirror the token presence into the tray. */
  onTokenState: (tokenSet: boolean) => void;
  onError: (title: string, body: string) => void;
  /** Live per-game export progress (pushed to the sync card). */
  onSyncProgress?: (done: number, total: number) => void;
  /**
   * Ids of the user's visible, in-app authored targets — so the exporter's
   * aggregate-grade rule (A.4) can tell them apart from the hidden Notion
   * bookkeeping id. Re-read live on every export, never cached. Defaults to
   * an empty set so callers that don't yet wire targets still compile.
   */
  authoredTargetIds?: () => ReadonlySet<string>;
  /**
   * The same visible authored targets WITH their rules, so measured (⚡) targets
   * can be auto-graded from each match's stats and folded into the exported
   * Improvement Target grade. Re-read live per export; defaults to none.
   */
  authoredTargets?: () => readonly AuthoredTarget[];
  /**
   * The effective map names (active + inactive) to seed a freshly auto-created
   * Maps database with, so historical matches on any map still relate to a page
   * (spec AC 32). Defaults to the built-in table when unset.
   */
  mapNames?: () => readonly string[];
}

/**
 * Everything Notion in the main process: the client/exporter/admin lifecycle,
 * the cached shape-validation of the configured database, and the provider
 * operations behind the Notion screen (status · token · picker · auto-create).
 * Owns no persistence of its own — config edges live in ./config, export
 * dedupe in the outbox store.
 */
export class NotionRuntime {
  private client?: Client;
  private exporter?: NotionExporter;
  private admin?: NotionAdmin;
  // Cached async validation of the configured database's shape; undefined =
  // not yet checked (or nothing to check).
  private shapeCheck?: { title?: string; valid: boolean; issues: string[] };
  // Whether the configured database has the optional `Played At` date column, so
  // the writer may set it. Off until validation confirms it — writing a column
  // the database lacks would fail every export row.
  private hasPlayedAt = false;
  // Whether the configured database has the optional `SR Delta` number column, so
  // the writer may set the signed competitive SR change. Same guard as hasPlayedAt.
  private hasSrDelta = false;
  // Subjective columns the configured database defines (Comms, Improvement Target,
  // Leaver, …), so the writer may set them. Same presence guard as hasPlayedAt.
  private writableColumns: ReadonlySet<string> = new Set();
  // The select option names each subjective select column defines (from validate),
  // so the writer can write the database's own "none"-like option for an unset
  // Comms / Improvement Target instead of leaving it blank (spec E2).
  private subjectiveSelectOptions: Record<string, string[]> = {};
  // Per-column schema diagnostics for the 5 optional subjective columns (A.7),
  // cached from the last `validate()` so `status()` can surface them without
  // re-checking the network. Undefined = not yet validated (or nothing configured).
  private subjectiveDiagnostics?: SubjectiveColumnDiag[];
  // The Maps database the Gametracker's `Map` relation points at, discovered from
  // the schema — so export resolves maps even when mapsDatabaseId was never set.
  private mapsRelationDbId?: string;
  // The configured Gametracker database's validated data source id — so the writer
  // can parent new rows on it directly instead of resolving on every export.
  private gametrackerSourceId?: string;
  // Outcome of the last validate's schema auto-provisioning pass (columns Vantage
  // created to keep the database in step, or a provisioning error) — cached so
  // `status()` can surface it. Undefined = nothing created and nothing failed.
  private schemaProvision?: SchemaProvisionStatus;

  constructor(private readonly deps: NotionRuntimeDeps) {}

  /** (Re)build the client stack from the saved token; safe to call anytime. */
  rebuild(): void {
    const token = getNotionToken();
    this.shapeCheck = undefined;
    this.hasPlayedAt = false;
    this.hasSrDelta = false;
    this.writableColumns = new Set();
    this.subjectiveSelectOptions = {};
    this.subjectiveDiagnostics = undefined;
    this.mapsRelationDbId = undefined;
    this.gametrackerSourceId = undefined;
    this.schemaProvision = undefined;
    if (!token) {
      this.client = this.exporter = this.admin = undefined;
      this.deps.onTokenState(false);
      return;
    }
    this.client = new Client({ auth: token, notionVersion: NOTION_API_VERSION });
    this.admin = new NotionAdmin(this.client, this.deps.mapNames?.());
    const maps = this.buildExporter();
    this.deps.onTokenState(true);
    maps?.load().catch((err) => this.deps.onError('Maps load failed', String(err)));
    void this.validateConfigured();
  }

  status(): NotionStatus {
    const { notion } = this.deps.config();
    const tokenSet = Boolean(getNotionToken());
    const databaseConfigured = Boolean(notion.gametrackerDatabaseId);
    const games = this.deps.historyGames();
    return {
      tokenSet,
      databaseConfigured,
      connected: tokenSet && databaseConfigured && Boolean(this.exporter),
      gametrackerUrl: notion.gametrackerUrl || undefined,
      unsyncedGames: this.unsyncedCount(games, notion.gametrackerDatabaseId || undefined),
      competitiveGames: countCompetitiveGames(games),
      databaseSource: notionDatabaseSource(),
      databaseId: notion.gametrackerDatabaseId || undefined,
      databaseTitle: this.shapeCheck?.title,
      shapeValid: this.shapeCheck?.valid,
      shapeIssues: this.shapeCheck?.issues,
      lastSyncedAt: notion.lastSyncedAt,
      importedMatches: this.deps.importedMatches(),
      subjectiveColumns: this.subjectiveDiagnostics,
      schemaProvision: this.schemaProvision,
    };
  }

  /**
   * How many competitive games still need syncing to the configured database:
   * never-exported OR changed-since-export, using the SAME signature + ledger the
   * exporter does so the count and a real sync agree (spec E3). Uses the live
   * authored targets/ids (re-read here, never cached) so a measured grade folds
   * into the signature identically to `export()`. `0` when no database is
   * configured — there is no ledger to diff against, and the sync UI is gated on
   * `connected` anyway.
   */
  private unsyncedCount(games: GameRecord[], databaseId: string | undefined): number {
    if (!databaseId) return 0;
    const authoredTargets = this.deps.authoredTargets?.() ?? [];
    const authoredTargetIds = this.deps.authoredTargetIds?.() ?? new Set<string>();
    return countUnsyncedGames(
      games,
      (g) => matchExportSignature(g, effectiveImprovementGrade(g, authoredTargets, authoredTargetIds)),
      (matchId) => ({
        pageId: this.deps.outbox.pageIdFor(matchId, databaseId),
        signature: this.deps.outbox.signatureFor(matchId, databaseId),
      }),
    );
  }

  async export(games: GameRecord[]): Promise<ExportResult> {
    if (!this.exporter) return { ok: 0, failed: 0, unavailable: true };
    const result = await this.exporter.export(games, this.deps.onSyncProgress);
    if (!result.error) {
      saveLocalNotionConfig({ lastSyncedAt: Date.now() });
      this.deps.reloadConfig();
    }
    return result;
  }

  /**
   * Pull rows from the configured Gametracker database back into local records
   * (the inverse of export). Returns the mapped games for the caller to
   * de-duplicate + persist; `unavailable` when there's no client/database.
   */
  async import(): Promise<ImportOutcome & { unavailable?: boolean; error?: string }> {
    const { notion } = this.deps.config();
    if (!this.client || !notion.gametrackerDatabaseId) return { games: [], failed: 0, duplicates: 0, unavailable: true };
    try {
      const importer = new NotionImporter(
        this.client, notion.gametrackerDatabaseId, notion.mapsDatabaseId || undefined,
        // Ledger preference for canonical-row selection (`pickCanonicalRow`'s
        // second precedence tier): what the local ledger already points at for
        // this match id, in the currently-configured database — so a group
        // whose embedded-id rule can't resolve it still prefers the row
        // Vantage already knows about over an arbitrary earliest-created pick.
        (matchId) => this.deps.outbox.pageIdFor(matchId, notion.gametrackerDatabaseId),
      );
      const result = await importer.import();
      // Imported rows already live in Notion, so ledger them as exported with the
      // signature the exporter would compute: the next "Sync to Notion" skips them
      // unless their local content changes, in which case it updates in place.
      const authoredTargetIds = this.deps.authoredTargetIds?.() ?? new Set<string>();
      const authoredTargets = this.deps.authoredTargets?.() ?? [];
      for (const g of result.games) {
        // Fold measured grades in exactly as the exporter does, so the ledger
        // baseline signature matches what the next export computes (no spurious
        // first-sync update).
        const grade = effectiveImprovementGrade(g, authoredTargets, authoredTargetIds);
        this.deps.outbox.recordImported(g.matchId, {
          pageId: g.pageId,
          signature: matchExportSignature(g, grade),
          databaseId: notion.gametrackerDatabaseId,
        });
      }
      return result;
    } catch (err) {
      return { games: [], failed: 0, duplicates: 0, error: String(err) };
    }
  }

  /**
   * Opt-in duplicate cleanup (AC9–AC11): re-scans the configured database at
   * ACTION TIME (never from stale import state — Notion may have changed
   * since the last import/export), groups rows by effective match id, and for
   * every group with more than one row keeps the canonical row
   * (`pickCanonicalRow`, preferring whatever the ledger already points at)
   * while archiving the rest to Notion trash (`in_trash: true` —
   * restorable ~30 days, never a hard delete).
   *
   * Per-row isolated: one group's archive failure is counted in `failed` and
   * does not stop the remaining groups from being processed (AC11). Stamping
   * the canonical row's `Match ID` (when it lacks one) and re-pointing the
   * ledger at it are both best-effort follow-ups to a successful group —
   * neither failure is counted, mirroring the importer's write-back and the
   * exporter's adoption stamp.
   *
   * Never called from `import()` or `export()` — archiving only ever happens
   * here, behind the caller's explicit confirm (AC10).
   */
  async cleanupDuplicates(): Promise<CleanupDuplicatesResult> {
    const { notion } = this.deps.config();
    if (!this.client || !notion.gametrackerDatabaseId) {
      return { archived: 0, kept: 0, failed: 0, unavailable: true };
    }
    const client = this.client;
    const databaseId = notion.gametrackerDatabaseId;
    try {
      // Prefer the already-resolved data source id from the last validate()
      // (paging directly, no redundant `databases.retrieve`); fall back to
      // `queryAllPages`, which resolves `databaseId` itself.
      const pages = this.gametrackerSourceId
        ? await queryDataSourcePages(client, this.gametrackerSourceId)
        : await queryAllPages(client, databaseId);
      const groups = groupByEffectiveMatchId(pages.map(rowRefOf));

      let archived = 0;
      let kept = 0;
      let failed = 0;
      for (const [effectiveId, rows] of groups) {
        if (rows.length <= 1) continue; // no duplicate — nothing to clean up
        kept++;
        const canonical = pickCanonicalRow(rows, {
          ledgeredPageId: this.deps.outbox.pageIdFor(effectiveId, databaseId),
        });
        for (const row of rows) {
          if (row.pageId === canonical.pageId) continue;
          try {
            await client.pages.update({ page_id: row.pageId, in_trash: true } as any);
            archived++;
          } catch {
            // Per-row isolation (AC11): this group's other duplicates and every
            // other group still get processed; only this archive is lost.
            failed++;
          }
        }
        if (!canonical.matchIdText) {
          try {
            await client.pages.update({
              page_id: canonical.pageId,
              properties: { 'Match ID': { rich_text: [{ text: { content: effectiveId } }] } },
            } as any);
          } catch {
            // Best-effort, same as the importer's write-back — never counted.
          }
        }
        try {
          this.deps.outbox.repointExport(effectiveId, { pageId: canonical.pageId, databaseId });
        } catch {
          // Best-effort like the stamp above: a ledger-write failure (disk
          // full, file lock) must not abort the remaining groups or discard
          // this run's real archive counts — the export create-guard re-adopts
          // the canonical row if the ledger stays stale.
        }
      }
      return { archived, kept, failed };
    } catch (err) {
      return { archived: 0, kept: 0, failed: 0, error: String(err) };
    }
  }

  setToken(token: string): NotionStatus {
    setNotionToken(token);
    this.rebuild();
    return this.status();
  }

  clearToken(): NotionStatus {
    clearNotionToken();
    this.rebuild();
    return this.status();
  }

  async listDatabases(): Promise<{ databases: NotionDatabaseSummary[]; error?: string }> {
    if (!this.admin) return { databases: [], error: 'Connect Notion first.' };
    try {
      return { databases: await this.admin.listDatabases() };
    } catch (err) {
      return { databases: [], error: String(err) };
    }
  }

  async listPages(): Promise<{ pages: NotionPageSummary[]; error?: string }> {
    if (!this.admin) return { pages: [], error: 'Connect Notion first.' };
    try {
      return { pages: await this.admin.listParentPages() };
    } catch (err) {
      return { pages: [], error: String(err) };
    }
  }

  async selectDatabase(databaseId: string): Promise<NotionStatus> {
    const found = this.admin
      ? (await this.admin.listDatabases()).find((d) => d.id === databaseId)
      : undefined;
    return this.adopt({ gametrackerDatabaseId: databaseId, gametrackerUrl: found?.url ?? '' });
  }

  async createDatabase(parentPageId: string): Promise<NotionStatus> {
    if (!this.admin) return this.status();
    const created = await this.admin.createGametracker(parentPageId);
    return this.adopt({
      gametrackerDatabaseId: created.gametrackerDatabaseId,
      gametrackerUrl: created.gametrackerUrl,
      mapsDatabaseId: created.mapsDatabaseId,
    });
  }

  /** Persist a database choice, reload config, and re-validate against it. */
  private async adopt(patch: Parameters<typeof saveLocalNotionConfig>[0]): Promise<NotionStatus> {
    saveLocalNotionConfig(patch);
    this.deps.reloadConfig();
    this.rebuild();
    await this.validateConfigured();
    return this.status();
  }

  /**
   * Async shape validation of the configured database, cached for `status()`.
   * Self-heals the schema first: any Vantage-owned column the database is missing
   * is created in place (additively), then the database is re-validated ONCE so a
   * freshly-created column flips into the writer's capabilities and is written in
   * this same session's sync. The exporter is (re)built with the found issues so a
   * later `export()` short-circuits instead of failing once per game.
   */
  private async validateConfigured(): Promise<void> {
    const { notion } = this.deps.config();
    if (!this.admin || !notion.gametrackerDatabaseId) return;
    const opts = { requireMapRelation: Boolean(notion.mapsDatabaseId) };
    try {
      let result = await this.admin.validate(notion.gametrackerDatabaseId, opts);
      // Provision the columns Vantage owns and expects but the database lacks,
      // then re-validate so they land in `writableColumns`/`hasPlayedAt`/`hasSrDelta`
      // for this session. Additive only; wrong-type/near-miss columns stay in
      // `blocked` and are never touched. Bounded to one attempt + one re-validate.
      // Best-effort: a failure (e.g. a token without schema-edit permission) is
      // surfaced in `schemaProvision.error` and the export still runs for the
      // columns that already exist (a still-missing required column keeps the
      // "Database is missing" short-circuit below — no crash, no partial write).
      const { toCreate } = result.provisionPlan;
      if (result.dataSourceId && Object.keys(toCreate).length) {
        try {
          const created = await this.admin.ensureColumns(result.dataSourceId, toCreate);
          result = await this.admin.validate(notion.gametrackerDatabaseId, opts);
          this.schemaProvision = created.length ? { created } : undefined;
        } catch (err) {
          this.schemaProvision = { created: [], error: String(err) };
        }
      } else {
        this.schemaProvision = undefined;
      }
      this.shapeCheck = { title: result.title, valid: result.ok, issues: [...result.missing, ...result.mismatched] };
      this.hasPlayedAt = result.hasPlayedAt;
      this.hasSrDelta = result.hasSrDelta;
      this.writableColumns = new Set(result.subjectiveColumns);
      this.subjectiveSelectOptions = result.subjectiveSelectOptions;
      this.subjectiveDiagnostics = result.subjectiveColumnDiagnostics;
      this.mapsRelationDbId = result.mapRelationDbId;
      this.gametrackerSourceId = result.dataSourceId;
    } catch (err) {
      this.shapeCheck = { valid: false, issues: [String(err)] };
      this.hasPlayedAt = false;
      this.hasSrDelta = false;
      this.writableColumns = new Set();
      this.subjectiveSelectOptions = {};
      this.subjectiveDiagnostics = undefined;
      this.mapsRelationDbId = undefined;
      this.gametrackerSourceId = undefined;
      this.schemaProvision = undefined;
    }
    this.buildExporter(this.shapeCheck.valid ? undefined : this.shapeCheck.issues);
  }

  /** (Re)wire writer + maps + exporter against the live client and config. */
  private buildExporter(shapeIssues?: string[]): MapsCache | undefined {
    if (!this.client) return undefined;
    const cfg = this.deps.config();
    const writer = new NotionWriter(
      this.client, cfg.notion.gametrackerDatabaseId, this.hasPlayedAt, this.writableColumns, this.hasSrDelta,
      this.gametrackerSourceId, this.subjectiveSelectOptions,
    );
    // Prefer an explicitly configured Maps database, else the one discovered off
    // the Gametracker's `Map` relation — so maps resolve even when the user only
    // ever picked their Gametracker database (mapsDatabaseId left blank).
    const mapsDbId = cfg.notion.mapsDatabaseId || this.mapsRelationDbId || '';
    const maps = new MapsCache(this.client, mapsDbId, cfg.mapAliases);
    // Pass the getter itself (not a snapshot) — the exporter re-reads it on every
    // export() call so a target authored after rebuild/validate is still visible.
    const authoredTargetIds = () => this.deps.authoredTargetIds?.() ?? new Set<string>();
    const authoredTargets = () => this.deps.authoredTargets?.() ?? [];
    this.exporter = new NotionExporter(
      writer, maps, this.deps.outbox, shapeIssues, authoredTargetIds,
      cfg.notion.gametrackerDatabaseId
        ? { client: this.client, gametrackerDatabaseId: cfg.notion.gametrackerDatabaseId, dataSourceId: this.gametrackerSourceId }
        : undefined,
      cfg.notion.gametrackerDatabaseId || undefined,
      authoredTargets,
    );
    return maps;
  }

  /**
   * Drop the ledger record for each matchId — the wiring behind
   * `deleteImportedMatches` (Decision A.2's "cleared by deleteImportedMatches"
   * invariant): once a locally-imported match is deleted, its export/import
   * ledger entry must go with it so a later re-import or re-export starts fresh
   * instead of skipping (stale signature) or updating a page that no longer
   * corresponds to any local match.
   */
  clearExports(matchIds: string[]): void {
    for (const id of matchIds) this.deps.outbox.clearExport(id);
  }
}
