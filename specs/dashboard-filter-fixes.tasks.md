# Tasks: dashboard-filter-fixes

Derived from [dashboard-filter-fixes.plan.md](dashboard-filter-fixes.plan.md).
Ordered dependencies-first (contract → core → renderer → tests).

- [x] **T1 — Widen the `days` filter union (contract).**
  - Goal: `DashboardFilters.days` accepts a dedicated `'season'` value.
  - Files: `src/shared/contract/dashboard.ts`.
  - Check: `days?: number | 'all' | 'season'`; `npm run typecheck` still clean.
  - Size: S

- [x] **T2 — Add the pure season module.**
  - Goal: `seasonStart(now)` / `currentSeason(now)` from a known-season table +
    63-day cadence fallback.
  - Files: `src/core/season.ts` (new), `test/season.test.ts` (new).
  - Check: unit tests pass for on-boundary, mid-season, pre-boundary, extrapolated,
    and pre-table `now`; `seasonStart(now) <= now`.
  - Size: M

- [x] **T3 — Apply the season window in the view-model.**
  - Goal: `applyFilters` filters by the real season for `days: 'season'`; weekly-trend
    flag handles `'season'` explicitly.
  - Files: `src/core/dashboardData.ts`; `test/vantageCore.test.ts` (add case).
  - Check: games before the current season start are excluded under `{ days: 'season' }`;
    numeric day-window unchanged.
  - Size: S

- [x] **T4 — Filter-aware primary rank (#20b).**
  - Goal: `primaryRankOf` honors an active Role filter when it names an anchored role,
    else most-played.
  - Files: `src/core/dashboardData.ts`; `test/vantageCore.test.ts` (add case).
  - Check: multi-anchored account + role filter → filtered role's rank; `role:'all'` →
    most-played (existing test green); unanchored filtered role → most-played fallback.
  - Size: S

- [x] **T5 — Season option in the filter bar (#22 renderer).**
  - Goal: "This season" dropdown uses `value:'season'`; `onChange` and preset naming
    handle it.
  - Files: `renderer/src/views/view.ts`.
  - Check: selecting "This season" sets `days:'season'`; Reset/preset chips still work;
    typecheck clean.
  - Size: S

- [x] **T6 — Refresh sidebar/Overview after setting a rank (#20a).**
  - Goal: saving a rank in Manage Accounts refreshes the global dashboard snapshot.
  - Files: `renderer/src/views/settings.ts`.
  - Check: after `setRankAnchor`, `store.refresh()` runs; sidebar chip updates without
    navigation (verified in preview).
  - Size: S

- [x] **T7 — Prefill Log match from the active filter (#21).**
  - Goal: Account/Role default to the active dashboard filter when specific, else prefs.
  - Files: `renderer/src/app/log-match.ts`.
  - Check: filtered account/role pre-selected on open; `'all'` falls back to prefs;
    missing-account filter falls back to first option (no crash).
  - Size: S

- [x] **T8 — Full verification.**
  - Goal: green build + preview proof for all three.
  - Files: — (run `npm test`, `npm run typecheck`, preview harness).
  - Check: tests + typecheck pass; preview shows season filtering, rank refresh, and
    log prefill.
  - Size: S

## Consistency check (spec acceptance criteria → tasks)

| Acceptance criterion | Task(s) |
|---|---|
| #20a — sidebar/KPI refresh after set-rank | T6 |
| #20b — role-filter selection | T4 |
| #20b — no filter → most-played | T4 |
| #20b — unanchored filtered role → fallback | T4 |
| #21 — account prefilled from filter | T7 |
| #21 — role prefilled from filter | T7 |
| #21 — `'all'` → prefs fallback | T7 |
| #21 — missing account → first option | T7 |
| #22 — season window excludes prior season | T2, T3, T5 |
| #22 — extrapolated boundary beyond table | T2 |
| #22 — `currentSeason(now)` unit-tested | T2 |
| #22 — persisted `days: 90` still valid | T1, T5 (no crash; remains numeric) |

- **Gaps (criteria with no task):** none.
- **Scope creep (tasks tracing to no criterion):** none — T1 (contract) and T8
  (verification) are enabling/DoD tasks, not scope additions.
