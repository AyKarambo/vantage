# Tech Plan: `sqlite-storage-notion-sync`

Implements [`specs/sqlite-storage-notion-sync.spec.md`](./sqlite-storage-notion-sync.spec.md).
Grounded in a five-agent survey of the storage layer, config/IPC plumbing, the Notion edge,
build/packaging, and test conventions.

---

## 0. Key decisions up front (please confirm at the gate)

1. **SQLite driver → `node:sqlite` (built-in), not `better-sqlite3`.**
   Empirically verified: ow-electron `39.6.1` bundles Node `22.22.0` (ABI 140) with
   `node:sqlite` present and working (SQLite 3.50.4). It is **synchronous** (matches our
   synchronous bootstrap and keeps `HistoryStore`'s interface synchronous) and needs **zero
   packaging changes** — no native rebuild, no `asarUnpack`, no MSVC/Python toolchain.
   `better-sqlite3` would be the project's *first* native addon (needs `nodeGypRebuild: true`,
   `asarUnpack`, a build toolchain, ABI-140 rebuild) and would add fragility to an already
   finicky signed-release pipeline. WASM builds are async → rejected (fight the synchronous
   interface and bootstrap). **Cost of `node:sqlite`:** it's flagged *experimental* (emits one
   `ExperimentalWarning` on first use) and `@types/node@20` lacks its typings — handled by a
   small scoped ambient declaration (§3.5).

2. **Base branch / sequencing.** This worktree's branch does **not** contain PR #24
   (`notion-sync-export-fix` — subjective-column export + Map-relation fallback). The
   Notion-parity half of this feature is a direct continuation of #24. **Recommendation: land
   PR #23 and PR #24 first, then branch this feature off updated `main`.** Then the new SR-Δ
   column extends #24's generalized optional-column mechanism rather than re-introducing a
   one-off boolean. (Alternative: stack this branch on `notion-sync-export-fix` — noted in
   §5.)

3. **Scope of the configurable location → the SQLite history DB file.** Per the spec's wording
   ("where the SQLite DB lives"), the setting controls the folder holding `history.db`. The
   small JSON stores (`outbox`/`rankAnchors`/`manual`) stay in `userData` for now; folding them
   into SQLite for full-redundancy is explicit future work (§5). Confirm or widen to the whole
   `data/` dir at the gate.

---

## 1. Architecture & Approach

### A. Storage engine swap (`HistoryStore` → SQLite, interface-identical)

`HistoryStore` (`src/store/history.ts`) keeps its **exact public interface** and its
`constructor(dir: string)` / no-Electron-import contract — every consumer reaches it through
`type`-only imports and `Pick<HistoryStore, …>` (`src/main/matchPipeline.ts:22`,
`src/main/dataProvider.ts:30`), so swapping internals is invisible to them and to the browser
preview (which never imports the store — verified: the preview esbuild graph terminates at
`core/` + `shared/contract`).

Internals change from "whole array in memory, rewrite `history.json` on every mutation" to a
**hybrid SQLite table**: denormalized scalar columns for future analytics **plus** a full-record
JSON blob for lossless reconstruction (§3.1). This keeps `all()` returning identical
`GameRecord[]` (parse the blob) while giving a queryable substrate — the "more analytics"
motivation — *without* moving any analytics logic out of pure `core/` (guardrail #3 intact;
that's future SQL work, not this feature).

Method mapping (all semantics preserved, verified against `test/stores.test.ts` +
`test/reviewPipeline.test.ts`):
- `all()` → `SELECT data FROM games ORDER BY rowid` → `JSON.parse` each.
- `has(id)` / `add` → `INSERT … ON CONFLICT(matchId) DO NOTHING`, report inserted-or-not.
- `addMany` → one transaction, per-row insert-or-skip, return `{imported, skipped}`.
- `editManual` / `setReview` / `clearReview` / `setReviews` / `addScreenshots` → read row →
  patch the parsed `GameRecord` (same null-deletes-key logic) → `UPDATE` blob + denormalized
  cols in a transaction.
- `relabelAccount(from,to)` → `UPDATE games SET account=?, data=json_set(...)` (or read-patch-
  write) for matching rows; return count.
- `removeImported()` → `SELECT` then `DELETE WHERE importedAt IS NOT NULL`; return removed.
- `count()` / `importedCount()` → `SELECT COUNT(*)` (+ `WHERE importedAt IS NOT NULL`).

Durability: `PRAGMA synchronous=FULL`; **rollback journal (`journal_mode=DELETE`/`TRUNCATE`),
not WAL** — a single-process app gains nothing from WAL, and WAL's `-wal`/`-shm` sidecars
complicate cloud-synced folders (§C). SQLite's ACID commit **eliminates the current
silent-empty-fallback footgun** (`history.json` `load()` catch-returns-`[]` then overwrites) —
satisfies AC #4.

To keep files small (per project style), SQLite specifics live in a new
`src/store/historyDb.ts` (schema, open, statements); `history.ts` becomes a thin
interface-preserving wrapper over it. (Alternative: rewrite in place — decide during
`/implement`.)

### B. One-time migration (`history.json` → SQLite)

A new pure-ish helper `migrateJsonHistory(store, legacyJsonPath)` in
`src/store/historyMigration.ts`, called once from the composition root right after the store is
constructed:
- No-op if the DB already has rows (`store.count() > 0`) → idempotent, safe every launch (AC #2).
- Else if `legacyJsonPath` exists and parses to an array → `store.addMany(games)`.
- **Leaves `history.json` byte-for-byte untouched** and never writes it again (AC #1). The
  legacy file is the frozen safety copy.
- Corrupt/unreadable legacy JSON → log + skip (mirrors today's tolerant `load()`), never throws.

Legacy path is always the default `<userData>/data/history.json` even when the DB is relocated
(§C), so an upgrade migrates cleanly regardless of the configured DB folder.

### C. Configurable database location

New optional `AppConfig` field `historyDbFolder?: string` (default → `<userData>/data`),
following the exact persisted-setting pattern found in `src/main/config/appConfig.ts`
(`saveLocalConfig` + the `config = loadConfig()` re-read convention).

- **Composition root** (`src/main/index.ts:69`): resolve
  `const dbFolder = config.historyDbFolder || path.join(app.getPath('userData'), 'data')` and
  construct `new HistoryStore(dbFolder)` (opens `dbFolder/history.db`).
- **Guarded launch (AC #6):** if `historyDbFolder` is set but missing/unwritable, surface a
  blocking error (dialog + log) and **do not** silently create a fresh empty DB at a fallback
  location. Fail loud, never fake-empty.
- **Folder picker (net-new — no `showOpenDialog` exists today):** add
  `chooseDatabaseFolder(): Promise<string | undefined>` to the IPC contract; main handler calls
  `dialog.showOpenDialog(win, { properties: ['openDirectory'] })`. The dialog needs a
  `BrowserWindow`; `DashboardWindow` already holds `win` and owns `registerDashboardIpc`, and
  `DataProvider` is deliberately Electron-agnostic — so the dialog call is implemented in the
  composition root / window layer and exposed to the provider as an injected callback (mirrors
  how `apply()` for app settings lives in `index.ts`, not in the provider).
- **Relocation (AC #5):** on confirm, `HistoryStore.relocate(newDir)` → checkpoint/close the DB,
  move `history.db` to `newDir`, reopen at the new path (live, no restart); persist
  `historyDbFolder` via `saveLocalConfig` and re-read `config`. Because reads/writes go through
  the one reopened handle, "subsequent reads/writes use the new path" holds immediately.
- **Renderer:** a card in `renderer/src/views/settings.ts` following the `appBehaviorCard`
  `apply/paint` loop — show current folder + a `button('Choose folder…')` that calls
  `bridge.chooseDatabaseFolder()` then `bridge.setDatabaseFolder(dir)` and repaints. Include a
  short "point this at a OneDrive/Dropbox folder for off-machine backup" hint and the
  single-machine caveat.

### D. Notion round-trip parity

Assumes PR #24's foundation (see §0.2). Two concrete gaps close, plus one latent bug:

1. **SR-Δ column (`srDelta`)** — the one analytics-meaningful scalar with no Notion home today.
   Add a new **optional, presence-guarded** number column, exactly mirroring the `Played At`
   mechanism end-to-end (or, if stacked on #24, registered in its generalized
   optional/writable-column set):
   - `src/core/model/match.ts`: add `srDelta?: number` to `MatchRecord` (prerequisite — no slot
     exists today).
   - `src/notion/gametrackerSchema.ts`: `SR_DELTA_PROPERTY` + `hasSrDeltaColumn()`; include it in
     `buildGametrackerProperties()` for new DBs; **not** added to `REQUIRED_PROPERTIES` (legacy
     DBs still validate).
   - `src/notion/notionAdmin.ts`: `ValidateResult.hasSrDelta` from `hasSrDeltaColumn`.
   - `src/notion/notionWriter.ts`: guarded write `if (hasSrDelta && Number.isFinite(r.srDelta))`.
   - `src/notion/notionExporter.ts` (`gameToMatchRecord`): carry `srDelta: game.srDelta`.
   - `src/notion/notionImporter.ts`: `pickNumber(props['SR Δ'])` → `srDelta` (read needs no
     guard; Notion omits absent props).
   - `src/main/notionRuntime.ts`: thread `hasSrDelta` through `rebuild`/`validateConfigured`/
     `buildExporter` alongside `hasPlayedAt`.
2. **`finalScore` export fix (latent bug)** — the writer and importer both support `Final Score`,
   but `gameToMatchRecord` never copies `game.finalScore`, so it's silently dropped. One-line
   fix (`finalScore: game.finalScore`) in the same pass; add a regression test.
3. **Documented local-only exceptions unchanged** (AC #9): `screenshots`, `roster`, `perHero`
   (structure), extra named-target grades, `review.at`, `review.flags`, `importedAt`, and
   `source` (heuristic from matchId, not a real column). These are intentionally not synced.

Idempotency (AC #10) is already provided by the `OutboxStore` `processed` set on export and
`markManyProcessed` on import — no change needed; the round-trip test asserts it.

### E. What does **not** change
`core/` purity, GEP-only ingestion, the single CSP-friendly renderer bundle, the release/signing
pipeline (node:sqlite adds nothing to package), and the browser preview.

---

## 2. Affected Files / Modules

**New**
- `src/store/historyDb.ts` — node:sqlite schema, open/close/relocate, prepared statements.
- `src/store/historyMigration.ts` — `migrateJsonHistory(store, legacyJsonPath)`.
- `src/types/node-sqlite.d.ts` — scoped ambient typings for the `node:sqlite` subset used.
- Tests: `test/historyStoreSqlite.test.ts`, `test/historyMigration.test.ts`,
  `test/notionRoundTrip.test.ts`, `test/dataDirRelocation.test.ts` (+ a pure resolver test).

**Changed — storage/config**
- `src/store/history.ts` — internals → SQLite via `historyDb.ts`; interface unchanged; add
  `relocate(newDir)`.
- `src/main/index.ts` — resolve `dbFolder` from config, guarded construction, run migration,
  wire folder-picker + relocation callbacks.
- `src/main/config/appConfig.ts` — `historyDbFolder?: string` in `AppConfig` + `DEFAULTS`.
- `src/shared/contract/api.ts` + `appSettings.ts` — `chooseDatabaseFolder()`,
  `setDatabaseFolder(path)` (or fold folder into `AppUiSettings` + a picker method) with
  `IPC_CHANNELS` entries (compile-enforced).
- `src/main/dashboard/ipcHandlers.ts` + `src/main/dashboard/provider.ts` +
  `src/main/dataProvider.ts` — new handler + provider methods.
- `renderer/src/views/settings.ts` — database-folder card.
- `package.json` (`devDependencies`) — bump `@types/node` **only if** we choose the bump over
  the ambient d.ts (§3.5).

**Changed — Notion parity** (assuming #24 base)
- `src/core/model/match.ts`, `src/notion/gametrackerSchema.ts`, `notionAdmin.ts`,
  `notionWriter.ts`, `notionExporter.ts`, `notionImporter.ts`, `src/main/notionRuntime.ts`.
- Tests extended: `test/gametrackerSchema.test.ts`, `test/notionExporter.test.ts`,
  `test/notionImporter.test.ts`.

**Docs:** `README` — new storage engine, configurable DB folder + backup guidance, new Notion
column.

---

## 3. Data Model / Interfaces

### 3.1 SQLite schema (`games`)
```
CREATE TABLE IF NOT EXISTS games (
  matchId          TEXT PRIMARY KEY,
  timestamp        INTEGER NOT NULL,
  account          TEXT,
  role             TEXT,
  map              TEXT,
  result           TEXT,
  gameType         TEXT,
  source           TEXT,
  srDelta          REAL,
  durationMinutes  REAL,
  importedAt       INTEGER,
  data             TEXT NOT NULL          -- JSON.stringify(GameRecord), lossless
);
CREATE INDEX IF NOT EXISTS idx_games_account   ON games(account);
CREATE INDEX IF NOT EXISTS idx_games_timestamp ON games(timestamp);
CREATE INDEX IF NOT EXISTS idx_games_map        ON games(map);
CREATE INDEX IF NOT EXISTS idx_games_role       ON games(role);
```
`data` is the source of truth for `GameRecord` reconstruction (guarantees lossless `all()`);
scalar columns are denormalized copies for future SQL analytics. Writes populate both inside a
transaction. A `meta(key,value)` table holds a `schemaVersion` for future migrations.

### 3.2 Config
`AppConfig.historyDbFolder?: string` — absent ⇒ `<userData>/data`. Persisted via existing
`saveLocalConfig`; read back via `config = loadConfig()`.

### 3.3 IPC additions (`OwStatsApi` + `IPC_CHANNELS`)
- `chooseDatabaseFolder(): Promise<string | undefined>` → `'settings:choose-db-folder'`
- `setDatabaseFolder(path: string): Promise<AppUiSettings /* or a small result DTO */>` →
  `'settings:set-db-folder'` (relocates + persists, returns the applied state).

### 3.4 `HistoryStore` additions
- `relocate(newDir: string): void` — close, move `history.db`, reopen at `newDir/history.db`.
- Everything else identical in signature and behavior.

### 3.5 `node:sqlite` typings
Ship `src/types/node-sqlite.d.ts` with a minimal `declare module 'node:sqlite'` covering
`DatabaseSync`, `.prepare()`, `.exec()`, and `StatementSync.{run,get,all}`. Low-risk and scoped;
avoids a global `@types/node` major bump. (Alternative: bump `@types/node` to a version shipping
the typings — more "correct" but risks type churn; decide in `/implement`.)

---

## 4. Test Strategy (maps to acceptance criteria)

Follows existing conventions: real tmp dirs (`fs.mkdtempSync`/`rmSync`), cross-instance reload
to prove disk persistence, plain object client mocks (no `vi.mock`), local `game()` factories,
core stays pure.

- **AC 1–4 (storage + migration):**
  - `test/historyStoreSqlite.test.ts` — a **shared contract suite**
    `describeHistoryStoreContract(factory)` asserting behavioral parity for every method +
    dedupe + reload-from-disk, run against the SQLite store (reuses the existing
    `stores.test.ts` / `reviewPipeline.test.ts` HistoryStore assertions test-for-test). Real DB
    files in a tmp dir (mirrors the "survives reload" idiom), not `:memory:`.
  - `test/historyMigration.test.ts` — seed a real `history.json` (as `manualLog.test.ts` seeds
    legacy JSON), assert faithful import of all fields incl. `srDelta`/`review`/`mental`,
    idempotency on second run, `history.json` left unmodified, corrupt-JSON handled gracefully.
  - Crash/atomicity (AC 4): assert a partially-written/aborted transaction leaves prior rows
    intact and never yields an empty read.
- **AC 5–6 (configurable location):**
  - Pure resolver (`configuredFolder → effective db path`, default fallback, validation)
    unit-tested directly, no Electron/fs.
  - `test/dataDirRelocation.test.ts` — two tmp dirs; write games, `relocate(newDir)`, assert
    data intact at the new path and the store reads/writes there; assert a missing/unwritable
    target is rejected (AC 6) rather than silently re-created empty. The `dialog`/`app.getPath`
    wrappers stay thin and untested (matches the existing no-mock-Electron convention).
- **AC 7–10 (Notion parity):**
  - `test/gametrackerSchema.test.ts` — `hasSrDeltaColumn` + optional-column validation (mirrors
    the `Played At` tests).
  - `test/notionExporter.test.ts` — `NotionWriter — SR Delta round-trip` block (guarded write,
    mirrors Played-At block) + a `finalScore` export regression test.
  - `test/notionImporter.test.ts` — `srDelta` in the `row()` fixture + a `NotionImporter — SR
    delta` describe.
  - `test/notionRoundTrip.test.ts` — build a full `GameRecord`, run through
    `gameToMatchRecord` + a fake `pages.create` to capture properties, feed those into the
    importer, assert all synced fields (incl. `srDelta`, `finalScore`) reconstruct and documented
    exceptions are absent; assert re-export is a no-op via the outbox (AC 10).
- **AC 11 (DoD):** `npm test` + `npm run typecheck` (main + renderer) green; README updated.

---

## 5. Risks & Alternatives

- **PR #24 dependency (highest).** The Notion half continues #24. *Mitigation/recommendation:*
  merge #23 + #24 first, branch off updated `main`, and implement SR-Δ via #24's generalized
  optional-column mechanism. *Alternative:* stack this branch on `notion-sync-export-fix`
  (faster to start, but rebases if #24 changes in review). **Needs your call at the gate.**
- **`node:sqlite` experimental status.** Stable API surface for our basic DDL/DML, baked into
  the pinned ow-electron runtime (won't shift under us without an ow-electron bump), and the DB
  file is portable to `better-sqlite3` later if we ever want off it. *Mitigation:* isolate all
  node:sqlite calls in `historyDb.ts` behind the stable `HistoryStore` interface, so swapping
  the driver later touches one file. Silence the first-use `ExperimentalWarning` if noisy.
- **Cloud-synced folder + live DB.** A sync client uploading mid-write, or two machines writing
  the synced file, can corrupt SQLite. *Mitigation:* rollback-journal (single main file, no
  WAL sidecars) + `synchronous=FULL`; document single-machine-only redundancy (already a spec
  non-goal); Notion remains the true portable backup.
- **Configurable-location scope.** Covering only `history.db` leaves `rankAnchors`/`manual`
  (genuine user data) un-redundant. *Alternative:* relocate the whole `data/` dir (all four
  stores already take `dataDir`) — more complete but re-points 4 stores and likely wants a
  restart-to-apply. *Recommendation:* ship history-DB-only now; fold the other stores into
  SQLite later, which closes the gap cleanly.
- **Bootstrap stays synchronous** thanks to `node:sqlite`'s sync API — no async refactor of
  `main()` (which constructs all stores synchronously before window/IPC). Had we picked WASM,
  the whole bootstrap chain would have needed to go async.
- **`@types/node` typings gap** — mitigated by the scoped ambient d.ts (§3.5); the bump is the
  fallback.

---

## Open items for `/breakdown`
- Confirm §0 decisions (driver, base-branch sequencing, location scope).
- Final Notion column display name for SR-Δ (`SR Δ` vs `SR Delta`) and whether to also write the
  real `Source` (Auto/Manual from `game.source`) as a small fidelity win.
- Whether `history.ts` is refactored to wrap `historyDb.ts` or rewritten in place.
