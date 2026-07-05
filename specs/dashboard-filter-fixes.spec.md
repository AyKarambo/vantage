# Spec: dashboard-filter-fixes

Fixes three independent dashboard accuracy defects: GitHub issues
[#20](https://github.com/AyKarambo/vantage/issues/20),
[#21](https://github.com/AyKarambo/vantage/issues/21),
[#22](https://github.com/AyKarambo/vantage/issues/22).

## Intent (WHAT & WHY)

1. **#20 — Setting a rank doesn't update the displayed rank.** After a user
   sets/edits a rank anchor in Settings → Manage Accounts, the sidebar account
   chip and Overview "Rank" KPI don't reflect it — the settings card refetches
   only itself, never the global dashboard snapshot, and the "primary rank"
   heuristic can surface a different role than the one just set. The user's
   hand-entered rank is the most trustworthy signal in the app; showing anything
   else reads as broken.

2. **#21 — Log-match ignores the active filter.** When the dashboard is scoped to
   a specific account/role, opening "Log match" still defaults Account/Role to the
   last-logged values, forcing re-selection and inviting matches logged against the
   wrong account.

3. **#22 — "This season" isn't a season.** The "This season" filter is a hardcoded
   rolling 90-day window (`days: 90`), not the actual Overwatch 2 competitive
   season. Both the duration (~90d vs ~9 weeks) and the alignment (rolling from
   "now" vs the season's real start date) are wrong, so "This season" silently
   mixes in the previous season's matches.

All three are visible-every-session inaccuracies in the app's core promise: turn
match history into trustworthy stats.

## In-Scope

- **#20a** Setting/editing a rank anchor in Manage Accounts immediately refreshes
  the sidebar chip and Overview "Rank" KPI (no manual navigation/restart).
- **#20b** When an account has multiple anchored roles, the surfaced rank respects
  the **active Role filter** when one is set, falling back to the most-played
  anchored role otherwise.
- **#21** "Log match" prefills **Account** and **Role** from the active dashboard
  filter when those filters name a specific value; falls back to the existing
  last-used-prefs behavior when a filter is "all".
- **#22** "This season" filters to matches within the **current OW2 competitive
  season's real start→now window**, derived from a table of known season start
  dates with a fixed 9-week (63-day) cadence formula fallback for future seasons.
  Implemented as pure, unit-tested `core/` logic.

## Out-of-Scope

- Changing the default filter (stays "Last 30 days").
- Prefilling **Mode** for Log match from the filter (kept from prefs).
- Showing *all* anchored roles at once, or a "highest rank" selection.
- A season *picker* for browsing past seasons; only "current season" is in scope.
- Backfilling / retagging existing matches with a season number.
- Changing how rank anchors are stored or how SR deltas are replayed.

## Constraints

- **Guardrail 3 — `core/` stays pure & Electron-free.** Season-boundary logic and
  rank-selection logic live under `src/core/`, take "now"/inputs as parameters (no
  ambient clock inside the pure helper), and ship with vitest unit tests.
- **Guardrail 4 — renderer stays CSP-friendly.** No new remote code; season data
  ships in the bundle.
- **Typed IPC contract end-to-end** — the `days` filter value stays a typed union;
  no `any` across the boundary.
- **Definition of Done:** `npm test` green, `npm run typecheck` clean (main +
  renderer), new core logic unit-tested, README updated where user-visible filter
  behavior changes. Preview harness keeps working for all three.

## Acceptance Criteria

### #20a — refresh after set
- **Given** an account with a rank anchor shown in the sidebar/Overview, **When** I
  change that role's rank via Manage Accounts → "Set rank" and Save, **Then** the
  sidebar chip and Overview "Rank" KPI show the new value without navigating away
  or restarting.

### #20b — filter-aware rank selection
- **Given** an account with anchors for multiple roles **and** an active Role
  filter set to one of them, **When** the dashboard renders, **Then** the sidebar
  chip and Overview "Rank" show that filtered role's anchored rank.
- **Given** no Role filter (role = "all"), **When** the dashboard renders, **Then**
  the shown rank is the most-played anchored role (unchanged from today).
- **Given** a Role filter whose role has **no** anchor for the active account,
  **When** the dashboard renders, **Then** it falls back to the most-played
  anchored role (or the winrate heuristic if the account has no anchors at all).

### #21 — log prefill from filter
- **Given** the dashboard is filtered to account "Smurf#123", **When** I open "Log
  match", **Then** the Account field defaults to "Smurf#123".
- **Given** the dashboard is filtered to role "support", **When** I open "Log
  match", **Then** the Role segment defaults to Support.
- **Given** account (or role) filter is "all", **When** I open "Log match", **Then**
  that field falls back to the last-logged value (today's behavior).
- **Given** the active filter names an account not in the account list, **When** I
  open "Log match", **Then** it falls back gracefully to the first option (no
  crash/blank).

### #22 — real season window
- **Given** today is within OW2 season *N* that started on date *S*, **When** I
  select "This season", **Then** only matches with `timestamp >= S` (and `<= now`)
  are included — season *N-1* matches are excluded.
- **Given** a new season has started but the known-season table ends before it,
  **When** I select "This season", **Then** the boundary is extrapolated by the
  fixed 63-day cadence from the last known entry (no crash, no silent 90-day
  fallback).
- **Given** the season logic, **When** unit tests run, **Then** `currentSeason(now)`
  returns the correct start/end for representative dates (a known table date, a
  mid-season date, and an extrapolated future date), all computed purely from
  inputs.
- **Given** a filter previously persisted as `days: 90`, **When** the app loads it,
  **Then** it still resolves to a valid filter with no runtime error.

## Resolved Questions

- **#22 season source →** *Table + formula fallback.* Ship a table of known OW2
  season start dates; extrapolate future seasons via a fixed 63-day (9-week)
  cadence from the last known entry so "This season" never silently breaks between
  releases. Table dates grounded against Blizzard's published schedule at
  implementation time.
- **#20 rank selection →** *Active role filter, else most-played.*
- **#22 filter value →** Replace the `days: 90` "This season" option with a
  dedicated `days: 'season'` value; drop the fake literal 90-day option. A
  previously-persisted `days: 90` remains a legal rolling-90-day filter (no crash),
  just no longer offered in the dropdown.
- **#21 mode →** Mode stays sourced from prefs (out of scope).
- **#22 cadence →** 63 days (9 weeks) for extrapolation beyond the table.

## Open Questions

_None blocking. Migration of a persisted `days: 90` to `'season'` was considered
and deliberately skipped: 90 remains a valid filter, and silently rewriting a
user's stored window would be presumptuous._
