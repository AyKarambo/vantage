# Tasks: Review — "Ignore all" bulk action + age filter

**Slug:** `review-ignore-all` · **Spec:** `specs/review-ignore-all.spec.md` · **Plan:** `specs/review-ignore-all.plan.md`

Ordered by dependency. Each task is implemented, tested, and reviewed on its own via `/implement` before the next starts.

---

- [x] **1. Core: scope `reviewInbox`/`pendingReviews` by Role/account (exempt from Season/day-window)**
  - **Goal:** Reverse "always unfiltered" for Review — add `pendingReviewMatches()` (reuses `applyFilters` with `days` forced to `'all'`) and wire it into `computeDashboard`, replacing the inline `ungraded`.
  - **Files:** `src/core/dashboardData.ts`, `test/vantageCore.test.ts`, `test/reviewPipeline.test.ts`
  - **Check:** an ungraded game outside the active Role/account filter no longer appears in `reviewInbox`/`pendingReviews`; an ungraded game *outside* the active `days`/season value still appears in both (the exemption); a graded game stays excluded regardless of any filter; the rewritten `reviewPipeline.test.ts` describe block and the row-cap test both pass; `npm test` + `npm run typecheck` pass.
  - **Size:** M

- [x] **2. Contract: add `IgnorePendingReviewsInput` + the three new API methods/channels**
  - **Goal:** Extend the shared IPC contract with `previewPendingReviewIgnore`, `ignorePendingReviews`, `clearReviews`.
  - **Files:** `src/shared/contract/inputs.ts`, `src/shared/contract/index.ts`, `src/shared/contract/api.ts`
  - **Check:** `npm run typecheck` passes (main + renderer); the `IPC_CHANNELS` `satisfies` clause compiles, confirming every new method has a channel entry.
  - **Size:** S

- [ ] **3. Store: bulk-undo `HistoryStore.clearReviews`**
  - **Goal:** Add a transactional bulk `clearReviews(matchIds)`, the undo counterpart to `setReviews`.
  - **Files:** `src/store/history.ts`, `test/historyStoreSqlite.test.ts`
  - **Check:** new test seeds reviewed/unreviewed/unknown-id matches, calls `clearReviews`, asserts `{cleared, skipped}` and per-id post-state via `all()`, all inside one transaction; `npm test` passes.
  - **Size:** S

- [ ] **4. Core: age-cutoff predicate `isOlderThan`**
  - **Goal:** Add the pure `isOlderThan(g, minAgeDays, now)` predicate that the bulk-ignore computation (task 5) will use.
  - **Files:** `src/core/matchFilter.ts`, `test/vantageCore.test.ts`
  - **Check:** unit tests cover boundary cases — exactly N days old (included, `<=`), N-1 days (excluded), N+1 days (included), `minAgeDays = 0` always `true`; `npm test` passes.
  - **Size:** S

- [ ] **5. Main process: wire bulk-ignore/preview/undo end-to-end**
  - **Goal:** Implement `previewPendingReviewIgnore`/`ignorePendingReviews`/`clearReviews` on `DataProvider`/`dataProvider.ts` (using `pendingReviewMatches` + `isOlderThan` + `setReviews`/`clearReviews`), extend `DataProviderDeps.history`'s `Pick<...>`, register the three IPC handlers.
  - **Files:** `src/main/dashboard/provider.ts`, `src/main/dataProvider.ts`, `src/main/dashboard/ipcHandlers.ts`, `test/logMatchProvider.test.ts`
  - **Check:** new provider-level tests (DI-fake `deps.history`/`masterDataStore`) assert: computed matchIds respect role/account + `minAgeDays` (and ignore any `days` value passed in `filters`, per task 1's exemption); `setReviews` is called only with `{at, grades:{}, flags:{}}` entries for eligible ids; a match already reviewed by call time is excluded; a >150-eligible-match scenario returns every matching id, not just 150; `previewPendingReviewIgnore` never calls `setReviews`; `clearReviews` passes through to the store method. `npm test` + `npm run typecheck` pass.
  - **Size:** M — depends on tasks 1, 2, 3, 4.

- [ ] **6. Renderer: age-cutoff preference + client-side filter on Review**
  - **Goal:** Add `reviewMinAgeDays` to `PrefsShape`, a small numeric-input control on the Review screen, and filter the on-screen pending list by it.
  - **Files:** `renderer/src/prefs.ts`, `renderer/src/views/review.ts`
  - **Check:** `npm run preview` — setting the cutoff instantly narrows the visible pending list with no network call; clearing it restores the Role/account-scoped (days-exempt) list; the sidebar badge is confirmed unaffected by the cutoff; the value survives a page reload (prefs persistence); navigating to Heroes/Matches/Trends shows their stats unaffected by the cutoff. `npm run typecheck` passes.
  - **Size:** S — depends on task 1; independent of tasks 2/3/4/5.

- [ ] **7. Renderer: "Ignore all" button, confirm dialog, bulk-undo toast**
  - **Goal:** Wire an "Ignore all" button in Review's `viewHead` actions slot to `previewPendingReviewIgnore` → `openModal` confirm → `ignorePendingReviews` → `store.refresh()` + a batched `toast(...)` with Undo → `clearReviews` + `store.refresh()`.
  - **Files:** `renderer/src/views/review.ts`
  - **Check:** `npm run preview` — button hidden/disabled when the current (role/account + age-cutoff) pending list is empty; clicking shows a confirm dialog with the exact count (verified against a synthesized >150-pending backlog, not just what's rendered); confirming clears the matching rows and drops the sidebar badge by that exact count; Undo restores rows and badge; a match graded in the same session is never included. `npm run typecheck` passes.
  - **Size:** M — depends on tasks 5 and 6.

- [ ] **8. Docs: update README's Review bullet**
  - **Goal:** Rewrite the README line describing Review as "always-visible... independent of the global filters" to describe the new Role/account scoping (Season/day-window exempt), the age cutoff, and Ignore all.
  - **Files:** `README.md`
  - **Check:** reads accurately against the shipped behavior from tasks 1–7.
  - **Size:** S — depends on tasks 1, 6, 7.

---

## Consistency gate

Every Acceptance Criterion in `specs/review-ignore-all.spec.md` mapped against the tasks above:

| # | Acceptance Criterion (abridged) | Task(s) |
|---|---|---|
| 1 | At Role/account defaults, no age cutoff → full backlog shown regardless of Season/day-window | 1 |
| 2 | Narrowing Role/account → list+badge narrow; Season/day-window alone has no effect | 1 |
| 3 | Age cutoff N days → list narrows further; badge unaffected | 6 |
| 4 | Clearing age cutoff → list returns to Role/account-only view | 6 |
| 5 | Age cutoff set → other screens' stats unaffected | 6 |
| 6 | Confirm dialog states exact count N before mutation | 7 (+5 for the accurate count) |
| 7 | Confirm → N empty reviews saved, list/badge drop by N, toast with Undo | 5, 7 |
| 8 | >150-row backlog → all matching cleared, not just rendered 150; counts agree | 5, 7 |
| 9 | Undo restores exactly the cleared batch | 3, 5, 7 |
| 10 | Already-reviewed match by run-time is left untouched | 5 |
| 11 | Zero pending in current scope → "Ignore all" hidden/disabled | 6, 7 |
| 12 | Age cutoff persists across app restart | 6 |

**No gaps** — every acceptance criterion traces to at least one task.

**No scope creep** — task 2 (contract types) and task 4 (`isOlderThan`) don't map to an AC directly, but both are load-bearing prerequisites for task 5, which does; task 8 (README) isn't an AC either, but is required by CLAUDE.md's Definition of Done ("README / relevant docs are updated when user-visible behavior or commands change"), not spec scope creep.

**Note:** during this breakdown, the consistency-gate check caught a self-contradiction in the spec's original AC #1 (it claimed "full backlog at defaults," but the app's actual default day-window is 30 days, not "all time"). This was resolved with the user and the spec was amended (Resolved Questions #8) before finalizing this task list — see `specs/review-ignore-all.spec.md`.
