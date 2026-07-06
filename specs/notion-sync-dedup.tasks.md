# Tasks — notion-sync-dedup

Derived from `notion-sync-dedup.plan.md`. Ordered by dependency; each task is individually
implementable and testable.

- [x] **T1 — Pure dedup module**
  - **Goal:** `src/notion/dedup.ts` with `effectiveMatchId`, `embeddedPageId`, `RowRef`,
    `rowRefOf`, `groupByEffectiveMatchId`, `pickCanonicalRow` (embedded > ledgered >
    earliest createdTime, tiebreak pageId), client-free.
  - **Files:** `src/notion/dedup.ts`, `test/notionDedup.test.ts`
  - **Check:** new unit tests cover derivation round-trip, non-derivable ids, grouping,
    canonical ordering, `rowRefOf` projection; `npm test` green.
  - **Size:** M

- [x] **T2 — Shared page scan helper**
  - **Goal:** extract the importer's paging loop into `src/notion/pageScan.ts`
    (`queryAllPages(client, idOrDataSourceId)`); importer delegates to it (memoized resolve
    kept in the importer).
  - **Files:** `src/notion/pageScan.ts`, `src/notion/notionImporter.ts`
  - **Check:** existing importer tests still green (pure refactor, no behavior change).
  - **Size:** S

- [x] **T3 — Outbox `repointExport`**
  - **Goal:** re-point an existing ledger record's `pageId` (+ stamp `databaseId`)
    preserving its signature; no-op when the match has no record.
  - **Files:** `src/store/outbox.ts`, `test/outbox.test.ts`
  - **Check:** unit tests: repoint preserves signature, no-op without record.
  - **Size:** S

- [x] **T4 — Importer: canonical dedupe + `duplicates` count + Match ID write-back**
  - **Goal:** `toGame` uses `effectiveMatchId` and reports `hadMatchIdText`; post-loop
    grouping keeps only the canonical game per match id (optional `ledgeredPageIdFor` ctor
    arg for ledger preference); `ImportOutcome.duplicates`; canonical id-less rows get their
    id stamped via `pages.update` (per-row best-effort).
  - **Files:** `src/notion/notionImporter.ts`, `test/notionImporter.test.ts`
  - **Check:** tests for AC1 (stamp written), AC2 (stamp failure ignored), AC8 (dup pair →
    one game, canonical pageId, `duplicates: 1`, copy not stamped); rows with Match ID text
    never stamped.
  - **Size:** L

- [x] **T5 — Exporter: lazy existing-rows index + create-guard + backfill via index**
  - **Goal:** build a `Map<effectiveMatchId, RowRef[]>` index at most once per `export()`
    (only when an unledgered match is hit, only when `legacyLookup` present); create path
    adopts found rows (update-in-place + stamp when id-less) instead of creating;
    `backfillLegacy` uses the index (delete `findLegacyPage`); scan failure → per-game
    `failed`, never blind create. `NotionWriter.updateMatchPage` gains
    `opts?: { stampMatchId?: boolean }`.
  - **Files:** `src/notion/notionExporter.ts`, `src/notion/notionWriter.ts`,
    `test/notionExporter.test.ts`
  - **Check:** tests for AC3 (legacy hand row healed, no create), AC4 (unledgered
    manual-notion adopt via derived id), AC5 (unledgered GEP adopt via text), AC6 (not found
    → create; scan called once across several games), AC12 (ledgered unchanged → skipped, no
    scan); existing affinity tests (AC7) green; legacy fixtures updated with `Match ID`
    properties.
  - **Size:** L

- [x] **T6 — Runtime: ledger-aware import + `cleanupDuplicates()`**
  - **Goal:** `NotionRuntime.import()` passes `ledgeredPageIdFor` and threads `duplicates`;
    new `cleanupDuplicates()` scans, groups, archives redundants (`in_trash: true`,
    per-row isolated), stamps canonical id-less rows, `repointExport`s the ledger; returns
    `{ archived, kept, failed, unavailable?, error? }`.
  - **Files:** `src/main/notionRuntime.ts`, `test/notionRuntime.test.ts`
  - **Check:** tests for AC9 (redundant archived, canonical stamped, unique untouched),
    AC10 (no `in_trash` during import/export), AC11 (one archive fails → others processed,
    `failed` counted), unavailable path.
  - **Size:** L

- [x] **T7 — Contract + IPC + provider + preview stub**
  - **Goal:** `ImportResult.duplicates?`, `CleanupDuplicatesResult`,
    `cleanupNotionDuplicates` on `OwStatsApi` + `IPC_CHANNELS`
    (`'notion:cleanup-duplicates'`), handler registration, provider method + extended
    `notion` Pick, `duplicates` passthrough in `importNotion`, preview harness stub.
  - **Files:** `src/shared/contract/notion.ts`, `src/shared/contract/api.ts`,
    `src/shared/contract/index.ts`, `src/main/dashboard/ipcHandlers.ts`,
    `src/main/dataProvider.ts`, `renderer/preview/preview.ts`,
    `test/importNotionProvider.test.ts`
  - **Check:** provider test asserts `duplicates` passthrough; typecheck (main + renderer)
    clean.
  - **Size:** M

- [x] **T8 — Renderer: duplicates chip + cleanup button/confirm/toast**
  - **Goal:** `importResult()` shows a duplicates chip + hint; "Clean up duplicate rows…"
    ghost button (visible when connected) opens an `openModal` confirm (archive-to-trash
    wording) → `bridge.cleanupNotionDuplicates()` → result toast → `store.refresh()`.
  - **Files:** `renderer/src/views/notion/syncCard.ts`
  - **Check:** renderer typecheck clean; manual verification via preview harness (stubbed
    result renders chips/toast).
  - **Size:** M

- [x] **T9 — Docs + spec amendments + finalize**
  - **Goal:** README Notion section (write-back, no-blind-create, cleanup action);
    amend `specs/notion-import.spec.md` idempotency bullet to reference this spec;
    spec lifecycle → `done`.
  - **Files:** `README.md`, `specs/notion-import.spec.md`,
    `specs/notion-sync-dedup.spec.md`
  - **Check:** docs mention all three user-visible behaviors; `npm test` +
    `npm run typecheck` green.
  - **Size:** S

## AC ↔ Task consistency

| Acceptance criterion (spec) | Task(s) |
|---|---|
| AC1 import write-back | T4 |
| AC2 write-back best-effort | T4 |
| AC3 no duplicate from legacy backfill | T5 |
| AC4 ledger loss, hand row adopted | T5 |
| AC5 ledger loss, GEP row adopted | T5 |
| AC6 new matches still export, one scan | T5 |
| AC7 database switch creates fresh | T5 (existing tests preserved) |
| AC8 duplicate detection on import | T4 (+ T7 surfacing) |
| AC9 cleanup archives redundants only | T6 (+ T8 UI) |
| AC10 cleanup is explicit | T6 (+ T8 confirm) |
| AC11 cleanup failure isolation | T6 |
| AC12 stamp doesn't dirty signature | T5 |

Gaps: none — every AC maps to ≥1 task. Scope creep: T1/T2/T3 are enablers for T4–T6 (no AC
of their own but required by them); T9 is the Definition-of-Done docs requirement. No task
traces to nothing.
