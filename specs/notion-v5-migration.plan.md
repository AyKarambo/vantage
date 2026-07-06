# Techplan: `notion-v5-migration`

Derived from [`notion-v5-migration.spec.md`](./notion-v5-migration.spec.md).
Shapes below were read from the installed `@notionhq/client@5.22.0` typings
(`node_modules/@notionhq/client/build/src/api-endpoints/*.d.ts`), not from memory.

## v5 API facts (the contract)
- SDK default `Notion-Version: 2025-09-03` (Client.js `defaultNotionVersion`).
- `client.databases` = `{ retrieve, create, update }` — **no `query`**.
  `databases.retrieve` → `{ title, data_sources: [{ id, name }], url, … }` — **no `properties`**.
  `databases.create({ parent, title, initial_data_source?: { properties } })` → response
  includes `data_sources[0].id`.
- `client.dataSources` = `{ retrieve, query, create, update, listTemplates }`.
  `dataSources.query({ data_source_id, start_cursor, page_size, filter, sorts })` — body
  semantics identical to the old `databases.query`.
  `dataSources.retrieve({ data_source_id })` → `{ properties, title, parent, … }`.
- `search` filter value: `'page' | 'data_source'` (no `'database'`). Data-source results carry
  `.title` (rich text), `.url`, and `.parent` (`{ type: 'database_id', database_id }`).
- Relation property **request**: `{ relation: { data_source_id, single_property: {} } }`.
  Relation property **response** carries BOTH `database_id` and `data_source_id`.
- `pages.create` parent still accepts `{ database_id }` *or* `{ data_source_id }`.

## Decisions
1. **Config stays database-id-based.** No config migration; `notionDatabaseSource()` semantics
   unchanged. A new shared helper `resolveDataSourceId(client, id)` (new file
   `src/notion/dataSourceResolver.ts`, exported for reuse + tests):
   try `databases.retrieve({ database_id: id })` → `data_sources[0].id`
   (undefined if the list is empty); on error, try `dataSources.retrieve({ data_source_id:
   id })` → its own `id`; on error, undefined. Callers cache the result per id.
2. **mapsCache**: resolve once per `load()` (cache the resolved id on the instance, keyed by
   the configured id) then `dataSources.query`. An unresolvable id → empty index (same
   behavior as the current blank-id path), so a bad Maps reference degrades to "maps
   unmatched", never a crash loop.
3. **notionImporter**: `queryAll(id)` resolves then `dataSources.query`. `discoverMapsDbId`
   becomes `discoverMapsSourceId`: `databases.retrieve` → first data source →
   `dataSources.retrieve` → `properties.Map.relation` → prefer `data_source_id`, fall back
   `database_id` (the resolver normalizes either at query time).
4. **notionAdmin**:
   - `searchAll('data_source' | 'page')`; `listDatabases()` maps each data source to its parent
     database id (`parent.database_id`, falling back to the object's own id), dedupes by id
     (first wins), title via the existing rich-text extractor, url from the result.
   - `createGametracker`: `databases.create({ …, initial_data_source: { properties } })`;
     Maps pages parented `{ type: 'data_source_id', data_source_id: mapsDb.data_sources[0].id }`;
     Gametracker relation built from the Maps **data-source** id; returned
     `mapsDatabaseId`/`gametrackerDatabaseId` stay the **database** ids (config semantics).
   - `validate(databaseId)`: `databases.retrieve` (title + first source id) →
     `dataSources.retrieve` (properties) → existing pure validators unchanged. `ValidateResult`
     gains `dataSourceId?: string`.
5. **gametrackerSchema**: `buildGametrackerProperties(mapsDataSourceId?)` emits
   `relation: { data_source_id, single_property: {} }`; `mapRelationDatabaseId` →
   `mapRelationSourceId`, reading `relation.data_source_id ?? relation.database_id`.
6. **notionWriter**: constructor gains the resolved `dataSourceId?` (from validation, threaded
   through `notionRuntime.buildExporter`); page parent =
   `{ data_source_id }` when known, else `{ database_id }` (pre-validation fallback — valid for
   single-source databases). Everything else (props, guards) unchanged.
7. **notionRuntime**: store `gametrackerSourceId` from `validate()`, pass to the writer;
   `mapsRelationDbId` (now a source id) keeps flowing into `MapsCache` — the resolver accepts it.

## Test migration map
- Mocks gain `dataSources: { query: vi.fn(), retrieve: vi.fn() }`.
- `notionAdmin.test.ts`: search expectations → `value: 'data_source'` with results shaped
  `{ id, title, url, parent: { type: 'database_id', database_id } }`; create asserts
  `initial_data_source.properties` + relation `data_source_id`; validate mocks the two-step
  retrieve (db → source).
- `notionImporter.test.ts` / `mapsCache.test.ts` / round-trip: `databases.query` mocks →
  `dataSources.query`; resolver paths mocked via `databases.retrieve` returning
  `{ data_sources: [{ id }] }`.
- `gametrackerSchema.test.ts`: relation-shape and rename updates (pure).
- New `test/dataSourceResolver.test.ts`: db id → first source; source id fallback; empty
  `data_sources` → undefined; both-retrieves-fail → undefined.
