# Screen spec: Review (`review`)

**Source:** `renderer/src/views/review.ts`, `renderer/src/components/reviewControls.ts`, `renderer/src/reviews.ts`, `renderer/src/shortcuts.ts`, `renderer/src/components/toast.ts`, `renderer/src/components/popover.ts`, `renderer/src/components/roleIcon.ts`, `src/core/rankDisplay.ts` (`rankParts`), `src/core/dashboardData.ts` (`pendingReviewMatches`, `pendingReviewsRecent`, `eligibleForNoRead`), `src/main/dataProvider.ts`, `src/main/dashboard/ipcHandlers.ts`, `src/store/history.ts` (`setReviews`, `clearReviews`).

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`; the sidebar shows a pending-review badge (`renderer/src/app/shell.ts`), scoped to the last 7 days (R1) — see Constraints.

## Intent

The home of the manual (◎) layer. Auto-tracking removes the "I'm logging this game" moment, so finished games land here as an inbox needing the human read: grade the active targets (Hit / Partial / Missed) and flag how the game felt. The auto (⚡) facts are read-only — the player only adds what the app can't see.

## Layout & behaviour

- **Pending inbox:** tracked games without a saved review; the first pending item is pre-expanded. Derived from `DashboardData.reviewInbox`, which is always **unfiltered** (see Constraints).
- **Active-targets strip** (with a pointer to the Targets page when empty). "Active" is the user-selected set — `isActive && !archivedAt` — set on the Targets screen.
- **Per-game grading card:** a ⚡ auto-facts header (result, map, hero, role shown as a **role icon**, time — with the competitive rank composed through the shared rank renderer, `rankParts`, when shown) · a 3-way grade control per active **self-rated (◎)** target (starts unselected so it reads as "needs grading") · feel-flag controls (the shared `reviewControls` component: Tilt, Toxic mates, Leaver — my team, Leaver — enemy, and the three-state comms-tone switch) · **Save & next** · **Skip**.
- **Measured (⚡) active targets are auto-graded, read-only.** Each shows its computed result for the match (e.g. "⚡ Hit — Damage/10 = 11,240"), or "⚡ no stat this match" when the match doesn't expose the stat — no manual control, contributing no entries to the saved `review.grades`. Only self-rated targets are hand-graded.
- **Keyboard grading (H/P/M/S):** while a grading card is open, `H`/`P`/`M` grade the *focused* self-rated target row and advance focus to the next; `S` saves the open review (equivalent to Save & next). The first target row starts focused; the footer hint reads "keys: H / P / M grade · S saves".
- **Save is undoable:** saving shows a toast "Review saved — `<map>`" with an **Undo** action (~6s, hover pauses). Undo calls `bridge.clearReview(matchId)`, removing the stored review; the game returns to the inbox and the badge count.
- **Sidebar pending-count badge (R1):** backed by `DashboardData.pendingReviewsRecent` — of the unfiltered, uncapped pending set, how many landed in the **last 7 days**, minus games graded this session that fall in that same window. The lifetime total only ever grows for an active player, so it stopped answering "anything to do tonight?"; this is the number that does. Its title spells out both: "N from this week · M in total". The Review head's own subtitle still states the full uncapped total (`pendingReviews`).
- **"Mark older as no-read" (R1):** a `viewHead` action, shown whenever the inbox is non-empty, opening a popover with an age cutoff (older than 1 day / 7 days / all of them), a live preview count (`bridge.previewPendingReviewIgnore`), and a confirm that calls `bridge.ignorePendingReviews` — saving an *empty* review (`{ grades: {}, flags: {} }`, no `Hit`/`Partial`/`Missed` claimed) on every matching row, so they leave the inbox/badge without being counted as graded. A 12s Undo toast (`bridge.clearReviews(matchIds)`) follows, same pattern as Delete match. The preview count and the actual write share one `src/core/dashboardData.ts` computation (`pendingReviewMatches` + `eligibleForNoRead`), so they can never disagree.
- **"All caught up"** positive empty state when every tracked game has a review.

## Out-of-Scope

- Editing/deleting a saved review beyond the undo-toast window (the toast's Undo is the only removal path, and it expires).
- Creating targets (the strip points to the Targets page).

## Constraints & edge cases

- **Reviews persist to the main-process store,** keyed by `matchId`, attached to the match as `GameRecord.review { at, grades, flags }` (`flags` uses the shared `MatchMental` shape the quick-log modal also writes). Path: renderer → `bridge.saveReview` → IPC → `HistoryStore.setReview`. Renderer `localStorage` is not the source of truth.
- **Skip means "later"** — the game stays pending and counted until graded.
- Saving triggers a client-side re-render only (no refetch); `gradedThisSession` (a renderer-side `Set<matchId>`) tracks what's been graded since the last refetch, so the inbox list, the subtitle and the badge all subtract it from the still-stale snapshot — the badge's subtraction is further scoped to the last 7 days, matching what `pendingReviewsRecent` itself counts.
- **The inbox is always unfiltered.** `reviewInbox`, `pendingReviews` and `pendingReviewsRecent` are computed from the full history — narrowing the global filters never hides an ungraded game or changes the badge. `reviewInbox` is capped at 150 rows for display; `pendingReviews`/`pendingReviewsRecent` are uncapped. "Mark older as no-read" is scoped by Role/account like `reviewInbox` (via `pendingReviewMatches`), but is exempt from the Season/day-window value exactly as the inbox itself is — the whole point is clearing a backlog the date filter would otherwise hide.
- **Grades and flags feed downstream stats.** Flags OR-merge with quick-log flags into the Mental screen's composites and counts (once per game). Self-rated grades feed the corresponding target's hit-rate, hits/attempts, sparkline, and win-when-hit / win-when-missed splits — an attempt is any grade; `partial` counts as an attempt but not a hit.
- **Keyboard shortcuts are gated:** H/P/M/S register through the central shortcut registry with a `when` gate — they fire only while Review is the active view and the expanded card is connected, and never while a text input has focus or an overlay is open.
