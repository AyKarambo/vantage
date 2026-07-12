# 01 — Getting started

## Prerequisites

- **Node.js 22.13+** (or the current LTS) and npm. `npm test` uses Node's built-in
  `node:sqlite`, which needs an unflagged build (22.13+); the ow-electron/-builder Dev
  Mode toolchain (below) separately wants Node ^20.19 or >=22.12 for its own tooling —
  22.13+ covers both. Everything else installs locally.
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

With Overwatch running, GEP events flow in automatically **once ow-electron Dev Mode
authentication is set up** (one-time, below). Without the game, use the dev flags below
instead.

## Dev Mode — real GEP data before Overwolf approval

Normally GEP only binds once Overwolf has approved/whitelisted the app (see
[README.md](../../README.md) → *Status*). ow-electron's
[Dev Mode](https://dev.overwolf.com/ow-electron/guides/dev-tools/dev-mode) bypasses that
for local development: it loads the gaming packages (GEP, Overlay, Recorder) against an
unsigned, unpackaged build, as long as the process can authenticate with an Overwolf
Developer Console identity. This repo's `@overwolf/ow-electron` / `@overwolf/ow-electron-builder`
devDependencies are pinned to the **beta** versions that support it (no stable release
exists yet at time of writing).

One-time setup:

1. Sign in to the [Overwolf Developer Console](https://console.overwolf.com/) and confirm
   (or create) an app registration matching this repo's `package.json` `name`
   (`ow.vantage`) + `author` (`Timo Seikel`) exactly — see
   [docs/overwolf-submission.md §1](../overwolf-submission.md).
2. Generate an API key: Console → **Profile → API Keys → "Revoke and get new API key"**.
   Copy it now — the console only shows it once.
3. `ow config` (the `@overwolf/ow-cli` devDependency ships the `ow` binary) — enter your
   Console login email + that API key. This writes a `[default]` profile to
   `~/.ow-cli/credentials`. (Heads-up: the Dev Mode docs call this file `~/.ow/credentials`,
   but the pinned `@overwolf/ow-cli` 0.1.x actually writes `~/.ow-cli/credentials` — the
   launcher below checks both, so either is fine.)

**Have a *dev key* instead of an API key?** Temporary/approved developers without Console
API-key access get a **dev key** from Overwolf. It authenticates differently (Bearer, via
`OW_DEV_KEY`) and is **not** an API key — typing it into `ow config`'s API-key prompt makes
ow-electron send it as `OW_CLI_API_KEY` and Overwolf rejects it (401 `invalid verification`).
Instead, set `OW_DEV_KEY=<token>`, or drop the token (by itself) into `~/.ow-cli/dev-key`.
The launcher prefers a dev key when one is present.

**How the credentials reach the app.** ow-electron's Dev Mode authenticates using *only* the
environment variables `OW_CLI_EMAIL` + `OW_CLI_API_KEY` (or a bearer `OW_DEV_KEY`) — it does
**not** read the `~/.ow-cli/credentials` file that `ow config` writes. `npm start` / `npm run dev`
launch through [`scripts/ow-dev.mjs`](../../scripts/ow-dev.mjs), which loads that file and
exports those env vars into the ow-electron process for you, so `ow config` alone is enough.
Prefer to manage it yourself? Set `OW_CLI_EMAIL` + `OW_CLI_API_KEY` (or `OW_DEV_KEY`) in your
shell and they take precedence. Run `npm run dev:check` to confirm credentials resolve before
launching. (If you only ran `ow config` and GEP still won't attach, that env-vs-file gap was
almost certainly the cause.)

Once that's done, launch normally (`npm start`) with Overwatch running. Watch the status
bar's live-feed indicator (No game → Connected-waiting → Receiving data) and the Logs
screen (Debug detail on) for `gep package ready` / `game-detected`. If GEP attaches but
Overwatch isn't in the supported-games list, that's a Console-side registration gap, not
a Dev Mode problem — `src/main/gep.ts`'s `logSupportedGames()` diagnostic calls this out
explicitly in the log.

**Troubleshooting — GEP never loads (`invalid verification` / no `gep package ready`).**
ow-electron's own package-manager log is the source of truth:
`%APPDATA%/ow-electron/<app-uid>/logs/owpm.log` (also echoed to the `npm start` terminal).
`[SECURITY] Dev credentials rejected (401)` → `closing package manager: 'invalid
verification'` means the credentials *reached* Overwolf and were **rejected** — the local
`ow config` / env-var wiring is fine, the credentials themselves aren't accepted. Common causes:
1. **A dev key sent as an API key** (this repo's original bug). A dev key must go out as
   `OW_DEV_KEY` (Bearer); if it's sitting in the `apiKey` slot of `~/.ow-cli/credentials` it's
   sent as `OW_CLI_API_KEY` (Key) and rejected. Move it to `~/.ow-cli/dev-key` (or set
   `OW_DEV_KEY`). `npm run dev:check` should then report `(dev key, bearer)`.
2. **Stale/incorrect API key** — regenerate it (Console → Profile → API Keys → "Revoke and
   get new API key") and re-run `ow config`; regenerating a key invalidates the previous one,
   so an old value left in `~/.ow-cli/credentials` will 401.
3. **Account/app not yet approved for dev-mode gaming packages** — if credentials are the right
   type and still 401, dev tooling access hasn't been granted. Overwolf grants gaming-package
   (GEP) access once the app idea is approved and the account is whitelisted (see
   [Status](../../README.md)); contact your Overwolf DevRel.

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
