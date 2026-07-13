# Screen spec: Trends (`trends`)

**Source:** `renderer/src/views/trends.ts`, `renderer/src/components/chartCard.ts`, `renderer/src/charts/plots.ts`, `renderer/src/charts/tooltip.ts`, `src/core/analytics.ts`.

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; the global filter bar re-scopes everything shown.

## Intent

Momentum over time and where winrate concentrates — one screen to see whether things are improving, which role / mode / account carries the results, when the player actually wins, and whether their self-read tracks reality.

## Layout & behaviour

- **Winrate over time** line chart from the trend buckets. The card is a `chartCard` with a Chart/Table toggle — the table shows the same buckets as text (columns Week-or-Day · WR · Games).
- **Three breakdown cards** — **By role**, **By game mode** (map-type), **By account** — compact horizontal winrate bars, ranked best → worst, with game counts.
- **Time of day** card: winrate by day-part, with a best-window callout when the sample is worth reading (≥10 decided games and the best bucket is actually a winning one).
- **Game # in session** card: the fatigue curve — winrate by game position within a sitting, plus a "you fade from game N on" read when a late-session decline is detected.
- **Your self-rating** card: the 0–100 self-rated performance over time (rolling average, dependency-free SVG `ratingChart`) plus a "does your self-read track results?" win-vs-loss average split. Empty state when no rated games exist in range (the slider lives on Log Match and Review).
- **Chart tooltips everywhere:** the line chart's points and the breakdown bars use the shared cursor-following tooltip layer (native `<title>` fallback).

## Out-of-Scope

- Forecasting/projection; per-bucket drill-down; map-level breakdowns (owned by `screen-maps.spec.md`).

## Constraints & edge cases

- Bucketing: **weekly** when the range is "All time" or longer than 90 days, **daily** otherwise; the card subtitle states which ("by week" / "by day").
- Breakdowns reuse the compact horizontal-bar component so rendering stays visually stable from 1 row to many.
- Charts are dependency-free SVG (project convention).
- The chart-as-table toggle covers the primary data charts (this screen's line chart and Maps' winrate bars); breakdown/ordered bars have tooltips but no table toggle (their data is already compact text-adjacent rows).
