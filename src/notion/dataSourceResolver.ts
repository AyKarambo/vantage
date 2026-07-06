import { Client } from '@notionhq/client';

/**
 * Notion v5 splits a database into a container + data sources; `dataSources.query`
 * replaced `databases.query`, so every id Vantage's config stores as a "database id"
 * (`gametrackerDatabaseId` / `mapsDatabaseId`) must be resolved to its (first, since
 * Gametracker/Maps are single-source) data source id before it can be queried.
 *
 * The Map-relation target discovered off the Gametracker schema is *already* a
 * data-source id under v5 (relation properties point at data sources, not
 * databases) — so this also accepts an id that already is one, rather than
 * requiring every caller to know which kind of id it's holding.
 *
 * Resolution failure PROPAGATES (throws) rather than degrading to `undefined` —
 * this must surface exactly like the old `databases.query` throw did, so a bad
 * token, an unshared/deleted database, or a network outage becomes a visible
 * error (red import error, 'Maps load failed' toast, a failed-not-processed
 * export row) instead of a silent "no data source".
 */
export async function resolveDataSourceId(client: Client, id: string): Promise<string> {
  let db: any;
  try {
    db = await client.databases.retrieve({ database_id: id });
  } catch (databaseErr) {
    // Not a database id (or retrieve failed) — the id may already be a data
    // source id (e.g. read straight off a relation property), so try that path
    // before giving up.
    try {
      const source: any = await client.dataSources.retrieve({ data_source_id: id });
      return source.id;
    } catch {
      // Config ids are database ids, so the databases.retrieve failure is the
      // meaningful one — rethrow it, not the data-source fallback's error.
      throw databaseErr;
    }
  }
  const sourceId = db?.data_sources?.[0]?.id;
  if (!sourceId) {
    throw new Error('no visible data sources — the integration token may lack read-content capability');
  }
  return sourceId;
}
