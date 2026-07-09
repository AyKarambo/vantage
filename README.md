# Vantage

A standalone **Overwatch stats coach**. Vantage turns your match history into a
dashboard of priority maps, exact hero stats, mental tracking and flexible
improvement targets — and tells you **where the points are hiding**. Built on
**ow-electron** (Overwolf's Electron); a frameless desktop app (1300×840) that runs
from a single Windows tray icon. Notion is one optional export, not the core.

The visual design follows the **Vantage — Aurora** direction: a near-black canvas,
an aurora-purple accent, Geist / Geist Mono type, and a data model that separates
**⚡ auto-detected** signals (result · map · hero) from **◎ manual** ones (tilt ·
comms · toxicity · leavers · your improvement target).

## Screens

Every screen sits behind a persistent sidebar: the account switcher (a specific tracked
account, or **All accounts**), navigation, and a **Current session** card — a live recap
(W–L, net, winrate) of your current sitting. A sitting ends once you've gone longer than a
configurable gap since your last game (default 3h; adjustable in Settings → General →
Coaching), so a late-night session spanning past midnight still reads as one, and the card
never shows stale data as "current."

- **Overview** — greeting, KPIs (winrate, games, rank, streak), the flagship
  *winrate × volume* scatter with a top-priority callout, and a mental snapshot.
- **Matches** — the recent game log; click any row for a full **match detail page**
  (scoreboard, per-hero tabs, competitive progress, a read-only **Grades card** with
  the match's target grades, performance rating and feel/leaver flags, player history,
  and an end-of-match screenshots gallery — each section degrades gracefully to whatever
  the game feed actually reported for that match). Every match is **editable** from here:
  hand-logged matches fully, auto-tracked ones down to their manual layer (mental
  flags, leaver-team, SR %, target grades) while the game-derived facts stay locked.
  The editor mirrors the Log match card — the same shared controls, wording and field
  order: colour-coded **W/L/D** (the `W`/`L`/`D` keys work here too), the **locked map
  combobox** (type to search, recent maps first), the **most-played hero shortlist**
  with search, the **mouse-wheel nudge** on the SR field, the **three-state comms**
  switch (positive / banter / abusive), and a **"Set current rank"** mode — enter the
  rank you ended at and Vantage **back-calculates that match's SR %** (your live anchor
  is left as-is; switching role re-seeds the prefilled rank). Competitive
  progress shows the rank you held **after that specific match**: forward-calculated for
  matches at/after your anchor, and **reconstructed backward** (best-effort) for older
  ones, so a past game no longer just echoes today's rank.
  A **Customize view** popover lets you set role, heroes, account, SR delta, duration,
  final score, performance rating, target grades and leaver/mental flags each to hidden,
  inline (folded into the row's meta line), or its own aligned column — the choice
  persists across sessions. The grades-oriented fields start hidden and render compactly
  when enabled: the 0-100 self-rating as a small tinted stat, auto-graded measured
  targets as Hit / Partial / Missed pills, and flags as Tilt / Toxic / Leaver / +Comms /
  Abusive pills. The meta line only ever joins the fields you've set to inline that
  actually have a value for that row (no `—` placeholders or dangling `·`), and
  disappears entirely when nothing applies.
- **Maps** — winrate by game mode, then every map ranked best → worst.
- **Heroes** — the exact per-hero table (per-10-minute stats), with a click-through
  drill-down drawer (per-map winrate, recent games, aggregates).
- **Focus** — the "what to work on" hub: net-losing **maps, heroes and roles** in one
  deficit-ranked list, each with a trend arrow (improving/declining) and — once you
  track it as a target — the winrate movement since you flagged it.
- **Mental** — calm/tilt state, a **"What it costs you"** card (the tilt tax generalized:
  winrate deltas for tilt, comms tone, toxic teammates, a my-team/enemy **leaver swing**,
  and the performance drop when tilted — each sample-gated), a **tilt-rate trend** sparkline
  with an improving/worsening read, **tilt by game # in a sitting** (the "stop after game N"
  read), flag counts with leavers split by team, and a **break-reminder setting**
  (on/off + loss threshold) that fires a tray notification after N consecutive losses.
- **Trends** — winrate over time, splits by role/account, **when you win** (time-of-day
  winrate with a best-window callout) and the **session fatigue curve** (winrate by game number
  within a sitting, with a "you fade from game N" read when the sample supports it), an
  activity heatmap, and **your self-rating over time** (the 0–100 performance slider with a
  rolling average plus the avg-rating-on-wins vs -losses split — does your self-read track
  results, or your play?). Per-hero and per-map average self-ratings also appear as **RTG**
  columns on the Heroes and Maps tables.
- **Readiness** — a **training-load & recovery** read borrowed from the sports-science idea
  of *supercompensation*, detecting **over- and undertraining**. One **score-first composite**
  (0–100, the band derives from it — score and verdict can't disagree) built from three
  families: **behavioral load** (volume vs *your own* norm — habit is not risk), **objective
  performance vs your own baselines** (winrate and per-10 elims/deaths/damage/healing, per
  hero *and per account*, so an alt's lobbies never skew your main; a decline only counts once
  it's sustained — one long marathon session qualifies, a single bad game never does), and
  down-weighted **self-report** (tilt + your performance rating, hard-capped so a feeling
  never outweighs the evidence). Working on your **improvement targets** softens a results dip
  (deliberate practice makes you temporarily worse — that's normal) unless your tilt is clearly
  elevated; heroes you're still learning are exempt entirely. The screen shows the verdict +
  score, a **"what moves the score"** subscore breakdown, the top reasons, a rest
  recommendation, and the trend. The verdict is **regime-aware**: a ⚡ stats / ⚡◎ hybrid / ◎
  manual badge shows how much of the read rests on live match stats vs your own logs, blending
  continuously as coverage rises or falls (a patch-day GEP outage eases it toward manual and back —
  missing stats are never counted against you). On manual logs alone (today's norm, pending Overwolf
  approval) results-vs-your-own-baseline are promoted and a norm-free absolute training-load read
  (consecutive days, daily volume, marathon sessions) fills in for unmeasurable outcomes, with
  confidence capped at medium; **load alone still never reads red in any regime**. A simultaneous
  drop in output *and* deaths reads as playing scared, not as improvement (deaths only earn credit
  while output holds). A week-plus layoff reads as **Rusty** (ramp-back-up nudge,
  not an alarm); a thin weekly rhythm gets a consistency nudge **only on proven rank stagnation**
  (~2 weeks of logged SR changes with no account climbing) — the coach never encourages volume
  for its own sake. Deliberately conservative and
  framed as an evidence-informed **wellness nudge, not a diagnosis**. The screen itself stays
  data-first; all the explanation — a progressive-disclosure **help wiki** (plain → how it works
  → the real formulas), a personalized *"your readiness right now"* score walkthrough, and a
  curated library of player scenarios — lives behind a **Help** button
  (replacing the old single "How is this calculated?" modal), including its limits (e.g. a balance
  patch looks like a decline too). Optional opt-in tray reminder at launch; extends
  (doesn't replace) the Mental break reminder. It's the one screen that ignores the filter bar
  and account switcher entirely — readiness is about the person, not a slice of their history.
- **Review** — grade your active **self-rated** (◎) targets (Hit / Partial / Missed), flag
  how each tracked game felt, and rate your own **performance** on a 0-100 slider; **measured
  (⚡) targets are auto-graded from that match's stats and shown read-only**. An
  always-visible inbox of ungraded games, independent of the global filters.
- **Improvement Target** — build a target (self-rated ◎, or measured ⚡ which **auto-grades
  from your per-10-minute stats** — no manual read), or start from a **curated, coaching-grounded
  template** (positioning, ult economy, cooldown value, target selection, plus per-role stat
  floors). Measured thresholds take **scroll-to-adjust** (per-stat steps, hold Shift for bigger
  jumps). Rotate your focus with the **Active focus** panel (quick add/remove + "start a fresh
  focus"); active targets that go stale (past a configurable days/matches threshold) get a
  rotate nudge. Edit or archive/delete targets, and track a library that shows whether hitting
  a target actually moves your winrate. The **Focus** screen can create a map-practice target
  for a losing map in one click (**＋ target**).
- **Log match** — the quick-capture card that opens after a game, built to be **keyboard-fast**:
  `W`/`L`/`D` picks the result, the **map is a locked combobox** — type to search (recent picks
  listed first), but the field can only ever hold a real map name; a rotated-out map is still
  reachable by typing its name (shown muted, deprioritized), just not offered by default. `Enter`
  saves, and `Ctrl+Enter` is **Save & log another** (which carries your heroes over — it's the same
  sitting). Forgot to log during the session? The **Played** chips backfill a game 30 min / 1 h / 2 h
  into the past so session analytics stay honest. Pick the **account** and **role** (Tank / Damage /
  Support / **Open Queue**); the **hero picker defaults to your most-played heroes** for that
  role and account (chip grid, same tap-to-toggle as before) — **search** reaches any hero outside
  the shortlist, and how many heroes it suggests is configurable in **Settings › Quick Log**
  (default 6). Every logged match is competitive, so there's no mode picker. The **skill-rating**
  field **presets from the result** (+25 on a win, −25 on a loss) and takes a **mouse-wheel nudge**
  (±1) — or flip it to **"Set current rank"** to enter your rank directly (**prefilled from the rank
  already tracked** for that account+role, if any — also wheel-adjustable) and let Vantage work out
  the change (handy when you forgot to track a few). A **negative %** there (or in Settings ›
  Accounts) means you're **in rank protection**. Flag the **leaver** by team (my team / enemy), set
  the **comms** tone on a colour switch (**positive / banter / abusive** — the same switch now backs
  Review and the match editor), rate your own **performance** on a 0-100 slider (colored on the same
  red→green scale as winrate elsewhere; also editable later from Review or a match's detail page), and
  grade active improvement targets inline.
  Vantage then **calculates your live rank** from that anchor plus each logged %, including Overwatch
  **rank protection** (a loss that would drop below 0% holds the division and keeps the true negative
  carry — matching the game's own negative display — until a win or draw pays it back above 0%; only
  a further loss demotes).
- **Notion sync** — connect a Notion integration token, pick (or auto-create) the
  target database, **push** your tracked games to it and **import** them back — an
  on-demand pull that reads the Gametracker rows into local history for restoring or
  migrating a season. The round-trip preserves each match's **time** (via a `Played At`
  column, so restored history lands on the right days), its **skill-rating change** (via
  an `SR Delta` column) and **round score**, and its **auto/manual provenance**; a
  just-imported season won't re-duplicate itself on the next Sync, and if the date
  filter would hide it all the Overview offers a one-click "view all time". Sync is
  **update-in-place**, not create-only: re-syncing a match you've since reviewed (target
  grades, comms) fills in its `Improvement Target`/`Comms` cells on the existing row, and
  clearing a flag or grade locally clears the matching cell on the next sync — no
  duplicate rows. Multi-target reviews export as one aggregate grade (all hit → `hit`,
  all missed → `missed`, any mix → `partially`). If you delete a row in Notion, the next
  sync recreates it and the sync result calls it out (`N recreated`). Importing a row you
  graded in Notion (`Improvement Target`) now **merges into the existing local match**
  instead of leaving it stuck in the pending queue — as hidden bookkeeping, so it never
  shows up as an extra target on the Targets or Review screens; a local review or mental
  record you already entered always wins over what's in Notion. Sync and import are
  **duplicate-proof by construction**: importing a hand-added row (one with an empty
  `Match ID` cell) **writes the generated match id back onto the row**, so the row itself
  carries the link from then on; and before ever creating a row, Sync **scans the
  database for an existing match** (by `Match ID` cell, or — for hand-added rows — by the
  id derived from the page itself) and updates it in place instead of re-creating it,
  even after a reinstall or on a new machine. If duplicates already crept in, the import
  summary reports them and a **"Clean up duplicate rows"** action (explicit, behind a
  confirm) keeps one row per match and moves the redundant copies to Notion's trash
  (restorable for ~30 days) — nothing in Notion is ever archived without that click.
  The schema also **stays in step with the app**: on connect, Vantage detects the
  columns it owns and expects but that your database is missing (e.g. an `SR Delta`
  or `Comms` column a later version added) and **creates them in place** — additively,
  so your own columns and data are never touched — then writes them on the very next
  sync. A column that used to hard-stop the sync ("Database is missing …") now
  self-heals instead; the status card notes what it added. A column present with the
  wrong type, or under a near-miss name, is **never overwritten** — it's surfaced for
  you to fix. If the integration token can't edit the schema, the sync still runs for
  the columns that already exist, and the reason is shown.
  Opening the Notion screen also shows a **per-column status** for the five optional
  subjective columns (Comms, Improvement Target, Leaver, Tilt, Toxic Mates): available,
  or skipped with a reason (missing, wrong type, or a near-miss name like `comms ` you
  probably meant). Only the manual **Sync**, **Import** and **Clean up** buttons ever
  send data outbound — no automatic traffic.
- **About** — the app's identity and version, the build/runtime facts (Electron, Chromium,
  Node, V8, platform/OS) with a one-click **Copy diagnostics** for bug reports, the
  account-safety ("zero ban risk — GEP only") and local-first promises restated in-app, and
  support/legal (support email, MIT © Timo Seikel). External links open via the sanctioned
  `shell.openExternal` path — the renderer window itself never navigates.

Vantage tracks **competitive matches only** — quick play and arcade games are never recorded,
live or manually logged, so every stat, count, and export is competitive by construction (existing
non-competitive rows from before this were simply hidden, not deleted). Filter by role and time
range — with a one-click **Reset** chip and savable presets. The time filter offers `Last 7 days`,
`Last 30 days`, one entry per **named competitive season** with data (e.g. `2026 Season 3`, newest
first, current season always listed), and `All time`; there's no account or game-mode filter in the
bar — the account switcher in the top-left already covers "which account", and mode no longer
applies. Quality-of-life throughout: **Ctrl+K command palette** (jump to any screen, run actions,
find a map/hero/recent match), keyboard shortcuts (`Ctrl+1–9` screens, `?` cheatsheet, `←/→`
between match details, `H/P/M/S` grading on Review, `W/L/D`+`Enter` in the log dialog), toasts with
**Undo** for reversible actions, day-grouped match log with hero/map cross-links, **drill-down
everywhere** (click a heatmap day or a Mental flag count to open exactly those matches; hero-drawer
map rows and Overview scatter dots jump to the Maps screen), remembered role + account in the
quick-log, hover tooltips + a "view as table" toggle on charts, a next-day session recap, a
choice of **winrate colour schemes** (Aurora, Teal & coral, or a colorblind-safe blue–orange),
window-position memory, and a **Settings** screen with an
**accounts manager** (create/edit/delete accounts, per-role rank anchors), a **Master data**
editor (see below), a **Quick Log** card (how many most-played heroes the log-match hero picker
suggests) alongside the break
reminder, close-to-tray, run-at-login, diagnostics, and a **Data storage** card that relocates
*all* your data — match history, targets, outbox, rank anchors, and screenshots — to any folder,
moved together with a copy-verify-then-delete guarantee. Point it at a OneDrive/Dropbox-synced
folder for off-machine backup (use it from one machine at a time — editing the same synced files
from two machines at once can corrupt them). The app restores your last view on launch and
refreshes without flicker.

The **first time you launch Vantage**, before any demo-data prompt, it asks where to keep your
data: the default app-data folder (preselected) or a folder you choose via the native picker,
validated as creatable and writable. Pointing it at a folder that already holds Vantage data (say,
an existing OneDrive backup) **adopts** that data as-is rather than overwriting or migrating it.
Existing installs updating to this version see no prompt and keep their current location.

Match history is stored on-device in an embedded **SQLite** database (`history.db`); a pre-SQLite
`history.json` is imported once on first launch and kept untouched as a frozen backup. Storage stays
**local-first** — the only outbound paths are the opt-in Notion export and the opt-in **Master data
update** below, both user-initiated.

### Master data (heroes, maps & seasons)

The lists behind Vantage — the **hero roster** (and each hero's role), the **maps** (and their game
modes), and the **competitive seasons** — are fully **editable** in *Settings › Master data*, so you
never have to wait for an app update when Blizzard adds a hero, a map, or starts a season. Add, edit,
or remove any entry; maps carry an **In pool / Out of pool** toggle for the current competitive map
pool (an out-of-pool map stays in your history and analytics but is hidden from new-log suggestions
and the demo generator). Season boundaries are hand-editable too, and the current season keeps
auto-extrapolating on its usual cadence between edits.

An **Update** button fetches the latest heroes & maps from the community
[OverFast API](https://overfast-api.tekrop.fr) (MIT-licensed, derived from Blizzard's public
reference pages — there is no official Blizzard data API) and shows **new and changed** entries as a
preview you **accept or discard per item** — nothing is written until you accept, your manual edits
are never silently overwritten, and everything stays editable afterward. This is the only new
outbound path besides Notion: it is **user-initiated**, sends **no personal, account, or match
data**, treats the response as untrusted, and falls back to the bundled snapshot when offline. The
endpoint is configurable in `appsettings.json` (`masterData.overfastBaseUrl`). Seasons are edited
by hand only — no public API exposes their dates. Your edits live in `masterData.json` alongside
the rest of your data and travel with it when you relocate the data folder.

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
- Competitive **rank** follows the current Overwatch model: eight tiers Bronze→**Champion**,
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
IDs are deduped, so re-syncing never creates a duplicate row — but it does **update** an
already-exported match's row when its review or mental flags changed since the last sync
(and recreates it if you deleted it in Notion). When Vantage adds a stats column in a new
version, it's **created in your existing database automatically** on connect (additively —
your own columns are left alone), so exports never silently drop a field or refuse to run.
(The tray's **Set Notion token** still works too; a hand-edited `appsettings.json`
database id is still supported as a fallback.)

## Architecture

```
Overwatch ─▶ GEP ─▶ aggregator ─▶ GameRecord ─▶ HistoryStore ───┐
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
- `core/readiness/` — the pure readiness / training-load model: gap-based sessions, a local
  4am-day boundary, EWMA acute-vs-chronic load, per-account/per-hero stat **baselines** with a
  one-sided-CUSUM decline detector (`baselines.ts`, `performance.ts`), a disagreement-gated
  subjective read (`subjective.ts`), and the **score-first composite** — three bounded
  subscore deltas on a 75 anchor, with the band derived from (score, driver, hard gates)
  (`score.ts`), plus a continuous **stats↔manual blend** `b` (`regime.ts`, bit-identical to the
  old engine at `b=1`) and the regime label. All thresholds are conservative, centrally tuned
  constants; every gate is unit-tested. Surfaced on `DashboardData` like `mental`.
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

## Importing match history

Bring an existing tracker's matches into Vantage without giving up your own tool. A companion
PowerShell script converts an Obsidian match vault into a **Vantage import file** (JSON), and
Settings → **Data import** ingests it — imported matches are tagged so they can be cleared and
re-imported cleanly. See **[docs/import.md](docs/import.md)** for the workflow and the file format.

```powershell
npm run import:obsidian -- -VaultPath "C:\path\to\vault" -OutFile "vantage-import.json" -CurrentRank "Diamond 3"
```

## Build a release

Every push to `main` auto-publishes a GitHub Release: the
[`auto-release`](.github/workflows/auto-release.yml) workflow derives the next version from the latest
`v*` tag plus the [Conventional Commits](https://www.conventionalcommits.org/) since it (`feat` →
minor, `fix`/others → patch, `type!:`/`BREAKING CHANGE` → major), builds the installer on a Windows
runner, and publishes a tagged Release with it attached. It's **tag-driven** — the version is baked
into the built installer but not committed back, so nothing pushes to the protected `main` branch
(`package.json`'s version field stays at its floor; the tag/Release/installer carry the real version).
CI signs the installer automatically when the SSL.com eSigner secrets are configured
(unsigned otherwise — see [docs/signing.md](docs/signing.md)).

To build locally:

```bash
npm run release    # ow-electron-builder → release/Vantage-Setup-<ver>.exe
```

Without the `ES_*` env vars this produces an unsigned installer (fine for personal use — Windows
SmartScreen → *More info → Run anyway*). With them set, the same build signs the app exe, the
uninstaller and the installer via SSL.com eSigner — required for the Overwolf gaming packages (GEP)
to load in distributed builds. Setup and runbook: [docs/signing.md](docs/signing.md).

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
