# Tasks: `sqlite-storage-notion-sync`

Derived from [`sqlite-storage-notion-sync.plan.md`](./sqlite-storage-notion-sync.plan.md).
Decisions taken (autonomous run): driver = `node:sqlite`; base = stacked on
`notion-sync-export-fix` (PR #24); configurable location = history DB file only; typings =
scoped ambient d.ts.

- [ ] **T1 — node:sqlite typings shim** _(S)_
  - Goal: `import { DatabaseSync } from 'node:sqlite'` typechecks under `@types/node@20`.
  - Files: `src/types/node-sqlite.d.ts`.
  - Check: `npm run typecheck` clean with a file importing it.
  - Enables: AC 1–6, 11.

- [ ] **T2 — SQLite-backed HistoryStore** _(L)_
  - Goal: replace JSON internals with a node:sqlite `games` table (denormalized cols + JSON
    blob), preserving the public interface exactly; add `relocate(newDir)`.
  - Files: `src/store/history.ts` (+ optional `src/store/historyDb.ts`).
  - Check: `test/historyStoreSqlite.test.ts` — shared contract suite (every method, dedupe,
    reload-from-disk) green; AC 3, 4 (ACID, no empty-fallback).

- [ ] **T3 — history.json → SQLite migration** _(M)_
  - Goal: one-time import of a legacy `history.json`, idempotent, leaves JSON untouched.
  - Files: `src/store/historyMigration.ts`.
  - Check: `test/historyMigration.test.ts` — faithful import, idempotent 2nd run, JSON
    unmodified, corrupt-JSON tolerated; AC 1, 2.

- [ ] **T4 — Config field + composition-root wiring** _(M)_
  - Goal: `AppConfig.historyDbFolder?`; resolve effective DB folder; guarded construction
    (fail loud if configured folder unwritable); run migration on boot.
  - Files: `src/main/config/appConfig.ts`, `src/main/index.ts`, small pure resolver.
  - Check: resolver unit test; app boots on demo dataset; AC 2, 6.

- [ ] **T5 — Configurable-location IPC + picker + renderer** _(L)_
  - Goal: `chooseDatabaseFolder()` + `setDatabaseFolder()` end to end; live relocate; settings
    card with backup hint + single-machine caveat.
  - Files: `src/shared/contract/{api,appSettings}.ts`, `src/main/dashboard/{ipcHandlers,provider}.ts`,
    `src/main/dataProvider.ts`, `src/main/index.ts`, `renderer/src/views/settings.ts`.
  - Check: `test/dataDirRelocation.test.ts` (two tmp dirs, data intact, unwritable rejected);
    typecheck (contract satisfies); AC 5, 6.

- [ ] **T6 — Notion SR-Δ column (guarded, symmetric)** _(M)_
  - Goal: add optional `SR Δ` number column; write guarded, read symmetric; new DBs include it.
  - Files: `src/core/model/match.ts`, `src/notion/{gametrackerSchema,notionAdmin,notionWriter,notionExporter,notionImporter}.ts`, `src/main/notionRuntime.ts`.
  - Check: extended `gametrackerSchema`/`notionExporter`/`notionImporter` tests; AC 7, 8.

- [ ] **T7 — finalScore export fix** _(S)_
  - Goal: stop silently dropping `game.finalScore` in `gameToMatchRecord`.
  - Files: `src/notion/notionExporter.ts`.
  - Check: regression test in `notionExporter.test.ts`; AC 7.

- [ ] **T8 — Round-trip parity test** _(M)_
  - Goal: prove Vantage→Notion→Vantage reconstructs all synced fields (incl. srDelta,
    finalScore, mental) and documented exceptions stay absent; re-export is a no-op.
  - Files: `test/notionRoundTrip.test.ts`.
  - Check: green; AC 7, 9, 10.

- [ ] **T9 — Docs** _(S)_
  - Goal: README covers the SQLite engine, configurable DB folder + backup guidance, new column.
  - Files: `README.md`.
  - Check: docs reflect user-visible changes; AC 11.

## Consistency check (spec ↔ tasks)

| Acceptance criterion | Covered by |
|---|---|
| 1 migrate on launch, JSON frozen, identical dataset | T2, T3, T4 |
| 2 JSON not re-read, SQLite sole source of truth | T3, T4 |
| 3 every HistoryStore method behaves identically | T2 |
| 4 crash-safe, no silent empty | T2 |
| 5 relocate live, survives restart | T5 |
| 6 missing/unwritable configured path → clear error, no silent empty | T4, T5 |
| 7 full synced-field round-trip | T6, T7, T8 |
| 8 missing new column added additively, existing untouched | T6 |
| 9 documented local-only fields intentionally absent | T8 |
| 10 idempotent both directions | T8 |
| 11 tests + typecheck + docs (DoD) | all + T9 |

**Gaps:** none — every acceptance criterion maps to ≥1 task.
**Scope creep:** none — every task traces to ≥1 criterion (T7 is a latent-bug fix that directly
serves AC 7's "all synced fields").
