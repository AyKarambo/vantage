# Tasks: data-import-script

Derived from [data-import-script.plan.md](./data-import-script.plan.md). Ordered so
dependencies come first. Each task is small and individually reviewable.

- [x] **T1 — `importSource` on GameRecord** · Size S
  - **Goal:** Add the typed provenance field so file-imports can be discriminated from Notion imports.
  - **Files:** `src/core/analytics/types.ts` (add `importSource?: 'notion' | 'file'` with JSDoc; correct the `importedAt` JSDoc that says "only … from Notion").
  - **Check:** `npm run typecheck` clean; field visible on `GameRecord`. No behavior change yet.

- [x] **T2 — HistoryStore: column, migration, source-scoped clear/count** · Size M
  - **Goal:** Persist `importSource`, add the repo's first idempotent migration, and make clear/count filter by source so file-imports are independently clearable (AC8) without breaking Notion.
  - **Files:** `src/store/history.ts` (add `importSource TEXT` to `SCHEMA_SQL`; denormalize in `rowValues`/`INSERT_SQL`/`UPDATE_SQL`; `PRAGMA table_info` + `ALTER TABLE … ADD COLUMN` in `open()`; `removeImported(source)` / `importedCount(source)` scoped via `WHERE importedAt IS NOT NULL AND COALESCE(importSource,'notion') = ?`). Update the two Notion callers to pass `'notion'` and stamp `importSource:'notion'` at add (`src/main/dataProvider.ts` importNotion/deleteImportedMatches/importedMatches). Update the Notion provider test fake (`test/importNotionProvider.test.ts`). New `test/importFileStore.test.ts`.
  - **Check:** `test/importFileStore.test.ts` proves `removeImported('file')` deletes only file rows (keeps `'notion'`, legacy-NULL-as-notion, and live rows), `importedCount` is scoped, and reopening a column-less DB adds the column. Existing `importNotionProvider.test.ts` stays green.

- [x] **T3 — Core `importEnvelope.ts` validator** · Size M
  - **Goal:** Pure, Electron/Node-free parse + per-row validate/normalize of the import envelope into `{ games, anchor?, errors }`, rejecting bad rows without throwing.
  - **Files:** `src/core/importEnvelope.ts` (new; import `TIERS` from `src/core/rank`, `resolveResult` from resolvers); `test/importEnvelope.test.ts` (new).
  - **Check:** `test/importEnvelope.test.ts`: bad/missing `result` → `errors` entry (not thrown, row dropped); `srDelta:0` kept; timestamp clamped to `opts.now`; anchor with bad tier/division/pct dropped + error; non-object envelope → single envelope-level error, empty `games`.

- [x] **T4 — IPC contract surface** · Size S
  - **Goal:** Declare the typed import methods + result DTOs end-to-end so main can implement and renderer can call them.
  - **Files:** `src/shared/contract/api.ts` (add `importFromFile`, `deleteFileImports`, `fileImportedCount` to `OwStatsApi`; add channels to `IPC_CHANNELS`), `src/shared/contract/index.ts` (export `ImportFileResult` DTO).
  - **Check:** `npm run typecheck` fails only because `createDataProvider` doesn't yet implement the methods (the `satisfies`/interface guard is active) — confirming the contract is wired; resolved by T5.

- [x] **T5 — Provider + main wiring** · Size M
  - **Goal:** Implement ingestion: dialog+read+parse at the edge, `addMany` (stamp `importedAt`+`importSource:'file'`), account seeding, anchor at the newest match, and independent clear/count.
  - **Files:** `src/main/dataProvider.ts` (`importFromFile`/`deleteFileImports`/`fileImportedCount`; add `importFile: { pick(): Promise<unknown | undefined> }` to `DataProviderDeps`; call `parseVantageImport`, `seedImportedAccounts`, `rankAnchors.set({…, setAt: min(latestCompTs, now)})` directly — **not** `setRankAnchor`). `src/main/index.ts` (`pickImportFile()` copying `pickDataFolder` with `properties:['openFile']` + json filter, `fs.readFileSync`+`JSON.parse`; supply the `importFile` slice in `createDataProvider`). `src/main/dashboard/ipcHandlers.ts` (register the 3 channels via `handle()`). New `test/importFileProvider.test.ts`.
  - **Check:** `test/importFileProvider.test.ts`: import a 2-game envelope → `{imported:2,skipped:0}`, rows carry `importSource:'file'`; re-import same → `{imported:0,skipped:2}` (AC7); `deleteFileImports` keeps a live row then re-import matches new set (AC9); anchor present → `rankAnchors.set` called once with `setAt===max comp ts` (not `Date.now()`) + `Lampenlicht` seeded (AC10); anchor absent → not called, existing anchor untouched (AC11); cancelled `pick()` → no writes, `{cancelled:true}` (AC12 path); malformed raw → surfaced as invalid, nothing written (AC12).

- [x] **T6 — Settings → Data import card (+ help panel)** · Size M
  - **Goal:** In-app UI: import button + result line, remove-imported button + confirm modal, and a collapsible import-format help panel.
  - **Files:** `renderer/src/views/settings/importCard.ts` (new; `h()` composition, `.hint`/`mono`, collapsible via local boolean re-render à la `builder.ts:149-176`, confirm modal à la `syncCard.ts:154`); compose it into the Settings → Data screen (next to `dataLocation.ts`); use `await bridge.importFromFile()` / `bridge.deleteFileImports()` / `bridge.fileImportedCount()` + `void store.refresh()`.
  - **Check:** `npm run typecheck` (renderer) clean; preview harness shows the card with a working import button, a confirmable remove, and a toggleable help panel documenting the envelope (AC13).

- [x] **T7 — PowerShell transform script** · Size L
  - **Goal:** Convert an Obsidian vault into a Vantage import file, zero-dependency, idempotent, with rank prompt + map canonicalization.
  - **Files:** `scripts/import-obsidian.ps1` (new; `sign-local.ps1` template — `#` header, `param` PascalCase, validate+`exit 1`, 4-space/double-quote); optional `package.json` dev alias `import:obsidian`.
  - **Check:** Run on the sample vault → `vantage-import.json` with 97 games (empty file skipped + reported) (AC1); byte-identical `matchId`s across two runs (AC2); a `2026-07-05 18:42` match → correct local-time epoch (AC4); 5★→`performance:100`, 1★→0 (AC3); `Watchpoint Gibraltar`→`Watchpoint: Gibraltar`, `Neon Junction`→`Neon Junktion` (AC6); `sr_change:0` kept, partner dropped (AC5).

- [x] **T8 — Docs + final verification** · Size S
  - **Goal:** Document the script + envelope for the friend and future sources, link from README, and verify the end-to-end DoD.
  - **Files:** `docs/import.md` (new — run the script, rank prompt, envelope format, tz/anchor caveats); `README.md` (link from Development section).
  - **Check:** `npm test` + `npm run typecheck` (main + renderer) green (AC14); `docs/import.md` matches the in-app help panel; sample-vault run documented.

---

## Consistency gate (acceptance-criteria trace)

| AC (spec) | Covered by | Verified in |
|---|---|---|
| AC1 vault→file, 97 games, skip empty | T7 | T7/T8 (sample run) |
| AC2 deterministic ids | T7 | T7 (two-run diff) |
| AC3 star→100 mapping | T7 (script maps) | T7 (inspect output JSON) |
| AC4 local timezone | T7 | T7 |
| AC5 dirty-data handling | T7 (script skip/keep/drop) + T3 (row missing `result` → error) | T3 test + T7 |
| AC6 map reconciliation & alias | T7 | T7 |
| AC7 idempotent ingest | T5 (`addMany` dedup) | T5 test |
| AC8 marked & independently clearable | T2 (store scope) + T5 (`deleteFileImports`) | T2 + T5 tests |
| AC9 wipe-and-re-import re-sync | T5 | T5 test |
| AC10 anchor & reconstruction | T5 (anchor at latest, direct store) | T5 test |
| AC11 anchor optional & non-destructive | T5 | T5 test |
| AC12 malformed rejected cleanly | T3 (envelope-level error) + T5 (no writes) | T3 + T5 tests |
| AC13 import-format help | T6 (panel) + T8 (docs) | T6 preview + T8 |
| AC14 Definition of Done | all + T8 | T8 (`npm test`/`typecheck`) |

- **Gaps (AC with no task):** none.
- **Scope creep (task with no AC):** none — T1 enables AC8's marking; T4 enables the AC7/8/9/12 IPC surface; both trace to criteria.
- **Note on AC3:** the star→100 mapping lives in the PowerShell script (the neutral envelope carries 0–100), so it is verified by inspecting the script's output JSON rather than by a vitest case; the core validator only checks `performance` is a finite number. No spec/plan revision needed.
