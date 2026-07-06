# Spec: `notion-v5-migration`

## Intent (WHAT & WHY)
`@notionhq/client` v2 speaks the pre-2025 Notion API; v5 (Notion-Version `2025-09-03`) splits a
database into a container + **data sources**: `databases.query` is gone (→ `dataSources.query`),
database schema (`properties`) lives on the data source, `databases.create` nests properties
under `initial_data_source`, search can no longer filter on `'database'` (→ `'data_source'`),
and relation columns point at data sources. Migrate Vantage's Notion edge to v5 so the app stays
on the latest supported SDK — **without changing config semantics or the export/import
round-trip**. The user validates against their live workspace.

## In-Scope
- SDK bump to `^5.22.0` and migration of every call site: `mapsCache`, `notionImporter`,
  `notionAdmin`, `notionWriter`, `gametrackerSchema`, `notionRuntime`.
- **Legacy config compatibility:** `gametrackerDatabaseId` / `mapsDatabaseId` keep storing
  *database* ids; a small resolver maps database id → its (single) data-source id at runtime,
  and also accepts an id that already *is* a data-source id (the schema-discovered Map-relation
  target is one now).
- Test-suite migration in lockstep (mocks gain `dataSources.{query,retrieve}`; expectations
  follow the new call shapes).

## Out-of-Scope (non-goals)
- Multi-data-source databases (Gametracker/Maps are single-source; first source wins).
- Any change to the Gametracker column schema, the round-trip field mapping, or config keys.
- New API 2025-09-03 features (views, file uploads, markdown endpoints).

## Constraints
- Round-trip invariants hold: export/import mappings stay exact inverses; legacy databases
  missing optional columns keep working via the existing presence guards.
- Per-row isolation, pagination (`has_more`/`next_cursor`) and error behavior unchanged.
- `core/` untouched; edge stays in `src/notion/` + `src/main/notionRuntime.ts`.

## Acceptance Criteria (Given / When / Then)
1. Given a legacy config holding a **database id**, when export/import/validate run, then the id
   resolves to the database's first data source and all operations succeed (query/update/schema
   reads go through `dataSources.*`).
2. Given the Map-relation target discovered from the Gametracker schema (now a **data-source
   id**), when the maps cache loads, then the same resolver accepts it directly.
3. Given auto-create, when `createGametracker` runs, then both databases are created with
   `initial_data_source.properties`, the Maps pages are parented on the Maps **data source**,
   and the Gametracker's `Map` relation points at the Maps **data source id**; returned
   ids/urls keep their existing (database-level) meaning for config.
4. Given the database picker, when `listDatabases` runs, then it searches `'data_source'`,
   returns one entry per parent **database** (deduped), titled and linked, so selection still
   stores a database id.
5. Given a validated database, when the writer exports, then new rows are parented on the
   resolved **data source** (database-id parent only as the pre-validation fallback), and every
   column-presence guard (Played At, SR Delta, subjective columns) reads from the data source's
   properties exactly as before.
6. DoD: `npm run typecheck` + full `npm test` green with migrated mocks; README untouched
   (no user-visible behavior change); user validates export → import round-trip against a live
   workspace.
