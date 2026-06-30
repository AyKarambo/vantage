# Overwatch Gametracker Sync

Auto-fills a Notion **Gametracker** database after every **competitive** Overwatch 2 match —
account, role, map, win/loss — and leaves your subjective notes (Tilt, Comms, Improvement,
Leaver) for you to fill in. Runs as a single **Windows tray icon**, no in-game overlay.

## How it works (and why it's account-safe)

```
Overwatch 2 ──▶ Counterwatch (Overwolf app) ──▶ its local IndexedDB
                                                      │  read-only
                                                      ▼
                                  this app ──▶ Notion Gametracker row
                                  └ tray icon + toast
```

**Counterwatch** is an Overwolf-sanctioned Overwatch tracker that does the actual in-game
capture through Overwolf's approved Game Events Provider. It writes every finished match to a
local database on your PC. **This app simply reads that local database** (your own files, on
your own machine), maps the fields, and creates a Gametracker row in Notion.

That means:
- **No Blizzard ban risk** — nothing here touches the game; Counterwatch does the sanctioned capture, and we only read its local output.
- **No Overwolf developer account / app approval** — we don't use Overwolf's APIs at all.
- **No screen capture / OCR.**

The whole thing is a single headless `ow-electron` process (used only as a convenient tray +
notifications host; it does **not** use Overwolf's game APIs).

## What gets synced

| Notion field | Source |
|---|---|
| Account | Counterwatch BattleTag → your accounts map |
| Role | Counterwatch role (Tank/Damage/Support → tank/damage/support; Flex → openQ) |
| Map (relation) | match map → your Maps DB page |
| Result | Victory/Defeat/Draw → Win/Loss/Draw |
| Game Type | Ranked/Competitive/… (only competitive is logged by default) |
| Battletag, Match ID (dedupe), Source = Auto | match record |

- **Competitive only** by default — Unranked / Quick Play / Arcade are skipped (`logFilter`).
- **Subjective fields** (Leaver, Comms, Improvement Target, Toxic Mates, Tilt) are left blank
  for you; auto rows are tagged `Source = Auto`.
- **Detailed per-hero stats** (K/D/A, damage, healing, mitigation, heroes) are **not** synced —
  they live, nicely presented, inside Counterwatch's own UI. (See *Limitations*.)

## Prerequisites

- **Windows**, **Node 18+**.
- **Counterwatch** installed (via Overwolf), **logged in**, and **running while you play** —
  it's what captures the matches. <https://www.counterwatch.gg/>
- A **Notion** workspace with the `Overwatch` page containing your `Gametracker` and `Maps`
  databases (already set up).

## Setup

1. **Install**
   ```bash
   npm install
   ```

2. **Notion integration token**
   - Create an *internal* integration at <https://www.notion.so/my-integrations>
     (capabilities: Read + Insert + Update content) and copy the token (`ntn_…`).
   - Open your Notion **Overwatch** page → `•••` → **Connections** → add the integration
     (this cascades to both `Gametracker` and `Maps`).

3. **Configure your accounts** — map each in-game BattleTag to its Notion `Account` value. Put
   your real tags in the machine-local config (tray → *Edit config*, which opens
   `config.local.json`):
   ```json
   { "accounts": { "MainTag#1234": "Karambo", "SmurfTag#5678": "BobRoss" } }
   ```
   (`config.local.json` is gitignored — keep personal data here, not in `appsettings.json`.)
   Add `mapAliases` only if a map name differs from your Notion Maps page name.

4. **Run**
   ```bash
   npm start
   ```
   A tray icon appears. Click it → **Set Notion token (from clipboard)** (copy the token first).

5. Play a competitive match (with Counterwatch running). Within ~30 s the row appears in your
   Gametracker and a tray toast confirms it. Enable **Run at login** from the tray to keep it
   running in the background.

## Configuration & data locations

- `appsettings.json` — version-controlled defaults (`logFilter`, `sensor`, database IDs,
  placeholder accounts, map aliases). **No personal data.**
- `config.local.json` (in the app's `userData` folder) — your personal overrides (real
  BattleTags, run-at-login). Never committed. Open via tray → *Edit config*.
- **Notion token** — stored encrypted (Electron `safeStorage`) in `userData`; or set the
  `NOTION_TOKEN` env var for development.
- Outbox / dedupe state — `userData/data/outbox.json`.

`logFilter` accepts `Competitive` (default — logs Ranked/Competitive), `CompetitiveAndQuickPlay`,
or `Everything`. Env overrides for one-off testing: `OW_SYNC_FILTER`, `OW_SYNC_SENSOR`.

## Resilience

- Matches are written to a durable on-disk **outbox** before the Notion write, removed on
  success, and **retried every 60 s** if Notion is down — so a failed/offline sync isn't lost.
- Dedupe is keyed on **Match ID**, so the same match is never written twice (the reader polls +
  watches Counterwatch's DB continuously).

## Limitations

- **Counterwatch must be running** while you play — it's the capture source. Matches played
  without it aren't recorded.
- We read Counterwatch's **internal** database. A Counterwatch update could change its field
  keys; if a row stops populating, the key map is centralized in one place
  (`KEYS` in `src/core/counterwatchParse.ts`) for a quick re-map.
- **Detailed stats are not extracted** — they're stored in a nested, encoded form that isn't
  worth reverse-engineering reliably (wrong numbers would be worse than none). View them in
  Counterwatch.
- Only matches Counterwatch has already saved are synced; historical games compacted out of its
  recent write-log may not be picked up — it's designed to track **going forward**.

## Verification

- **Unit tests** (vitest): resolvers, competitive filter (incl. the Unranked-vs-Ranked case),
  Counterwatch parser (field extraction, multi-revision merge), sync (retry/dedupe/in-flight).
  ```bash
  npm test
  ```
- **End-to-end**: with Counterwatch installed and a recent match played, `npm start` reads the
  match, and a `Source = Auto` row with the correct Account/Role/Map/Result appears in your
  Gametracker (the Map relation drives your existing Season/WinValue/win-rate formulas).

## Project layout

```
src/core/      pure logic: resolvers, competitive filter, Counterwatch parser — unit-tested
src/notion/    Notion writer + Maps cache (@notionhq/client)
src/store/     durable JSON outbox + dedupe
src/main/      ow-electron process: config, Counterwatch reader, tray, sync orchestration
test/          vitest suites · scripts/ tray icon generator
```

## Scripts

| Command | Description |
|---|---|
| `npm start` | build + run (reads Counterwatch, syncs to Notion) |
| `npm test` | run the vitest suite |
| `npm run typecheck` | type-check without emitting |
| `npm run build` | compile TypeScript to `dist/` |

## Note on the alternative GEP sensor

The repo also contains an Overwolf **GEP** sensor (`sensor: "gep"`), kept for reference. It
needs an approved/whitelisted Overwolf app to receive Overwatch 2 events, so it isn't usable for
a private, unpublished tool — which is exactly why the default sensor reads Counterwatch instead.
