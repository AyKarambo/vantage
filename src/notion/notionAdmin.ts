import { Client } from '@notionhq/client';
import { MAP_MODES } from '../core/maps';
import {
  buildGametrackerProperties, diagnoseSubjectiveColumns, hasPlayedAtColumn, hasSrDeltaColumn,
  mapRelationSourceId, planColumnProvision, presentSubjectiveColumns, validateGametrackerShape,
  type ColumnProvisionPlan, type ShapeValidation,
} from './gametrackerSchema';
import type { NotionDatabaseSummary, NotionPageSummary, SubjectiveColumnDiag } from '../shared/contract';
export type { NotionDatabaseSummary, NotionPageSummary };

/** Result of `createGametracker` — ids/urls for the two databases it provisions. */
export interface CreateGametrackerResult {
  gametrackerDatabaseId: string;
  gametrackerUrl?: string;
  mapsDatabaseId: string;
  mapsUrl?: string;
}

/** Shape-check verdict for an existing database, plus its title for display in the picker. */
export interface ValidateResult extends ShapeValidation {
  title?: string;
  /** Whether the database carries the optional `Played At` date column, so the writer may set it. */
  hasPlayedAt: boolean;
  /** Whether the database carries the optional `SR Delta` number column, so the writer may set it. */
  hasSrDelta: boolean;
  /** Subjective columns present on the database, so the writer may set them (Comms, Leaver, …). */
  subjectiveColumns: string[];
  /** Per-column schema diagnostics for all 5 optional subjective columns (available/wrong-type/near-miss/missing). */
  subjectiveColumnDiagnostics: SubjectiveColumnDiag[];
  /** The database the `Map` relation points at — lets the exporter resolve maps without a configured mapsDatabaseId. */
  mapRelationDbId?: string;
  /** The validated database's first data source id, so the writer can parent new rows on it directly. */
  dataSourceId?: string;
  /**
   * The Vantage-owned columns missing from (→ `toCreate`) or conflicting with
   * (→ `blocked`) the live schema, from {@link planColumnProvision}. The runtime
   * feeds `toCreate` to {@link NotionAdmin.ensureColumns} to self-heal the schema
   * on validate; `blocked` (wrong-type/near-miss) is surfaced, never created over.
   */
  provisionPlan: ColumnProvisionPlan;
}

/**
 * Workspace-admin operations against the Notion API: listing what the
 * integration can see, auto-creating a correctly-shaped Gametracker (+ Maps)
 * database pair, and validating an existing database's shape. Mirrors
 * `MapsCache`'s constructor-injected `Client` so it's unit-testable with a
 * mock (see `test/notionAdmin.test.ts`) without ever touching the network.
 */
export class NotionAdmin {
  /**
   * `mapNames` is the effective map catalog to seed the Maps DB with — ALL maps,
   * active and inactive (spec AC 32), so historical matches on a now-inactive map
   * still relate to a Maps page. Defaults to the built-in table for callers (and
   * tests) that don't inject effective master data.
   */
  constructor(
    private readonly client: Client,
    private readonly mapNames: readonly string[] = Object.keys(MAP_MODES),
  ) {}

  /**
   * Databases the integration has been shared with. v5's search only returns data
   * sources (not databases directly), so this searches those and maps each back to
   * its parent database id — deduped (first wins) since a single-source database
   * (the only kind Vantage creates or expects) surfaces as exactly one data source.
   */
  async listDatabases(): Promise<NotionDatabaseSummary[]> {
    const results = await this.searchAll('data_source');
    const seen = new Set<string>();
    const databases: NotionDatabaseSummary[] = [];
    for (const obj of results) {
      // A restricted-token search can return a PartialDataSourceObjectResponse —
      // no parent/title/url. Skip it rather than falling back to the data
      // source's own id: emitting a data-source id as a "database id" would
      // corrupt config if picked (a picker entry titled 'Untitled' with no url),
      // which is worse than the entry being absent from the list.
      const databaseId = obj?.parent?.database_id;
      if (!databaseId) continue;
      if (seen.has(databaseId)) continue;
      seen.add(databaseId);
      databases.push({ id: databaseId, title: titleOfDatabase(obj), url: obj.url });
    }
    return databases;
  }

  /** Pages the integration has been shared with — candidate parents for auto-create. */
  async listParentPages(): Promise<NotionPageSummary[]> {
    const results = await this.searchAll('page');
    return results.map((obj) => ({ id: obj.id, title: titleOfPage(obj), url: obj.url }));
  }

  /**
   * Creates a Maps database under `parentPageId`, populates it with one page
   * per `MAP_MODES` key, then creates the Gametracker database with its `Map`
   * relation pointing at the Maps data source. Order matters: the Gametracker
   * database needs the Maps data source id to build its relation property.
   * Properties nest under `initial_data_source` (v5's `databases.create` shape);
   * both creates return `data_sources[0].id` for the single source each database
   * gets. Returned ids/urls stay database-level — that's still what config stores.
   */
  async createGametracker(parentPageId: string): Promise<CreateGametrackerResult> {
    const mapsDb: any = await this.client.databases.create({
      parent: { type: 'page_id', page_id: parentPageId },
      title: [{ type: 'text', text: { content: 'Maps' } }],
      initial_data_source: { properties: { Name: { title: {} } } },
    });
    const mapsSourceId = firstDataSourceId(mapsDb, 'Maps');

    for (const name of this.mapNames) {
      await this.client.pages.create({
        parent: { type: 'data_source_id', data_source_id: mapsSourceId },
        properties: { Name: { title: [{ text: { content: name } }] } },
      });
    }

    const gametrackerDb: any = await this.client.databases.create({
      parent: { type: 'page_id', page_id: parentPageId },
      title: [{ type: 'text', text: { content: 'Gametracker' } }],
      initial_data_source: { properties: buildGametrackerProperties(mapsSourceId) as any },
    });

    return {
      gametrackerDatabaseId: gametrackerDb.id,
      gametrackerUrl: gametrackerDb.url,
      mapsDatabaseId: mapsDb.id,
      mapsUrl: mapsDb.url,
    };
  }

  /**
   * Validate a database's live shape against the Gametracker schema. Two-step
   * under v5: `databases.retrieve` for the title + first data source id, then
   * `dataSources.retrieve` for the properties the schema validators read.
   */
  async validate(databaseId: string, opts: { requireMapRelation?: boolean } = {}): Promise<ValidateResult> {
    const db: any = await this.client.databases.retrieve({ database_id: databaseId });
    const dataSourceId: string | undefined = db?.data_sources?.[0]?.id;
    const source: any = dataSourceId ? await this.client.dataSources.retrieve({ data_source_id: dataSourceId }) : undefined;
    const properties = source?.properties ?? {};
    const shape = validateGametrackerShape(properties, opts);
    return {
      ...shape,
      title: titleOfDatabase(db),
      hasPlayedAt: hasPlayedAtColumn(properties),
      hasSrDelta: hasSrDeltaColumn(properties),
      subjectiveColumns: presentSubjectiveColumns(properties),
      subjectiveColumnDiagnostics: diagnoseSubjectiveColumns(properties),
      mapRelationDbId: mapRelationSourceId(properties),
      dataSourceId,
      provisionPlan: planColumnProvision(properties),
    };
  }

  /**
   * Additively create the given Vantage-owned columns on an EXISTING data source
   * (the self-healing schema step) via one `dataSources.update`. Additive ONLY —
   * never sends a rename, retype, or removal, so user columns and data are never
   * touched. A no-op (no network call) when `toCreate` is empty, keeping a
   * complete schema idempotent. Returns the names actually created (empty when
   * nothing to do). Errors (e.g. a token without schema-edit permission) propagate
   * to the caller, which surfaces them and still runs the sync for existing columns.
   */
  async ensureColumns(dataSourceId: string, toCreate: Record<string, unknown>): Promise<string[]> {
    const names = Object.keys(toCreate);
    if (names.length === 0) return [];
    await this.client.dataSources.update({ data_source_id: dataSourceId, properties: toCreate as any });
    return names;
  }

  /** Paginated `client.search`, following `has_more`/`next_cursor`. */
  private async searchAll(value: 'data_source' | 'page'): Promise<any[]> {
    const results: any[] = [];
    let cursor: string | undefined;
    do {
      const res: any = await this.client.search({
        filter: { property: 'object', value },
        start_cursor: cursor,
        page_size: 100,
      });
      results.push(...(res.results ?? []));
      cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
    } while (cursor);
    return results;
  }
}

/**
 * Read a freshly-created database's first data source id, throwing a clear
 * error when it's missing/empty (a restricted-token response can come back
 * partial) BEFORE any dependent object — Map pages, the Gametracker's relation
 * — gets created against a garbage `undefined` id.
 */
function firstDataSourceId(db: any, label: string): string {
  const id = db?.data_sources?.[0]?.id;
  if (!id) {
    throw new Error(
      `${label} database has no visible data sources — the integration token may lack read-content capability`,
    );
  }
  return id;
}

// Near-duplicate of mapsCache's extractTitle — kept separate deliberately (dedupe would
// couple admin to the exporter for ~10 lines); this documents the duplication instead of "fixing" it.

/** Database objects carry their title as rich-text directly on `.title`. */
function titleOfDatabase(db: any): string {
  const text = (db?.title ?? []).map((t: any) => t.plain_text ?? '').join('').trim();
  return text || 'Untitled';
}

/** Page titles live inside a `title`-type property. */
function titleOfPage(page: any): string {
  const props = page?.properties ?? {};
  for (const value of Object.values<any>(props)) {
    if (value?.type === 'title') {
      const text = (value.title ?? []).map((t: any) => t.plain_text ?? '').join('').trim();
      if (text) return text;
    }
  }
  return 'Untitled';
}
