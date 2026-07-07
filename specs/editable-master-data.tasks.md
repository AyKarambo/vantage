# Tasks: Editable & Updatable Master Data

Ordered dependencies-first. Each task is individually reviewable. Sizes: S/M/L.

- [x] **T1 — Core types & default snapshot**
  - Goal: `MasterData`/entry/patch/override/preview types + `DEFAULT_MASTER_DATA` (heroes from `HEROES_BY_ROLE`, maps from `MAP_MODES`, seasons from `SEASON_STARTS`; Paris + Horizon Lunar Colony as `isActive:false`).
  - Files: `src/core/masterData/types.ts`, `defaults.ts`, `index.ts`; `test/masterData.defaults.test.ts`.
  - Check: defaults test — every current map active, withheld two inactive; hero/season counts match sources. (AC 31)
  - Size: M

- [x] **T2 — Merge (defaults ⊕ overrides)**
  - Goal: `mergeMasterData` + per-category merge; identity keys; `isActive` default true; tombstone removes; dedupe user-add vs default.
  - Files: `src/core/masterData/merge.ts`; `test/masterData.merge.test.ts`.
  - Check: tests for add/edit/remove; missing isActive ⇒ active; user-add later shipped as default appears once; edits survive changed defaults. (AC 1,2,3,16,17,26,30)
  - Size: M

- [x] **T3 — Mode-mapping + OverFast parsing/validation**
  - Goal: `modeMap.ts` (comp→MapMode, arcade dropped, unknown-comp→Unknown) + `overfast.ts` (untrusted parse → validated entries).
  - Files: `src/core/masterData/modeMap.ts`, `overfast.ts`; `test/masterData.overfast.test.ts`.
  - Check: valid payload parses; unmapped mode ⇒ Unknown; malformed/partial rejected; arcade maps dropped. (AC 10,14)
  - Size: M

- [x] **T4 — Diff + apply (accept/patch)**
  - Goal: `diffMasterData` (additions+changes over name/role & name/mode, isActive excluded); `apply.ts` upsert/remove-override + `applyAccepted`.
  - Files: `src/core/masterData/diff.ts`, `apply.ts`; `test/masterData.diff.test.ts`, `test/masterData.apply.test.ts`.
  - Check: additions/changes correct; no change when only isActive differs; accept addition ⇒ isActive:true; accept mode-change preserves isActive:false; role-change ⇒ patch; up-to-date ⇒ empty; rename ⇒ add + orphan retained. (AC 5,8,9,11,12,27,28,29)
  - Size: L

- [x] **T5 — Season DI (editable starts, keep cadence)**
  - Goal: thread optional `starts?: readonly number[]` (default `SEASON_STARTS`) through season fns; `startsFromSeasons(entries)` helper.
  - Files: `src/core/season.ts`; extend `test/season.test.ts`.
  - Check: injected user starts change window list/boundary; no arg ⇒ identical to today; cadence still advances past last known. (AC 18,19,20)
  - Size: M

- [x] **T6 — Analytics/generator/notion DI**
  - Goal: `computeDashboard(..., masterData?)` (mapMode resolver + season starts from it; attach `masterData` to output); `matchDetail(..., mapResolver?)`; `generateSampleGames(..., activeMaps?)`; `NotionAdmin(effectiveMaps?)`.
  - Files: `src/core/dashboardData.ts`, `src/core/matchDetail.ts`, `src/core/sampleData/generate.ts`, `src/notion/notionAdmin.ts`; extend tests.
  - Check: existing suites green untouched; with effective data, byMapType uses edited modes, generator draws active-only (fallback all), notion iterates all maps. (AC 2,23,24,32)
  - Size: L

- [x] **T7 — Override store (data folder)**
  - Goal: `MasterDataStore` (atomic `masterData.json`, `all/upsert/remove` per category, `relocate`).
  - Files: `src/store/masterData.ts`; `test/masterDataStore.test.ts`.
  - Check: round-trip persist; relocate moves file; corrupt/missing ⇒ empty overrides. (AC 7,17)
  - Size: M

- [x] **T8 — Fetch edge**
  - Goal: `fetchOverfast(baseUrl, timeoutMs)` via `net.fetch` + timeout race; returns parsed heroes+maps or throws.
  - Files: `src/main/masterDataUpdate.ts`.
  - Check: builds; timeout/HTTP-error path throws a clear error (surfaced by caller). (AC 13,15)
  - Size: S

- [x] **T9 — Config + appsettings endpoint**
  - Goal: `AppConfig.masterData.overfastBaseUrl` (+ default); merged in `loadConfig`; `appsettings.json` documented key.
  - Files: `src/main/config/appConfig.ts`, `src/main/config/index.ts`, `appsettings.json`.
  - Check: typecheck; default endpoint present; overridable. (Constraints: configurable endpoint)
  - Size: S

- [x] **T10 — IPC contract**
  - Goal: add masterData methods to `OwStatsApi` + `IPC_CHANNELS`; add `masterData: MasterData` to `DashboardData`.
  - Files: `src/shared/contract/api.ts`, `src/shared/contract/types.ts` (+ barrel).
  - Check: typecheck (preload auto-generates); contract compiles with `satisfies`. (AC 5,7)
  - Size: S

- [x] **T11 — Provider + handlers + composition**
  - Goal: implement provider masterData methods (store+core, return effective); pass effective data into computeDashboard/matchDetail/generator/notionAdmin; register handlers; construct store+updater in `index.ts`; relocate on data-folder change.
  - Files: `src/main/dashboard/provider.ts`, `src/main/dataProvider.ts`, `src/main/dashboard/ipcHandlers.ts`, `src/main/index.ts`.
  - Check: typecheck; dashboard payload carries masterData; fetch+apply round-trip works in preview harness. (AC 5,6,7,13)
  - Size: L

- [x] **T12 — Renderer: Master Data editor + Update modal**
  - Goal: Settings "Master Data" card — Heroes/Maps/Seasons CRUD, isActive chip, muted inactive maps, **Update** button → preview modal (accept/discard per item) → applyUpdate → repaint + `store.refresh()`.
  - Files: `renderer/src/views/settings.ts` (+ small helpers/components as needed).
  - Check: preview harness — add/edit/remove persists; toggle isActive; Update shows additions/changes, accept persists, discard no-ops; inactive rows muted. (AC 1,2,3,5,6,7,9,33)
  - Size: L

- [x] **T13 — Renderer consumers read effective data**
  - Goal: `log-match.ts` suggestions (active-only browse, full-list resolve), `matchDetail.ts` dropdown (active + keep current inactive selected), `overview.ts` scatter mode — all from `ctx.data.masterData`.
  - Files: `renderer/src/app/log-match.ts`, `renderer/src/views/matchDetail.ts`, `renderer/src/views/overview.ts`.
  - Check: preview harness — inactive map absent from log-match browse but still type-resolvable; match on inactive map keeps it selected; historical inactive-map analytics unaffected. (AC 4,21,22,23,25,26)
  - Size: M

- [x] **T14 — Docs**
  - Goal: README/docs note the Update action, editable master data, and the new (opt-in, user-initiated) outbound path to OverFast.
  - Files: `README.md`, relevant `docs/`.
  - Check: docs mention the feature + outbound path. (AC 34)
  - Size: S

- [x] **T15 — Full verification**
  - Goal: `npm test` + `npm run typecheck` (main + renderer) green; preview-harness smoke of the flows.
  - Files: —
  - Check: both commands clean. (AC 34)
  - Size: S

## Consistency check (spec AC → task)

| AC | Tasks |
|----|-------|
| 1 add hero appears/persists | T2, T12 |
| 2 edit map mode reflected | T2, T6, T12 |
| 3 remove leaves history intact | T2, T6, T13 |
| 4 unknown hero/map still ingested | T13 (no gating on ingest) |
| 5 Update preview additions+changes | T4, T10, T11, T12 |
| 6 discard no-ops | T11, T12 |
| 7 accept persists + editable | T4, T7, T11, T12 |
| 8 manual edit surfaced as change | T4, T12 |
| 9 up-to-date empty | T4, T12 |
| 10 unmapped mode ⇒ Unknown | T3 |
| 11 role change history-immutable | T4, T5/T6 (new-only), T13 |
| 12 rename ⇒ add + orphan | T4 |
| 13 API down ⇒ snapshot + clear error | T8, T11 (defaults are snapshot) |
| 14 malformed rejected | T3 |
| 15 no personal data sent | T8 |
| 16 dedupe user-add vs later default | T2 |
| 17 overrides survive changed defaults | T2, T7 |
| 18 Update ignores seasons | T5, T11 |
| 19 cadence still advances | T5 |
| 20 edited season used | T5, T12 |
| 21 inactive not browsed (log-match) | T13 |
| 22 inactive still resolves typed | T13 |
| 23 inactive history aggregates by mode | T6, T13 |
| 24 generator active-only + fallback | T6 |
| 25 match-detail keeps inactive selected | T13 |
| 26 inactive hides suggestions only | T2, T13 |
| 27 isActive not a change in diff | T4 |
| 28 accept mode-change preserves isActive | T4 |
| 29 new map ⇒ isActive:true | T4 |
| 30 pre-feature overrides ⇒ active | T2 |
| 31 withheld ship inactive | T1 |
| 32 Notion export all maps | T6, T11 |
| 33 muted inactive in editor only | T12 |
| 34 tests+typecheck+docs green | T14, T15 |

**Gaps:** none — every acceptance criterion maps to ≥1 task.
**Scope creep:** none — every task traces to ≥1 criterion (T8/T9 infra support AC 13/15 and the configurable-endpoint constraint).
