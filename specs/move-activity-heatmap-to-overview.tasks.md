# Tasks: Move Activity Heatmap to Overview

**Slug:** `move-activity-heatmap-to-overview` · **Spec:** `specs/move-activity-heatmap-to-overview.spec.md` · **Plan:** `specs/move-activity-heatmap-to-overview.plan.md`

- [x] **1. Add the Activity card to Overview's bottom row**
  - **Goal:** Render the Activity heatmap as a third card in Overview's bottom row, sourced from `d.calendar`, with day-click navigation to Matches — identical title/sub/behavior to the Trends version.
  - **Files:** `renderer/src/views/overview.ts` (add `calendarHeatmap` to the `components/primitives` import; add an `activityCard(d)` helper mirroring `mental`/`readinessCard`'s structure; wire it into `bottomRow()` as the third argument)
  - **Check:** In the preview harness, Overview shows three cards (Mental, Readiness, Activity) in the bottom row; clicking a heatmap day cell with games navigates to Matches filtered to that day.
  - **Size:** S

- [x] **2. Remove the Activity card from Trends**
  - **Goal:** Delete the Activity card block and its now-dead `calendarHeatmap` import from `trends.ts` — Overview owns it now, and Trends keeps no stub or teaser.
  - **Files:** `renderer/src/views/trends.ts`
  - **Check:** `grep -n calendarHeatmap renderer/src/views/trends.ts` returns nothing; Trends screen shows no Activity card, heatmap, or link to one in the preview harness.
  - **Size:** S

- [x] **3. Update the Trends and Overview screen specs**
  - **Goal:** Keep both screens' living current-state specs in sync with the move.
  - **Files:** `specs/screen-trends.spec.md` (remove the Activity bullet and its AC line), `specs/screen-overview.spec.md` (add an Activity bullet to the bottom-row description in In-Scope, and a matching Acceptance Criterion)
  - **Check:** `screen-trends.spec.md` has no remaining "Activity"/heatmap mention in In-Scope or AC; `screen-overview.spec.md`'s In-Scope and Acceptance Criteria sections both describe the Activity card.
  - **Size:** S

- [x] **4. Update README's Trends/Overview feature bullets**
  - **Goal:** Keep the screen-by-screen feature list in README accurate now that the heatmap has moved (Definition of Done requires docs updates on user-visible behavior/placement changes).
  - **Files:** `README.md` (Trends bullet ~line 63-69: drop the "an activity heatmap" clause; Overview bullet ~line 23-24: append a short heatmap mention)
  - **Check:** README's Trends bullet no longer mentions the activity heatmap; the Overview bullet does.
  - **Size:** S

- [x] **5. Verify: typecheck, tests, and manual walk-through**
  - **Goal:** Confirm the whole move is self-consistent with no regressions before calling it done.
  - **Files:** none (verification only)
  - **Check:** `npm run typecheck` clean (main + renderer); `npm test` passes unchanged; manual preview walk-through confirms (a) three-card row at normal width, (b) two-card row (Mental + Activity) with Readiness disabled in Settings, (c) day-click navigation to Matches, (d) Trends has nothing left of the Activity section.
  - **Size:** S

## Consistency gate (spec Acceptance Criteria → tasks)

| Spec AC | Task(s) |
|---|---|
| Bottom row shows Mental, Readiness (if enabled), Activity in one row; Activity always present | 1, 5 |
| Day-cell click with games navigates to Matches filtered to that day | 1, 5 |
| Trends renders with no Activity card/heatmap/teaser anywhere | 2, 5 |
| `trends.ts` has no `calendarHeatmap` import and no dead imports | 2, 5 |
| `screen-trends.spec.md` / `screen-overview.spec.md` updated to match | 3 |
| `npm test` and `npm run typecheck` pass, no changes outside renderer/specs | 5 (and implicitly all — no task touches contract/core) |

**Gaps:** none — every spec AC maps to at least one task.

**Scope creep check:** Task 4 (README) doesn't trace to a literal spec Acceptance Criterion — it traces to the spec's "Also touch" note and the plan's Definition-of-Done justification (CLAUDE.md requires doc updates when user-visible behavior/placement changes). Flagging this as intentional, plan-driven scope rather than a literal AC, not creep — everything else maps 1:1.

No task traces to nothing; no AC is left uncovered.
