# Tasks: `drilldown-crosslinks`

Derived from [`drilldown-crosslinks.plan.md`](./drilldown-crosslinks.plan.md).
Autonomous overnight run — spec/plan gates self-approved; implementation delegated to
sonnet subagents, reviewed & verified by the orchestrating session.

- [x] **T1 — Row flags in core + contract** _(M)_
  - Goal: `MatchFlagKey` + optional `MatchRow.flags` (only-true keys), produced by a pure
    `rowFlags(g)` next to `mentalSummary` (same OR-merge + leaver side-merge semantics).
  - Files: `src/shared/contract/dashboard.ts`, `src/core/mental.ts`, `src/core/dashboardData.ts`,
    `test/rowFlags.test.ts`.
  - Check: unit tests (mental-only, review-only, both, legacy leaver, unflagged → undefined);
    `computeDashboard` row carries flags. AC 2, 7.

- [x] **T2 — Drill-down params plumbing** _(S)_
  - Goal: `ViewParams.day` / `ViewParams.flag`; `store.setView` dedupe via a `sameParams()` over
    all keys; shell render key includes the new params.
  - Files: `renderer/src/store.ts`, `renderer/src/app/shell.ts`.
  - Check: typecheck; repeated day → clear → flag navigation re-renders every time. AC 6.

- [x] **T3 — Matches scope + chip** _(M)_
  - Goal: Matches narrows to `params.day` (via core `dayKey`) or `params.flag`
    (`m.flags?.[flag]`); dismissible `Only <label> ✕` chip; scoped header count; scoped-empty
    state keeps the chip reachable.
  - Files: `renderer/src/views/matches.ts`.
  - Check: preview — heatmap day matches the scoped list; ✕ restores; row interactions intact.
    AC 1, 2, 5.

- [x] **T4 — Drill-down entry points** _(M)_
  - Goal: `calendarHeatmap(days, onPick?)` (games>0 cells only) wired from Trends;
    Mental flag counts clickable when >0 (leavers → `'leaver'`); hero-drawer By-map rows →
    close drawer + Maps highlight (thread `ctx`/`close` into `heroDetail`); Readiness verdict
    card break-reminder line + Mental link on `loaded`/`in-the-hole`.
  - Files: `renderer/src/components/primitives/stats.ts`, `renderer/src/views/trends.ts`,
    `renderer/src/views/mental.ts`, `renderer/src/views/heroes.ts`, `renderer/src/views/readiness.ts`.
  - Check: preview walkthrough of AC 1–4.

- [x] **T5 — Verify + docs** _(S)_
  - Goal: full suite + typecheck + preview walkthrough of AC 1–6; README QoL line mentions the
    heatmap/flag drill-downs.
  - Files: `README.md`.
  - Check: DoD (AC 7).

## Consistency check (spec ↔ tasks)

| Acceptance criterion | Covered by |
|---|---|
| 1 heatmap day drill-down | T2, T3, T4 |
| 2 flag drill-down | T1, T2, T3, T4 |
| 3 hero drawer → Maps | T4 |
| 4 readiness → Mental link | T4 |
| 5 scope composes with filters, clears on nav | T2, T3 |
| 6 no stale renders | T2 |
| 7 DoD | T1, T5 |

**Gaps:** none. **Scope creep:** none.
