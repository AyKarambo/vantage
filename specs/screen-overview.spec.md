# Screen spec: Overview (`overview`)

**Source:** `renderer/src/views/overview.ts`, `src/core/analytics/session.ts` (`sessionRecap`), `src/core/rankDisplay.ts` (`rankParts`).

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext` (`renderer/src/views/view.ts`); the global filter bar (Role · Season) and the sidebar account switcher re-scope it. The demo dataset shows a "Demo data" badge. `Ctrl+K` opens the command palette (see `screen-shell.spec.md`); the quick-log modal opens from this screen's **Log match** CTA or the palette's Log match action.

## Intent

The landing screen — "priority maps at a glance". Answers in one glance: *how am I doing* (KPIs) and *where are the points hiding* (which maps bleed rank), so the player knows what to fix before queueing.

## Layout & behaviour

- **Greeting header:** time-of-day greeting + player name, date + live winrate line, and the primary **Log match** CTA (opens the quick-log modal).
- **Session recap card** ("Yesterday's session", glow variant, above the KPI row): shown when the previous calendar day had games and today's recap hasn't been dismissed. Sub-line: game count · "toughest: `<worst map>`" (when known) · "tilt flagged ×N" (when any). Four stat boxes: `W–L` (tinted by net) with signed net, winrate, best map (or "—"), targets-hit rate (or "—"). A ✕ dismiss button persists the day-key (`recapShown` pref) so the card renders once per day.
- **KPI row:** **Winrate** (with a recent-form delta chip), **Games** (W·L split), **Rank**, **Streak** (accented, with a "ride it" / "reset it" nudge).
  - The **Rank** KPI shows the greeting account's **real anchored rank** — the calculated rank of its most-played anchored role (`DashboardData.primaryRank`) — composed through the shared rank renderer (`rankParts`): the tier/division label, a 🛡 protection shield and buffer text when the rank is protected, else the within-division progress %. Overview is the **only** surface that shows the anchor→now **movement arrow** (▴ rising / ▾ falling / neutral-flat, from the shared `rankParts` `movement`), and the arrow is truthful (neutral within ±10 ladder points). When the greeting account has no rank anchor, the KPI falls back to the winrate-derived heuristic (`progression`).
- **Maps scatter card:** winrate × volume for every map in range; dot colour is a stable categorical per map; legend uses shortened map names with the full name on hover.
- **Top priority callouts:** the top 3 net-losing maps (net = losses − wins > 0, from `focusMaps`) with games, signed net, and winrate; hint copy uses practice/review framing. The CTA **"Open Focus →"** is the Overview's single entry to the Focus screen (Overview teases, Focus is the hub — hierarchy owned by `screen-focus.spec.md`).
- **Bottom row (three cards, one row):** **Activity** (leftmost, always present), **Mental** snapshot (Calm/Tilted bars + a truthful break-reminder line reflecting the real per-user setting), and the **Readiness** teaser (only when the feature is enabled). Activity renders regardless of the Readiness toggle.
- **Activity calendar heatmap:** games per day over a fixed 35-day window, cell colour = winrate, opacity = game count; the legend (Losing/Even/Winning) stacks vertically beside the grid; a bottom hint line reads "games/day · colour = winrate · click a day to open its matches". Clicking a day cell with games navigates to Matches filtered to that day.

## Out-of-Scope

- Drill-downs beyond the Activity day-click and the Focus CTA (no per-map or per-KPI navigation).
- Any practice-queue feature or copy — no queue feature exists (GEP-only guardrail); no "queue" verb in the copy.
- The cross-dimension focus list itself (owned by `screen-focus.spec.md`).
- The break-reminder mechanism itself (owned by `screen-mental.spec.md`).

## Constraints & edge cases

- Recent-form delta = mean winrate of the last ≤5 trend buckets minus the range baseline, in points; suppressed below 3 buckets (deliberately smoothed).
- The scatter flags a map as focus-worthy at net ≥ 3; maps sort most-played-first so legend order and per-map colours stay stable.
- The Winrate KPI shows "–" at 0 games.
- The recap is computed in pure core (`sessionRecap`, `src/core/analytics/session.ts`, unit-tested) over the **unfiltered** history — it's about the player's day, not the filter scope — and delivered as `DashboardData.recap` (absent when yesterday had no games). Best/worst map are only set when that day had ≥2 distinct maps; the targets-hit rate only when at least one target grade was saved that day.
- With no net-losing maps, the Top priority callout shows "No net-losing maps — clean season. 🎯".
