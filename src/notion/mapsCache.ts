import { Client } from '@notionhq/client';
import { buildMapIndex, resolveMap, type MapMatch } from '../core/resolvers/map';
import { resolveDataSourceId } from './dataSourceResolver';

/**
 * Loads the Maps database once (page Name → page id) and resolves GEP map names
 * against it. Refreshes on a cache miss so a newly-added map page is picked up
 * without restarting the app.
 */
export class MapsCache {
  private index = new Map<string, { pageId: string; name: string }>();
  private loadedAt = 0;
  // Resolved once per configured id and cached on the instance — `mapsDatabaseId`
  // may be a database id (legacy config) or already a data source id (schema
  // discovery); the resolver accepts either, but only needs to run once. Stays
  // undefined on a resolution failure (the failure is rethrown, not cached), so
  // the next load() attempt retries resolution rather than being stuck broken.
  private resolvedSourceId?: string;

  constructor(
    private readonly client: Client,
    private readonly mapsDatabaseId: string,
    private readonly aliases: Record<string, string> = {},
  ) {}

  /** (Re)load the full Maps database into the in-memory index. */
  async load(): Promise<void> {
    if (!this.mapsDatabaseId) {
      this.index = new Map();
      this.loadedAt = Date.now();
      return;
    }
    if (this.resolvedSourceId === undefined) {
      // A resolution failure (bad token, unshared/deleted database, network
      // outage) PROPAGATES out of load() — it must surface exactly like the
      // pre-migration `databases.query` throw did: `NotionRuntime.rebuild`'s
      // `maps.load().catch` turns it into a 'Maps load failed' toast, and during
      // export it throws inside `NotionExporter`'s per-game try so the game
      // counts as failed without being marked processed (retryable once the
      // user fixes sharing/token).
      this.resolvedSourceId = await resolveDataSourceId(this.client, this.mapsDatabaseId);
    }
    const rows: Array<{ pageId: string; name: string }> = [];
    let cursor: string | undefined;
    do {
      const res: any = await this.client.dataSources.query({
        data_source_id: this.resolvedSourceId,
        start_cursor: cursor,
        page_size: 100,
      });
      for (const page of res.results ?? []) {
        const name = extractTitle(page);
        if (name) rows.push({ pageId: page.id, name });
      }
      cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
    } while (cursor);
    this.index = buildMapIndex(rows);
    this.loadedAt = Date.now();
  }

  /** Resolve a raw GEP map name, refreshing once on a miss. */
  async resolve(rawName: string | undefined): Promise<MapMatch> {
    if (this.loadedAt === 0) await this.load();
    let match = resolveMap(rawName, this.index, this.aliases);
    if (!match.matched && Date.now() - this.loadedAt > 5_000) {
      await this.load();
      match = resolveMap(rawName, this.index, this.aliases);
    }
    return match;
  }
}

/** Extract the plain-text value of a page's title property. */
function extractTitle(page: any): string | undefined {
  const props = page?.properties ?? {};
  for (const value of Object.values<any>(props)) {
    if (value?.type === 'title') {
      const text = (value.title ?? []).map((t: any) => t.plain_text ?? '').join('').trim();
      return text || undefined;
    }
  }
  return undefined;
}
