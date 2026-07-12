# Screen spec: Review (`review`)

**Source:** `renderer/src/views/review.ts`, `renderer/src/components/reviewControls.ts`, `renderer/src/reviews.ts`, `renderer/src/shortcuts.ts`, `renderer/src/components/toast.ts`, `renderer/src/components/roleIcon.ts`, `src/core/rankDisplay.ts` (`rankParts`).

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; the sidebar shows a pending-review badge (`renderer/src/app/shell.ts`).

## Intent

The home of the manual (◎) layer. Auto-tracking removes the "I'm logging this game" moment, so finished games land here as an inbox needing the human read: grade the active targets (Hit / Partial / Missed) and flag how the game felt. The auto (⚡) facts are read-only — the player only adds what the app can't see.

## Layout & behaviour

- **Pending inbox:** tracked games without a saved review; the first pending item is pre-expanded. Derived from `DashboardData.reviewInbox`, which is always **unfiltered** (see Constraints).
- **Active-targets strip** (with a pointer to the Targets page when empty). "Active" is the user-selected set — `isActive && !archivedAt` — set on the Targets screen.
- **Per-game grading card:** a ⚡ auto-facts header (result, map, hero, role shown as a **role icon**, time — with the competitive rank composed through the shared rank renderer, `rankParts`, when shown) · a 3-way grade control per active **self-rated (◎)** target (starts unselected so it reads as "needs grading") · feel-flag controls (the shared `reviewControls` component: Tilt, Toxic mates, Leaver — my team, Leaver — enemy, and the three-state comms-tone switch) · **Save & next** · **Skip**.
- **Measured (⚡) active targets are auto-graded, read-only.** Each shows its computed result for the match (e.g. "⚡ Hit — Damage/10 = 11,240"), or "⚡ no stat this match" when the match doesn't expose the stat — no manual control, contributing no entries to the saved `review.grades`. Only self-rated targets are hand-graded.
- **Keyboard grading (H/P/M/S):** while a grading card is open, `H`/`P`/`M` grade the *focused* self-rated target row and advance focus to the next; `S` saves the open review (equivalent to Save & next). The first target row starts focused; the footer hint reads "keys: H / P / M grade · S saves".
- **Save is undoable:** saving shows a toast "Review saved — `<map>`" with an **Undo** action (~6s, hover pauses). Undo calls `bridge.clearReview(matchId)`, removing the stored review; the game returns to the inbox and the badge count.
- **Sidebar pending-count badge:** backed by `DashboardData.pendingReviews` — an unfiltered, uncapped count minus games graded this session.
- **"All caught up"** positive empty state when every tracked game has a review.

## Out-of-Scope

- Editing/deleting a saved review beyond the undo-toast window (the toast's Undo is the only removal path, and it expires).
- Creating targets (the strip points to the Targets page).

## Constraints & edge cases

- **Reviews persist to the main-process store,** keyed by `matchId`, attached to the match as `GameRecord.review { at, grades, flags }` (`flags` uses the shared `MatchMental` shape the quick-log modal also writes). Path: renderer → `bridge.saveReview` → IPC → `HistoryStore.setReview`. Renderer `localStorage` is not the source of truth.
- **Skip means "later"** — the game stays pending and counted until graded.
- Saving triggers a client-side re-render only (no refetch); `gradedThisSession` (a renderer-side `Set<matchId>`) tracks what's been graded since the last refetch, so the inbox list and the badge both subtract it from the still-stale snapshot.
- **The inbox is always unfiltered.** `reviewInbox` and `pendingReviews` are computed from the full history — narrowing the global filters never hides an ungraded game or changes the badge. `reviewInbox` is capped at 150 rows for display; `pendingReviews` is uncapped.
- **Grades and flags feed downstream stats.** Flags OR-merge with quick-log flags into the Mental screen's composites and counts (once per game). Self-rated grades feed the corresponding target's hit-rate, hits/attempts, sparkline, and win-when-hit / win-when-missed splits — an attempt is any grade; `partial` counts as an attempt but not a hit.
- **Keyboard shortcuts are gated:** H/P/M/S register through the central shortcut registry with a `when` gate — they fire only while Review is the active view and the expanded card is connected, and never while a text input has focus or an overlay is open.
