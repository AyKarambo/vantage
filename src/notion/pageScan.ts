import { Client } from '@notionhq/client';
import { resolveDataSourceId } from './dataSourceResolver';

/**
 * Pages through every row of a Gametracker/Maps data source, resolving
 * `idOrDataSourceId` first (`resolveDataSourceId` — accepts either a
 * database id or an already-resolved data source id, so callers don't need
 * to know which kind of id they're holding). Shared by the exporter's
 * create-guard and duplicate cleanup, which have no per-run memo of their
 * own and so resolve fresh on every call.
 *
 * {@link NotionImporter} does NOT call this directly — it memoizes
 * `resolveDataSourceId` per instance (schema discovery and the row query
 * both need the same id resolved) and would otherwise pay for a redundant
 * `resolveDataSourceId` call on every page fetch. It resolves once itself
 * and pages via {@link queryDataSourcePages} with the already-resolved id.
 */
export async function queryAllPages(client: Client, idOrDataSourceId: string): Promise<any[]> {
  const dataSourceId = await resolveDataSourceId(client, idOrDataSourceId);
  return queryDataSourcePages(client, dataSourceId);
}

/**
 * The cursor-paging loop itself, over an ALREADY-RESOLVED data source id —
 * no `resolveDataSourceId` call. Split out from {@link queryAllPages} so a
 * caller that memoizes its own resolution (`NotionImporter`) can page
 * without a redundant resolve round trip.
 */
export async function queryDataSourcePages(client: Client, dataSourceId: string): Promise<any[]> {
  const results: any[] = [];
  let cursor: string | undefined;
  do {
    const res: any = await client.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: cursor,
      page_size: 100,
    });
    results.push(...(res.results ?? []));
    cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
  } while (cursor);
  return results;
}
