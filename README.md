# Vantage

A standalone **Overwatch 2 stats coach**. Vantage turns your match history into a
dashboard of priority maps, exact hero stats, mental tracking and flexible
improvement targets — and tells you **where the points are hiding**. Built on
**ow-electron** (Overwolf's Electron); a frameless desktop app (1300×840) that runs
from a single Windows tray icon. Notion is one optional export, not the core.

The visual design follows the **Vantage — Aurora** direction: a near-black canvas,
an aurora-purple accent, Geist / Geist Mono type, and a data model that separates
**⚡ auto-detected** signals (result · map · hero) from **◎ manual** ones (tilt ·
comms · toxicity · leavers · your improvement target).

## Screens

- **Overview** — greeting, KPIs (winrate, games, rank, streak), the flagship
  *winrate × volume* scatter with a focus band, a focus queue and a mental snapshot.
- **Matches** — the recent game log.
- **Maps** — winrate by game mode, then every map ranked best → worst.
- **Heroes** — the exact per-hero table (per-10-minute stats), with a click-through
  drill-down drawer (per-map winrate, recent games, aggregates).
- **Focus** — net-losing maps ranked by deficit — the "what to work on" signal.
- **Mental** — calm/tilt state, the tilt tax on your winrate, and flag counts.
- **Trends** — winrate over time, splits by role/mode/account, and an activity heatmap.
- **Improvement Target** — build a target (self-rated ◎ or measured ⚡) and track a
  library that shows whether hitting it actually moves your winrate.
- **Log match** — the quick-capture card that opens after a game (~5 taps).
- **Notion sync** — connect a Notion integration token and push your tracked games
  to a database with one click (deduped by Match ID).

Filter everything by account, role, game mode and time range.

## Account safety

The live data source is **Overwolf's Game Events Provider (GEP)** — the sanctioned
feed Overwolf apps use. Nothing here reads game memory, injects, or exposes hidden
info, so there is **no Blizzard ban risk**. (Going live with GEP requires publishing
the app through Overwolf's approval flow — see *Status*.)

## Status

- The app, dashboard, analytics, and per-hero GEP plumbing are **built and working**.
- Until the app is approved by Overwolf for GEP, **no live match data flows**, so the
  dashboard shows a **realistic demo dataset** (badged "Demo data"). Once approved,
  real games populate it automatically — the pipeline is identical.
- The manual (◎) surfaces now **persist**: Log match writes a real game to the local history
  (feeding every stat, including the mental composite), and authored improvement targets are
  saved to a local store and shown in your Targets library.

## Run it

```bash
npm install
npm start
```

A tray icon appears and the dashboard opens. Double-click the tray icon to reopen it.
Enable **Run at login** from the tray to keep it in the background.

### Preview the UI in a browser

You don't need the Overwolf runtime to see the interface. The preview harness mocks
the IPC bridge with the sample season and renders the full app in a plain browser:

```bash
npm run preview        # bundles the harness and serves it at http://localhost:5178
```

### Optional: Notion sync

The **Notion sync** screen connects a Notion database and pushes your tracked games to
it. Create an internal integration at <https://www.notion.so/my-integrations>, add it to
your *Overwatch* page's connections, then paste the token on that screen and hit **Sync**.
Match IDs are deduped, so re-syncing never double-writes. (The tray's **Set Notion token**
still works too.)

## Architecture

```
Overwatch 2 ─▶ GEP ─▶ aggregator ─▶ GameRecord ─▶ HistoryStore ─┐
                                                                ├─▶ core/dashboardData ─▶ IPC ─▶ renderer
                                                                └─▶ Notion export (optional)
```

**Main process (`src/`)** — pure, Electron-free domain logic under `core/`, with the
Electron/Overwolf/Notion plumbing kept at the edges:

- `core/analytics.ts` — the stats engine (win/loss, groupings, trend, focus, per-hero,
  session, calendar, hero drill-down). Pure and fully unit-tested.
- `core/dashboardData.ts` — the **view-model**: raw games + filters → the exact payload
  the renderer consumes. Pure, so it powers both the app and the browser preview.
- `core/mental.ts` · `core/progression.ts` · `core/targets.ts` · `core/maps.ts` — the
  additional Vantage models (mental composite, rank heuristic, target library, map modes).
- `shared/contract.ts` — the single typed IPC contract shared by main **and** renderer.
- `main/dashboard.ts` — owns the frameless BrowserWindow and wires the contract to IPC.

**Renderer (`renderer/`)** — authored as TypeScript modules and bundled to one
CSP-friendly script by **esbuild**. Composition-first, framework-free:

- `src/dom.ts` — a tiny `h()` hyperscript, the composition primitive everything nests from.
- `src/components/` — reusable pieces (cards, KPIs, buttons, pills, segmented controls,
  stat bars, a sortable table, overlays). Views compose these rather than hand-rolling markup.
- `src/charts/` — dependency-free SVG charts (line, bars, the winrate×volume scatter, sparklines).
- `src/views/` — one module per screen.
- `src/app/` — the shell (frameless title bar, sidebar router, status bar) and the Log Match modal.
- `src/store.ts` — a small reactive store: the single source of truth for filters, view and data.
- `styles/` — design tokens, base, components and layout, driven by CSS custom properties.

## Development

```bash
npm test           # vitest — analytics, aggregator, resolvers, store, and the Vantage models
npm run typecheck  # tsc for the main process and the renderer
npm run build      # tsc (main) + esbuild (renderer bundle)
npm run watch:renderer   # rebuild the renderer bundle on change
npm start          # runs with the demo dataset
```

Env helpers: `OW_SYNC_SIMULATE=1` replays a synthetic match through the live pipeline;
`OW_SYNC_SENSOR=gep|counterwatch` switches the sensor.

## Build a release

```bash
npm run release    # ow-electron-builder → release/Vantage-Setup-<ver>.exe
```

Unsigned installer (fine for personal use — Windows SmartScreen → *More info → Run anyway*).

## Support

Questions or feedback: <timo.seikel@gmail.com> (also reachable from the tray's **Help & Support**
item). The [Privacy Policy](docs/legal/privacy.html) and [Terms of Use](docs/legal/terms.html) live
under `docs/legal/` and are published as the app's public legal URLs.

## Testing the live pipeline

`OW_SYNC_RECORD=1` captures a real GEP session to `userData/recordings/*.jsonl`; replay it with
`OW_SYNC_REPLAY=<file>` to exercise match start/stop and the history update without the game. These
are dev-only flags — the recorder is off in normal use.

## Roadmap

- **Publish to Overwolf** — the app is whitelisted; submission is prepped in
  [docs/overwolf-submission.md](docs/overwolf-submission.md) (store copy, proposal
  answers, compliance + monetization notes, and generated assets). Regenerate assets
  with `npm run assets:store` (icon/tile/hero/creator) and `npm run assets:screens`
  (real 1200×675 UI screenshots).
- More views (hero-vs-map matrix, time-of-day, role-queue trends).
