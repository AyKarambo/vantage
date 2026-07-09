# Feature Spec: Move Activity Heatmap to Overview

**Slug:** `move-activity-heatmap-to-overview` · **Source:** [issue #116](https://github.com/AyKarambo/vantage/issues/116)

## Intent (WHAT & WHY)

The activity heatmap (games-per-day, coloured by winrate) currently lives on Trends, but Trends is the "momentum over time" screen (winrate trend, role/mode/account splits, time-of-day, fatigue, self-rating). "How active have I been, and did I win on those days?" is a glance-and-move-on read, not a momentum question — it belongs on Overview, the explicit "priority maps at a glance" landing screen. Moving it also gives the heatmap's day-click → Matches drilldown more natural placement on the screen the player lands on first. **Placement change only — no new data, no behavior change to the heatmap itself.**

## In-Scope

- Move the `card({ title: 'Activity', sub: 'games/day · colour = winrate · click a day to open its matches' }, calendarHeatmap(...))` block from `trends()` (`renderer/src/views/trends.ts:37-38`) into `overview()`'s bottom row (`renderer/src/views/overview.ts:185-201`).
- **Layout:** the Activity card joins `bottomRow` as a **third card alongside Mental and Readiness** (not a separate full-width row) — a full-width row was considered and rejected as mostly empty space. `readinessCard` already renders `null` when readiness is disabled, so the row holds 2 or 3 cards depending on that setting; Activity always renders (unaffected by the readiness toggle).
- Reuse `calendarHeatmap` and its day-click → `ctx.navigate('matches', { day: date })` behavior unmodified.
- Remove the Activity card and the now-unused `calendarHeatmap` import from `trends.ts` (keep `card`, `emptyState`, `statBox` — still used elsewhere in that file).
- **Trends keeps no stub or teaser** for the removed section — dropped outright, no "see it on Overview" pointer.
- Update both screen specs: remove the Activity bullet + AC from `screen-trends.spec.md` (lines 16, 33); add the equivalent bullet + AC to `screen-overview.spec.md`.

## Out-of-Scope

- Any change to `calendarHeatmap`'s data, rendering logic, or the `CalendarDay[]` shape.
- Any change to `src/shared/contract/` or `src/core/` — `DashboardData.calendar` is reused unmodified.
- Overview's header/greeting copy — stays exactly as-is.
- Any other Trends content (line chart, breakdowns, time-of-day, fatigue, self-rating) — untouched.

## Constraints

- No contract or `src/core/` changes; renderer-only move.
- The heatmap window is a fixed 35 days (`calendar(games, 35)`, `src/core/analytics/session.ts:51`) regardless of the active date-range filter — always 5–6 grid columns (13px cells, `.heatmap` in `renderer/styles/components.css:652-658`), roughly 78–93px wide plus its legend. It is a narrow, near-fixed-width card, not a wide one — fits an equal-thirds column next to Mental/Readiness without horizontal scrolling or special-casing.
- `trends.ts` must have no dead imports after removal (`calendarHeatmap` no longer referenced there).

## Acceptance Criteria

- Given Overview renders, when the bottom row is built, then it shows Mental, Readiness (if enabled), and Activity as cards in one row — Activity always present regardless of the readiness toggle.
- Given a click on an Activity heatmap day cell with games, when handled, then the app navigates to Matches filtered to that day — identical to today's Trends behavior.
- Given Trends renders, then no Activity card, heatmap, or teaser/link to it appears anywhere on the screen.
- Given `trends.ts` after the change, then it contains no `calendarHeatmap` import and no dead imports.
- Given `screen-trends.spec.md` and `screen-overview.spec.md` after the change, then Trends' spec no longer lists Activity in In-Scope/AC, and Overview's spec lists it in both.
- `npm test` and `npm run typecheck` pass with no changes required outside the renderer and specs.

## Resolved questions

- **Drop vs. teaser on Trends:** Drop entirely, no stub — confirmed. The sidebar already reaches Overview in one click; a dangling teaser would be dead weight.
- **Placement on Overview:** Three-up row with Mental and Readiness, not a separate full-width row — confirmed. A full-width row was rejected as leaving too much unused horizontal space.
- **Header copy:** Overview's greeting subline stays unchanged — confirmed. The heatmap is glance-level content that doesn't need a mention there.

## Open Questions

None. The column-sizing question raised during drafting is resolved by the fixed 35-day/5-6-column heatmap size confirmed above — an equal `flex: '1'` third column (same treatment as Mental and Readiness) fits without overflow handling.

## Also touch (non-blocking, flagged during research)

- `README.md:66` lists the activity heatmap as a Trends feature ("...an **activity heatmap**, and your self-rating over time...") — reword into the Overview bullet (`README.md:23-24`) so the docs don't go stale. Per the Definition of Done ("README / relevant docs are updated when user-visible behavior changes"), this is in scope for `/implement`, not just a suggestion.
- `specs/drilldown-crosslinks.spec.md` (lines 4, 12, 34, 36, 39-40) refers to "the Trends activity heatmap" — this is a point-in-time historical design doc (like other completed-feature specs in this repo), not a living current-state doc; left as-is, no update planned.
