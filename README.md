# Overwatch Stats

A standalone **Overwatch 2 stats coach** — a desktop app that turns your match
history into a dashboard of win/loss and exact hero stats, and tells you **what to
focus on**. Built on **ow-electron** (Overwolf's Electron); runs from a single
Windows tray icon and opens its own dashboard window. Notion is one optional export,
not the core.

## What it shows

- **KPIs** — games, winrate, W·L·D record, current streak.
- **Latest session** — today's record, winrate, streak and maps played.
- **Winrate over time** — daily/weekly trend line.
- **By role / account / game mode** — winrate bars.
- **Focus — work on these** — your **net-losing maps** ranked by how far behind you
  are (the core "what to improve" signal).
- **Activity heatmap** — games per day, coloured by winrate.
- **Heroes** — exact per-hero stats (winrate, KDA, and eliminations / deaths /
  assists / damage / healing / mitigation **per 10 min**). Click a hero for a
  drill-down: per-map winrate, recent games, and aggregate stats.

Filter everything by account, role and time range.

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

## Run it

```bash
npm install
npm start
```
A tray icon appears and the dashboard opens. Double-click the tray icon to reopen it.
Enable **Run at login** from the tray to keep it in the background.

### Optional: Notion export
The dashboard's **Export → Notion** button pushes the filtered games to a Notion
database (the original Gametracker). To enable it:
1. Create an internal integration at <https://www.notion.so/my-integrations> and share
   your Notion *Overwatch* page with it.
2. Tray icon → **Set Notion token (from clipboard)**.
Match IDs are deduped, so re-exporting never double-writes.

## Architecture

```
Overwatch 2 ─▶ GEP ─▶ aggregator ─▶ GameRecord ─▶ HistoryStore ─▶ analytics ─▶ dashboard window
                                                                         └─▶ Notion export (optional)
```
- `src/core/analytics.ts` — pure stats engine (win/loss, by-key groupings, trend,
  focus net-losses, per-hero, session, calendar, hero drill-down). Fully unit-tested.
- `src/core/matchAggregator.ts` — GEP stream → one match, incl. **per-hero deltas**.
- `src/core/sampleData.ts` — deterministic demo season for development.
- `src/store/history.ts` — durable game history (the dataset behind the charts).
- `src/main/dashboard.ts` + `renderer/` — the BrowserWindow UI: hand-rolled SVG
  charts, a CSP-locked renderer, and a preload/IPC bridge.
- `src/main/gep.ts` — the sanctioned sensor (Counterwatch reader kept as an alt).
- `src/notion/notionExporter.ts` — on-demand export.

## Development

```bash
npm test          # vitest — analytics, aggregator (incl. per-hero), resolvers, store
npm run typecheck
npm start          # runs with the demo dataset
```
Env helpers: `OW_SYNC_SIMULATE=1` replays a synthetic match through the live pipeline;
`OW_SYNC_SENSOR=gep|counterwatch` switches the sensor.

## Build a release

```bash
npm run release    # ow-electron-builder → release/Overwatch Gametracker Sync-Setup-<ver>.exe
```
Unsigned installer (fine for personal use — Windows SmartScreen → *More info → Run anyway*).

## Roadmap

- **Publish to Overwolf** — submit the app proposal so GEP is enabled and the app is
  store-listed (then live data flows; demo data is replaced).
- More views (hero-vs-map matrix, time-of-day, role-queue trends).
