# 01 — Getting started

## Prerequisites

- **Node.js 20+** and npm. That's it — everything else installs locally.
- Windows is required to run the real app (ow-electron targets Windows, and Overwatch
  only reports events there). The browser preview and the test suite run anywhere.

```bash
npm install
```

## The commands you'll actually use

```bash
npm test                 # vitest suite, one shot (npm run test:watch for watch mode)
npm run typecheck        # tsc, no emit — checks main AND renderer tsconfigs
npm run build            # tsc (main → dist/) + esbuild (renderer → renderer/dist/dashboard.js)
npm run watch:renderer   # rebuild the renderer bundle on change
npm start                # build + launch the app via ow-electron
npm run preview          # full UI in a plain browser at http://localhost:5178
```

A change isn't done until `npm test` and `npm run typecheck` are both clean — see the
Definition of Done in [`CLAUDE.md`](../../CLAUDE.md).

## Three ways to run the app

### 1. Browser preview (fastest — start here)

```bash
npm run preview          # → http://localhost:5178
```

No Electron, no Overwolf, no game. [`renderer/preview/preview.ts`](../../renderer/preview/preview.ts)
installs a fake `window.owstats` bridge that runs the *real* pure core
(`generateSampleGames()` + `computeDashboard()`) and persists your clicks to
localStorage. This is the fastest loop for any UI or analytics work, because the browser
preview and the real app share all of `src/core/` and all of `renderer/src/`.

### 2. Desktop app with demo data

```bash
npm start
```

Launches the real frameless window from the tray. If you have no recorded history yet
(`history.json` empty), the dashboard automatically falls back to the deterministic
sample dataset and shows a "demo" badge — so the app is fully explorable without ever
playing a match.

### 3. Desktop app with live/simulated data

With Overwatch 2 running, GEP events flow in automatically. Without the game, use the
dev flags below.

## Dev environment flags

All read at startup in [`src/main/index.ts`](../../src/main/index.ts) and
[`src/main/config/appConfig.ts`](../../src/main/config/appConfig.ts):

| Flag | Effect |
|------|--------|
| `OW_SYNC_SIMULATE=1` (or `--simulate`) | Feeds one synthetic competitive match through the *real* pipeline shortly after launch. Match IDs are prefixed `SIM-`. |
| `OW_SYNC_RECORD=1` | Records the live GEP stream to `userData/recordings/*.jsonl`. |
| `OW_SYNC_REPLAY=<file>` | Replays a recorded `.jsonl` through the pipeline at (capped) real-time speed — exercise match start/stop without the game. |
| `OW_SYNC_SENSOR=gep\|counterwatch` | Chooses the data sensor (see [architecture](02-architecture.md#the-two-sensors)). |
| `OW_SYNC_FILTER=<LogFilter>` | Overrides which game types get tracked (e.g. `Competitive`). |
| `NOTION_TOKEN=<token>` | Dev override for the Notion token — beats the encrypted token file. |
| `--hidden` | Start minimized to tray (used by auto-launch). |

Record once while you play, then replay forever — that's the intended way to debug the
live pipeline.

## Where the app keeps its data

Everything lives under Electron's `userData` directory
(`%APPDATA%/ow.vantage/` on Windows):

```
userData/
├── data/
│   ├── history.json      # every tracked game (GameRecord[])
│   ├── manual.json       # authored improvement targets
│   ├── outbox.json       # Notion export dedupe + retry queue
│   └── screenshots/      # end-of-match captures, one folder per match
├── recordings/           # OW_SYNC_RECORD output (.jsonl)
├── notion-token.bin      # Notion token, encrypted via Electron safeStorage
└── config.local.json     # user config overrides (merged over appsettings.json)
```

Deleting `history.json` puts you back in demo mode. None of this is ever committed —
tokens and user data stay on the machine (guardrails 2 and 5 in
[`CLAUDE.md`](../../CLAUDE.md)).

## A good first hour

1. `npm install && npm test && npm run typecheck` — confirm a green baseline.
2. `npm run preview` — click through every screen against sample data.
3. `npm start` then `OW_SYNC_SIMULATE=1 npm start` — see the real shell, tray, and a
   simulated match landing in history.
4. Read [02 — Architecture](02-architecture.md) with
   [`src/main/index.ts`](../../src/main/index.ts) open next to it.
