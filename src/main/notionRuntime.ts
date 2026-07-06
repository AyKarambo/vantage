import { Client } from '@notionhq/client';
import { NotionWriter } from '../notion/notionWriter';
import { MapsCache } from '../notion/mapsCache';
import { NotionExporter } from '../notion/notionExporter';
import { NotionImporter, type ImportOutcome } from '../notion/notionImporter';
import { NotionAdmin } from '../notion/notionAdmin';
import type { OutboxStore } from '../store/outbox';
import {
  getNotionToken, setNotionToken, clearNotionToken, saveLocalNotionConfig, notionDatabaseSource,
  type AppConfig,
} from './config';
import type { GameRecord } from '../core/analytics';
import type {
  ExportResult, NotionDatabaseSummary, NotionPageSummary, NotionStatus,
} from '../shared/contract';

export interface NotionRuntimeDeps {
  outbox: OutboxStore;
  /** Live app config — re-read through this on every use, never cached. */
  config: () => AppConfig;
  /** Re-load config.local.json into the owner after this runtime persisted to it. */
  reloadConfig: () => void;
  /** Games available to push, for the status card. */
  trackedGames: () => number;
  /** How many local matches came from a Notion import (deletable for a clean re-import). */
  importedMatches: () => number;
  /** Mirror the token presence into the tray. */
  onTokenState: (tokenSet: boolean) => void;
  onError: (title: string, body: string) => void;
  /** Live per-game export progress (pushed to the sync card). */
  onSyncProgress?: (done: number, total: number) => void;
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
  // The Maps database the Gametracker's `Map` relation points at, discovered from
  // the schema — so export resolves maps even when mapsDatabaseId was never set.
  private mapsRelationDbId?: string;
  // The configured Gametracker database's validated data source id — so the writer
  // can parent new rows on it directly instead of resolving on every export.
  private gametrackerSourceId?: string;

  constructor(private readonly deps: NotionRuntimeDeps) {}

  /** (Re)build the client stack from the saved token; safe to call anytime. */
  rebuild(): void {
    const token = getNotionToken();
    this.shapeCheck = undefined;
    this.hasPlayedAt = false;
    this.hasSrDelta = false;
    this.writableColumns = new Set();
    this.mapsRelationDbId = undefined;
    this.gametrackerSourceId = undefined;
    if (!token) {
      this.client = this.exporter = this.admin = undefined;
      this.deps.onTokenState(false);
      return;
    }
    this.client = new Client({ auth: token });
    this.admin = new NotionAdmin(this.client);
    const maps = this.buildExporter();
    this.deps.onTokenState(true);
    maps?.load().catch((err) => this.deps.onError('Maps load failed', String(err)));
    void this.validateConfigured();
  }

  status(): NotionStatus {
    const { notion } = this.deps.config();
    const tokenSet = Boolean(getNotionToken());
    const databaseConfigured = Boolean(notion.gametrackerDatabaseId);
    return {
      tokenSet,
      databaseConfigured,
      connected: tokenSet && databaseConfigured && Boolean(this.exporter),
      gametrackerUrl: notion.gametrackerUrl || undefined,
      trackedGames: this.deps.trackedGames(),
      databaseSource: notionDatabaseSource(),
      databaseId: notion.gametrackerDatabaseId || undefined,
      databaseTitle: this.shapeCheck?.title,
      shapeValid: this.shapeCheck?.valid,
      shapeIssues: this.shapeCheck?.issues,
      lastSyncedAt: notion.lastSyncedAt,
      importedMatches: this.deps.importedMatches(),
    };
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
    if (!this.client || !notion.gametrackerDatabaseId) return { games: [], failed: 0, unavailable: true };
    try {
      const importer = new NotionImporter(this.client, notion.gametrackerDatabaseId, notion.mapsDatabaseId || undefined);
      const result = await importer.import();
      // Imported rows already live in Notion, so mark them exported: a later
      // "Sync to Notion" then skips them instead of writing duplicate rows back
      // into the same database (the outbox is the export dedupe key).
      this.deps.outbox.markManyProcessed(result.games.map((g) => g.matchId));
      return result;
    } catch (err) {
      return { games: [], failed: 0, error: String(err) };
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
   * The exporter is rebuilt with the found issues so a later `export()`
   * short-circuits instead of failing once per game.
   */
  private async validateConfigured(): Promise<void> {
    const { notion } = this.deps.config();
    if (!this.admin || !notion.gametrackerDatabaseId) return;
    try {
      const result = await this.admin.validate(notion.gametrackerDatabaseId, {
        requireMapRelation: Boolean(notion.mapsDatabaseId),
      });
      this.shapeCheck = { title: result.title, valid: result.ok, issues: [...result.missing, ...result.mismatched] };
      this.hasPlayedAt = result.hasPlayedAt;
      this.hasSrDelta = result.hasSrDelta;
      this.writableColumns = new Set(result.subjectiveColumns);
      this.mapsRelationDbId = result.mapRelationDbId;
      this.gametrackerSourceId = result.dataSourceId;
    } catch (err) {
      this.shapeCheck = { valid: false, issues: [String(err)] };
      this.hasPlayedAt = false;
      this.hasSrDelta = false;
      this.writableColumns = new Set();
      this.mapsRelationDbId = undefined;
      this.gametrackerSourceId = undefined;
    }
    this.buildExporter(this.shapeCheck.valid ? undefined : this.shapeCheck.issues);
  }

  /** (Re)wire writer + maps + exporter against the live client and config. */
  private buildExporter(shapeIssues?: string[]): MapsCache | undefined {
    if (!this.client) return undefined;
    const cfg = this.deps.config();
    const writer = new NotionWriter(
      this.client, cfg.notion.gametrackerDatabaseId, this.hasPlayedAt, this.writableColumns, this.hasSrDelta,
      this.gametrackerSourceId,
    );
    // Prefer an explicitly configured Maps database, else the one discovered off
    // the Gametracker's `Map` relation — so maps resolve even when the user only
    // ever picked their Gametracker database (mapsDatabaseId left blank).
    const mapsDbId = cfg.notion.mapsDatabaseId || this.mapsRelationDbId || '';
    const maps = new MapsCache(this.client, mapsDbId, cfg.mapAliases);
    this.exporter = new NotionExporter(writer, maps, this.deps.outbox, shapeIssues);
    return maps;
  }
}
