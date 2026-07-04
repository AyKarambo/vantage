# Screen spec: Trends (`trends`)

**Source:** `renderer/src/views/trends.ts` · reverse-engineered 2026-07-04
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; the global filter bar re-scopes everything shown.

## Intent (WHAT & WHY)

[explicit] Momentum over time and where winrate concentrates — one screen to see whether things are improving and which role / game mode / account carries the results.

## In-Scope

- **Winrate over time** line chart from the trend buckets.
- Three breakdown cards — **By role**, **By game mode**, **By account** — rendered as compact horizontal winrate bars, ranked best → worst, with game counts.
- **Activity** calendar heatmap: games per day, cell colour = winrate.

## Out-of-Scope

- Forecasting/projection; per-bucket drill-down; map-level breakdowns (owned by `screen-maps.spec.md`).

## Constraints

- [explicit] Bucketing: **weekly** when the range is "All time" or longer than 90 days, **daily** otherwise; the card subtitle states which ("by week" / "by day").
- [explicit] Breakdowns deliberately reuse the compact horizontal-bar component (same as Maps) because vertical SVG bars "ballooned when a card had only a single category" — rendering must stay visually stable from 1 row to many.
- Charts are dependency-free SVG (project convention).

## Acceptance Criteria (current behavior)

- Given a 30-day range, when Trends renders, then the line chart buckets by day and is subtitled "by day"; given "All time" (or >90 days), it buckets by week and is subtitled "by week".
- Given any breakdown split, then rows rank best → worst winrate with their game counts, and a single-category split renders at normal row height.
- Given games in range, then the activity heatmap shows one cell per day sized by games and coloured by that day's winrate.

## Known gaps (intent ≠ code)

None identified — behavior matches intent.

## Open Questions

None.
