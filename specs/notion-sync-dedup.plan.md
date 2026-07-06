# Techplan — notion-sync-dedup

Derived from `specs/notion-sync-dedup.spec.md` (status: planned). Grounded in parallel
codebase research (exporter/outbox mechanics, import pipeline, IPC/renderer conventions,
notion-edge module conventions, risk sweep) — key findings inlined below.

## Architecture & Approach

The durable link between a local match and its Notion row becomes **the row itself**, not just
the local ledger. Three mechanisms, all built on one new pure module and one shared scan
helper:

### 1. Pure dedup logic — `src/notion/dedup.ts` (new, client-free like `gametrackerSchema.ts`)

- `effectiveMatchId(pageId, matchIdText)` → `matchIdText || 'manual-notion-' + pageId sans
  dashes` — extracted from the importer's inline rule (`notionImporter.ts:152`) so importer,
  exporter index and cleanup all share the *single* id-derivation rule.
- `embeddedPageId(matchId)` → the dashed UUID embedded in a `manual-notion-<32 hex>` id, else
  `undefined` (strict: exactly 32 hex chars; `manual-<ts>` and GEP ids return undefined).
- `RowRef { pageId: string; matchIdText?: string; createdTime?: string }` +
  `rowRefOf(page)` — minimal projection of a raw Notion page (reads only `id`,
  `created_time`, `properties['Match ID'].rich_text`).
- `groupByEffectiveMatchId(rows: RowRef[]): Map<string, RowRef[]>`.
- `pickCanonicalRow(rows, opts?: { ledgeredPageId?: string }): RowRef` — deterministic:
  (1) the row whose `pageId` the effective id embeds (the original hand row), else
  (2) the ledgered page, else (3) earliest `createdTime`, tiebreak lexicographic `pageId`.

Pure + client-free ⇒ direct unit tests (`test/notionDedup.test.ts`), usable from both edges.

### 2. Shared scan helper — `src/notion/pageScan.ts` (new)

`queryAllPages(client, idOrDataSourceId): Promise<any[]>` — the importer's private
`queryAll` paging loop (`notionImporter.ts:83-97`, `page_size: 100` + cursor loop +
`resolveDataSourceId`) extracted so importer, exporter create-guard and cleanup share it.
Importer keeps its per-instance memoization by passing already-resolved ids.

### 3. Import write-back + duplicate detection (`notionImporter.ts`, `notionRuntime.ts`)

- `toGame` uses `effectiveMatchId`; each mapped game also carries `hadMatchIdText`.
- After the mapping loop, group games by `matchId`. For groups > 1: keep only the canonical
  row's game (via `pickCanonicalRow`, ledger preference supplied by a new optional
  constructor arg `ledgeredPageIdFor?: (matchId: string) => string | undefined` — the
  runtime passes `outbox.pageIdFor(id, dbId)`); count the rest into a new
  `ImportOutcome.duplicates`.
- **Write-back:** for each surviving game with `hadMatchIdText === false`, stamp the id via
  `client.pages.update({ page_id, properties: { 'Match ID': { rich_text: [...] } } })`.
  Per-row try/catch — a failed stamp never fails the row's import (AC2). Only canonical
  rows are stamped (redundant copies untouched, AC8).
- `NotionRuntime.import()` now ledgers only the (deduped) returned games — the ledger always
  points at the canonical page — and threads `duplicates` outward.
- `dataProvider.importNotion()` passes `duplicates` into `ImportResult`.

### 4. Export create-guard + backfill fix (`notionExporter.ts`, `notionWriter.ts`)

- New lazy **existing-rows index** inside the exporter: built at most once per `export()`
  run, only when the first unledgered match is encountered (AC6). Built from
  `queryAllPages` over `legacyLookup` (client + database + dataSourceId — the runtime always
  supplies it; when absent, e.g. minimal tests, the guard is skipped and behavior degrades
  to today's blind create). Index: `Map<effectiveMatchId, RowRef[]>` via `dedup.ts`;
  lookup resolves multi-row groups with `pickCanonicalRow`.
- **Create path** (`pageId === undefined`, `notionExporter.ts:121-126`): consult the index
  first. Found → adopt: `updateOrRecreate(foundPageId, …)` (existing page-gone fallback
  covers a stale index), stamping `Match ID` when the found row lacked it; counted as
  `updated`/`recreated` as usual. Not found → `createPage` exactly as today (AC6, AC7 — the
  index is built from the *configured* database, so database affinity is preserved by
  construction).
- **Legacy backfill** (`backfillLegacy`): replace the per-id `findLegacyPage` query with the
  same index lookup — id-less hand rows are now found by their derived id (AC3), and
  `findLegacyPage` is deleted. Found-branch behavior otherwise unchanged (update when
  signature non-empty, adopt baseline, stamp when row lacked the id).
- **Index/scan failure:** if the scan itself throws, affected games land in the existing
  per-game `catch` → `failed++`. Never fall back to blind create (that would duplicate).
- `NotionWriter.updateMatchPage(pageId, m, opts?: { stampMatchId?: boolean })` — when set,
  the update payload additionally carries `Match ID` (rich_text). Signature semantics
  untouched: stamping is not part of `matchExportSignature` (grade + flags only,
  `notionBookkeeping.ts:32-38`), so unchanged-and-ledgered matches still skip (AC12).

### 5. Opt-in cleanup (`notionRuntime.ts` + IPC + renderer)

- `NotionRuntime.cleanupDuplicates(): Promise<CleanupDuplicatesResult>` — recomputed at
  action time, never from stale import state: scan all rows → `rowRefOf` → group → for each
  group > 1: pick canonical (ledger preference), archive the rest via
  `pages.update({ page_id, in_trash: true })` (per-row try/catch → `failed`), stamp the
  canonical row when id-less, and re-point an existing ledger record at the canonical page.
- New `OutboxStore.repointExport(matchId, { pageId, databaseId })` — updates `pageId` on an
  *existing* record, preserving its signature (no-op when no record exists; export's
  create-guard will adopt later). Keeps unchanged matches skipping after a cleanup.
- Result: `{ archived, kept, failed, unavailable?, error? }` (`kept` = duplicate groups
  kept/canonicalized).

### IPC / renderer wiring (per the established conventions)

- `src/shared/contract/notion.ts`: `ImportResult.duplicates?: number` + new
  `CleanupDuplicatesResult`.
- `src/shared/contract/api.ts`: `cleanupNotionDuplicates(): Promise<CleanupDuplicatesResult>`
  + `IPC_CHANNELS` entry `'notion:cleanup-duplicates'` (preload + renderer bridge auto-wire
  from the channel map — no manual edits there).
- `src/main/dashboard/ipcHandlers.ts`: `handle(ch.cleanupNotionDuplicates, …)`.
- `src/main/dataProvider.ts`: add `'cleanupDuplicates'` to the `notion` Pick + provider
  method.
- `renderer/preview/preview.ts`: stub the new method (canned counts) — preview breaks at
  runtime otherwise, not at build.
- `renderer/src/views/notion/syncCard.ts`:
  - duplicates chip in `importResult()` (amber/loss styling like failed, since it signals
    an anomaly) + a hint line when `duplicates > 0`.
  - "Clean up duplicate rows…" ghost button in the import section, visible when
    `s.connected` — confirm modal via `openModal` mirroring `confirmDeleteImported`
    (explains: keeps one row per match, moves redundant copies to Notion trash,
    restorable ~30 days) → `bridge.cleanupNotionDuplicates()` → toast with counts →
    `store.refresh()`.

## Affected Files/Modules

| File | Change |
|---|---|
| `src/notion/dedup.ts` | **new** — pure id-derivation/grouping/canonical-selection |
| `src/notion/pageScan.ts` | **new** — shared paged scan (`queryAllPages`) |
| `src/notion/notionImporter.ts` | use `dedup.ts` + `pageScan.ts`; canonical dedupe; `duplicates` count; Match ID write-back; `ledgeredPageIdFor` ctor arg |
| `src/notion/notionExporter.ts` | lazy existing-rows index; create-guard; backfill via index; drop `findLegacyPage` |
| `src/notion/notionWriter.ts` | `updateMatchPage` optional `stampMatchId` |
| `src/main/notionRuntime.ts` | thread ledger lookup + `duplicates`; new `cleanupDuplicates()` |
| `src/store/outbox.ts` | new `repointExport` |
| `src/main/dataProvider.ts` | `duplicates` passthrough; `cleanupNotionDuplicates` provider method; extend `notion` Pick |
| `src/main/dashboard/ipcHandlers.ts` | register new channel |
| `src/shared/contract/notion.ts` / `api.ts` | `duplicates?`, `CleanupDuplicatesResult`, method + channel |
| `renderer/src/views/notion/syncCard.ts` | duplicates chip, cleanup button + confirm modal |
| `renderer/preview/preview.ts` | stub `cleanupNotionDuplicates` |
| `test/notionDedup.test.ts` | **new** — pure logic |
| `test/notionImporter.test.ts`, `test/notionExporter.test.ts`, `test/notionRuntime.test.ts`, `test/importNotionProvider.test.ts`, `test/outbox.test.ts` | new/updated cases (see Test Strategy) |
| `README.md`, `specs/notion-import.spec.md` | docs + amendment note |

## Data Model / Interfaces

```ts
// src/notion/dedup.ts
export interface RowRef { pageId: string; matchIdText?: string; createdTime?: string }
export function effectiveMatchId(pageId: string, matchIdText?: string): string
export function embeddedPageId(matchId: string): string | undefined
export function rowRefOf(page: any): RowRef
export function groupByEffectiveMatchId(rows: RowRef[]): Map<string, RowRef[]>
export function pickCanonicalRow(rows: RowRef[], opts?: { ledgeredPageId?: string }): RowRef

// src/shared/contract/notion.ts
export interface ImportResult { …; duplicates?: number }
export interface CleanupDuplicatesResult {
  archived: number; kept: number; failed: number;
  unavailable?: boolean; error?: string;
}

// src/notion/notionImporter.ts
export interface ImportOutcome {
  games: Array<GameRecord & { pageId: string }>;
  failed: number;
  duplicates: number;
}
```

`ExportResult` is deliberately unchanged — adopted rows land in the existing
`updated`/`recreated` buckets.

## Test Strategy (maps to spec ACs)

Existing patterns reused: `game()`/`review()`/`tmpDir()` builders, `stubWriter()`/`stubMaps()`,
client mocks `{ pages: { create, update }, dataSources: { query } }`, importer `row()` page
fixtures, provider harness in `importNotionProvider.test.ts`.

- **`test/notionDedup.test.ts`** — id derivation round-trip (`effectiveMatchId` ↔
  `embeddedPageId`), non-derivable ids, grouping, canonical order (embedded > ledgered >
  earliest, tiebreak), `rowRefOf` projection.
- **Importer** — AC1: id-less row → stamped via `pages.update` with the derived id; AC2:
  stamp rejection → row still imports, `failed` unchanged; AC8: hand row + copy (Match ID
  text = derived id) → one game, canonical pageId, `duplicates: 1`, no stamp on the copy;
  rows with Match ID text are never stamped.
- **Exporter** — AC4: unledgered `manual-notion-*` + scan returns its id-less row → adopt
  (update, no create) + stamp; AC5: unledgered GEP id + scan returns its row by text → adopt,
  no stamp; AC3: legacy `processed[]` hand row (empty Match ID in fixture) → updated in
  place, ledger adopted, `create` never called; AC6: nothing found → created, scan called
  exactly once across several unledgered games; AC7: existing database-affinity tests keep
  passing (index from configured db); AC12: ledgered + unchanged → `skipped`, no scan.
  *Churn:* legacy-backfill fixtures gain `properties['Match ID']` so the index resolves them
  (the old per-id query mock shape is retired with `findLegacyPage`); exhaustive
  `toEqual` assertions on ExportResult (lines 56/72/88 area) unchanged — no new fields.
- **Runtime** — cleanup: mocked client returns dup groups → archives redundant pages
  (`in_trash: true`), stamps canonical, repoints ledger, counts `{archived, kept, failed}`;
  AC10: plain import/export mocks assert no `in_trash` call; AC11: one archive rejects →
  other groups still processed, `failed: 1`; unavailable when no client/db. Import threads
  `duplicates` + ledgers only canonical games.
- **Outbox** — `repointExport` preserves signature/databaseId, no-op without a record.
- **Provider** — `duplicates` passthrough into `ImportResult`.

## Risks & Alternatives

- **Scan cost on export**: one paged scan (100/page) only when unledgered matches exist —
  strictly cheaper than the per-id queries it replaces (500 rows = 5 requests vs. up to 500);
  SDK handles 429 backoff. Alternative (per-match `Match ID` queries) rejected: more
  requests and blind to id-less rows.
- **Scan failure fails unledgered games** instead of creating: deliberate — a duplicate is
  worse than a retryable failure. Documented in code.
- **Stamping into wrong-typed `Match ID` columns**: per-row best-effort catch; export-side
  validation already requires `Match ID: rich_text` (`REQUIRED_PROPERTIES`).
- **Archiving user rows** (cleanup): explicit action + confirm; archive = Notion trash
  (restorable), never a hard delete; canonical rule prefers the user's original hand row so
  hand-authored extra columns survive. Alternative (auto-cleanup after import) rejected —
  guardrail 5's spirit.
- **Exporter tests without `legacyLookup`** degrade to blind create — acceptable: the real
  runtime always supplies it; documented on the constructor.
- **Preview harness** must stub the new bridge method or the button dies at runtime —
  stubbed in the same task as the contract change.
