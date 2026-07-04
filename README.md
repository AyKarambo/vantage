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
- **Matches** — the recent game log; click any row for a full **match detail page**
  (scoreboard, per-hero tabs, competitive progress estimate, player history, and an
  end-of-match screenshots gallery — each section degrades gracefully to whatever the
  game feed actually reported for that match).
- **Maps** — winrate by game mode, then every map ranked best → worst.
- **Heroes** — the exact per-hero table (per-10-minute stats), with a click-through
  drill-down drawer (per-map winrate, recent games, aggregates).
- **Focus** — net-losing maps ranked by deficit — the "what to work on" signal.
- **Mental** — calm/tilt state, the tilt tax on your winrate, flag counts, and a
  **break-reminder setting** (on/off + loss threshold) that fires a tray notification
  after N consecutive losses.
- **Trends** — winrate over time, splits by role/mode/account, and an activity heatmap.
- **Review** — grade your active improvement targets (Hit / Partial / Missed) and flag
  how each tracked game felt; an always-visible inbox of ungraded games, independent of
  the global filters.
- **Improvement Target** — build a target (self-rated ◎ or measured ⚡), choose which
  targets are active (graded on Review), edit or archive/delete them, and track a
  library that shows whether hitting it actually moves your winrate.
- **Log match** — the quick-capture card that opens after a game (~5 taps).
- **Notion sync** — connect a Notion integration token, pick (or auto-create) the
  target database, and push your tracked games to it with one click (deduped by
  Match ID).

Filter everything by account, role, game mode and time range — with a one-click **Reset** chip and
savable presets. Quality-of-life throughout: **Ctrl+K command palette** (jump to any screen, run
actions, find a map/hero/recent match), keyboard shortcuts (`Ctrl+1–9` screens, `?` cheatsheet,
`←/→` between match details, `H/P/M/S` grading on Review), toasts with **Undo** for reversible
actions, day-grouped match log with hero/map cross-links, hero typeahead + remembered role/mode in
the quick-log, hover tooltips + a "view as table" toggle on charts, a next-day session recap, a
colorblind-safe palette option, window-position memory, and a **Settings** screen (break reminder,
close-to-tray, run-at-login, diagnostics). The app restores your last view on launch and refreshes
without flicker.

## Account safety

The live data source is **Overwolf's Game Events Provider (GEP)** — the sanctioned
feed Overwolf apps use. Nothing here reads game memory, injects, or exposes hidden
info, so there is **no Blizzard ban risk**. (Going live with GEP requires publishing
the app through Overwolf's approval flow — see *Status*.)

The desktop shell is hardened to match: the renderer runs with **context isolation**
and **sandbox** on, `nodeIntegration` off, behind a strict **CSP** (`default-src 'none'`),
and the window **denies in-page navigation and popups**. The main process **validates the
sender** of every IPC message (dropping anything not from the app's own renderer) — so the
renderer stays a contained surface. External links open only through the main process.

## Status

- The app, dashboard, analytics, and per-hero GEP plumbing are **built and working**.
- Until the app is approved by Overwolf for GEP, **no live match data flows**. On first
  launch the app **asks whether to load a realistic demo dataset or start fresh** (changeable
  later in Settings). Demo data is badged "Demo data" and yields to real games automatically
  once tracking starts — the pipeline is identical. With no demo and no authored targets, the
  Targets screen stays honestly empty rather than showing sample targets.
- Competitive **rank** follows the current Overwatch 2 model: eight tiers Bronze→**Champion**,
  five divisions each (5 = lowest, 1 = highest), with within-division progress shown as a
  **percentage (0–100%)**. It is a winrate-derived heuristic (GEP does not report rank), not a
  value read from the game.
- The manual (◎) surfaces now **persist**: Log match writes a real game to the local history
  (feeding every stat, including the mental composite), authored improvement targets are
  saved to a local store and shown in your Targets library, and grading a game on the
  **Review** screen (per-target grades + how-it-felt flags) persists to that game's record
  in the same local history — feeding Target hit-rates/win-splits and the Mental stats
  alongside the quick-log flags.
- The **break reminder** (Mental screen) is a real tray notification, not just a line of
  copy: it watches every finished game — live or manually logged — and nudges you after a
  configurable number of consecutive losses.
- **Notion sync** now includes an in-app database picker and an auto-create option, so
  connecting a database no longer requires hand-editing a config file.

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
your *Overwatch* page's connections, then paste the token on that screen. Once a token is
saved, a **Database** card lets you either **choose** a database the integration can
already see, or have Vantage **create one for you** (a Maps database plus a matching
Gametracker database, correctly shaped, under a page you pick). Then hit **Sync**. Match
IDs are deduped, so re-syncing never double-writes. (The tray's **Set Notion token** still
works too; a hand-edited `appsettings.json` database id is still supported as a fallback.)

## Architecture

```
Overwatch 2 ─▶ GEP ─▶ aggregator ─▶ GameRecord ─▶ HistoryStore ─┐
                                                                ├─▶ core/dashboardData ─▶ IPC ─▶ renderer
                                                                └─▶ Notion export (optional)
```

**Main process (`src/`)** — pure, Electron-free domain logic under `core/`, with the
Electron/Overwolf/Notion plumbing kept at the edges:

- `core/analytics/` — the stats engine (win/loss, groupings, trend, focus, per-hero,
  session, calendar, hero drill-down). Pure and fully unit-tested.
- `core/dashboardData.ts` — the **view-model**: raw games + filters → the exact payload
  the renderer consumes. Pure, so it powers both the app and the browser preview.
- `core/mental.ts` · `core/progression.ts` · `core/targets/` · `core/maps.ts` — the
  additional Vantage models (mental composite, rank heuristic, target library, map modes).
- `core/matchDetail.ts` · `core/playerIndex.ts` — the match detail page's payload
  (scoreboard, per-hero tabs, competitive estimate, screenshots) and the local
  player-encounter index it draws Player History from.
- `core/breakReminder.ts` — the pure break-reminder state machine (consecutive-loss
  threshold, re-fire cadence, re-arm on a win), driven by the main process after every
  recorded game.
- `shared/contract/` — the single typed IPC contract shared by main **and** renderer
  (import path stays `shared/contract`), including the channel map that preload and the
  renderer bridge are generated from.
- `main/dashboard/` — owns the frameless BrowserWindow and wires the contract to IPC.
- `main/matchPipeline.ts` · `main/dataProvider.ts` — factories the composition root
  (`main/index.ts`) feeds with injected stores/services: the GEP-message→history pipeline
  and the renderer-facing DataProvider, both unit-testable without Electron.
- `main/notionRuntime.ts` — the Notion client/exporter/admin lifecycle in one place:
  token state, database selection, cached shape validation, export short-circuiting.
- `main/screenshots.ts` — best-effort end-of-match screenshot capture, served to the
  renderer via the read-only `vantage-media://` protocol.
- `notion/notionAdmin.ts` — the Notion database picker/auto-create admin operations
  (list databases/pages, create a shaped Gametracker + Maps pair, validate a shape).

**Renderer (`renderer/`)** — authored as TypeScript modules and bundled to one
CSP-friendly script by **esbuild**. Composition-first, framework-free:

- `src/dom.ts` — a tiny `h()` hyperscript, the composition primitive everything nests from.
- `src/components/` — reusable pieces (cards, KPIs, buttons, pills, segmented controls,
  stat bars, a sortable table, overlays, the match detail scoreboard). Views compose these
  rather than hand-rolling markup.
- `src/charts/` — dependency-free SVG charts (line, bars, the winrate×volume scatter, sparklines).
- `src/views/` — one module per screen, including the parameterized `matchDetail` drill-down.
- `src/app/` — the shell (frameless title bar, sidebar router, status bar) and the Log Match modal.
- `src/store.ts` — a small reactive store: the single source of truth for filters, view and data.
- `styles/` — design tokens, base, components and layout, driven by CSS custom properties.

## Development

New to the codebase? Start with the **[onboarding guide](docs/onboarding/README.md)** —
setup, architecture, a folder-by-folder tour, and recipes for common changes.

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

## Live connection status

The status bar (and the tray icon) shows a four-state feed indicator that never conflates
*attached* with *alive*: **No game** · **Connected — waiting for events** (GEP attached, nothing
flowing — e.g. in menus) · **Receiving data** (events demonstrably arriving) · **⚠ Stale** (a match
is running but the feed has been silent for 60s — the "says connected but nothing updates" failure,
surfaced instead of hidden). Click the indicator for details: last event time, events this session,
match state, attach time. In demo mode it always reads "No live feed". State transitions are
written to the debug log.

## Debug log

Every build — including releases — writes a structured log to `%APPDATA%/Vantage/logs/`
(`vantage.log`, rotating at 2 MB × 5 files): app lifecycle, GEP attach/detach, match-pipeline
milestones, Notion sync results, and uncaught errors from both processes. Notion tokens are
redacted before anything is written. The **Logs** screen (sidebar → Data) live-tails the last
1000 entries with level filtering, and its **Debug detail** toggle raises verbosity to the full
GEP event stream for the current session (resets to `info` on restart). Logs never leave the
device.

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
