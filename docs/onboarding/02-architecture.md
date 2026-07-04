# 02 — Architecture

## The shape of the app

Vantage is a classic two-process Electron app with an unusually strict layering rule:
**everything that thinks is pure TypeScript; everything that touches the outside world
lives at the edges.**

```
┌────────────────────────── main process ──────────────────────────┐
│                                                                  │
│  src/main/   Electron/Overwolf plumbing, composition root, IPC   │
│  src/store/  JSON persistence (history, targets, outbox)         │
│  src/notion/ optional Notion export edge                         │
│                    │  both call into…                            │
│                    ▼                                             │
│  src/core/   PURE domain logic — no Electron, no Overwolf,       │
│              no Notion imports. Fully unit-tested.               │
│                                                                  │
└──────────────┬───────────────────────────────────────────────────┘
               │ typed IPC — src/shared/contract/ (the only shared code)
┌──────────────▼───────────────────────────────────────────────────┐
│  renderer/src/  framework-free DOM composition, one esbuild      │
│                 bundle, talks to main only via window.owstats    │
└──────────────────────────────────────────────────────────────────┘
```

Why it matters: because `src/core/` is Electron-free, the whole analytics engine runs
in vitest *and* in the browser preview unchanged. Keeping it pure is guardrail 3 in
[`CLAUDE.md`](../../CLAUDE.md) — never import Electron/Overwolf/Notion under `core/`.

## Life of a match

The single most useful thing to understand. From game to screen:

```
Overwatch 2
   │  sanctioned game events (GEP — the only allowed source, guardrail 1)
   ▼
GepService                      src/main/gep.ts
   │  normalizes raw events → GepMessage { kind, feature, key, value }
   ▼
pipeline.feed(msg)              src/main/matchPipeline.ts
   ▼
MatchAggregator.handle(msg)     src/core/matchAggregator/
   │  stateful fold: accumulates roster snapshots, detects match end,
   │  computes per-hero splits → returns a finished MatchRecord
   ▼
matchToGame(record, accounts)   src/core/gameRecord.ts
   │  resolvers map raw GEP values → display values
   │  (account, role, result, map) → GameRecord
   ▼
pipeline.recordGame(game)       src/main/matchPipeline.ts
   │  dedupes by matchId, evaluates the break reminder,
   │  kicks off async screenshot capture
   ▼
HistoryStore.add(game)          src/store/history.ts → userData/data/history.json
   ▼
DataProvider.getDashboard()     src/main/dashboard/provider.ts
   │  computeDashboard(games, filters) — src/core/dashboardData.ts
   │  assembles ALL analytics into one DashboardData payload
   ▼
IPC ('dashboard:data')          src/main/dashboard/ipcHandlers.ts
   ▼
bridge.getDashboard()           renderer/src/bridge.ts → window.owstats
   ▼
store.refresh()                 renderer/src/store.ts
   ▼
views render                    renderer/src/views/*
```

The three data shapes along the way:

- **`GepMessage`** ([`src/core/model/gep.ts`](../../src/core/model/gep.ts)) — one wire
  event from Overwolf.
- **`MatchRecord`** ([`src/core/model/match.ts`](../../src/core/model/match.ts)) — an
  aggregated match as GEP reported it (raw strings, roster snapshot, per-hero stats).
- **`GameRecord`** ([`src/core/analytics/types.ts`](../../src/core/analytics/types.ts)) —
  the resolved, analyzable form: display values plus optional `mental` self-report and
  `review` grades. This is what gets persisted and what all analytics consume.

Manual entries (the Log Match card) skip the aggregator: `DataProvider.logMatch()`
builds a `GameRecord` directly and feeds it into the same `recordGame` path.

## The composition root

[`src/main/index.ts`](../../src/main/index.ts) is the only place where things get wired
together, in order: config → stores → aggregator → screenshots → Notion runtime →
pipeline + data provider (via `createMatchPipeline()` / `createDataProvider()` factory
functions) → tray → dashboard window. Everything is constructor-injected — no globals,
no service locators. Factories receive `getConfig: () => AppConfig` *thunks* rather than
config values, so a config reload takes effect without a restart.

This DI style is also the testing story: tests construct the unit with `vi.fn()` fakes
instead of module-mocking.

## The two sensors

Live data can come from either source, selected by `config.sensor` /
`OW_SYNC_SENSOR`:

- **`gep`** (default, the product promise) — `GepService` subscribes to Overwolf's Game
  Events Provider and streams `GepMessage`s into the pipeline.
- **`counterwatch`** ([`src/main/counterwatch.ts`](../../src/main/counterwatch.ts)) — a
  dev-oriented alternative that reads *finished* matches from the Counterwatch app's
  IndexedDB (LevelDB files parsed by
  [`src/core/counterwatchParse.ts`](../../src/core/counterwatchParse.ts)). It emits
  pre-aggregated `MatchRecord`s, bypassing the aggregator.

## Typed IPC, end to end

One contract, three mechanical layers — you should never write a stringly-typed channel:

1. **[`src/shared/contract/api.ts`](../../src/shared/contract/api.ts)** declares
   `OwStatsApi` (every renderer-callable method) and `IPC_CHANNELS` (method name →
   channel string). The `shared/contract` barrel is the *only* code imported by both
   processes, and it re-exports the core types the renderer needs.
2. **[`src/main/preload.ts`](../../src/main/preload.ts)** *generates* the bridge by
   iterating `IPC_CHANNELS` — one `ipcRenderer.invoke` wrapper per entry — and exposes
   it as `window.owstats`. A method missing a channel entry is a compile error.
3. **[`src/main/dashboard/ipcHandlers.ts`](../../src/main/dashboard/ipcHandlers.ts)**
   registers one thin `ipcMain.handle` per channel, each forwarding to a
   `DataProvider` method.

On the renderer side, [`renderer/src/bridge.ts`](../../renderer/src/bridge.ts) is a
property-forwarding proxy over `window.owstats` — which is what lets the browser
preview substitute a mock bridge without touching app code.

## The renderer in one paragraph

No framework. [`h()`](../../renderer/src/dom.ts) builds real DOM elements
(`h('div', { class: 'card', on: { click } }, ...children)`); **views**
(`renderer/src/views/`, one per screen) are pure functions `(ctx: ViewContext) =>
HTMLElement` that compose **components** (`renderer/src/components/`) and dependency-free
SVG **charts** (`renderer/src/charts/`). A single reactive
[`store.ts`](../../renderer/src/store.ts) holds `{ filters, view, params, data, loading }`;
`setView()` is the router, and every state change re-renders the current view from
scratch inside the [`App` shell](../../renderer/src/app/shell.ts). esbuild bundles it
all to one CSP-friendly IIFE (`renderer/dist/dashboard.js`) — no inline scripts, no CDN
(guardrail 4).

## The Notion edge (optional by design)

[`NotionRuntime`](../../src/main/notionRuntime.ts) owns the lifecycle: no token → the
client stack simply stays `undefined` and every operation reports "unavailable". The
export path is `NotionRuntime.export()` → [`NotionExporter`](../../src/notion/notionExporter.ts)
(orchestrates) → [`MapsCache`](../../src/notion/mapsCache.ts) (map-name → Notion page) →
[`NotionWriter`](../../src/notion/notionWriter.ts) (builds page properties). Dedupe is
durable: [`OutboxStore`](../../src/store/outbox.ts) keeps a processed-matchId list so
re-exports never double-write. The expected database schema lives as pure data in
[`gametrackerSchema.ts`](../../src/notion/gametrackerSchema.ts), which both creates
databases and validates existing ones. Tokens are encrypted at rest via Electron
`safeStorage` ([`notionToken.ts`](../../src/main/config/notionToken.ts)) and never live
in JSON or git.

## Configuration layering

[`appConfig.ts`](../../src/main/config/appConfig.ts) merges, in order:
built-in `DEFAULTS` ← bundled [`appsettings.json`](../../appsettings.json) ← user
`userData/config.local.json` ← env overrides (`OW_SYNC_FILTER`, `OW_SYNC_SENSOR`).
Notable keys: `sensor`, `logFilter`, `accounts` (BattleTag → display name),
`mapAliases`, `notion.*`, `breakReminder`.

## The guardrails, and why

[`CLAUDE.md`](../../CLAUDE.md) is binding. In short: **GEP only** (account safety is
the product), **no secrets in git**, **`core/` stays pure**, **renderer stays
CSP-friendly** (store review requirement), **local-first with opt-in export**. If a
change needs to weaken one of these, it's the wrong change.
