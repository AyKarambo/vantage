# Screen spec: Review (`review`)

**Source:** `renderer/src/views/review.ts`, `renderer/src/reviews.ts` · reverse-engineered 2026-07-04 · updated 2026-07-04 after gap implementation
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior · [confirmed] user decision (2026-07-04 spec review) · [implemented 2026-07-04] shipped in the gap-closing pass

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; sidebar shows a pending-review badge (`renderer/src/app/shell.ts`).

## Intent (WHAT & WHY)

[explicit — module docblock] The home of the manual (◎) layer. Auto-tracking removes the "I'm logging this game" moment, so finished games land here as an inbox needing the human read: grade the active targets (Hit / Partial / Missed) and flag how the game felt. The auto (⚡) facts are read-only — the player only adds what the app can't see.

## In-Scope

- Pending inbox: tracked games without a saved review; first pending item pre-expanded. [implemented 2026-07-04] Derived from `DashboardData.reviewInbox`, which is always **unfiltered** — see Constraints.
- Active-targets strip (with pointer to the Targets page when empty). [implemented 2026-07-04] "Active" now means the user-selected set — targets with `isActive && !archivedAt` — set on the Targets screen, not a positional placeholder.
- Per-game grading card: ⚡ auto facts header (result, map, hero, role, time) · 3-way grade control per active target (starts unselected so it reads as "needs grading") · feel-flag chips (Tilted, Good comms, Toxic mate, Leaver) · **Save & next** · **Skip**.
- Sidebar pending-count badge. [implemented 2026-07-04] Backed by `DashboardData.pendingReviews` — an unfiltered, uncapped count — minus games already graded this session (see Constraints).
- "All caught up" positive empty state.

## Out-of-Scope

- Editing or deleting a saved review (no UI path exists — unchanged; still out of scope after this pass).
- Creating targets (the strip points to the Targets page).

## Constraints

- [implemented 2026-07-04] **Reviews persist to the main-process store**, keyed by `matchId`, attached to the match record as `GameRecord.review { at, grades, flags }` (`flags` uses the shared `MatchMental` shape — tilt/positiveComms/toxicMates/leaver — the same shape the quick-log modal writes). Saving goes renderer → `bridge.saveReview` → IPC → `HistoryStore.setReview` → `history.json`. Renderer `localStorage` is no longer the source of truth.
- [implemented 2026-07-04] **One-time legacy migration**: on the first non-sample dashboard load, `migrateLegacyReviews()` reads the old `vantageReviews` localStorage payload (if any), maps its renderer-local flag names to `MatchMental`, and imports it via `bridge.importReviews`. The migration is idempotent — it never overwrites a review already present on a game record, skips match ids the store doesn't recognize, and only clears the localStorage key after a successful import (a failure mid-import leaves it in place for a retry on the next launch). It runs once per app session and only against real (non-demo) history, since demo match ids don't exist in the store.
- [confirmed] **Skip means "later"** — the game stays pending and counted in the badge until graded. This is intended behavior, not a gap.
- [explicit] Saving triggers a client-side re-render only (no refetch), so the current data snapshot stays stable; `gradedThisSession` (a renderer-side `Set<matchId>`) tracks what's been graded since the last refetch so the inbox list and the sidebar badge both subtract it from the still-stale snapshot.
- [implemented 2026-07-04] **The inbox is always unfiltered.** `reviewInbox` and `pendingReviews` are computed from the full, unfiltered history — narrowing the global account/role/mode/range filters never hides an ungraded game or changes the badge count. `reviewInbox` is capped at 150 rows for display; `pendingReviews` is an uncapped count.
- [implemented 2026-07-04] **Active targets feed grading rows.** The grading strip = `targets.filter(t => t.isActive && !t.archivedAt)` from the current `DashboardData.targets`, sourced from the Targets screen's lifecycle state (see `screen-targets.spec.md`).
- [implemented 2026-07-04] **Grades and flags feed downstream stats.** Flags OR-merge with quick-log flags into the Mental screen's composites and counts (each flag counts once per game, regardless of which surface set it). Grades feed the corresponding target's hit-rate, hits/attempts, sparkline (last 8 attempts), and win-when-hit/win-when-missed splits — an attempt is any grade; `partial` counts as an attempt but not a hit.

## Acceptance Criteria (current behavior)

- Given a tracked game with no saved review, when Review renders, then it appears in the inbox and in the sidebar badge count, regardless of the active global filters.
- Given the user grades targets and/or toggles flags and clicks "Save & next", then `bridge.saveReview({ matchId, grades, flags })` persists `{ at, grades, flags }` onto the match's `GameRecord.review` in the main store, the match id is added to `gradedThisSession`, and the game visually leaves the inbox without a data refetch.
- Given the user clicks "Skip", then the card collapses and the game remains pending.
- Given no active targets, when a grading card expands, then it shows "No active targets yet — add some on the Targets page to grade them here." instead of grade rows.
- Given every tracked game has a review, then the "All caught up — every tracked game has your read. 🎯" card is shown.
- Given a legacy `vantageReviews` localStorage payload exists and the current data is real (non-sample) history, then on first load it is imported into the main store once, skipping any match id already reviewed or not found in history, and the localStorage key is cleared only after a successful import.
- Given a saved review includes a feel flag, then the Mental screen's flag counts and calm/tilted composites include it (OR-merged with any quick-log flag on the same game, counted once).
- Given a saved review includes a grade for an active target, then that target's Targets-library row reflects the updated hit-rate, hits/attempts, sparkline, and win-splits on next refresh.

## Known gaps (intent ≠ code)

None identified — behavior matches intent. One out-of-scope item remains unchanged:

- [confirmed] **No UI path to edit or delete a saved review.** Once "Save & next" is clicked, the review is final from the Review screen's perspective — there is no way to reopen and change grades/flags for a match already reviewed. This was explicitly out-of-scope before this pass and remains so; reviews are keyed to match ids in the store, so a future edit affordance is technically straightforward but was not part of this implementation.

## Open Questions

None — all three 2026-07-04 gaps (unfiltered inbox, user-selected active targets, full manual-data pipeline) are now implemented.
