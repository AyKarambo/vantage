# Spec: `drilldown-crosslinks`

## Intent (WHAT & WHY)
Vantage's aggregates are honest but **dead-ended**: the Trends activity heatmap shows a bad
Tuesday you can't open, the Mental card counts 52 tilt flags you can't inspect, a hero drawer
lists per-map winrates that don't link to the Maps screen, and Readiness tells you to rest while
the break reminder lives unlinked in Mental. The UX audit's strongest cross-view finding was this
pattern: **every aggregate should open the games behind it**. This iteration closes those loops
with lightweight drill-down params on the existing Matches list — no new screens.

## In-Scope
- **Day drill-down:** clicking a day cell (≥1 game) on the Trends activity heatmap opens Matches
  scoped to that day, with a dismissible chip showing the active scope.
- **Flag drill-down:** the four counts on Mental's "Flags this range" card become clickable
  (when > 0) and open Matches scoped to games carrying that flag (quick-log OR review source,
  leaver merged across sides — same OR-merge as `mentalSummary`).
- **Hero drawer → Maps:** the drawer's "By map" rows navigate to Maps with the existing
  highlight-flash (closing the drawer).
- **Readiness → Mental:** on `loaded` / `in-the-hole` verdicts the card states the break-reminder
  status with a link to Mental.
- `MatchRow` gains merged per-row flags so the renderer can filter without re-deriving
  mental semantics.

## Out-of-Scope (non-goals)
- New screens, URL routing, or filter-bar changes (day/flag are view params, not global filters).
- Drill-down scopes surviving navigation away from Matches, or composing with each other
  (one scope at a time).
- Flag filters over games beyond the current global filter set + row cap (the drill-down scopes
  the list the Matches screen already shows).

## Constraints
- Guardrails intact: pure logic in `core/`, one CSP-friendly bundle, typed IPC contract
  (additive `MatchRow` change only), preview keeps working with no harness changes.
- Day identity must use the same bucketing as the heatmap data (`dayKey`, UTC) — no re-derived
  local-date math in the renderer.
- Existing `calendarHeatmap` call sites must be unaffected (opt-in click handler).

## Acceptance Criteria (Given / When / Then)
1. **Given** the Trends heatmap, **when** a day cell with ≥1 game is clicked, **then** Matches
   opens showing exactly that day's games (same `dayKey` bucketing as the heatmap) under a chip
   like `Only Jul 3 ✕`; clicking ✕ restores the full list; day cells with 0 games don't navigate.
2. **Given** Mental's flags card, **when** a non-zero count (Tilt / Toxic mates / Leavers /
   Positive comms) is clicked, **then** Matches opens showing only games carrying that flag from
   either source, with the same dismissible chip; zero counts are not clickable.
3. **Given** a hero drawer's "By map" list, **when** a row is clicked, **then** the drawer closes
   and Maps opens scrolled to & flashing that map.
4. **Given** a `loaded` or `in-the-hole` readiness verdict, **then** the verdict card shows
   whether the break reminder is on (and after how many losses) with a working "open Mental" link;
   green/rusty verdicts show nothing new.
5. **Given** an active day/flag scope, **then** it composes with the global filters (it narrows
   the list Matches already shows), the header count reflects the narrowed list, navigation to
   any other view and back clears it, and match-row clicks (detail, hero drawer, map links)
   still work.
6. **Given** the drill-down params, **then** navigating repeatedly (day → clear → flag → detail →
   back) never renders a stale view (store dedupe & shell render-key account for the new params).
7. DoD: `npm test` + `npm run typecheck` green; the flag-merge logic ships with unit tests;
   README's cross-link QoL line mentions the new drill-downs.
