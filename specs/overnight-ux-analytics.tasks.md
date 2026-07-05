# Tasks: `overnight-ux-analytics`

Derived from [`overnight-ux-analytics.spec.md`](./overnight-ux-analytics.spec.md).
Retroactive record — all tasks landed in commits `43cafb7..ec67760` before this file was written.

- [x] **T1 — Undertraining model** _(L)_ — `src/core/readiness/{types,constants,score,signals,index}.ts`;
  rusty band + restEffect curve + activeDaysPerWeek + rust/low-frequency signals + rusty stale path.
  Check: `test/readiness.test.ts` (42 tests). AC 1–3.
- [x] **T2 — Rusty rendering** _(M)_ — `renderer/src/views/readiness.ts`, `renderer/src/views/overview.ts`,
  `renderer/src/charts/plots/readinessChart.ts`, `renderer/src/theme.ts` (PALETTE.info); band metas,
  gap shading, detraining tail, copy, load-card stat. AC 1.
- [x] **T3 — Temporal analytics** _(M)_ — `src/core/analytics/temporal.ts` (+ barrel), contract
  `timeOfDay`/`sessionPosition`, `src/core/dashboardData.ts`, `renderer/src/views/trends.ts`.
  Check: `test/temporal.test.ts` (13 tests). AC 4.
- [x] **T4 — Keyboard-fast logging** _(L)_ — `renderer/src/app/log-match.ts`,
  `renderer/src/components/typeahead.ts` (showOnFocus + Enter stopPropagation),
  `src/shared/contract/inputs.ts` (playedAt), `src/main/dataProvider.ts`, `renderer/preview/preview.ts`.
  Check: `test/logMatchProvider.test.ts`; preview walkthrough. AC 5.
- [x] **T5 — Quick wins** _(S)_ — scatter `onPick` → Maps highlight; tilt-tax sample guard. AC —
  audit-driven UX fixes.
- [x] **T6 — Signal coherence fix** _(S)_ — suppress stale pre-layoff signals under rusty
  (found in preview walkthrough). AC 2.
- [x] **T7 — Docs** _(S)_ — README (Readiness both-directions, Trends cards, Log match). AC 6.

**Consistency check:** every AC maps to ≥1 task (1→T1/T2, 2→T1/T6, 3→T1, 4→T3, 5→T4, 6→all);
no task without an AC. Gaps: none.
