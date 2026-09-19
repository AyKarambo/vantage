# Screen spec: Trends (`trends`)

**Source:** `renderer/src/views/trends.ts`, `renderer/src/components/chartCard.ts`, `renderer/src/charts/plots.ts` (`rankChart`, C1), `renderer/src/charts/tooltip.ts`, `src/core/analytics.ts`, `src/core/rank/series.ts` (`rankSeries`).

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; the global filter bar re-scopes everything shown.

## Intent

Momentum over time and where winrate concentrates — one screen to see whether things are improving, which role / mode / account carries the results, when the player actually wins, and whether their self-read tracks reality.

## Layout & behaviour

- **Rank (C1)**, above everything else — the flagship "am I climbing?" chart the screen used to entirely lack. One line per anchored (account, role) track that has a competitive match in the active range, built from `DashboardData.rankTrend` (already scoped by the same filtered game set every other card here reads, so no extra client-side narrowing). Plotted by REAL timestamp, not by index — a stretch with no plottable entering rank (an open placement run, a pre-reset match, no anchor) is simply absent, so the gap shows as real elapsed time rather than an interpolated guess. A point drawn hollow is `estimated: true` (backward-reconstructed rather than a stored snapshot or a forward replay from the anchor — the same 'calculated'/'reconstructed' → not-stored distinction `playerIndex.ts` already collapses to one badge). Y-axis ticks land on division boundaries in the short rank form (`shortRankLabelOf`, e.g. `G3`); with more than one track a colour-keyed legend appears and the per-row "net this range" stat box is withheld (a single number would silently pick a winner among tracks the chart shows side by side). The `chartCard`'s Table toggle lists Date · Rank · `±` (the change from the prior plotted point in the same track; blank on the first row). Omitted entirely when nothing is anchored, or the anchored track(s) have no games in the active range.
- **Winrate over time** line chart from the trend buckets. The card is a `chartCard` with a Chart/Table toggle — the table shows the same buckets as text (columns Week-or-Day · WR · Games · **7d/7w avg**, C6). In **daily** mode only (C7 — a weekly bucket's label isn't a Matches-recognized day yet), a point already had `cursor: pointer` with nothing behind it; clicking it (or its Table row) now opens that day's games on Matches (`{ day }`), and the tooltip appends "· click to open". The bold line is a **real calendar-true, game-weighted rolling average** (C6, `rollingWinrate` in core) — it sums wins/losses over every bucket whose period start falls within the trailing 7 calendar days (7 ISO weeks in weekly mode) of the current one, not just the last 7 *array* entries, since `trend` buckets are sparse (only days/weeks with games exist); a 1-game day no longer swings it as much as a 12-game day. Above the chart, a **momentum strip** (C6, `DashboardData.momentum`) states the trend in numbers instead of asking the player to eyeball the line: last-window winrate · game count, previous-window winrate · game count, and the signed point delta (tinted win/loss), where "window" is the same 7 days / 4 ISO weeks (28 days) the chart itself buckets by; omitted below a 5-decided-game floor on either side rather than showing a number nobody should trust. Below the chart, a **Best day / worst day** stat-box pair (`DashboardData.extremes`, `streakStats`, C7) shows the single calendar day with the highest/lowest net wins − losses anywhere in the (filtered) range, each clickable into the same day drill-down; omitted with no games in range.
- **Three breakdown cards** — **By role**, **By game mode** (map-type), **By account** — compact horizontal winrate bars, ranked best → worst, with game counts.
- **Time of day** card: winrate by day-part, with a best-window callout when the sample is worth reading (≥10 decided games and the best bucket is actually a winning one).
- **Game # in session** card: the fatigue curve — winrate by game position within a sitting, plus a "you fade from game N on" read when a late-session decline is detected.
- **Your self-rating** card: the 0–100 self-rated performance over time (rolling average, dependency-free SVG `ratingChart`) plus a "does your self-read track results?" win-vs-loss average split. The rolling line and its Table's **7d avg** column (C6) are the same calendar-true, rated-game-weighted trailing mean as the winrate chart's, computed in core (`performanceStats`) rather than smoothed client-side. Empty state when no rated games exist in range (the slider lives on Log Match and Review). This trend is always daily (no weekly-bucket mode yet), so its point/Table-row click-through (C7) is unconditional.
- **Chart tooltips everywhere:** the line chart's points and the breakdown bars use the shared cursor-following tooltip layer (native `<title>` fallback).

## Out-of-Scope

- Forecasting/projection; map-level breakdowns (owned by `screen-maps.spec.md`); a weekly-bucket drill-down (the winrate chart's day drill-down, C7, is daily-mode only — clicking a weekly point does nothing yet); the readiness trend's own day drill-down (left out until its 04:00-local day keys are unified with Matches' UTC `dayKey`).
- The By role / By game mode / By account breakdown bars don't yet mark the previous window's winrate as a tick against the current bar (C3's period-over-period comparison stops at the KPI row, the winrate chart's momentum strip, and the Heroes table's Δ WR column — a per-bar tick is a real follow-up, not a hard blocker).

## Constraints & edge cases

- Bucketing: **weekly** when the range is "All time" or longer than 90 days, **daily** otherwise; the card subtitle states which ("by week" / "by day").
- Breakdowns reuse the compact horizontal-bar component so rendering stays visually stable from 1 row to many.
- Charts are dependency-free SVG (project convention).
- The chart-as-table toggle covers the primary data charts (this screen's line chart and Maps' winrate bars); breakdown/ordered bars have tooltips but no table toggle (their data is already compact text-adjacent rows).
