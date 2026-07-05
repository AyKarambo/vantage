# Techplan: dashboard-filter-fixes

Implements [dashboard-filter-fixes.spec.md](dashboard-filter-fixes.spec.md). Three
independent fixes; grouped here because they all live in the dashboard
filter/display path.

## Architecture & Approach

### #22 — real season window (new pure core module)
- **New file `src/core/season.ts`** — pure, Electron-free, clock-injected:
  - `SEASON_STARTS`: an ordered table of known OW2 competitive season start dates
    (ISO strings → epoch ms). Grounded against Blizzard's published schedule at
    implementation time. Covers 2024-08 → 2026-06 (the realistic range of tracked
    history); the current season as of this work is 2026 "Into the Tiger's Den",
    started 2026-06-16.
  - `SEASON_CADENCE_MS = 63 * 86_400_000` (9 weeks) — the extrapolation step.
  - `seasonStart(now: number): number` — the start of the season containing `now`:
    the latest table entry `<= now`; if `now` is at/after the last table entry,
    roll forward by whole cadences; if `now` precedes the table, roll backward by
    cadences from the earliest entry (defensive — production always passes a current
    `now`). Total, never throws.
  - `currentSeason(now: number): { start: number; end: number }` — `start` from
    `seasonStart`; `end` is the next table boundary after `start`, else
    `start + SEASON_CADENCE_MS`.
- **`src/core/dashboardData.ts` → `applyFilters`**: compute `const now = Date.now()`
  once; for `f.days === 'season'` filter `g.timestamp >= seasonStart(now)`; the
  numeric day-window path reuses the same `now`.
- **`computeDashboard` weekly flag**: make the `'season'` case explicit (season ≈ 63
  days → daily trend, matching today's behavior for the old `90`), avoiding the
  `NaN`-cast smell of `(filters.days as number) > 90`.
- **Contract `src/shared/contract/dashboard.ts`**: `days?: number | 'all' | 'season'`
  (+ comment). This is the only contract change; it flows to renderer + main via the
  shared barrel.

### #22 — renderer filter bar
- **`renderer/src/views/view.ts` → `filterBar`**: replace
  `{ value: '90', label: 'This season' }` with `{ value: 'season', label: 'This season' }`;
  change the `onChange` to `days: v === 'all' || v === 'season' ? v : Number(v)`.
  `summarizeFilters` gains a `'season'` → `'this season'` case (preset naming).
  `activeFilterCount` / `sameFilters` already compare via `String(...)`, so `'season'`
  works unchanged. `String(d.filters.days)` renders the select value fine.
- No `store.ts` change: `FILTER_DEFAULTS.days` stays `30`; the union widens via the
  contract type. A previously-persisted `days: 90` stays a legal rolling filter.

### #20a — refresh after setting a rank
- **`renderer/src/views/settings.ts` → `openSetRank` save handler**: after
  `bridge.setRankAnchor(...)` resolves, call `store.refresh()` (the singleton is
  already imported and used by the Appearance card). `store.refresh()` refetches the
  dashboard snapshot and notifies subscribers, so the always-visible sidebar chip
  updates live; the local `onDone`/`reload` keeps refreshing the accounts card.

### #20b — filter-aware rank selection
- **`src/core/dashboardData.ts` → `primaryRankOf`**: add a `roleFilter?: string`
  param, passed from `computeDashboard` as `filters.role`. When `roleFilter` names an
  anchored role for the account, use it; otherwise keep the most-played-anchored-role
  heuristic. The most-played path (and its existing test) is unchanged when
  `roleFilter` is `'all'`/absent/unanchored.

### #21 — log-match prefill from active filter
- **`renderer/src/app/log-match.ts` → `buildForm`**: seed `state.account` and
  `state.role` from `ctx.data.filters` when those name a specific value, else fall
  back to the current `prefs.logPrefill` behavior. Account only wins if it is an
  actual option (guards the "filter names a missing account" edge → first option).
  Role maps the filter's role string (`tank|damage|support|openQ`) to the same
  `state.role` seed used today. Mode is untouched (out of scope).

## Affected Files/Modules
- `src/core/season.ts` — **new** pure season module.
- `src/core/dashboardData.ts` — `applyFilters` (season), weekly flag, `primaryRankOf`.
- `src/shared/contract/dashboard.ts` — `days` union widened.
- `renderer/src/views/view.ts` — season option + `summarizeFilters`.
- `renderer/src/views/settings.ts` — `store.refresh()` after set-rank.
- `renderer/src/app/log-match.ts` — prefill account/role from filter.
- `test/season.test.ts` — **new** unit tests for the season helper.
- `test/vantageCore.test.ts` — `applyFilters('season')` + `primaryRankOf` role-filter.

_No change needed:_ `renderer/preview/preview.ts` (delegates to core `computeDashboard`/
`applyFilters`), `renderer/src/store.ts`, `overview.ts` (reads precomputed
`d.primaryRank`), main-process handlers, README (filters described generically).

## Data Model / Interfaces
- `DashboardFilters.days: number | 'all' | 'season'` — the sole contract change.
- `season.ts` public surface: `seasonStart(now)`, `currentSeason(now)`,
  `SEASON_CADENCE_MS`.

## Test Strategy
- **season.ts (pure):** `currentSeason(now)` for (a) a `now` exactly on a table start,
  (b) mid-season within the table, (c) the day before a table boundary (still prior
  season), (d) an extrapolated future `now` beyond the table (start = last +
  k·cadence), (e) `now` before the table (defensive). Assert start/end and that
  `seasonStart` never exceeds `now`.
- **applyFilters('season'):** with games straddling `seasonStart(Date.now())`, only
  on/after the current season start survive; previous-season games are dropped.
- **primaryRankOf role filter:** multi-anchored account + `role` filter → filtered
  role's rank; `role:'all'` → most-played (existing test stays green); filtered role
  unanchored → falls back to most-played.
- Renderer changes (#20a refresh, #21 prefill, season label) verified in the preview
  harness; `npm run typecheck` covers the widened union end-to-end.

## Risks & Alternatives
- **Season table drift.** Real Blizzard dates deviate from exact 9-week cadence, so
  extrapolated future seasons may be off by days until the table is extended. Accepted
  per the resolved decision (self-healing, correct within the shipped table). Mitigate
  by keeping the table trivially appendable and commented with its source/as-of date.
- **Persisted `days: 90`.** No longer a dropdown option; remains a valid rolling
  90-day filter (won't crash, just isn't highlighted in the select). Deliberately not
  auto-migrated — rewriting a stored window would be presumptuous.
- **Alternative (rejected):** pure epoch+cadence formula with no table — simpler but
  drifts from real dates immediately; the user chose table+fallback for accuracy.
