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

  constructor(private readonly deps: NotionRuntimeDeps) {}

  /** (Re)build the client stack from the saved token; safe to call anytime. */
  rebuild(): void {
    const token = getNotionToken();
    this.shapeCheck = undefined;
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
      return await importer.import();
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
    } catch (err) {
      this.shapeCheck = { valid: false, issues: [String(err)] };
    }
    this.buildExporter(this.shapeCheck.valid ? undefined : this.shapeCheck.issues);
  }

  /** (Re)wire writer + maps + exporter against the live client and config. */
  private buildExporter(shapeIssues?: string[]): MapsCache | undefined {
    if (!this.client) return undefined;
    const cfg = this.deps.config();
    const writer = new NotionWriter(this.client, cfg.notion.gametrackerDatabaseId);
    const maps = new MapsCache(this.client, cfg.notion.mapsDatabaseId, cfg.mapAliases);
    this.exporter = new NotionExporter(writer, maps, this.deps.outbox, shapeIssues);
    return maps;
  }
}
