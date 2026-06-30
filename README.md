# Overwatch Gametracker Sync

Auto-fills a Notion **Gametracker** database after every Overwatch 2 match — map, role,
account, win/loss, plus full stats — and leaves your subjective notes (Tilt, Comms, …) for
you to fill in. Runs as a single **Windows tray icon**, no in-game overlay.

## Why it can't get your account banned

The only thing that reads the game is **Overwolf's Game Events Provider (GEP)**, via the
sanctioned `ow-electron` runtime. GEP is approved by Blizzard, never reads game memory,
never injects, and only surfaces information you can already see on your own scoreboard
(your map, account, result, your own stats). This is the same mechanism shipping trackers
like Counterwatch use. This app does **no** memory reading, packet sniffing, or injection —
those are the bannable techniques and are deliberately out of scope.

## How it works

```
Overwatch 2 ──▶ Overwolf GEP ──▶ ow-electron app (this) ──▶ Notion Gametracker row
                                  └ tray icon + toast
```

A single headless `ow-electron` process subscribes to GEP, assembles one record per match,
resolves the four core fields, applies your **Competitive-only** filter, dedupes, writes the
row via the official Notion API, and shows a brief tray notification.

| Notion field | From GEP |
|---|---|
| Account | `battle_tag` → your accounts map |
| Role | open queue → `openQ`, else local `hero_role` |
| Map (relation) | `match_info.map` → Maps DB page |
| Result | `match_outcome` (Victory/Defeat/Draw) |
| Hero(es) Played, Eliminations, Deaths, Assists, Damage, Healing, Mitigation | local roster |
| Game Type, Queue Type, Group Size, Match Duration (min), Final Score, Battletag, Match ID | game/match info |
| Source | always `Auto` |

Subjective fields (Leaver, Comms, Improvement Target, Toxic Mates, Tilt) are left blank.

## Prerequisites

- **Node 18+** and Windows.
- An **Overwolf developer account** (free) to enable GEP for Overwatch 2 on your machine —
  see <https://dev.overwolf.com/ow-electron/>. Personal/local use needs **no** store
  publishing and **no** code-signing certificate.
- **Overwatch 2** installed.
- A **Notion** workspace with the `Overwatch` page containing the `Gametracker` and `Maps`
  databases (already set up).

## Setup

1. **Install**
   ```bash
   npm install
   ```

2. **Notion integration token**
   - Create an *internal* integration at <https://www.notion.so/my-integrations> and copy
     its token (starts with `ntn_` or `secret_`).
   - Open your Notion **Overwatch** page → `•••` → *Connections* → add the integration. (It
     is the parent of both `Gametracker` and `Maps`, so this grants read+write to both.)

3. **Configure your accounts**
   - Edit `appsettings.json` (or, once running, the tray → *Edit config*) and map each
     in-game **BattleTag** to its Notion `Account` value:
     ```json
     "accounts": { "Karambo#21234": "Karambo", "BobRoss#1102": "BobRoss" }
     ```
   - Add `mapAliases` only if a GEP map name differs from your Notion Maps page name.

4. **Run**
   ```bash
   npm start
   ```
   This generates the tray icon, builds, and launches under `ow-electron`. A tray icon
   appears. Click it → **Set Notion token (from clipboard)** (copy the token first).

5. Launch Overwatch and play a competitive match. The row appears in Gametracker and a tray
   toast confirms it.

> Tip: enable **Run at login** from the tray menu to have it always running in the background.

## Configuration & data locations

- `appsettings.json` — version-controlled defaults (database IDs, filter, accounts, aliases).
- `config.local.json` (in the app's `userData` folder) — your personal overrides; never
  committed. Open it from the tray → *Edit config*.
- **Notion token** — stored encrypted (Electron `safeStorage`) in `userData`; or set the
  `NOTION_TOKEN` env var for development.
- Local outbox/dedupe state — `userData/data/outbox.json`.

`logFilter` accepts `Competitive` (default), `CompetitiveAndQuickPlay`, or `Everything`.

## Verification

- **Unit tests** (resolvers, filter, aggregator, dedupe):
  ```bash
  npm test
  ```
- **Without the game** — use Overwolf's **GEP Simulator** to replay an Overwatch 2 event
  sequence and confirm a test row appears with the right Map/Role/Account/Result and stats,
  the toast fires, and a replay does not create a duplicate.
- **Live** — play one competitive match; confirm one correct row (`Source = Auto`, subjective
  fields blank) and that a Quick Play/Arcade match is **not** logged.

## Troubleshooting

- **No events**: GEP rolls out per game and can pause after a big OW2 patch until Overwolf
  re-maps it. The tray status shows the current state; matches during an outage aren't logged
  (enter them manually as before).
- **"Overwatch is running as administrator"**: run this app as administrator too, or launch
  the game non-elevated, so GEP can attach.
- **Unmapped account / map** toast: add the BattleTag to `accounts`, or add a `mapAliases`
  entry / the missing page to your Notion Maps DB, then *Reload config*.
- **Field names look off** after a patch: every raw GEP message is logged to the console
  (`npm start` shows them); adjust the `K` key table in `src/core/matchAggregator.ts` if a
  feature/key was renamed.

## Project layout

```
src/core/      pure logic (resolvers, filter, match aggregator) — unit-tested, no I/O
src/notion/    Notion writer + Maps cache (@notionhq/client)
src/store/     durable JSON outbox + dedupe
src/main/      ow-electron process: config, GEP service, tray, sync orchestration
test/          vitest suites
scripts/       tray icon generator
```

## Scripts

| Command | Description |
|---|---|
| `npm start` | build + run under ow-electron |
| `npm test` | run the vitest suite |
| `npm run typecheck` | type-check without emitting |
| `npm run build` | compile TypeScript to `dist/` |

## Limitations

- Only **your** team's data is available from GEP — enemy composition is not logged.
- Subjective judgement fields are never auto-filled.
- Depends on Overwolf GEP availability for Overwatch 2.
