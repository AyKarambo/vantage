# Tasks: Feedback Batch 2026-07

**Slug:** `feedback-batch-2026-07`
**Spec:** [`feedback-batch-2026-07.spec.md`](./feedback-batch-2026-07.spec.md) (Approved 2026-07-06)
**Plan:** [`feedback-batch-2026-07.plan.md`](./feedback-batch-2026-07.plan.md) (§6 Implementation Order & Parallelization)
**Status:** Draft

This breaks the approved plan into small, individually reviewable tasks, organized by the
plan's waves. GitHub issues #28–#34 already exist (Areas A–G) — do **not** re-create them.

## How to read this

- **Task id** — `W<wave>-<area><n>` (e.g. `W1-A2`). Stable across edits.
- **Greenness policy (plan §6, load-bearing):** waves are **NOT** each independently green.
  Contract changes in Wave 0 break their renderer/main consumers until later waves land. This
  batch ships as **one atomic PR**; `npm test` + `npm run typecheck` green is required **only at
  the end** (task `W4-V1`). Each task's **Check** therefore states what *can* be verified in
  isolation (a targeted vitest file that compiles against the already-landed core, or a
  behavioral/preview check) — not full-suite greenness mid-flight.
- **Single-owner shared files** (plan §6 hazard summary) are honored: where two areas touch one
  file, the tasks are merged under one owner or strictly sequenced, and the task says which.
- **Parallelism:** tasks within the same wave that list disjoint **Files** may run in parallel.
  Same-wave tasks sharing a file are serialized (noted per task).

---

## Wave 0a — Contract (single owner)

> The IPC contract is barreled and shared by every area. One agent owns all of Wave 0a. Nothing
> else in later waves compiles cleanly until this lands, so it goes first and alone.

- [x] **W0a-C1 — Land all contract shape changes + barrel + DataProvider interface**
  - **Goal:** Apply every typed-contract change this batch needs — filter/season/matchrow/notion/
    data-location — in one atomic edit so all downstream waves compile against a stable contract.
  - **Files:** `src/shared/contract/dashboard.ts` (`DashboardFilters.days` union `number | 'all' |
    { season: string }`; drop `mode`; `DashboardData.filters` → `{ account, role, days }`;
    `options.seasons: Array<{ id; label }>`, drop `options.modes`; **drop `byMode` from
    `DashboardData`**; `MatchRow.srDelta?: number` + `finalScore?: string`),
    `src/shared/contract/notion.ts` (`ExportResult.updated?/recreated?`; `SubjectiveColumnStatus`,
    `SubjectiveColumnDiag`; `NotionStatus.subjectiveColumns?`),
    `src/shared/contract/appSettings.ts` (`DataLocation`, `DataLocationResult` with `leftovers?`;
    extend/rename from `DatabaseLocation*`), `src/shared/contract/api.ts` (new channels:
    `getDataLocation`, `chooseDataFolder`, `setDataFolder`, `chooseFirstRunDataFolder`; rename old
    data-location channels), `src/shared/contract/index.ts` (**explicit named re-exports** — add
    `SubjectiveColumnDiag`/`SubjectiveColumnStatus`, `DataLocation`/`DataLocationResult`, season
    option type; the barrel is not `export *`), `src/main/dashboard/provider.ts` (the
    `DataProvider` interface — rename/extend `getDatabaseLocation`/`chooseDatabaseFolder` `:101-104`
    to the Area-C endpoints so `ipcHandlers.ts` compiles in Wave 2).
  - **Check:** `npx tsc -p tsconfig.json --noEmit` on `src/shared/contract/**` compiles as an
    island (the contract has no internal consumers). Full-repo typecheck will be red until Waves
    2–3 — expected. Grep confirms `mode`/`modes`/`byMode` removed from the contract surface.
  - **Size:** M
  - **Spec ACs covered:** enabling infrastructure for A (updated/recreated, subjectiveColumns),
    C (DataLocation), D (days union, drop mode/modes/byMode, seasons options), F
    (MatchRow.srDelta/finalScore). No AC fully satisfied by this task alone; it unblocks them.

---

## Wave 0b — Pure core + tests (parallel; disjoint files)

> All Electron-free `src/core/` logic + its vitest tests. These can run green in isolation
> (they don't depend on renderer/main). `dashboardData.ts` is the one shared-by-D-and-F hazard —
> single owner (`W0b-DF1`).

- [x] **W0b-D1 — Season enumeration & labeling API**
  - **Goal:** Add pure season windows — current, per-data enumeration, id lookup — with
    year-based labels whose counter resets each calendar year.
  - **Files:** `src/core/season.ts` (add `SeasonWindow`, `currentSeasonWindow(now)`,
    `seasonsForData(timestamps, now)`, `seasonWindowById(id, now)`; keep existing
    `seasonStart`/`currentSeason`/`SEASON_CADENCE_MS`), `test/season.test.ts` (extend).
  - **Check:** `npx vitest run test/season.test.ts` — cases: 2026 S1/S2/S3 labels (Feb 10 / Apr 14
    / Jun 16), first extrapolated 2027 season → `2027 Season 1`, pre-2026 date-range fallback,
    `seasonsForData` keeps only seasons with ≥1 timestamp + always the current one + newest-first,
    fresh-install (no timestamps) → just current 2026 S3, `[start, end)` boundary, `seasonWindowById`
    round-trips the `id`.
  - **Size:** M
  - **Spec ACs covered:** D2 (season options list, labels, boundaries), D2 fresh-install case.

- [x] **W0b-A1 — Aggregate improvement grade + bookkeeping constant + export signature (pure)**
  - **Goal:** Move the Notion internal-id constant into core, add the aggregate-grade rule and the
    export content signature as pure functions.
  - **Files:** `src/core/targets/notionBookkeeping.ts` (**NEW** — `NOTION_IMPROVEMENT_TARGET_ID`
    const + `matchExportSignature(game, grade)`), `src/core/targets/aggregateGrade.ts` (**NEW** —
    `aggregateImprovementGrade(review, { visibleTargetIds, bookkeepingId })`),
    `src/core/targets/index.ts` (barrel the new exports), `test/aggregateGrade.test.ts` (**NEW**).
    Do **not** yet delete the `notionImprovementId` re-export from `src/notion/notionImporter.ts`
    (that happens in Wave 1 per the import-switch protocol) — only *add* the core module here.
  - **Check:** `npx vitest run test/aggregateGrade.test.ts` — all-hit→hit, all-missed→missed,
    mixed→partial, single passthrough, any-partial→partial, internal-id excluded from aggregation,
    bookkeeping fallback used only when no visible authored grades (precedence), `undefined` when
    neither. Signature determinism (same input → same string; set/clear flips it).
  - **Size:** M
  - **Spec ACs covered:** A1 (aggregate rule, precedence), A2 (signature underpins changed-since),
    B4 (bookkeeping grade is the fallback the exporter uses).

- [x] **W0b-B1 — Import-merge decision (pure)**
  - **Goal:** Pure decision for what an imported row applies to an existing local match — local
    always wins for review and mental.
  - **Files:** `src/core/notionMerge.ts` (**NEW** — `mergeImportedIntoLocal(local, imported)` →
    `{ review?, mental? } | null`), `test/notionMerge.test.ts` (**NEW**). Imports the bookkeeping
    id from `src/core/targets/notionBookkeeping.ts` (W0b-A1) — sequence after A1 or land together.
  - **Check:** `npx vitest run test/notionMerge.test.ts` — grade applied when `local.review`
    undefined + imported carries bookkeeping grade; local review untouched when present (even with a
    different Notion grade); mental adopted wholesale when `local.mental` undefined; local mental
    wins wholesale when present (an unchecked local flag stays unchecked despite Notion checked);
    `null` when nothing to change.
  - **Size:** S
  - **Spec ACs covered:** B1 (merge rules, local-wins for review + mental).

- [x] **W0b-D2 — Competitive predicate; retire dead capture filter**
  - **Goal:** Add the pure `isCompetitive` classifier and delete the dead `shouldLog`/`LogFilter`.
  - **Files:** `src/core/matchFilter.ts` (`isCompetitive(gameType): boolean`; delete `shouldLog`),
    `src/core/model/enums.ts` (delete `LogFilter`), `src/core/model/index.ts` (drop `LogFilter`
    from the `export type { Role, Result, LogFilter }` re-export `:9`), `test/matchFilter.test.ts`
    (add `isCompetitive` truth table; remove `shouldLog` cases).
  - **Check:** `npx vitest run test/matchFilter.test.ts` — `isCompetitive` true for competitive,
    false for quick-play/arcade/etc.; grep confirms no remaining `shouldLog`/`LogFilter` references
    in `src/core/`.
  - **Size:** S
  - **Spec ACs covered:** D1 (competitive classification reused by the capture gate + reading side).

- [x] **W0b-C1 — Data-migration planner (pure)**
  - **Goal:** Pure planner deciding which data artifacts move and whether a folder already holds
    Vantage data.
  - **Files:** `src/core/dataMigration.ts` (**NEW** — `planDataMigration(files, fromDir, toDir)`
    ordered copy ops + optional flags; `isVantageDataDir(dir)` true iff `history.db` present),
    `test/dataMigration.test.ts` (**NEW**, pure planner half).
  - **Check:** `npx vitest run test/dataMigration.test.ts` — plan lists exactly the present files
    (skips missing optionals), correct order (DB first / dirs handled), `isVantageDataDir` true iff
    `history.db`. (The fs *executor* half is `W1-C1`, tested separately with a temp dir.)
  - **Size:** S
  - **Spec ACs covered:** C1/C2 (adopt-vs-migrate detection, which files move) — planner portion.

- [x] **W0b-DF1 — dashboardData core: competitive scoping, season filter, matchRow fields, drop mode/byMode (single owner: D+F+B-scoring)**
  - **Goal:** All `dashboardData.ts` + `scoring.ts` core edits in one place so downstream renderer
    work sees a stable core (plan §6 names `dashboardData.ts` a D+F hazard; B's scoring exclusion
    is a sibling).
  - **Files:** `src/core/dashboardData.ts` (filter `all` through `isCompetitive` once at the top;
    use competitive-only list for counts/`totalGamesAllTime`/`pendingReviews`/readiness input/
    `applyFilters`/options; `applyFilters` new `{ season: id }` branch via `seasonWindowById` with
    30-day fallback for unknown id; emit `options.seasons` via `seasonsForData`; drop `mode` branch
    + `options.modes`; **stop computing/emitting `byMode`** and drop its import `:7`; `toMatchRow`
    copies `srDelta`/`finalScore` spread-guarded), `src/core/targets/scoring.ts` (`buildTargets`
    excludes `NOTION_IMPROVEMENT_TARGET_ID`), `test/vantageCore.test.ts` (rewrite the `applyFilters`
    `{ mode: 'Competitive' }` test `:228-235` → competitive-only scoping + season-branch +
    unknown-id fallback; add `toMatchRow` srDelta/finalScore present/absent), `test/analytics.test.ts`
    (non-competitive rows invisible in counts/stats; internal id excluded from `buildTargets` and
    from any visible target's stats).
  - **Check:** `npx vitest run test/vantageCore.test.ts test/analytics.test.ts` — competitive-only
    counts, `applyFilters` season `[start,end)` selection, unknown season id → 30-day fallback,
    `toMatchRow` carries the two new fields when present / omits when absent, `buildTargets` never
    lists or scores the internal id. **Depends on** W0b-D1 (season), W0b-D2 (`isCompetitive`),
    W0b-A1 (bookkeeping const), W0a-C1 (contract shape) — schedule after those in Wave 0.
  - **Size:** L — **justified:** `dashboardData.ts` is a single-owner shared file (D season/scoping
    + F `toMatchRow`), and the B scoring exclusion + the `vantageCore.test.ts` rewrite must land in
    lockstep with it (plan §6 greenness note (c): the test fix lands in the same wave as the core
    change, not a nonexistent `dashboardData.test.ts`).
  - **Spec ACs covered:** D1 (competitive-only counts/stats), D2 (season filter selection + options
    emission), F5 (MatchRow srDelta/finalScore in `toMatchRow`), B2 (internal id never counted in
    target stats; defense-in-depth exclusion in `buildTargets`).

---

## Wave 1 — Store + main-process edges (parallel; disjoint files)

> Store rewrites and the notion edge. Shared-file hazards: `src/store/outbox.ts` (A ledger + C
> relocate → A first, then C, or one owner) and the `NOTION_IMPROVEMENT_TARGET_ID` import-switch
> (A repoints its own file, B repoints + deletes its own — both point at core before B removes the
> old export).

- [x] **W1-A1 — Outbox → keyed export ledger**
  - **Goal:** Replace the dead retry queue with a `records` map keyed by matchId (pageId +
    signature), with back-compat load of the legacy `processed[]`.
  - **Files:** `src/store/outbox.ts` (`records: Record<string, ExportRecord>`; `pageIdFor`,
    `signatureFor`, `recordExport`, `recordImported`, `clearExport`, `legacyProcessed()`; drop
    `enqueue`/`pending`/`remove`; keep `processed?: string[]` read-only back-compat),
    `test/outbox.test.ts` (**delete** the retry-queue cases `:31-37`; add ledger cases). **Owner
    also handles C's outbox `relocate` in `W1-C2` sequencing** — this task lands the ledger first.
  - **Check:** `npx vitest run test/outbox.test.ts` — `recordExport`→`pageIdFor`/`signatureFor`
    round-trip; `clearExport` removes a record; legacy `{ processed: [id] }` loads and
    `legacyProcessed()` returns ids with no ledger record; `recordImported` stores a full record.
  - **Size:** M
  - **Spec ACs covered:** A2 (pageId persistence enabling update-in-place; legacy backfill source).

- [x] **W1-A2 — Notion writer: `updateMatchPage` + shared subjective props**
  - **Goal:** Add page-update capability and factor create/update subjective-column building so
    update actively blanks cleared cells.
  - **Files:** `src/notion/notionWriter.ts` (`updateMatchPage(pageId, m)` via `pages.update`;
    private `subjectiveProps(m, { forUpdate })` — create omits empties, update emits `{ select:
    null }`/`{ checkbox: false }` for present-but-empty columns).
  - **Check:** Covered by `W1-A3`'s exporter test asserting `updateMatchPage` sends `{ select: null
    }` for a cleared `Comms`. Compiles against the Wave-0a `notion.ts` contract. (No standalone
    writer test file exists; verified through the exporter.)
  - **Size:** S
  - **Spec ACs covered:** A2 (update in place), A (clear cell — the `select: null`/`checkbox: false`
    emission).

- [x] **W1-A3 — Notion exporter: create/update/skip/recreate loop + legacy backfill + result counters**
  - **Goal:** Drive create/update/skip/recreate off the ledger + signature, derive the grade via
    `aggregateImprovementGrade`, recreate on page-gone (both error shapes), and run the one-time
    legacy `Match ID` query backfill.
  - **Files:** `src/notion/notionExporter.ts` (switch import of `NOTION_IMPROVEMENT_TARGET_ID` to
    `src/core/targets`; per-game: not-in-ledger→create; unchanged signature→skip; changed→update;
    page-gone→recreate on `object_not_found` **or** archived/in-trash `validation_error` guarded by
    a `pages.retrieve` `in_trash` check; legacy `processed[]` rows→batched `dataSources.query` on
    `Match ID`, found→update-in-place & adopt baseline, not-found→create & count recreated; populate
    `ExportResult.updated`/`recreated`/`skipped`), `test/notionExporter.test.ts` (extend, incl. the
    **DoD regression** repro).
  - **Check:** `npx vitest run test/notionExporter.test.ts` — (regression, DoD) reviewed match +
    Gametracker with `Improvement Target`+`Comms` present → create writes `Improvement Target=hit`,
    `Comms=positive` (record the *pre-fix* failing run for the PR); ledger `{pageId, empty sig}` +
    changed → `updateMatchPage` called once, `createMatchPage` not, `updated:1`; remove
    positiveComms → update sends `Comms:{select:null}`; page-gone case (a) `object_not_found` and
    (b) `validation_error`+`retrieve in_trash:true` → both recreate, `recreated:1`; negative
    `validation_error` on live page → `failed`, no recreate; legacy backfill: query finds page →
    `updateMatchPage` once & ledger recorded, query finds nothing → create & `recreated:1`;
    idempotency: two syncs no change → 0 updates.
  - **Size:** L — **justified:** the exporter is the single choke point for A2/A's create/update/
    skip/recreate + the legacy backfill + both page-gone error shapes + the DoD regression, and
    they are tightly coupled through the same loop and result object; splitting would fragment the
    signature/ledger contract mid-file.
  - **Spec ACs covered:** A2 (update-in-place, recreate + noted, clear cell), A (create writes both
    columns; legacy already-exported empty-cells → update-in-place, no duplicate), B4 (bookkeeping
    grade round-trips out).

- [x] **W1-A4 — Gametracker schema diagnostics + admin validate**
  - **Goal:** Classify each subjective column (available / wrong-type / near-miss / missing) purely
    at schema-discovery time and surface it from `validate`.
  - **Files:** `src/notion/gametrackerSchema.ts` (`diagnoseSubjectiveColumns(properties)` →
    `SubjectiveColumnDiag[]`), `src/notion/notionAdmin.ts` (`validate` returns the diagnostics),
    `test/gametrackerSchema.test.ts` (extend), `test/notionAdmin.test.ts` (extend if validate shape
    asserted).
  - **Check:** `npx vitest run test/gametrackerSchema.test.ts test/notionAdmin.test.ts` — `Comms`
    as `rich_text` → `wrong-type` with `actualType`; `comms ` (trailing space) / `improvement
    target` (wrong case) → `near-miss` with `actualName`; absent → `missing`; correct select →
    `available`.
  - **Size:** M
  - **Spec ACs covered:** A3 (per-column status: wrong-type, near-miss, missing, available).

- [x] **W1-B1 — History `mergeImported` + importer const switch**
  - **Goal:** Add the bulk merge op on the SQLite store and repoint the importer to the core
    bookkeeping constant, deleting its local factory/definition.
  - **Files:** `src/store/history.ts` (**NEW** `mergeImported(entries)` — one transaction, applies
    `mergeImportedIntoLocal` per entry via existing review/mental patch semantics; no `importedAt`
    stamp on merge), `src/notion/notionImporter.ts` (delete `notionImprovementTarget` factory;
    import `NOTION_IMPROVEMENT_TARGET_ID` from `src/core/targets`; expose the per-row Notion
    `pageId` for `recordImported`), `test/historyStoreSqlite.test.ts`
    (extend — `mergeImported` applies review/mental per the pure decision, leaves `importedAt`
    unset on merged rows; **pinned here, not `test/stores.test.ts`, so the Wave-1 file sets stay
    provably disjoint from W1-C2's `test/stores.test.ts`**), `test/notionImporter.test.ts` (importer
    no longer produces a synthetic target factory).
  - **Check:** `npx vitest run test/historyStoreSqlite.test.ts test/notionImporter.test.ts` —
    `mergeImported` writes only the returned review/mental keys, does not stamp `importedAt`;
    importer imports the const from core (grep confirms no local definition). Provider-level
    orchestration is `W2-P1`.
  - **Size:** M
  - **Spec ACs covered:** B1 (merge applied in a store transaction), B2 (no synthetic target
    factory in the importer).

- [x] **W1-C1 — Data-migration fs executor (store layer)**
  - **Goal:** Copy-verify-commit-delete executor with adopt semantics and leftover-surfacing, in
    `src/store/` so it's Electron-free and temp-dir testable.
  - **Files:** `src/store/dataMigration.ts` (**NEW** — takes data dirs + live store handles;
    refuses non-adopt when target has data; mkdir/copy/verify all, then repoint + persist + delete
    originals with bounded retry; `{ ok, leftovers }` on undeletable originals; rollback on
    pre-commit failure), `test/dataMigration.test.ts` (extend with executor cases, temp dir like
    `historyStoreSqlite.test.ts`).
  - **Check:** `npx vitest run test/dataMigration.test.ts` — copy-verify-commit moves all present
    files; mid-copy failure leaves source intact + no stale target; refuses non-adopt when target
    has `history.db`; adopt repoints without copy/delete; non-writable target → clear error, old
    location active; undeletable original after commit → `{ ok:true, leftovers:N }`.
  - **Size:** M
  - **Spec ACs covered:** C2 (all-files migration, copy-verify-then-delete, adopt-or-cancel refusal,
    non-writable rejection, leftover surfacing), C6 (adopt = repoint no copy/delete).

- [x] **W1-C2 — Store `relocate` methods + `resolveDataDir` rename**
  - **Goal:** Give each JSON/file store (and screenshots) a `relocate(newDir)`, and rename the dir
    resolver keeping a back-compat alias.
  - **Files:** `src/store/historyLocation.ts` (`resolveHistoryDir` → `resolveDataDir`; keep a thin
    `resolveHistoryDir` alias re-export until Wave 2 migrates `index.ts` — greenness note (b)),
    `src/store/outbox.ts` (`relocate` — **sequence after W1-A1's ledger rewrite**; same owner as
    W1-A1 for this file), `src/store/manualLog.ts` (`relocate`), `src/store/rankAnchors.ts`
    (`relocate`), `src/main/screenshots.ts` (`relocate` + re-register protocol mapping),
    `test/historyLocation.test.ts` (rename/extend — `resolveDataDir`, `dataFolder`↔legacy
    `historyDbFolder` fallback, alias export retained), `test/stores.test.ts`/`test/outbox.test.ts`
    (store `relocate` reopens at new dir).
  - **Check:** `npx vitest run test/historyLocation.test.ts test/stores.test.ts test/outbox.test.ts`
    — `resolveDataDir` resolves `dataFolder` then legacy `historyDbFolder`, alias still exported;
    each store's `relocate` re-points and reloads from the new dir.
  - **Size:** M
  - **Spec ACs covered:** C2 (stores follow the moved folder), C3 (pointer/resolution logic),
    enabling infra for C1 first-run adoption.

- [x] **W1-D1 — Competitive capture gate in the pipeline**
  - **Goal:** Drop non-competitive GEP matches before they are recorded, via `isCompetitive`.
  - **Files:** `src/main/matchPipeline.ts` (gate in `recordGame` before `history.add`; manual logs
    pass `gameType: 'Competitive'` so they're never dropped), `test/matchPipeline.test.ts` (extend).
  - **Check:** `npx vitest run test/matchPipeline.test.ts` — quick-play/arcade GEP match → not
    written; competitive → written; manual (forced competitive) → written.
  - **Size:** S
  - **Spec ACs covered:** D1 (live capture drops non-competitive; manual always competitive).

---

## Wave 2 — Composition root + config + IPC (mostly serial; shared main files)

> These are the plan's biggest shared-file hazards (`appConfig.ts`, `dataProvider.ts`,
> `index.ts`). One owner per file, landing all areas' edits together.

- [x] **W2-CD1 — appConfig: `dataFolder` rename + drop `logFilter`/env override (single owner: C+D)**
  - **Goal:** Rename the config key with back-compat and remove the dead capture-filter config in
    one edit to the shared config file.
  - **Files:** `src/main/config/appConfig.ts` (`dataFolder?: string` reading `dataFolder ?? legacy
    historyDbFolder`, persist under `dataFolder`; remove `logFilter` field, `DEFAULTS` entry, and
    the `OW_SYNC_FILTER` env override), `appsettings.json` (remove `logFilter` key),
    `test/appsettings.test.ts` (extend — `dataFolder` load, legacy `historyDbFolder` adopted,
    unknown `logFilter` in user config ignored without error).
  - **Check:** `npx vitest run test/appsettings.test.ts` — `dataFolder` round-trips; a config with
    only `historyDbFolder` resolves as `dataFolder`; a config still carrying `logFilter` loads
    without error and the key is not read.
  - **Size:** S
  - **Spec ACs covered:** C1/C2 (config carries the data folder), D1 (`logFilter`+`OW_SYNC_FILTER`
    removed; old `logFilter` ignored), part of the back-compat constraint.

- [x] **W2-P1 — dataProvider: export authored targets + import-merge orchestration + data-location endpoints (single owner: A+B+C)**
  - **Goal:** Wire all three areas' provider changes: feed authored targets to the export path,
    split imports into new-vs-existing + call `mergeImported` + remove synthetic-target seeding, and
    add the data-location endpoints.
  - **Files:** `src/main/dataProvider.ts` (A: provide visible authored-target ids + bookkeeping
    fallback to the export path; wire `deleteImportedMatches` → `clearExports(removedIds)` via a new
    `DataProviderDeps` seam. B: split imported games into new (`addMany`) vs existing
    (`mergeImported`); thread each imported page's `pageId` into `outbox.recordImported`; delete the
    synthetic-target seeding block + `seededBefore` seeding usage. C: `getDataLocation`,
    `chooseDataFolder`, `setDataFolder({ folder, adopt })`, `chooseFirstRunDataFolder`),
    `test/importNotionProvider.test.ts` (extend — merge into existing without review, new reviewed
    row with no local counterpart, local-reviewed unchanged, mental local-wins; **rewrite** the
    seeding tests `:64-106` to assert *no* seeding on any path).
  - **Check:** `npx vitest run test/importNotionProvider.test.ts` — existing local w/o review +
    Notion `missed` → local gains `missed`, no duplicate, not pending; Notion `hit` no local
    counterpart → new already-reviewed row; local already-reviewed → unchanged; local mental with
    `tilt` unchecked + Notion `Tilt` checked → local unchanged; no `AuthoredTarget` seeded on any
    import path.
  - **Size:** L — **justified:** plan §6 lists `dataProvider.ts` as an A+B+C hazard requiring one
    owner (or strict A→B→C sequence on the file); the three areas' edits interleave in
    `importNotion`/export wiring/`deleteImportedMatches` and share the `DataProviderDeps` seam.
  - **Spec ACs covered:** A1/A2 (authored targets drive aggregate precedence; clear-on-delete via
    `clearExports`), B1 (merge on re-import, local wins), B2 (no visible synthetic target seeded;
    reviewed-not-pending), C1/C2 (data-location endpoints).

- [x] **W2-A5 — notionRuntime: diagnostics cache + authored ids + ledger pageIds + clearExports**
  - **Goal:** Pass authored-target ids and ledger pageIds to the exporter, cache column
    diagnostics into `status()`, and expose the `clearExports` passthrough.
  - **Files:** `src/main/notionRuntime.ts` (cache `SubjectiveColumnDiag[]` from `validate` into
    `status()`; pass authored ids + outbox ledger to the exporter; `clearExports(ids)` calling
    `outbox.clearExport` per id).
  - **Check:** `npx vitest run test/notionAdmin.test.ts` (if runtime status covered there) plus
    compile against Wave-0a `notion.ts`. Behavioral surfacing verified in `W3-A1` (renderer). This
    task is mostly wiring — its correctness shows when the status card renders diagnostics.
  - **Size:** M
  - **Spec ACs covered:** A2 (ledger pageIds reach the exporter), A3 (diagnostics reach `status()`).

- [x] **W2-BC1 — index.ts: synthetic-target migration + mutable data dir + first-run wiring (single owner: B+C)**
  - **Goal:** Land the one-time synthetic-target removal (B) and the composition-root data-dir
    plumbing + first-run flag + migration wiring (C) in the shared main entry.
  - **Files:** `src/main/index.ts` (B: one-time `manual.removeTarget(NOTION_IMPROVEMENT_TARGET_ID)`
    after `ManualStore` construction — id-based, idempotent no-op thereafter. C: mutable `let
    dataDir`; wire `resolveDataDir`; compute `firstRunNeedsDataChoice` = no persisted
    `dataFolder`/legacy `historyDbFolder` AND `history.count()===0`; pass a single migration
    function to the provider; repoint stores after migration). Uses `resolveDataDir` — the Wave-1
    `resolveHistoryDir` alias may now be dropped (or in Wave 4 cleanup).
  - **Check:** No unit test drives `index.ts` (composition root). Verify via the B migration test
    (`W2-BC1` shares assertions with `test/manualLog.test.ts`/`test/stores.test.ts` for
    `removeTarget`) and the C first-run/integration checks in `W4-V1`. Grep confirms the
    `removeTarget(ID)` call and the config-driven first-run flag (no file-existence check).
  - **Size:** M
  - **Spec ACs covered:** B3 (synthetic target removed by id; same-name user target + grades
    intact), C1/C5 (first-run flag is config-driven, self-clearing; existing installs no prompt).

- [x] **W2-B2 — Synthetic-target migration test**
  - **Goal:** Prove the id-based `removeTarget` deletes only the synthetic target and spares a
    same-named user-authored one with its grades.
  - **Files:** `test/manualLog.test.ts` and/or `test/stores.test.ts` (extend).
  - **Check:** `npx vitest run test/manualLog.test.ts test/stores.test.ts` — `removeTarget(internal
    id)` removes the synthetic target; a user target sharing the name (different `t-<ts>` id)
    survives; stored grades on matches untouched.
  - **Size:** S
  - **Spec ACs covered:** B3 (migration removes only synthetic; user target + grades intact).

- [x] **W2-D2 — ipcHandlers: competitive scoping + new channel registration**
  - **Goal:** Scope export/heroDetail/matchDetail feeds to competitive-only and register the new
    C/A channels.
  - **Files:** `src/main/dashboard/ipcHandlers.ts` (shared `competitiveOnly(games)` on
    export/heroDetail/matchDetail feeds; register `getDataLocation`/`chooseDataFolder`/
    `setDataFolder`/`chooseFirstRunDataFolder` and any renamed A channels). Compiles against the
    Wave-0a `DataProvider` interface.
  - **Check:** `npx vitest run test/matchDetail.test.ts` (if it exercises the handler) + full
    typecheck deferred to `W4-V1`. Behavioral: exports/hero drilldowns exclude non-competitive rows
    — asserted via the `computeDashboard`/export path in `test/vantageCore.test.ts` (competitive
    scoping) landed in W0b-DF1; handler-level scoping is a thin reuse of the same helper.
  - **Size:** M
  - **Spec ACs covered:** D1 (exports and drilldowns competitive-only), C1/C2 (channels wired).

---

## Wave 3 — Renderer (parallel; mostly disjoint views)

> Shared-file hazards: `renderer/src/app/shell.ts` (C+E+G → one owner / serialize C→E→G),
> `renderer/src/prefs.ts` (D+F → one owner), `renderer/styles/components.css` (F+G → one owner or
> coordinate distinct rule blocks), `renderer/preview/preview.ts` (C+D → one owner).

- [x] **W3-A1 — Notion screen: per-column diagnostics + sync chips**
  - **Goal:** Render the subjective-column status (written/skipped + reason, near-miss name) and the
    updated/recreated sync chips.
  - **Files:** `renderer/src/views/notion/statusCard.ts` (or **NEW**
    `renderer/src/views/notion/subjectiveColumnsCard.ts`), `renderer/src/views/notion/syncCard.ts`
    (updated/recreated chips + recreate note).
  - **Check:** Preview harness (`npm run preview`, http://localhost:5178, Notion screen): with a
    stubbed status carrying a `wrong-type`/`near-miss`/`missing` column, the card shows the reason
    and the near-miss actual name; a sync result with `updated`/`recreated` renders the chips + "N
    row(s) recreated" note. Compiles against Wave-0a `notion.ts`.
  - **Size:** M
  - **Spec ACs covered:** A2 (recreate mentioned in sync result), A3 (visible per-column
    written/skipped status with reason + near-miss callout).

- [x] **W3-C1 — First-run data-location prompt + Settings "Data storage" card + preview mocks (single owner incl. preview.ts + shell sequencing)**
  - **Goal:** Add the first-run folder step (default/adopt/validate), rename+rework the Settings
    card to migrate all files with adopt-or-cancel, sequence the step in `maybeFirstRun`, and update
    the preview mocks.
  - **Files:** `renderer/src/app/firstRunPrompt.ts` (or **NEW**
    `renderer/src/app/dataLocationPrompt.ts` — default preselected, native picker via
    `chooseFirstRunDataFolder`, validate + re-prompt on invalid, adopt when folder has `history.db`,
    the C4 neutral sync note), `renderer/src/app/shell.ts` (sequence data-location step before demo
    prompt in `maybeFirstRun` — **shell.ts shared with E+G; this owner lands the C edits, then E,
    then G, or single shell owner**), `renderer/src/views/settings.ts` (rename card "Data storage";
    all-files copy + C4 note; "Change…" → `chooseDataFolder`→adopt-or-cancel→`setDataFolder`),
    `renderer/preview/preview.ts` (rename/extend data-location mocks; add
    `setDataFolder`/`chooseFirstRunDataFolder` stubs — **preview.ts shared with D; single owner**).
  - **Check:** Preview harness: Settings shows "Data storage" with current folder + "Change…" and
    the sync note (dialogs need Electron — the picker/migration itself is an integration check in
    `W4-V1`). Typecheck of `preview.ts` against the new `OwStatsApi` is part of `W4-V1`. First-run
    prompt appearance/adoption is the Electron integration check in `W4-V1`.
  - **Size:** L — **justified:** plan §6 forces a single owner across `shell.ts` (C+E+G) and
    `preview.ts` (C+D); C's first-run + Settings + sequencing + mock updates are interdependent
    (the prompt drives the same IPC the Settings card and mocks stub).
  - **Spec ACs covered:** C1 (first-run prompt, default preselected, invalid re-prompt + nothing
    written, adopt existing data), C2 (Settings all-files change, adopt-or-cancel, non-writable
    rejected), C4 (neutral sync note on both surfaces), C5 (existing installs no prompt — the UI
    honors the config-driven flag).

- [x] **W3-D1 — Filter bar rework + persistence/preset migration + quick-log + prefs (single owner: D-renderer, shares prefs.ts with F)**
  - **Goal:** Remove Account+Mode fields, add season options, migrate persisted filters/presets,
    drop the quick-log mode picker, and drop `LogPrefillPref.mode` — with the `prefs.ts` `PrefsShape`
    additions coordinated with F.
  - **Files:** `renderer/src/views/view.ts` (remove Account+Mode `filterField`; season `<select>`
    from `d.options.seasons` encoding `season:<id>`; `onChange` maps `7|30`→number, `all`→`'all'`,
    `season:<id>`→`{ season: id }`; reset restores role+days, leaves account; update
    `summarizeFilters`/`activeFilterCount`/`sameFilters` to `{ role, days }`), `renderer/src/store.ts`
    (`FILTER_DEFAULTS` drops `mode`; `vantageFilters` load strips `mode`, maps legacy `'season'`→
    current season id, reconciles unlistable id→`30` when first payload arrives),
    `renderer/src/prefs.ts` (`FilterPresetPref` strip `mode`/`account` on load/apply + rewrite on
    persist; drop `LogPrefillPref.mode`; **and land F's `PrefsShape` additions in the same edit —
    `MatchFieldMode`, `MatchColumnKey`, `MatchColumnsPref`, `MATCH_COLUMNS_DEFAULT`, add
    `matchColumns` to `PrefsShape` merging over defaults — so `prefs.ts` has a single Wave-3 owner
    (plan §6 hazard: `prefs.ts` = D + F). F consumes these; it does not re-edit `prefs.ts`**),
    `renderer/src/app/log-match.ts` (remove `MODES`/`modeField`; always
    show rank/SR block; send `gameType: 'Competitive'`), `renderer/preview/preview.ts` (sanity-check
    `getDashboard` mock against new filters/options shape — **owned by W3-C1's preview owner**;
    coordinate).
  - **Check:** Preview harness: filter bar has no Account/Mode field; season options match the AC
    example (Last 7 days, Last 30 days, 2026 Season 3, 2026 Season 1, All time when data in S1+S3);
    quick-log has no mode picker; seed `localStorage.vantageFilters` with `mode:'Quick
    Play'`,`days:'season'` → no crash, mode dropped, current named season shown; an old preset with
    `mode`/`account` applies role+time only, account unchanged, rewritten.
  - **Size:** L — **justified:** the D-renderer workstream spans five interlocking files (filter UI
    + store persistence + preset/logPrefill prefs + quick-log) and must coordinate the `prefs.ts`
    `PrefsShape` edit with F; splitting risks divergent `DashboardFilters` migration logic across
    `store.ts` and `prefs.ts`.
  - **Spec ACs covered:** D1 (no mode filter visible; quick-log no mode picker + saved competitive;
    persisted `mode` dropped), D2 (season options + selecting a season filters to its window; legacy
    `'season'`→current), D3 (account filter absent; switcher still drives all views), D4 (reset on
    reduced set; old preset strips mode/account, account unchanged, rewritten).

- [x] **W3-E1 — Readiness: drop schematic, hide filter bar, methodology modal (shares shell.ts)**
  - **Goal:** Remove the schematic from the main view, suppress the filter bar for readiness via a
    per-view flag, and add the "How is this calculated?" modal carrying the full methodology +
    schematic.
  - **Files:** `renderer/src/views/readiness.ts` (delete `supercompensationSchematic` call from
    `chartCard`; add "How is this calculated?" affordance on `verdictCard` → `openModal(() =>
    readinessMethodology())` with bands/signals/load-model/supercompensation-schematic/confidence/
    honesty; close via Escape/backdrop/close button), `renderer/src/app/shell.ts`
    (`FILTERLESS_VIEWS = new Set(['readiness'])`; `renderFilters` toggles `hidden` on `!state.data
    || FILTERLESS_VIEWS.has(state.view)` — **shell.ts shared with C+G; serialize after C**),
    `renderer/src/charts/plots/readinessChart.ts` (no change — `supercompensationSchematic` export
    stays; note only).
  - **Check:** Preview harness (readiness view, coach on and off): no schematic, no filter bar;
    switching accounts leaves verdict/signals/trend unchanged; clicking "How is this calculated?"
    opens a modal containing the methodology + schematic; closes via Escape, backdrop click, and
    close button.
  - **Size:** M
  - **Spec ACs covered:** E1 (schematic gone from main view), E2 (no filter bar; account-agnostic),
    E3 (methodology modal with schematic, three dismissals), E4 (other cards + off-state stay).

- [x] **W3-F1 — Matches list: configurable fields + clean meta line + columns (consumes prefs.ts from W3-D1; shares components.css with G — F then G)**
  - **Goal:** Add the per-field customize-view control, the clean separator-safe meta line, aligned
    column rendering, the new srDelta/finalScore/duration formatting, and remove the game-type label.
  - **Files:** _(no `prefs.ts` edit — the `matchColumns`/`MatchFieldMode`/`MatchColumnKey`/
    `MatchColumnsPref`/`MATCH_COLUMNS_DEFAULT` `PrefsShape` additions are landed by **W3-D1** as the
    single `prefs.ts` owner; this task **consumes** them via `prefs.get('matchColumns')` and must
    **sequence after W3-D1's `prefs.ts` edit**)_, `renderer/src/views/matches.ts` ("Customize view"
    popover with 3-way segmented control per field; build inline segments from inline+non-empty
    fields joined with ` · ` (no `—`, no dangling/doubled separators, omit `.row-meta` when zero
    segments); render `column` fields as fixed-width aligned cells in canonical order; signed
    color-coded srDelta, `${n}m` duration, verbatim finalScore; remove the `—` placeholder logic and
    the per-row game-type label), `renderer/styles/components.css` (`.match-col` + per-field width
    classes — **shared with G; serialized: F lands its `.match-col` block first, then G appends its
    `.cheatsheet*` block (distinct rule blocks, no overlap)**).
  - **Check:** Preview harness (Matches screen): default (heroes/account/srDelta inline) with no
    heroes → meta line `MyAccount · +25` (no `—`, no dangling separator); set account=column +
    role=inline → account is an aligned column (not inline) + role inline, persists across reload;
    all six hidden → only always-visible fields, no empty meta/spacer; match without SR while inline
    → SR segment omitted; SR as column → blank cell, column stays aligned.
  - **Size:** M
  - **Spec ACs covered:** F1 (per-field hidden/inline/column, canonical order, defaults), F2
    (persists across sessions), F3 (join only inline+non-empty, no placeholder/dangling separators,
    omit empty meta, blank column cell), F4 (signed color srDelta, minutes duration, verbatim
    score), F5 renderer consumption (from the contract fields added in W0a/W0b).

- [x] **W3-G1 — Cheatsheet spacing pass (shares shell.ts — serialize last after C→E; shares components.css with F — G after F)**
  - **Goal:** Add the `.cheatsheet` CSS spacing so key badges/text clear the modal border and gaps
    are uniform.
  - **Files:** `renderer/styles/components.css` (**NEW** `.cheatsheet` `padding: 22px 24px`;
    `.cheatsheet .nav-group` header top spacing ≥ 2× row gap; `.cheatsheet-row` uniform `padding:
    4px 0`; `.cheatsheet-row .kbd` fixed `min-width` ~72px — **shared with F; serialized: G appends
    its `.cheatsheet*` block after F's `.match-col` block lands (distinct rule blocks, no overlap)**),
    `renderer/src/app/shell.ts` (optional: drop the inline group/header styles `:404-406` so CSS
    owns spacing — **shell.ts shared with C+E; serialize last**).
  - **Check:** Preview harness (open `?` cheatsheet at default window size): `preview_inspect` on
    `.cheatsheet`, `.cheatsheet-row`, `.cheatsheet-row .kbd` — every key badge/text bounding box
    ≥20px from the modal border, group headers ≥2× the row gap above, row gaps uniform (±1px).
    Capture before/after screenshots (DoD).
  - **Size:** S
  - **Spec ACs covered:** G1 (≥20px inner padding, group header ≥2× row gap, uniform gaps, badge
    column clear of border).

---

## Wave 4 — Docs + specs + verification

- [x] **W4-DOC1 — README updates**
  - **Goal:** Document the user-visible changes: choosable data folder, competitive-only tracking,
    season time filter, configurable match columns, Notion update-on-sync + import-merge behavior.
  - **Files:** `README.md`.
  - **Check:** README sections for data storage, competitive-only, season filter, match-column
    customization, and the round-trip Notion behavior exist and match shipped behavior. (Docs — no
    unit test.)
  - **Size:** M
  - **Spec ACs covered:** DoD docs requirement (spec In-Scope: README updates). No product AC.

- [x] **W4-DOC2 — Update the six affected existing specs**
  - **Goal:** Bring the affected specs in line with shipped behavior.
  - **Files:** `specs/notion-import.spec.md` (import-merge, hidden bookkeeping, no synthetic target),
    `specs/screen-matches.spec.md` (configurable fields, clean meta line, no game-type label),
    `specs/dashboard-filter-fixes.spec.md` (competitive-only, season entries, no account/mode
    filter), `specs/sqlite-storage-notion-sync.spec.md` (export ledger, update-on-sync, all-files
    data folder), `specs/supercompensation-detection.spec.md` (schematic moved to modal, readiness
    filter-bar-exempt, competitive-only input), `specs/screen-shell.spec.md` (per-view filter-bar
    suppression, cheatsheet spacing).
  - **Check:** Each of the six specs reflects the new behavior (cross-reference this batch's spec).
    (Docs — no unit test.)
  - **Size:** M
  - **Spec ACs covered:** spec In-Scope: updating affected specs. No product AC.

- [x] **W4-V1 — Final verification (full suite + typecheck + preview screenshots)**
  - **Goal:** Confirm the atomic PR is green end-to-end and capture the required visual evidence.
  - **Files:** none (verification); may adjust any file to reach green.
  - **Check:** `npm test` passes; `npm run typecheck` clean (main + renderer, incl.
    `renderer/preview/preview.ts`); browser-preview screenshots for **E** (readiness: no
    schematic/filter bar, methodology modal open), **F** (matches: default meta line, column mode,
    all-hidden), **G** (cheatsheet before/after spacing); **B** preview check — after an import,
    the Targets and Review screens list **no** "Improvement Target" (imported/bookkeeping) target
    and no visible target's success-rate stats moved (the data-driven B guarantee has no Wave-3
    renderer task, so it is verified here); Electron integration checks noted in the PR for the
    dialog-dependent C flows: (i) first-run prompt appears on fresh install / absent on existing;
    (ii) first-run pointed at a **non-writable** folder → specific reason shown, picker re-prompts,
    nothing written to the invalid location; (iii) first-run pointed at a folder that already holds
    prior Vantage data (`history.db`) → adopted without overwrite (data loads from it, old location
    untouched); (iv) Settings all-files move; (v) Settings adopt-or-cancel; attach the Area-A
    pre-fix regression failing run + Area-G before/after screenshots to the PR.
  - **Size:** M
  - **Spec ACs covered:** the batch DoD (test + typecheck green; E/F/G preview evidence; A
    regression + G screenshots per spec Definition-of-Done additions). Verifies all areas; adds no
    new product behavior.

---

## Consistency check

Every spec acceptance criterion, area by area, mapped to the task(s) that cover it. AC labels are
paraphrased from the spec's Given/When/Then bullets (spec has no numeric AC ids within areas).

| Area | Acceptance criterion (paraphrased) | Task(s) |
|---|---|---|
| A | Single `hit` target + positiveComms → new row `Improvement Target=hit`, `Comms=positive` | W0b-A1, W1-A2, W1-A3, W2-P1 |
| A | 3 targets hit/hit/missed → `Improvement Target=partially` | W0b-A1, W1-A3 |
| A | Already-exported empty cells → offline review `partially`+comms → sync updates in place, no duplicate | W1-A1, W1-A2, W1-A3 |
| A | Remove positiveComms → sync clears the `Comms` cell | W1-A2, W1-A3 |
| A | User deleted the Notion page → next sync recreates + mentions it | W1-A3, W2-A5, W3-A1 |
| A | `Comms` as text column → status `skipped — wrong type (expected select)` | W1-A4, W2-A5, W3-A1 |
| A | `comms ` / wrong-case name → status calls out the near-miss name | W1-A4, W2-A5, W3-A1 |
| B | Local w/o review + Notion `missed` → local gains `missed`, not pending, no duplicate | W0b-B1, W1-B1, W2-P1 |
| B | Notion `hit` + no local counterpart → new already-reviewed row, not pending | W0b-B1, W1-B1, W2-P1 |
| B | Local already reviewed + different Notion grade → local review unchanged | W0b-B1, W2-P1 |
| B | Local mental `tilt` unchecked + Notion `Tilt` checked → local flag stays unchecked | W0b-B1, W2-P1 |
| B | Any import → Targets/Review show no "Improvement Target"; target stats unaffected | W0b-DF1, W2-P1, W4-V1 (preview) |
| B | Existing install + same-named user target → only synthetic gone; user target + grades intact | W2-BC1, W2-B2 |
| B | Import-only-review match → export/update carries that grade | W0b-A1, W1-A3 |
| C | Fresh install → asked for data location, default preselected, data lands in chosen folder | W2-BC1, W3-C1, W4-V1 |
| C | First-run non-writable folder → specific reason, re-prompt, nothing written | W3-C1, W4-V1 |
| C | Fresh install pointed at OneDrive folder with prior data → adopted, nothing overwritten | W0b-C1, W1-C1, W2-P1, W3-C1, W4-V1 |
| C | Settings change to empty writable folder → all files moved, old location clean, re-launch loads from new | W0b-C1, W1-C1, W1-C2, W2-P1, W3-C1, W4-V1 |
| C | Settings change to folder with existing data → adopt switches without overwrite; cancel = no change | W0b-C1, W1-C1, W2-P1, W3-C1, W4-V1 |
| C | Migration target not writable → rejected with clear error, old location active | W1-C1, W2-P1, W3-C1 |
| C | Existing install updating → no data-location prompt, data stays put | W2-BC1, W2-CD1, W4-V1 |
| D | Any screen → only competitive counted/listed; no mode filter visible | W0b-D2, W0b-DF1, W2-D2, W3-D1 |
| D | Quick-play match ends live → nothing written to history | W0b-D2, W1-D1 |
| D | Manual quick-log → no mode picker; saved match is competitive | W3-D1 |
| D | Data in S1+S3 → options exactly Last 7 / Last 30 / 2026 S3 / 2026 S1 / All time; S1 filters Feb 10–Apr 14 | W0b-D1, W0b-DF1, W3-D1 |
| D | Fresh install no matches → only season entry is current (2026 S3) | W0b-D1, W3-D1 |
| D | Persisted `mode:'Quick Play'`+`days:'season'` → no crash, mode dropped, current named season | W0b-DF1, W3-D1 |
| D | Old preset with `mode`+`account` → role/time apply, account unchanged, preset rewritten | W3-D1 |
| D | Reworked bar → no account filter; switcher "All accounts" updates all views | W0a-C1, W3-D1 |
| E | Readiness (coach on/off) → no schematic, no filter bar | W3-E1 |
| E | Switch accounts / "All accounts" → verdict/signals/trend unchanged | W3-E1 |
| E | Click "How is this calculated?" → modal with methodology + schematic; closes via Escape/backdrop/close | W3-E1 |
| F | Default + no heroes → meta line `MyAccount · +25`, no `—`/dangling separators | W0b-DF1, W3-F1 |
| F | account=column + role=inline → account aligned column (not inline), role inline; persists across restart | W3-F1 |
| F | All six hidden → only always-visible fields, no empty meta/spacer | W3-F1 |
| F | No SR while inline → SR segment omitted; SR as column → blank aligned cell | W3-F1 |
| G | Cheatsheet at default size → every badge/text ≥20px from border; headers ≥2× row gap; uniform gaps | W3-G1, W4-V1 (screenshots) |

### ACs without a task
_(none)_ — every acceptance criterion above maps to at least one implementing task. The
renderer-only ACs (B stats-hidden, C dialog flows, E, F, G) additionally trace to `W4-V1` for the
preview/integration evidence the spec's Definition-of-Done requires.

### Tasks tracing to no AC (scope-creep audit)
All tasks trace to at least one product AC **except** the following, each of which is justified
**enabling infrastructure or process (DoD)**, explicitly in the plan/spec's In-Scope list — not
scope creep:

- **W0a-C1** (contract) — pure enabling infrastructure. The typed IPC contract must change first
  (plan Wave 0a, single owner); every A/C/D/F AC depends on it, but no single AC is satisfied by
  the contract edit alone. Traces to spec In-Scope "IPC-contract updates".
- **W4-DOC1** (README) and **W4-DOC2** (six specs) — documentation, required by the spec's In-Scope
  list ("README updates", "updating the affected existing specs") and the Definition of Done, not
  by a Given/When/Then AC.
- **W4-V1** (final verification) — process/DoD (full `npm test` + typecheck green; E/F/G preview
  screenshots; A regression + G before/after screenshots per the spec's Definition-of-Done
  additions). Adds no product behavior.

All other tasks (including seemingly "infra" ones like W0b-C1 data-migration planner, W1-A1 outbox
ledger, W1-C2 store relocate, W2-A5 runtime wiring, W2-D2 ipc scoping) are mapped to concrete ACs in
the table above.
