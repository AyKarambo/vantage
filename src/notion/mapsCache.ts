import { Client } from '@notionhq/client';
import { buildMapIndex, resolveMap, type MapMatch } from '../core/resolvers/map';

/**
 * Loads the Maps database once (page Name → page id) and resolves GEP map names
 * against it. Refreshes on a cache miss so a newly-added map page is picked up
 * without restarting the app.
 */
export class MapsCache {
  private index = new Map<string, { pageId: string; name: string }>();
  private loadedAt = 0;

  constructor(
    private readonly client: Client,
    private readonly mapsDatabaseId: string,
    private readonly aliases: Record<string, string> = {},
  ) {}

  async load(): Promise<void> {
    const rows: Array<{ pageId: string; name: string }> = [];
    let cursor: string | undefined;
    do {
      const res: any = await this.client.databases.query({
        database_id: this.mapsDatabaseId,
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
