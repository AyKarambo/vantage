# Screen spec: Mental (`mental`)

**Source:** `renderer/src/views/mental.ts`, `renderer/src/components/breakReminderEditor.ts`, `src/core/mental.ts`, `src/core/mentalAnalytics.ts`, `src/core/breakReminder.ts`.

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; the global filter bar re-scopes the range.

## Intent

Surface the signals the game never reports — self-logged tilt, comms quality, teammates — and quantify what tilt costs ("tilt tax") so the player actually takes breaks. Everything here is the manual (◎) layer, badged as such.

## Layout & behaviour

- **State card:** Calm and Tilted composite bars (0–100) plus a break-reminder editor (the shared `breakReminderEditor`: an on/off chip + a threshold `<select>`, 1–5 losses, disabled while off). The canonical settings home is Settings (`screen-settings.spec.md`); Mental keeps this inline copy where the stat lives — both edit the same persisted config. Changes apply immediately with an Undo toast.
- **"What it costs you" card** — five sample-gated cost rows, derived in `src/core/mentalAnalytics.ts` (`mentalCosts`):
  - **Tilt tax** — winrate calm vs tilted.
  - **Comms tax** — winrate with positive vs abusive comms (a source-conflicted game counts as positive).
  - **Toxic mates** — winrate without vs with toxic teammates.
  - **Leaver swing** — three-way: my-team leaver vs no leaver vs enemy leaver. The verdict prices my-team vs none; the enemy side is reported separately.
  - **Performance when tilted** — mean 0–100 self-rating calm vs tilted (gated on rated games).
  Every row shows both sides + the point delta only when BOTH sides carry ≥ `COST_MIN_SAMPLE` (5) decided (or rated) games; otherwise a dim needs-data line with the current counts.
- **Trends card** — a per-day tilt-rate sparkline (dependency-free SVG, `tiltTrend()`) plus an improving/worsening/flat read (`tiltTrendDirection()`: range halved by game count, both halves gated on 5 games, 3-point dead zone → flat). Fewer than 2 days → an empty-state hint.
- **Session & triggers card** — tilt rate by game number within a sitting (`tiltBySessionPosition()`): one bar per position ('1'…'5', '6+'), numbered over the UNFILTERED history with the 90-minute gap convention (the filter scopes which games aggregate, never renumbers sittings). A gated hint names the peak-tilt position; a game-1 peak flips the copy to a queue-up check-in.
- **Flags this range card:** counts of Tilt, Toxic mates, Leaver — my team, Leaver — enemy, Positive comms, Abusive comms (six boxes). Each count OR-merges the quick-log flag with the Review-screen flag on the same game, so a game flagged from either source counts once. The leaver count is split my-team / enemy (a legacy single `leaver: true` counts as my-team); both boxes drill into the combined `'leaver'` Matches filter.

## Out-of-Scope

- Logging the flags (done in the quick-log modal and on the Review screen, per active target — see `screen-review.spec.md`).
- Any therapeutic/coaching content beyond the one-line nudges.
- A history/log of past break-reminder toasts (only the live on/off + threshold state is shown).

## Constraints

- Data derives from per-match mental flags on stored records: the quick-log modal's `GameRecord.mental` and the Review screen's `GameRecord.review.flags`, OR-merged per flag.
- Composite formula: `tilted = tilt-flag share`; `calm = 0.5·(1 − tiltShare) + 0.5·positiveCommsShare` — two deliberately independent axes.
- All cost/trend/session derivations live in pure, Electron-free `src/core/mentalAnalytics.ts` with unit tests; the view only formats and gates on `COST_MIN_SAMPLE`. Payload fields (`mentalCosts`, `tiltTrend`, `tiltBySession`) ride the typed IPC contract. Draws never count toward a decided sample.
- **Break reminder** (`src/core/breakReminder.ts`, pure): given the current loss streak, settings, and prior fire-state, it fires at the configured threshold and re-fires every further `afterLosses` losses, and re-arms as soon as the streak stops being a loss streak. The main process evaluates it after every recorded game — from **both** ingestion paths (live GEP feed and the manual Log Match modal) — against the **unfiltered** history. Firing sends a Windows tray toast ("Time for a break?" / "That's N losses in a row…"). Settings: `enabled` + `afterLosses` (UI offers 1–5, core clamps 1–10, default `{ enabled: true, afterLosses: 2 }`), persisted to `config.local.json`, editable from this card and from Settings through the same component.
- Reminder fire-state is held **in-memory only** in the main process — an app restart re-arms it (an accepted trade-off).
