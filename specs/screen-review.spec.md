# Screen spec: Review (`review`)

**Source:** `renderer/src/views/review.ts`, `renderer/src/reviews.ts` · reverse-engineered 2026-07-04
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior · [confirmed] user decision (2026-07-04 spec review)

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; sidebar shows a pending-review badge (`renderer/src/app/shell.ts`).

## Intent (WHAT & WHY)

[explicit — module docblock] The home of the manual (◎) layer. Auto-tracking removes the "I'm logging this game" moment, so finished games land here as an inbox needing the human read: grade the active targets (Hit / Partial / Missed) and flag how the game felt. The auto (⚡) facts are read-only — the player only adds what the app can't see.

## In-Scope

- Pending inbox: tracked games without a saved review; first pending item pre-expanded.
- Active-targets strip (with pointer to the Targets page when empty).
- Per-game grading card: ⚡ auto facts header (result, map, hero, role, time) · 3-way grade control per active target (starts unselected so it reads as "needs grading") · feel-flag chips (Tilted, Good comms, Toxic mate, Leaver) · **Save & next** · **Skip**.
- Sidebar pending-count badge.
- "All caught up" positive empty state.

## Out-of-Scope

- Editing or deleting a saved review (no UI path exists).
- Creating targets (the strip points to the Targets page).

## Constraints

- [explicit] Reviews persist keyed by `matchId` with timestamp, per-target grades, and flags (`localStorage` key `vantageReviews` today — see Known gaps for the intended end state).
- [confirmed] **Skip means "later"** — the game stays pending and counted in the badge until graded. This is intended behavior, not a gap.
- [explicit] Saving triggers a client-side re-render only (no refetch), so the current data snapshot stays stable.

## Acceptance Criteria (current behavior)

- Given a tracked game with no saved review, when Review renders, then it appears in the inbox and in the sidebar badge count.
- Given the user grades targets and/or toggles flags and clicks "Save & next", then a review `{ matchId, at, targets: targetId → grade, flags }` is stored and the game leaves the inbox without a data refetch.
- Given the user clicks "Skip", then the card collapses and the game remains pending.
- Given no active targets, when a grading card expands, then it shows "add some on the Targets page" instead of grade rows.
- Given every tracked game has a review, then the "All caught up — every tracked game has your read. 🎯" card is shown.

## Known gaps (intent ≠ code)

- [confirmed] **Inbox must ignore the global filters.** Today the inbox and badge derive from the filter-scoped match list, so narrowing the range hides older ungraded games. Intended: all ungraded tracked games are always visible in the inbox and counted in the badge, regardless of the active range/filters.
- [confirmed] **Active targets should be user-selected.** Today "active" = the first 3 library rows (for authored targets: the 3 most recently created). Intended: an explicit activate/deactivate mechanism on targets; the top-3 slice is a placeholder.
- [confirmed] **Full manual-data pipeline.** Today reviews live only in renderer `localStorage` and never reach the main-process store ([explicit] the code calls wiring them through "the shared next step"). Intended end state: saving a review persists grades + flags to the main store with the match record — flags feed the Mental stats, grades feed Target hit-rates/win-splits, and the data persists/exports like match history. `localStorage` stops being the source of truth.

## Open Questions

None — all resolved 2026-07-04 (see Known gaps for the three confirmed intent decisions).
