# Techplan: Editable & Updatable Master Data

**Slug:** `editable-master-data` · Derives the HOW from `editable-master-data.spec.md`.

## Architecture & Approach

The three static tables (`heroes.ts`, `maps.ts`, `season.ts`) stay as the **compiled-in
default snapshot**. On top of them we add:

1. **A pure `core/masterData` module** — the effective-data model (`MasterData`),
   override deltas, merge, diff (Update), OverFast parsing/validation, mode-mapping, and
   the accept/patch logic. All Electron-free and unit-tested (Guardrail 3).
2. **A data-folder override store** (`src/store/masterData.ts`) holding only user
   **deltas** (add/edit/remove), atomic writes + `relocate()`, mirroring
   `manualLog.ts`/`rankAnchors.ts`. Deltas (not full lists) keep the feature update-safe:
   new bundled defaults always show through; user edits layer on top (spec AC 16–17).
3. **A main-process fetch edge** (`src/main/masterDataUpdate.ts`) using Electron `net.fetch`
   + a timeout race to GET OverFast `/heroes` and `/maps`. This is the only new outbound
   path; it is user-initiated and sends no personal data (Guardrail 5).
4. **Effective data flows two ways:** (read) attached to the `DashboardData` payload so
   renderer views read `ctx.data.masterData`; (write) intent-level IPC methods
   (`upsert*`/`remove*`/`fetchUpdate`/`applyUpdate`) that persist deltas and return fresh
   effective `MasterData`. Provider recomputes `mergeMasterData(defaults, store.all())`.
5. **Consumers switch to injected effective data** via optional params defaulting to the
   built-ins, so every existing unit test passes unchanged.

### Effective-data flow

```
DEFAULT_MASTER_DATA (core, compiled)  ─┐
                                       ├─►  mergeMasterData()  ─►  effective MasterData
MasterDataStore.all() (data folder)  ──┘         │
                                                 ├─► DashboardData.masterData (→ renderer read)
                                                 ├─► mapMode resolver → computeDashboard/matchDetail
                                                 ├─► active maps → sample generator
                                                 └─► season starts → seasonsForData/seasonWindowById
```

### Update (fetch → preview → accept) flow

```
renderer "Update"  ─►  masterDataFetchUpdate (IPC)
   main: net.fetch OverFast /heroes,/maps  ─►  parse+validate (untrusted)  ─►  MasterData(fetched)
   core: diffMasterData(effective, fetched)  ─►  { additions, changes }  (over name/role, name/mode only; isActive excluded)
   renderer: preview modal (accept/discard per item)
renderer accept  ─►  masterDataApplyUpdate(accepted) (IPC)
   core: applyAccepted(overrides, accepted)  ─►  overrides'  (additions isActive:true; changes preserve isActive)
   store.save() → provider returns fresh effective → editor repaints + store.refresh()
```

## Affected Files / Modules

**New (pure core — tested):**
- `src/core/masterData/types.ts` — `MasterData`, `HeroEntry`, `MapEntry`, `SeasonEntry`, patch/override types, `UpdatePreview`, `AcceptedUpdate`.
- `src/core/masterData/defaults.ts` — `DEFAULT_MASTER_DATA` assembled from `HEROES_BY_ROLE`, `MAP_MODES`, `SEASON_STARTS`; adds known-withheld maps (Paris, Horizon Lunar Colony) as `isActive:false` (AC 31).
- `src/core/masterData/merge.ts` — `mergeMasterData`, per-category merge (identity keys: hero name, `normalizeMapName`, `S:<iso>`; `isActive` default true; tombstone removes; dedupe vs defaults).
- `src/core/masterData/modeMap.ts` — OverFast gamemode string → `MapMode` (comp modes mapped; arcade modes dropped; unrecognized comp-like → `Unknown`, AC 10).
- `src/core/masterData/overfast.ts` — `parseOverfastHeroes`/`parseOverfastMaps` (untrusted → validated `MasterData`; malformed rejected, AC 14).
- `src/core/masterData/diff.ts` — `diffMasterData` (additions + changes; `isActive` excluded, AC 27–28).
- `src/core/masterData/apply.ts` — `upsert*Override`/`remove*Override`/`applyAccepted` (returns new overrides; edits that match a default drop the patch).
- `src/core/masterData/index.ts` — barrel.

**New (edges):**
- `src/store/masterData.ts` — `MasterDataStore` (atomic JSON, `relocate`).
- `src/main/masterDataUpdate.ts` — `fetchOverfast(baseUrl, timeoutMs)` via `net.fetch`.

**Changed (DI, backward-compatible):**
- `src/core/dashboardData.ts` — `computeDashboard(..., masterData?)`: build mapMode resolver + season starts from it, attach `masterData` to output; default = `DEFAULT_MASTER_DATA`.
- `src/core/matchDetail.ts` — `matchDetail(..., mapResolver?)`.
- `src/core/season.ts` — thread optional `starts?: readonly number[]` (default `SEASON_STARTS`) through `seasonStart`/`currentSeason`/`seasonStartsThrough`/`currentSeasonWindow`/`seasonsForData`/`seasonWindowById`; add `startsFromSeasons(entries)` helper.
- `src/core/sampleData/generate.ts` — `generateSampleGames(count, seed, activeMaps?)` (active-only, fallback to all).
- `src/notion/notionAdmin.ts` — constructor takes effective maps (all, active+inactive) (AC 32).
- `src/shared/contract/api.ts` — add masterData methods to `OwStatsApi` + `IPC_CHANNELS`; add `masterData` to `DashboardData` type (in `contract/types`).
- `src/main/dashboard/provider.ts` + `src/main/dataProvider.ts` — implement masterData methods; pass effective data into `computeDashboard`/`matchDetail`/generator/notionAdmin.
- `src/main/dashboard/ipcHandlers.ts` — register masterData handlers.
- `src/main/index.ts` — construct `MasterDataStore` + `MasterDataUpdater`; wire `relocate` on data-folder change; persist hook.
- `src/main/config/appConfig.ts` + `appsettings.json` — add `masterData: { overfastBaseUrl }` config (configurable endpoint, spec Constraints).
- `renderer/src/store.ts` — effective master data arrives via `data.masterData` (no new slice needed); helper accessors.
- `renderer/src/views/settings.ts` — new **Master Data** card (Heroes/Maps/Seasons CRUD + isActive chip + **Update** button + preview modal). Inactive maps rendered muted (AC 33).
- `renderer/src/app/log-match.ts` — hero/map suggestions from `ctx.data.masterData` (active-only maps for browse; full list for free-text resolve, AC 21–22).
- `renderer/src/views/matchDetail.ts` — map dropdown from active maps, keep current inactive map selected (AC 25).
- `renderer/src/views/overview.ts` — scatter mode from effective maps.
- `README.md` / `docs/` — document the Update action + new outbound path (AC 34).

## Data Model / Interfaces

```ts
type Role = 'tank' | 'damage' | 'support';
interface HeroEntry { name: string; role: Role }
interface MapEntry  { name: string; mode: MapMode; isActive: boolean }
interface SeasonEntry { start: number; label: string }        // start = UTC ms
interface MasterData { heroes: HeroEntry[]; maps: MapEntry[]; seasons: SeasonEntry[] }

interface HeroPatch   { name?: string; role?: Role; removed?: boolean }
interface MapPatch    { name?: string; mode?: MapMode; isActive?: boolean; removed?: boolean }
interface SeasonPatch { start?: number; label?: string; removed?: boolean }
interface MasterDataOverrides {                                // persisted deltas
  heroes: Record<string, HeroPatch>;                          // key: hero name
  maps: Record<string, MapPatch>;                             // key: normalizeMapName(name)
  seasons: Record<string, SeasonPatch>;                       // key: S:<iso>
}

interface UpdatePreview {                                      // fetch result (no persist)
  heroes: { additions: HeroEntry[]; changes: { from: HeroEntry; to: HeroEntry }[] };
  maps:   { additions: MapEntry[];  changes: { from: MapEntry;  to: MapEntry  }[] };
}
interface AcceptedUpdate { heroes: HeroEntry[]; maps: MapEntry[] }  // items the user kept
```

IPC surface (all return fresh effective `MasterData` except fetch): `masterDataGet`,
`masterDataUpsertHero`, `masterDataRemoveHero`, `masterDataUpsertMap`,
`masterDataRemoveMap`, `masterDataUpsertSeason`, `masterDataRemoveSeason`,
`masterDataFetchUpdate → UpdatePreview`, `masterDataApplyUpdate(AcceptedUpdate)`.

## Test Strategy

Pure `core/masterData` gets the bulk of coverage (Definition of Done AC 34):
- **merge** — defaults⊕overrides; isActive default true (AC 30); tombstones (AC 3/26);
  dedupe of a user-add later shipped as a default (AC 16); edits apply over new defaults (AC 17).
- **modeMap** — comp modes → MapMode, arcade dropped, unknown comp-like → Unknown (AC 10).
- **overfast parse** — valid payload → entries; malformed/partial rejected (AC 14).
- **diff** — additions + changes on name/role & name/mode; isActive never a change (AC 27);
  empty when up-to-date (AC 9).
- **apply** — additions land isActive:true (AC 29); accepting a mode change preserves
  isActive:false (AC 28); role-change edit stored as patch (AC 11); rename = add + orphan (AC 12).
- **defaults** — withheld maps ship isActive:false, others true (AC 31).
- **season** — with injected user starts the window list/boundary reflects edits (AC 20);
  without, identical to today (regression) + cadence still advances (AC 19).
- **generate** — active-only maps; fallback to all when none active (AC 24).
- Store test: round-trip + relocate.
Existing suites (`vantageCore`, `season`, `filterMigration`, `heroes`, `notionAdmin`) must
stay green unchanged — the DI defaults guarantee it. Renderer behavior (suggestions/dropdown
gating, muted inactive) verified via the browser preview harness.

## Risks & Alternatives

- **Scope/blast radius.** Touches contract, provider, renderer, analytics. Mitigation:
  DI defaults keep every change backward-compatible; land core+tests first, integrate in layers
  with typecheck/test checkpoints.
- **`DashboardData` gains a field.** Any test doing a whole-object deep-equal would break;
  checked during implementation (tests assert specific fields, so low risk).
- **Season global-vs-DI.** Chose optional-`starts` DI over a module-global setter (research
  offered both) to keep `core` pure and avoid cross-test state leakage; costs a little more
  threading inside `season.ts`.
- **Withheld-map content.** Paris/Horizon Lunar Colony are Assault maps Vantage doesn't model;
  shipped as `isActive:false` with mode `Unknown` (truthful — not suggested, no history), which
  satisfies AC 31 without inventing a mode. Curating more inactive maps later is a one-line data edit.
- **OverFast dependency.** Untrusted + may move: validation rejects bad payloads, endpoint is
  configurable, and the compiled defaults are the offline snapshot (AC 13).
- **Alternative rejected:** storing the full effective list as the override — breaks update-safety
  (new built-ins wouldn't surface). Deltas chosen instead.
