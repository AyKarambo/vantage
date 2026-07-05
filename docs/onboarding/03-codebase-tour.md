# 03 — Codebase tour

A folder-by-folder map. One line per module; open the file for details — exports carry
JSDoc.

## Repo root

```
src/            main-process TypeScript (compiled to dist/ as CommonJS)
renderer/       renderer TypeScript + styles (bundled by esbuild, type-checked separately)
test/           vitest suite (*.test.ts) — pure core + stores + Notion modules
specs/          one behavioral spec per screen — what each view must show
scripts/        build/dev tooling (.mjs) — esbuild, preview server, assets, packaging
docs/           this folder, signing + store-submission notes, legal pages
appsettings.json  bundled default config (merged under user config.local.json)
CLAUDE.md       project constitution — guardrails + Definition of Done
```

Two tsconfigs, both strict: root [`tsconfig.json`](../../tsconfig.json) (main, ES2021/CommonJS)
and [`renderer/tsconfig.json`](../../renderer/tsconfig.json) (ESNext, `noEmit`, bundler
resolution — esbuild does the compiling). Imports are plain relative paths; no aliases.

## `src/core/` — pure domain logic

No Electron, Overwolf, or Notion imports anywhere below here. Everything is
unit-testable and shared with the browser preview.

| Module | Purpose |
|--------|---------|
| [`model/`](../../src/core/model) | The vocabulary: `MatchRecord`, `HeroStat`, `RosterPlayer` ([match.ts](../../src/core/model/match.ts)), `Role`/`Result`/`LogFilter` enums, `GepMessage`, BattleTag helpers. |
| [`matchAggregator/`](../../src/core/matchAggregator) | `MatchAggregator` — stateful fold of the GEP stream into a finished `MatchRecord`; `keys.ts` names the GEP fields it listens to; `gepValues.ts` is the tolerant value-coercion toolkit (`parseRoster`, `asNumber`, …). |
| [`gameRecord.ts`](../../src/core/gameRecord.ts) | `matchToGame()` — `MatchRecord` → `GameRecord` via the resolvers. |
| [`resolvers/`](../../src/core/resolvers) | Raw GEP value → display value: account (BattleTag matching), result (victory/defeat/…), role (queue-aware), map (alias + normalized-name lookup). |
| [`analytics/`](../../src/core/analytics) | The stats engine: `grouping.ts` (winrate buckets — byMap/byRole/byHero/focusBy/trend), `heroStats.ts` (per-10-min hero table), `session.ts` (streaks, day recaps, calendar heatmap, hero drill-down), `types.ts` (`GameRecord`, `MatchMental`, `MatchReview`). |
| [`dashboardData.ts`](../../src/core/dashboardData.ts) | `computeDashboard()` — applies filters and assembles *everything* into the single `DashboardData` payload the renderer receives. |
| [`matchDetail.ts`](../../src/core/matchDetail.ts) | The per-match drill-down (scoreboard, rank estimate, player history, saved review); degrades section-by-section when GEP data is missing. |
| [`matchFilter.ts`](../../src/core/matchFilter.ts) | Game-type classification + `shouldLog()` (which matches get tracked). |
| [`mental.ts`](../../src/core/mental.ts) | Calm/tilt summary and the tilt tax on winrate. |
| [`progression.ts`](../../src/core/progression.ts) | Winrate → rank heuristic → 8-tier (Bronze→Champion) / 5-division / 0–100% progress. |
| [`targets/`](../../src/core/targets) | Improvement targets: types, `buildTargets()` scoring against review grades, demo `sampleTargets`. |
| [`playerIndex.ts`](../../src/core/playerIndex.ts) | "Seen this player before" — encounters across stored rosters. |
| [`breakReminder.ts`](../../src/core/breakReminder.ts) | Loss-streak break-reminder state machine. |
| [`readiness/`](../../src/core/readiness) | Training-load / supercompensation model: gap-based sessions, local 4am-day buckets, EWMA acute-vs-chronic load, mental self-report signals, and a rule-gated readiness band + rest recommendation. Conservative, centrally-tuned constants. |
| [`maps.ts`](../../src/core/maps.ts) | Map → game-mode lookup (`MAP_MODES`). |
| [`counterwatchParse.ts`](../../src/core/counterwatchParse.ts) | Extracts `MatchRecord`s from Counterwatch's LevelDB/V8-serialized IndexedDB. |
| [`sampleData/`](../../src/core/sampleData) | `generateSampleGames()` — deterministic, seeded demo dataset (drives preview + first-run demo mode). |

## `src/shared/contract/` — the IPC contract

The only code imported by **both** processes, barreled through
[`index.ts`](../../src/shared/contract/index.ts):

- [`api.ts`](../../src/shared/contract/api.ts) — `OwStatsApi` (every renderer-callable
  method) + `IPC_CHANNELS` / `WINDOW_CHANNELS` (method → channel maps).
- [`dashboard.ts`](../../src/shared/contract/dashboard.ts) — `DashboardData` and friends.
- [`matchDetail.ts`](../../src/shared/contract/matchDetail.ts) — the drill-down payload.
- [`inputs.ts`](../../src/shared/contract/inputs.ts) — write-side inputs (log match, save
  target/review, …). [`notion.ts`](../../src/shared/contract/notion.ts) — Notion DTOs.

## `src/main/` — Electron/Overwolf plumbing

| Module | Purpose |
|--------|---------|
| [`index.ts`](../../src/main/index.ts) | **The composition root.** Single-instance lock, constructs and wires everything, starts the chosen sensor / dev modes. Start reading here. |
| [`gep.ts`](../../src/main/gep.ts) | `GepService` — subscribes to Overwolf GEP, normalizes events to `GepMessage`, emits `message`/`status`/`log`. |
| [`matchPipeline.ts`](../../src/main/matchPipeline.ts) | `createMatchPipeline()` — `feed` (GEP msg → aggregator), `addMatch`, `recordGame` (dedupe, break reminder, screenshots, persist). |
| [`dashboard/`](../../src/main/dashboard) | `dashboardWindow.ts` (frameless BrowserWindow — context-isolated, sandboxed, navigation-locked), `webContentsSecurity.ts` (`hardenWebContents()` — denies popups + navigation), `ipcHandlers.ts` (channel registration), `provider.ts` (`createDataProvider()` — implements the read/write API over stores + core). |
| [`preload.ts`](../../src/main/preload.ts) | Generates `window.owstats` from `IPC_CHANNELS` via contextBridge. Mechanical — you rarely touch it. |
| [`config/`](../../src/main/config) | `appConfig.ts` (defaults ← appsettings.json ← config.local.json ← env), `notionToken.ts` (safeStorage-encrypted token). |
| [`counterwatch.ts`](../../src/main/counterwatch.ts) | `CounterwatchReader` — alternative sensor; watches Counterwatch's IndexedDB. |
| [`notionRuntime.ts`](../../src/main/notionRuntime.ts) | Notion lifecycle: token → client stack → export/status/admin. Stays inert without a token. |
| [`tray.ts`](../../src/main/tray.ts) | Tray icon, context menu, toast notifications. |
| [`simulate.ts`](../../src/main/simulate.ts) / [`recorder.ts`](../../src/main/recorder.ts) | Dev tooling: synthetic match feed; GEP record/replay (`.jsonl`). |
| [`screenshots.ts`](../../src/main/screenshots.ts) | End-of-match capture + read-only `vantage-media://` protocol. |
| [`autolaunch.ts`](../../src/main/autolaunch.ts) | Run-at-login wiring. |

## `src/store/` — persistence (JSON under `userData/data/`)

| Store | File on disk | Holds |
|-------|-------------|-------|
| [`history.ts`](../../src/store/history.ts) | `history.json` | Every tracked `GameRecord`; screenshots and reviews attach here. Atomic writes (tmp + rename). |
| [`manualLog.ts`](../../src/store/manualLog.ts) | `manual.json` | Authored improvement targets and their lifecycle. |
| [`outbox.ts`](../../src/store/outbox.ts) | `outbox.json` | Notion export dedupe (processed matchIds) + retry queue. |

## `src/notion/` — optional export edge

[`notionAdmin.ts`](../../src/notion/notionAdmin.ts) (database discovery/creation/validation) ·
[`notionExporter.ts`](../../src/notion/notionExporter.ts) (export loop with outbox dedupe) ·
[`notionWriter.ts`](../../src/notion/notionWriter.ts) (GameRecord → Notion page properties) ·
[`mapsCache.ts`](../../src/notion/mapsCache.ts) (map-name → Notion page cache) ·
[`gametrackerSchema.ts`](../../src/notion/gametrackerSchema.ts) (the required schema as pure data).

## `renderer/src/` — the UI

| Module | Purpose |
|--------|---------|
| [`main.ts`](../../renderer/src/main.ts) | Entry: `new App(must('#app'))`. |
| [`app/shell.ts`](../../renderer/src/app/shell.ts) | The `App` class: titlebar/sidebar/statusbar, the `VIEWS` registry (ViewId → render fn), navigation, global shortcuts (Ctrl+K = log match). |
| [`app/log-match.ts`](../../renderer/src/app/log-match.ts) / [`app/onboarding.ts`](../../renderer/src/app/onboarding.ts) | The quick-capture modal; the first-run tour. |
| [`store.ts`](../../renderer/src/store.ts) | The reactive store: `{ filters, view, params, data, loading, status, error }`, pub-sub, `refresh()` fetches via bridge, filters persist to localStorage. |
| [`bridge.ts`](../../renderer/src/bridge.ts) | Proxy over `window.owstats`; the preview swaps in a mock behind the same interface. |
| [`dom.ts`](../../renderer/src/dom.ts) | `h()` — the composition primitive — plus `render`, `clear`, `must`. |
| [`views/`](../../renderer/src/views) | One module per screen (`overview`, `matches`, `matchDetail`, `maps`, `heroes`, `focus`, `mental`, `trends`, `review`, `targets/`, `notion/`). All are `(ctx: ViewContext) => HTMLElement`. `view.ts` has the shared `ViewContext`, `viewHead()`, `filterBar()`. |
| [`components/`](../../renderer/src/components) | `primitives/` (card, button, segmented, select, pills, KPI/stat blocks) plus `table.ts` (sortable data table), `overlay.ts` (modals), `scoreboard.ts`. Views compose these — don't hand-roll markup. |
| [`charts/`](../../renderer/src/charts) | Dependency-free SVG: `svg.ts` element builders; `plots/` (line, scatter, horizontal bars, donut, sparkline). |
| [`theme.ts`](../../renderer/src/theme.ts) | JS mirror of the CSS color tokens for SVG charts (`wrColor`, `modeColor`, `PALETTE`). |
| [`format.ts`](../../renderer/src/format.ts) | Presentation formatters (percentages, times, signed deltas). |

Styling lives in [`renderer/styles/`](../../renderer/styles): `tokens.css` (design
tokens — the source of truth for color/type/radius), `base.css`, `components.css`,
`app.css`. Components reference tokens via `var(--…)`.

[`renderer/preview/`](../../renderer/preview) is the browser harness: `preview.ts`
mocks `window.owstats` with the real core + localStorage. Dev-only, excluded from the
packaged app.

## `scripts/`

`build-renderer.mjs` (esbuild → single IIFE `renderer/dist/dashboard.js`, target
chrome128) · `build-preview.mjs` + `preview-server.mjs` (the browser harness,
port 5178) · `make-tray-icon.mjs`, `make-store-assets.mjs`, `capture-screenshots.cjs`
(assets) · `pack-opk.mjs`, `sign-local.ps1` (packaging/signing).

## `test/`

Vitest, node environment, `test/*.test.ts`. Strong coverage on the aggregator,
analytics, resolvers, stores, and the Notion schema/exporter; the renderer UI and IPC
plumbing are intentionally untested (they're thin). Conventions in
[04 — Common tasks](04-common-tasks.md#adding-a-test).
