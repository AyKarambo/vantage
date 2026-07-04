import { Client } from '@notionhq/client';
import { MAP_MODES } from '../core/maps';
import { buildGametrackerProperties, validateGametrackerShape, type ShapeValidation } from './gametrackerSchema';

export interface NotionDatabaseSummary {
  id: string;
  title: string;
  url?: string;
}

export interface NotionPageSummary {
  id: string;
  title: string;
  url?: string;
}

export interface CreateGametrackerResult {
  gametrackerDatabaseId: string;
  gametrackerUrl?: string;
  mapsDatabaseId: string;
  mapsUrl?: string;
}

export interface ValidateResult extends ShapeValidation {
  title?: string;
}

/**
 * Workspace-admin operations against the Notion API: listing what the
 * integration can see, auto-creating a correctly-shaped Gametracker (+ Maps)
 * database pair, and validating an existing database's shape. Mirrors
 * `MapsCache`'s constructor-injected `Client` so it's unit-testable with a
 * mock (see `test/notionAdmin.test.ts`) without ever touching the network.
 */
export class NotionAdmin {
  constructor(private readonly client: Client) {}

  /** Databases the integration has been shared with. */
  async listDatabases(): Promise<NotionDatabaseSummary[]> {
    const results = await this.searchAll('database');
    return results.map((obj) => ({ id: obj.id, title: titleOfDatabase(obj), url: obj.url }));
  }

  /** Pages the integration has been shared with — candidate parents for auto-create. */
  async listParentPages(): Promise<NotionPageSummary[]> {
    const results = await this.searchAll('page');
    return results.map((obj) => ({ id: obj.id, title: titleOfPage(obj), url: obj.url }));
  }

  /**
   * Creates a Maps database under `parentPageId`, populates it with one page
   * per `MAP_MODES` key, then creates the Gametracker database with its `Map`
   * relation pointing at the Maps database. Order matters: the Gametracker
   * database needs the Maps database id to build its relation property.
   */
  async createGametracker(parentPageId: string): Promise<CreateGametrackerResult> {
    const mapsDb: any = await this.client.databases.create({
      parent: { type: 'page_id', page_id: parentPageId },
      title: [{ type: 'text', text: { content: 'Maps' } }],
      properties: { Name: { title: {} } },
    });

    for (const name of Object.keys(MAP_MODES)) {
      await this.client.pages.create({
        parent: { database_id: mapsDb.id },
        properties: { Name: { title: [{ text: { content: name } }] } },
      });
    }

    const gametrackerDb: any = await this.client.databases.create({
      parent: { type: 'page_id', page_id: parentPageId },
      title: [{ type: 'text', text: { content: 'Gametracker' } }],
      properties: buildGametrackerProperties(mapsDb.id) as any,
    });

    return {
      gametrackerDatabaseId: gametrackerDb.id,
      gametrackerUrl: gametrackerDb.url,
      mapsDatabaseId: mapsDb.id,
      mapsUrl: mapsDb.url,
    };
  }

  /** Validate a database's live shape against the Gametracker schema. */
  async validate(databaseId: string, opts: { requireMapRelation?: boolean } = {}): Promise<ValidateResult> {
    const db: any = await this.client.databases.retrieve({ database_id: databaseId });
    const shape = validateGametrackerShape(db.properties ?? {}, opts);
    return { ...shape, title: titleOfDatabase(db) };
  }

  /** Paginated `client.search`, following `has_more`/`next_cursor`. */
  private async searchAll(value: 'database' | 'page'): Promise<any[]> {
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
