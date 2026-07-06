# Spec: dashboard-filter-fixes

Fixes three independent dashboard accuracy defects: GitHub issues
[#20](https://github.com/AyKarambo/vantage/issues/20),
[#21](https://github.com/AyKarambo/vantage/issues/21),
[#22](https://github.com/AyKarambo/vantage/issues/22).

**Updated 2026-07-06** after the `feedback-batch-2026-07` Area D fix (competitive-only capture
and UI, real season entries in the time filter, account filter removed from the filter bar) —
see `feedback-batch-2026-07.spec.md` Area D for the originating problem/requirements and its own
acceptance criteria. Area D **supersedes** this spec's original `#22` "This season" fix (a single
current-season window) with a full season-enumeration API and named past seasons; it also adds
two requirements this spec didn't originally cover (competitive-only, account-filter removal).
The sections below are amended so the two never diverge on shipped behavior.

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

4. **(added 2026-07-06, `feedback-batch-2026-07` Area D) The filter bar contradicts the
   product's competitive-only purpose and duplicates the account switcher.** The mode filter
   (All/Competitive/…) implies non-competitive tracking matters, while `logFilter`'s
   `shouldLog` predicate (`src/core/matchFilter.ts`) had no callers — quick-play/arcade games
   were recorded regardless of the config. The account filter duplicated the sidebar account
   switcher. And "This season" only ever meant the *current* season — no way to look at a named
   past season.

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
  **(Superseded 2026-07-06 — see below.)**
- **(added 2026-07-06, Area D) Competitive-only, everywhere.** The mode filter is removed from
  the filter bar; all screens, stats and counts (including `totalGamesAllTime`, pending
  reviews, exports, readiness) consider competitive games only. A new capture-time gate
  (`isCompetitive`, `src/core/matchFilter.ts`, wired in the match pipeline) stops non-competitive
  GEP matches from ever being recorded. The dead `logFilter` config key and `OW_SYNC_FILTER` env
  override are removed (an existing `logFilter` in a user config is ignored without error). The
  manual quick-log's mode picker is removed — manual logs are always competitive. Existing
  non-competitive rows stay in the DB but are invisible everywhere. Persisted filter state's
  `mode` key is ignored on load and dropped on next persist.
- **(superseded 2026-07-06, Area D) Season entries replace the single "This season" option.**
  The time filter now offers `Last 7 days`, `Last 30 days`, one entry per season that contains
  ≥1 competitive match (across all accounts), newest first with the current season always
  listed, then `All time`. Labels use in-game year-based naming with the counter resetting each
  calendar year (`2026 Season 1/2/3`, first 2027 season = `2027 Season 1`). Backed by a new
  pure season-enumeration/labeling API (`src/core/season.ts`: `SeasonWindow`,
  `currentSeasonWindow`, `seasonsForData`, `seasonWindowById`) and a contract change —
  `DashboardFilters.days` becomes `number | 'all' | { season: string }` — so a *specific* season
  is addressable, not just "the current one". A persisted legacy `days: 'season'` maps to the
  current named season; a persisted `{ season: id }` no longer offered falls back to the default
  (`Last 30 days`). This fully replaces `#22`'s original `days: 'season'` single-current-season
  design with an enumerable, addressable one — the original `90`-day literal fallback described
  below no longer applies once `{ season: id }` unambiguously resolves via `seasonWindowById`.
- **(added 2026-07-06, Area D) Account filter removed from the filter bar.** Account selection
  (including "All accounts") lives solely in the top-left account switcher. The `account` field
  disappears from the filter bar UI but remains in filter state/IPC contract (the switcher
  drives it). Saved presets from the old shape strip `mode` and `account` on load/apply (applying
  an old preset leaves the active account unchanged) and are rewritten to the new shape on next
  persist.

## Out-of-Scope

- Changing the default filter (stays "Last 30 days").
- Prefilling **Mode** for Log match from the filter (kept from prefs).
- Showing *all* anchored roles at once, or a "highest rank" selection.
- ~~A season *picker* for browsing past seasons; only "current season" is in scope.~~
  **(superseded 2026-07-06, Area D)** — past seasons are now enumerable and addressable; see
  above.
- Backfilling / retagging existing matches with a season number.
- Changing how rank anchors are stored or how SR deltas are replayed.
- Deleting non-competitive rows from the DB (Area D: hidden, not deleted).
- NSIS/installer changes; localization (out of scope for the whole batch, not just this fix).

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
- **(added 2026-07-06, Area D)** The capture-time competitive gate lives in `core/matchFilter.ts`
  (`isCompetitive`) and is called from the edge (match pipeline) — guardrail 3 still holds. No
  automatic Notion traffic is introduced by any of these fixes (guardrail 5).

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
- **(superseded 2026-07-06, Area D)** Log match no longer has a mode picker at all — manual
  logs are always competitive; there is nothing left to prefill for Mode.

### #22 — real season window **(superseded 2026-07-06 — see Area D below)**
- ~~Given today is within OW2 season *N* that started on date *S*, When I select "This
  season", Then only matches with `timestamp >= S` (and `<= now`) are included — season *N-1*
  matches are excluded.~~
- ~~Given a new season has started but the known-season table ends before it, When I select
  "This season", Then the boundary is extrapolated by the fixed 63-day cadence from the last
  known entry (no crash, no silent 90-day fallback).~~
- **Given** the season logic, **When** unit tests run, **Then** `currentSeasonWindow(now)`
  (formerly `currentSeason`) returns the correct start/end for representative dates (a known
  table date, a mid-season date, and an extrapolated future date), all computed purely from
  inputs.
- **Given** a filter previously persisted as `days: 90`, **When** the app loads it,
  **Then** it still resolves to a valid filter with no runtime error.

### Area D (added 2026-07-06) — competitive-only, named seasons, no account filter
- **Given** a history containing competitive and quick-play games, **when** any screen
  renders, **then** only competitive games are counted or listed anywhere, and no mode filter
  is visible.
- **Given** live capture running, **when** a quick-play match ends, **then** no match is
  written to history.
- **Given** the manual quick-log, **when** it opens, **then** there is no mode picker and a
  saved match is competitive.
- **Given** logged competitive matches in 2026 Season 1 and 2026 Season 3 only (today inside
  S3), **when** the user opens the time filter, **then** the options are exactly: Last 7 days,
  Last 30 days, 2026 Season 3, 2026 Season 1, All time — and picking `2026 Season 1` shows only
  matches from Feb 10 to Apr 14, 2026.
- **Given** a fresh install with no matches, **when** the user opens the time filter, **then**
  the only season entry is the current one (2026 Season 3).
- **Given** persisted filter state from the previous version containing `mode: 'Quick Play'`
  and `days: 'season'`, **when** the app starts, **then** nothing crashes, the mode key is
  discarded, and the time filter shows the current named season.
- **Given** a saved preset from the old shape containing `mode` and `account`, **when** the
  user applies it, **then** role/time apply, the active account selection is unchanged, and the
  preset is rewritten without the stale keys.
- **Given** the reworked filter bar, **when** the user looks for the account filter, **then**
  it is absent; switching accounts or choosing "All accounts" in the top-left switcher updates
  all views as before.

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
  **(superseded 2026-07-06, Area D)** — `days: 'season'` is itself now legacy; it maps to the
  current named season (`{ season: currentSeasonWindow(now).id }`) rather than being the
  season filter's terminal shape. See `feedback-batch-2026-07.plan.md` §3 `DashboardFilters`.
- **#21 mode →** Mode stays sourced from prefs (out of scope).
  **(superseded 2026-07-06, Area D)** — the mode picker itself is removed from Log match; there
  is no mode to prefill from any source anymore.
- **#22 cadence →** 63 days (9 weeks) for extrapolation beyond the table. **(unchanged by Area
  D — same cadence constant reused by `seasonsForData`/`currentSeasonWindow`.)**
- **(added 2026-07-06) Season naming →** in-game year-based naming, counter resets each
  calendar year (`2026 Season N`; first 2027 season = `2027 Season 1`). Only seasons with data
  are listed (current always shown; fresh installs see just the current season).
- **(added 2026-07-06) Non-competitive games →** track competitive only — new capture gate,
  `logFilter` config and the manual mode picker removed, existing non-competitive rows hidden
  (not deleted) everywhere.
- **(added 2026-07-06) "All accounts" affordance →** the existing account-switcher popover
  entry suffices; no replacement needed in the filter bar.

## Open Questions

_None blocking. Migration of a persisted `days: 90` to `'season'` was considered
and deliberately skipped: 90 remains a valid filter, and silently rewriting a
user's stored window would be presumptuous._

- **(added 2026-07-06)** Future seasons are extrapolated from a fixed 63-day cadence; Blizzard
  may drift from it, so an extrapolated future season may be temporarily mislabeled until the
  bundled calendar is updated in a later release. Accepted risk (unchanged from the original
  `#22` cadence caveat, now inherited by the season-enumeration API).
