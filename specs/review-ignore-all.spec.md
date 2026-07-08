# Spec: Review — "Ignore all" bulk action + age filter

**Slug:** `review-ignore-all`
**Source screen:** `renderer/src/views/review.ts` (see `specs/screen-review.spec.md` for the existing Review screen spec)

## Intent (WHAT & WHY)

A big historical import (or just skipping the Review screen for a while) can leave dozens
of ungraded games sitting in the inbox. Grading every one of them is not just slow — for a
game played days or weeks ago, a manual "how did it feel" / target grade is no longer
meaningful; the player doesn't remember the sitting well enough to grade it honestly. Today
the only way off that backlog is one-by-one Save or Skip (Skip doesn't even clear it — the
game stays pending forever), and there is no way to isolate "the old stuff" from "the stuff
I actually still remember."

This adds two things together: a way to narrow the Review screen down to just the stale
backlog (an age cutoff, on top of the existing Role/account scope), and a one-click
**"Ignore all"** that bulk-clears exactly what's narrowed into view — so the player can
isolate old imported games, wipe them out in one action, and leave recent, still-fresh
games in the inbox for real manual grading.

## In-Scope

- **A new age-cutoff filter on the Review screen**: "older than N days" — a new,
  Review-only filter field that, when set, narrows the pending inbox/badge to only
  tracked games older than N days (`timestamp <= now - N days`). Off (no cutoff) by
  default. It combines with — further narrows on top of — whatever Role/account
  scope is already active; it does not replace it.
- **The Review screen starts honoring the existing global Role and account filter** for
  both the on-screen pending list and the sidebar pending-review badge. This reverses
  today's deliberate "always unfiltered" behavior (see `screen-review.spec.md`
  Constraints) — see **Resolved questions** below for why. **The Season/day-window part
  of the global filter is deliberately excluded** — see Constraints and Resolved
  Questions #8: the app's default day-window (last 30 days) would otherwise silently
  hide exactly the backlog this feature exists to help clear. The new age cutoff is the
  sole, explicit way date narrows Review.
- A new **"Ignore all"** action that bulk-saves an **empty review** (no target grades, no
  feel flags, no performance rating) for every currently-pending match matching the
  combined scope (Role/account + age cutoff, if set).
- A confirm step before the bulk action runs ("Ignore N matches?"), consistent with the
  app's existing pattern of confirming irreversible-feeling bulk/destructive actions
  (e.g. the target library's Delete confirm modal).
- A single batched **Undo** toast after the action runs (mirrors the existing per-match
  Save-toast Undo), reverting every match that action just ignored back to pending.
- "Ignore all" affects every match matching the current combined scope — not just the (up
  to 150) rows rendered on screen. The confirm dialog's count, the bulk action's effect,
  and the sidebar badge all agree.

## Out-of-Scope

- Any per-match "ignore" affordance (the existing Skip / Save flow is untouched;
  "ignore" is a bulk, filtered-view action only).
- A visibly distinct "ignored" marker/tag anywhere else in the app (match history, match
  detail, exports). An ignored match is stored as an ordinary review with no grades/flags/
  rating — indistinguishable from a game the player manually saved blank.
- Changing what counts as "reviewed" for downstream stats (target hit-rates, mental
  composites) — an empty review already contributes nothing to those, by construction.
- A two-sided date range or calendar picker. The age cutoff is a single "older than N
  days" threshold, not a from/to range — no date-picker component exists in the codebase
  today, and a one-sided cutoff is all the stated use case needs.
- Any effect on other screens (Heroes, Matches, Trends, etc.). The age cutoff is scoped
  to Review only; it never narrows the general filtered `games` set every other screen's
  stats are built from.

## Constraints

- **Review's Role/account scoping deliberately excludes the Season/day-window
  component.** `reviewInbox`/`pendingReviews` narrow by Role and account exactly like
  every other screen, but the `days`/season value (rolling window, a named season, or
  "all time") is always treated as "all time" for Review's own computation, regardless of
  what's selected in the global bar. Only the new, explicit, off-by-default age cutoff
  narrows Review by date. Role/account carry no "silent surprise" risk (the player
  consciously picked them); the ambient day-window default does, and defeats the point of
  a feature meant to help clear an old backlog — see Resolved Questions #8.
- **Ignore = an ordinary empty review**, persisted through the same path as a manual
  blank Save (`{ at: now, grades: {}, flags: {} }`, no `performance`). No data-model
  change. This also means it reuses the existing bulk-review persistence the
  legacy-migration import already relies on (never overwrites a match that already has a
  review; skips unknown ids) — "ignore" cannot clobber a review that exists by the time
  it runs.
- **The age cutoff is a renderer-local preference, not a `DashboardFilters` field** —
  persisted the same way the Heroes screen's existing "min games" threshold already is
  (same storage mechanism), so it survives navigating away and back, and an app restart,
  without being threaded through `DashboardFilters`/`FILTER_DEFAULTS`/the global filter
  bar/presets/reset at all. It narrows the on-screen pending list via an instant local
  re-render (no refetch), and is passed as an explicit value — never through the
  persisted global-filters object — to whatever computes "Ignore all"'s true target set,
  so it can never leak into any other screen's stats.
- **"Ignore all" reaching beyond the 150-row display cap does not depend on the age
  cutoff being part of `DashboardFilters`.** The bulk action is its own request (current
  Role/account scope + the age-cutoff value, passed explicitly) that computes the
  true eligible set fresh and uncapped, independent of what happens to be rendered — so
  the confirm count and the toast count always match what actually gets cleared.
- **The sidebar pending-review badge reflects Role/account only — not the age
  cutoff.** The badge is a global nav element visible from every screen; the age cutoff
  is a Review-screen-local tool for narrowing *this session's* view and bulk-ignore
  target, not a persistent global scope change. (This also sidesteps an accuracy trap:
  the renderer only ever receives up to 150 pending rows with timestamps, so a
  client-computed "badge minus age cutoff" would silently undercount once the true
  pending count exceeds that cap.) This refines the second clarification round's
  original "list and badge move together" framing, which was decided before the age
  cutoff existed as a distinct, differently-scoped concept — see **Resolved questions**.
- **The display cap (150 rows) still applies to what's rendered**, but not to what
  "Ignore all" acts on or what the sidebar badge counts.
- **Undo is exact and scoped to that one action** — clicking Undo reverts precisely the
  matches that specific "Ignore all" click cleared (even if it was more than 150), not
  "everything currently ignored" or anything ignored by a prior batch.
- A match already mid-grade (its card expanded) when "Ignore all" runs is included like
  any other pending match in the combined scope — no special-casing; its unsaved grading
  state is simply discarded along with everything else in the batch.
- The "Ignore all" action and its confirm/undo affordances are inert while there is
  nothing pending in the current combined scope (same visibility rule as the rest of the
  empty-state handling already on this screen).
- The existing global filter bar's "Reset" (role + season) is unrelated to the age
  cutoff — resetting it does not implicitly clear the age cutoff, which has its own
  clear/off state.

## Acceptance Criteria

- Given the Review screen with Role/account at their defaults and no age cutoff set, when
  I open Review, then the pending list and the sidebar badge include every tracked game
  with no saved review (today's full backlog) — regardless of whatever Season/day-window
  value is active, since that component never narrows Review.
- Given I narrow Role and/or account (the existing global bar), when I view Review, then
  the pending list and the sidebar badge only include ungraded games matching that
  role/account scope. Changing the Season/day-window value alone has no effect on Review.
- Given I set the age cutoff to N days (with Role/account at any value), then the
  on-screen pending list additionally excludes any ungraded game newer than N days —
  narrowing further on top of, not instead of, the Role/account scope. The sidebar
  badge is unaffected by the age cutoff (it continues to reflect Role/account only).
- Given I clear the age cutoff, then the pending list returns to whatever
  Role/account alone would show.
- Given the age cutoff is set on Review, when I navigate to Heroes, Matches, or Trends,
  then their stats are computed exactly as before — unaffected by the age cutoff, and
  also unaffected by Review's own Season/day-window exemption (every other screen still
  honors the Season/day-window value normally).
- Given a combined scope (Role/account + optional age cutoff) with N pending
  matches, when I click "Ignore all", then a confirm dialog states the exact count N
  before anything changes.
- Given I confirm, then every one of those N matches gets an empty review saved (no
  grades, no flags, no performance), all N leave the pending list, the sidebar badge
  drops by N, and a single toast appears (e.g. "Ignored N matches") with an Undo action.
- Given the combined-scope pending count exceeds the 150-row display cap, when I confirm
  "Ignore all", then all matching pending matches are cleared — not just the 150 that
  were rendered — and the confirm count/toast count/badge delta all agree.
- Given I click Undo on that toast before it expires, then exactly the matches cleared by
  that click are restored to pending, and the badge/list return to their prior state.
- Given a match already has a saved review by the time "Ignore all" runs (e.g. graded
  earlier that session), then it is left untouched and not counted in "Ignore all"'s
  target set.
- Given zero matches are pending in the current combined scope, then "Ignore all" is
  hidden/disabled, consistent with the existing "All caught up" empty state.
- Given I quit and relaunch the app with an age cutoff set, then Review reopens with that
  same cutoff still applied (persisted like role/season/account).

## Resolved questions

1. **Should Review's pending list start honoring the existing global filters, so
   "Ignore all" acts on exactly what's shown?** → Yes, and the sidebar badge moves
   together with the list (both scoped to the current filter).
   *(Note: the Role/Season filter bar already renders above the Review screen today —
   it just silently has no effect on the inbox. This makes its Role field actually work
   there; see Resolved Questions #8 for why the Season field deliberately stays inert.)*
2. **What should "ignore" actually persist?** → A plain empty review, fully
   indistinguishable later from a manually-saved blank review. No new "ignored" field,
   no schema change.
3. **Safety net for a bulk action?** → Confirm dialog before running, plus a batched
   Undo toast afterward.
4. **What should the new Review-specific filter filter by?** → An age cutoff ("older
   than N days"). Confirmed there is no existing date-range/age concept anywhere in the
   codebase — this is new. A two-sided date-range picker was considered and rejected as
   more UI work than the use case needs (no date-picker component exists today).
5. **Does the new filter combine with, or replace, the existing global Role/Season/
   account scope?** → Combines — narrows further on top of it.
6. **Should the age cutoff persist (like role/days) or reset each visit to Review?** →
   Persist, the same durability guarantee as role/days (survives navigation and app
   restart) — but see #7 for how, after techplan research changed the mechanism.
7. **[Amended during techplan] How should the age cutoff actually be persisted?** →
   As a renderer-local preference (`prefs.ts`, the same mechanism the Heroes screen's
   "min games" threshold already uses), not as a new `DashboardFilters` field. Techplan
   research found the `DashboardFilters` route would touch ~8-10 call sites across
   `store.ts`/`prefs.ts`/`view.ts` (`FILTER_DEFAULTS`, `Required<DashboardFilters>`, the
   filter bar's active-count/preset/reset helpers) and break an existing test asserting
   `FILTER_DEFAULTS`'s exact shape — all avoidable, with identical persistence behavior,
   by keeping the age cutoff out of `DashboardFilters` entirely and passing it as an
   explicit parameter wherever "Ignore all" needs it. Consequence: the sidebar badge
   (which reads `DashboardData.pendingReviews`, computed server-side from
   `DashboardFilters`) no longer reflects the age cutoff — only Role/account. See
   the updated Constraints and Acceptance Criteria above.
8. **[Amended during breakdown] Does Review's Role/Season/account scoping include the
   Season/day-window component?** → No. The breakdown's consistency-gate check caught
   that AC #1 (as originally written) contradicted itself: it claimed Review would show
   "today's full backlog" at the filter's *default* values, but the app's actual default
   day-window is "last 30 days" (`FILTER_DEFAULTS.days = 30`), not "all time." Honoring
   Role/Season/account literally would mean a user who just imported years of history
   sees only last-30-days pending games at first launch — silently hiding the exact
   backlog this feature exists to help clear. Resolution: Review honors Role and account
   fully (no silent-surprise risk — the player consciously picked them) but always treats
   the Season/day-window value as "all time" for its own computation; the explicit,
   off-by-default age cutoff is the sole way date narrows Review. See the updated
   Constraints and Acceptance Criteria above.

## Open Questions

- Exact UI for the age-cutoff control (a number input, preset chips like "7d / 14d /
  30d" + custom, etc.) is left to the techplan/implementation — this spec only fixes the
  behavior (a single "older than N days" threshold, off by default).
- Toast copy and exact Undo expiry duration for the batched toast (the single-match Undo
  toast is ~6s with hover-pause) — left to implementation/techplan to match existing
  toast conventions.
