# Screen spec: Trends (`trends`)

**Source:** `renderer/src/views/trends.ts`, `renderer/src/components/chartCard.ts`, `renderer/src/charts/tooltip.ts` · reverse-engineered 2026-07-04 · updated 2026-07-04 after the ui-qol batch (PR #8) · updated 2026-07-09 per issue #116: Activity heatmap moved to Overview (`screen-overview.spec.md`)
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior · [qol 2026-07-04] shipped in the ui-qol batch (intent: `ui-qol.spec.md`)

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; the global filter bar re-scopes everything shown.

## Intent (WHAT & WHY)

[explicit] Momentum over time and where winrate concentrates — one screen to see whether things are improving and which role / game mode / account carries the results.

## In-Scope

- **Winrate over time** line chart from the trend buckets. [qol 2026-07-04] The card is a `chartCard` with a Chart/Table toggle — the table shows the same buckets as text (columns Week-or-Day · WR · Games).
- Three breakdown cards — **By role**, **By game mode**, **By account** — rendered as compact horizontal winrate bars, ranked best → worst, with game counts.
- [qol 2026-07-04] **Chart tooltips everywhere:** the line chart's points and the breakdown bars use the shared cursor-following tooltip layer (native `<title>` fallback) — the hover detail the scatter already had.

## Out-of-Scope

- Forecasting/projection; per-bucket drill-down; map-level breakdowns (owned by `screen-maps.spec.md`).

## Constraints

- [explicit] Bucketing: **weekly** when the range is "All time" or longer than 90 days, **daily** otherwise; the card subtitle states which ("by week" / "by day").
- [explicit] Breakdowns deliberately reuse the compact horizontal-bar component (same as Maps) because vertical SVG bars "ballooned when a card had only a single category" — rendering must stay visually stable from 1 row to many.
- Charts are dependency-free SVG (project convention).

## Acceptance Criteria (current behavior)

- Given a 30-day range, when Trends renders, then the line chart buckets by day and is subtitled "by day"; given "All time" (or >90 days), it buckets by week and is subtitled "by week".
- Given any breakdown split, then rows rank best → worst winrate with their game counts, and a single-category split renders at normal row height.
- Given the "Winrate over time" card, when I click the Table toggle, then the buckets render as a text table with the period column matching the bucketing ("Week" / "Day"); Chart restores the line.
- Given a hover over a line-chart point or a breakdown bar, then a tooltip with that entry's label, winrate, and games appears.

## Known gaps (intent ≠ code)

None identified — behavior matches intent. [qol 2026-07-04] `ui-qol.spec.md` #27 scoped the chart-as-table toggle "per chart card"; as shipped it covers the two primary data charts (this screen's line chart and Maps' winrate bars). The breakdown bars have tooltips but no table toggle — their data is already compact text-adjacent rows.

## Open Questions

None.
