# Techplan: Review — "Ignore all" bulk action + age filter

**Slug:** `review-ignore-all` · **Spec:** `specs/review-ignore-all.spec.md` (see that file's
"Resolved questions" #7 for the persistence-mechanism amendment made during this techplan)

## Architecture & Approach

Three independent pieces, in dependency order:

### 1. Reverse "always unfiltered" — `reviewInbox`/`pendingReviews` become Role/account-scoped (never Season/day-window)

Today `src/core/dashboardData.ts` computes `ungraded = all.filter(g => !g.review)` from the
**competitive-only but otherwise unfiltered** `all`, deliberately bypassing the `games =
applyFilters(all, filters, seasonStartsList)` scoping every other stat uses. This is the
"always unfiltered" invariant the spec reverses — but only partially: per the spec's
Resolved Questions #8 (caught during `/breakdown`'s consistency-gate check), Review must
honor Role and account, but must **never** honor the Season/day-window component,
because the app's default day-window (30 days) would otherwise silently hide the exact
backlog this feature exists to help clear the moment someone opens Review after a big
historical import. Only the new, explicit, off-by-default age cutoff (part 2) is allowed
to narrow Review by date.

Replace the inline `ungraded` with a new exported pure function, next to `applyFilters` in
the same file. It reuses `applyFilters` completely unchanged (no duplicated
account/role logic to drift out of sync) by forcing `days: 'all'` regardless of what the
caller's `filters.days` actually is:

```ts
export function pendingReviewMatches(
  allGames: GameRecord[],
  filters: DashboardFilters,
  seasonStartsList?: readonly number[],
): GameRecord[] {
  const competitive = allGames.filter((g) => isCompetitive(g.gameType));
  return applyFilters(competitive, { ...filters, days: 'all' }, seasonStartsList)
    .filter((g) => !g.review)
    .sort((a, b) => b.timestamp - a.timestamp);
}
```

`computeDashboard` calls this once and derives both fields from the same result, so they
can never disagree by construction:

```ts
const pending = pendingReviewMatches(allGames, filters, seasonStartsList);
...
reviewInbox: pending.slice(0, ROW_CAP).map((g) => toMatchRow(g, mapModeOf, activeMeasured)),
pendingReviews: pending.length,
```

This one change is what makes the sidebar badge and the on-screen Review list both honor
Role/account (spec's core reversal, minus the Season/day-window component) — no renderer
or IPC change is needed for this part; `shell.ts`'s badge already reads
`state.data.pendingReviews` reactively.

**Deliberately excluded from this function:** the new age cutoff. It stays a
renderer-local concern (see part 2) so this shared function — and therefore the sidebar
badge — never depends on it. This is what keeps the badge's meaning simple and always
exact ("pending under your current Role/account"), and sidesteps an accuracy trap:
the renderer only ever receives ≤150 pending rows with timestamps, so a client-computed
"badge minus age cutoff" would silently undercount past that cap.

### 2. Age cutoff — a renderer-local preference, not a `DashboardFilters` field

Per the spec's amended Constraints (Resolved Questions #7), `reviewMinAgeDays` lives in
`renderer/src/prefs.ts`'s `PrefsShape`, exactly like the Heroes screen's existing
`minGames` chip threshold — not in `DashboardFilters`. On `renderer/src/views/review.ts`:

```ts
const minAgeDays = prefs.get('reviewMinAgeDays') ?? 0;
const pending = d.reviewInbox
  .filter((m) => !gradedThisSession.has(m.matchId))
  .filter((m) => minAgeDays <= 0 || m.timestamp <= Date.now() - minAgeDays * 86400000);
```

A small local numeric-input control (mirroring `stalenessEditor.ts`'s `numberField`
helper) commits via `prefs.set('reviewMinAgeDays', n); store.rerender();` — instant,
no IPC round-trip, matching `minGames`'s exact pattern. `0` means "off" (no cutoff).

Because this only filters the **already-fetched, already role/season/account-scoped**
`d.reviewInbox` array, it's naturally capped at whatever's rendered (≤150 rows) — fine
for *display*. It must **not** be the mechanism "Ignore all" uses to decide its true
target set (see part 3).

### 3. "Ignore all" — a dedicated, uncapped, server-side bulk action

The renderer's `pending` array (part 2) is capped at 150 and is exactly what should be
*shown*, but "Ignore all" must reach every match matching the combined scope even beyond
that cap (per spec Acceptance Criteria). It gets its own IPC round trip that recomputes
the eligible set fresh from the full history, independent of what's rendered:

```ts
// src/shared/contract/inputs.ts
export interface IgnorePendingReviewsInput {
  filters: DashboardFilters;
  /** Review-only age cutoff (days); 0 = no cutoff. Never part of DashboardFilters. */
  minAgeDays: number;
}
```

Two new `OwStatsApi` methods (`src/shared/contract/api.ts`) share this input type — one
read-only (populates the confirm dialog's count, since that must be accurate even beyond
the 150-row cap), one mutating:

```ts
/** Read-only: how many pending matches would "Ignore all" affect right now. */
previewPendingReviewIgnore(input: IgnorePendingReviewsInput): Promise<{ count: number }>;
/** Bulk-saves an empty review for every matching pending match; returns their ids for Undo. */
ignorePendingReviews(input: IgnorePendingReviewsInput): Promise<{ matchIds: string[] }>;
/** Undo of ignorePendingReviews: clears reviews on exactly these matchIds. */
clearReviews(matchIds: string[]): Promise<void>;
```

`src/main/dataProvider.ts` implements both filtering methods against a small shared local
helper built from pieces that already exist and are already imported into
`ipcHandlers.ts` today (`pendingReviewMatches` from part 1, plus a new `isOlderThan`
predicate in `src/core/matchFilter.ts` alongside `isCompetitive`):

```ts
// src/core/matchFilter.ts
export function isOlderThan(g: GameRecord, minAgeDays: number, now: number): boolean {
  return minAgeDays <= 0 || g.timestamp <= now - minAgeDays * 86400000;
}
```

```ts
// src/main/dataProvider.ts (inside createDataProvider)
const eligibleForIgnore = (input: IgnorePendingReviewsInput): GameRecord[] => {
  const seasonStarts = effectiveMasterData().seasons.map((s) => s.start);
  const all = deps.history.count() ? deps.history.all() : [];
  return pendingReviewMatches(all, input.filters, seasonStarts)
    .filter((g) => isOlderThan(g, input.minAgeDays, Date.now()));
};
...
previewPendingReviewIgnore: (input) => ({ count: eligibleForIgnore(input).length }),
ignorePendingReviews: (input) => {
  const matchIds = eligibleForIgnore(input).map((g) => g.matchId);
  if (matchIds.length) {
    deps.history.setReviews(matchIds.map((matchId) => ({
      matchId, review: { at: Date.now(), grades: {}, flags: {} },
    })));
  }
  return { matchIds };
},
clearReviews: (matchIds) => { deps.history.clearReviews(matchIds); },
```

Reusing `pendingReviewMatches` here (not a separate query) means the confirm count and
what actually gets cleared are the *same computation* — they can't drift apart — and
`setReviews` (existing, used today by the legacy-review-import path) is reused unchanged
for the write side: it already does exactly "only set on unreviewed rows, in one
transaction, return counts," which is exactly right since candidates are pre-filtered to
`!g.review`. Only the **undo** side needs a genuinely new store method — there is no
existing bulk-clear.

```ts
// src/store/history.ts, directly below setReviews
/**
 * Bulk-remove reviews (one transaction) — the undo counterpart to a bulk ignore.
 * Unknown ids and ids with no review are both skipped, never throw.
 */
clearReviews(matchIds: string[]): { cleared: number; skipped: number } {
  let cleared = 0;
  let skipped = 0;
  this.tx(() => {
    for (const matchId of matchIds) {
      const game = this.getOne(matchId);
      if (!game?.review) { skipped++; continue; }
      delete game.review;
      this.updateStmt.run(...updateValues(game));
      cleared++;
    }
  });
  return { cleared, skipped };
}
```

This mirrors `setReviews`/`mergeImported`'s existing `this.tx()` loop 1:1 (real
`BEGIN`/`COMMIT` transaction over `node:sqlite`, one fsync total regardless of row count
— confirmed safe/efficient for hundreds of rows, same as every other bulk method in this
file already relies on).

**Renderer flow** (`renderer/src/views/review.ts`), on clicking "Ignore all":

```ts
const onIgnoreAll = (): void => {
  const filters = store.get().filters;
  void bridge.previewPendingReviewIgnore({ filters, minAgeDays }).then(({ count }) => {
    if (!count) return;
    openModal((close) =>
      h('div', { style: {...} },
        h('div', { style: {...} }, `Ignore ${count} match${count === 1 ? '' : 'es'}?`),
        h('div', { class: 'hint' },
          'These matches get marked reviewed with no grades or feel flags — the same as saving them blank. You can undo right after.'),
        h('div', { style: { display: 'flex', gap: '10px' } },
          button('Ignore them', { variant: 'primary', onClick: () => {
            close();
            void bridge.ignorePendingReviews({ filters, minAgeDays }).then(({ matchIds }) => {
              void store.refresh();
              toast(`Ignored ${matchIds.length} match${matchIds.length === 1 ? '' : 'es'}`, {
                action: {
                  label: 'Undo',
                  run: () => void bridge.clearReviews(matchIds).then(() => void store.refresh()),
                },
              });
            });
          }}),
          button('Cancel', { variant: 'ghost', onClick: close }),
        ),
      ),
    );
  });
};
```

This reuses `openModal` (from `renderer/src/components/overlay.ts`) and `toast` (from
`renderer/src/components/toast.ts`) completely as-is — both already support this shape
verbatim (the primary/ghost button-pair confirm convention is already established twice,
in `targets/library.ts`'s `confirmDelete` and `settings/importCard.ts`'s `confirmRemove`;
`toast`'s `action.run` already supports async fire-and-forget work exactly like the
existing per-match Save-undo does). **No changes to `toast.ts`, `overlay.ts`,
`bridge.ts`, or `preload.ts`** — the latter two are fully generic, contract-driven
pass-throughs (confirmed by research), so the two new methods are available the moment
they exist in the contract.

`store.refresh()` (a full `getDashboard` re-fetch) is used here — deliberately not the
snapshot-overlay trick (`gradedThisSession` + `rerender()`) the single-match Save path
uses. See Risks & Alternatives #6 for why.

## Affected Files/Modules

**Core (pure, unit-tested, Electron-free — Guardrail #3):**
- `src/core/dashboardData.ts` — new exported `pendingReviewMatches`; `computeDashboard` calls it instead of the inline `ungraded`.
- `src/core/matchFilter.ts` — new exported `isOlderThan(g, minAgeDays, now)`.

**Shared contract:**
- `src/shared/contract/inputs.ts` — new `IgnorePendingReviewsInput` (imports `DashboardFilters` from `./dashboard`).
- `src/shared/contract/index.ts` — re-export `IgnorePendingReviewsInput`.
- `src/shared/contract/api.ts` — new `OwStatsApi` methods (`previewPendingReviewIgnore`, `ignorePendingReviews`, `clearReviews`) + matching `IPC_CHANNELS` entries (`manual:preview-ignore-pending-reviews`, `manual:ignore-pending-reviews`, `manual:clear-reviews`).

**Main process:**
- `src/store/history.ts` — new `clearReviews(matchIds): { cleared, skipped }`.
- `src/main/dashboard/provider.ts` — new `DataProvider` method signatures (sync, mirroring `saveReview`/`clearReview`'s convention).
- `src/main/dataProvider.ts` — implementations (`eligibleForIgnore` helper + the three provider members); `DataProviderDeps.history`'s `Pick<...>` gains `'clearReviews'`.
- `src/main/dashboard/ipcHandlers.ts` — three new `handle(ch.<x>, ...)` registrations next to the existing `saveReview`/`importReviews`/`clearReview` block.

**Renderer:**
- `renderer/src/prefs.ts` — new `reviewMinAgeDays: number` field on `PrefsShape` (default `0`), clamped non-negative on read/write like `suggestedHeroCount`.
- `renderer/src/views/review.ts` — age-cutoff control + client-side filter, "Ignore all" button in `viewHead`'s actions slot, confirm modal, bulk-undo toast.
- **No changes needed:** `renderer/src/bridge.ts`, `src/main/preload.ts` (generic pass-throughs), `renderer/src/app/shell.ts` (badge already reactive off `pendingReviews`), `renderer/src/store.ts` (no new filter field; `store.refresh()` already exists), `renderer/src/components/{toast,overlay,primitives}.ts` (reused as-is).

**Docs:**
- `README.md` line ~89-92 — the Review bullet currently states *"An always-visible inbox of ungraded games, independent of the global filters"*; this is being reversed and must be rewritten (and mention the age filter + Ignore all).

## Data Model / Interfaces

No `GameRecord`/`MatchReview` schema change, no SQL migration (confirmed by research —
`review` lives entirely inside the existing `data` JSON blob column; an "empty" review is
just another value for that same column, `{ at, grades: {}, flags: {} }`, structurally
identical to any hand-saved blank review).

```ts
// src/shared/contract/inputs.ts
export interface IgnorePendingReviewsInput {
  filters: DashboardFilters;
  minAgeDays: number;
}
```

```ts
// src/shared/contract/api.ts — OwStatsApi additions
previewPendingReviewIgnore(input: IgnorePendingReviewsInput): Promise<{ count: number }>;
ignorePendingReviews(input: IgnorePendingReviewsInput): Promise<{ matchIds: string[] }>;
clearReviews(matchIds: string[]): Promise<void>;
```

```ts
// src/core/dashboardData.ts — new export
export function pendingReviewMatches(
  allGames: GameRecord[], filters: DashboardFilters, seasonStartsList?: readonly number[],
): GameRecord[];
```

```ts
// src/core/matchFilter.ts — new export
export function isOlderThan(g: GameRecord, minAgeDays: number, now: number): boolean;
```

```ts
// src/store/history.ts — new HistoryStore method
clearReviews(matchIds: string[]): { cleared: number; skipped: number };
```

```ts
// renderer/src/prefs.ts — PrefsShape addition
reviewMinAgeDays: number; // 0 = off; days
```

`DashboardFilters` itself (`src/shared/contract/dashboard.ts`) is **unchanged** — this is
the direct consequence of the techplan's persistence-mechanism amendment.

## Test Strategy

Per CLAUDE.md's Definition of Done: `npm test` passes, `npm run typecheck` is clean, and
new/changed pure `src/core/` logic ships with unit tests.

**Core (`test/vantageCore.test.ts`, `test/reviewPipeline.test.ts`):**
- New `applyFilters`/`pendingReviewMatches`-style test in `vantageCore.test.ts`: build games across different roles/accounts, assert `computeDashboard(...).reviewInbox`/`.pendingReviews` now honor `role`/`account` — i.e. an ungraded game outside the active role/account filter no longer appears in either. Also assert the negative case explicitly: a `days: 7` (or any other day-window/season) filter has **no effect** on `reviewInbox`/`pendingReviews` — an ungraded game from 6 months ago still appears in both, proving the Season/day-window exemption (spec Resolved Questions #8), while `d.matches`/other stats still correctly narrow by `days` as before.
- **Rewrite** (not just extend) `reviewPipeline.test.ts`'s `describe('computeDashboard — review inbox decoupled from filters', ...)` block — its premise needs updating precisely, not reversing wholesale. Replace with `describe('computeDashboard — review inbox scoped by role/account, exempt from days', ...)` asserting: an old ungraded game *does* drop out of `reviewInbox`/`pendingReviews` when a `role`/`account` filter excludes it, but *stays visible* regardless of any `days`/season value; a graded game stays excluded from the inbox regardless of any filter. Keep the existing "counts pendingReviews past the inbox row cap" test as-is (cap behavior is unchanged, just now operating over the role/account-filtered, days-exempt set).
- New unit tests for `isOlderThan` in a `matchFilter`-focused test (new `describe` block, likely in `test/vantageCore.test.ts` alongside other `matchFilter` coverage, or a new small test file if none exists yet) — boundary cases: exactly N days old (inclusive, per spec's `<=`), N-1 days (excluded), N+1 days (included), `minAgeDays = 0` always `true`.
- New test asserting `pendingReviewMatches` (called directly) returns the uncapped, sorted-newest-first set — the source both `reviewInbox` (capped) and the new IPC handler's `eligibleForIgnore` derive from.

**Store (`test/historyStoreSqlite.test.ts`):**
- New `describe('clearReviews', ...)` (or alongside the existing `mergeImported` bulk-op tests), mirroring `mergeImported`'s "runs as one transaction... applying only the eligible ones" shape: seed some reviewed + some unreviewed + one unknown matchId via `addMany`, call `clearReviews([...])`, assert `{cleared, skipped}` and that `h.all()` reflects the change per-id, leaving untouched matches alone.
- Existing `setReviews` test in `reviewPipeline.test.ts` needs no change — it already covers exactly the semantics `ignorePendingReviews`'s write side relies on.

**Provider (`test/logMatchProvider.test.ts`, following its existing `reviewHarness()`-style DI-fake pattern):**
- `ignorePendingReviews` — fake `deps.history` (`all`, `count`, `setReviews`) + fake `masterDataStore`, assert the computed matchIds respect role/account/days *and* `minAgeDays`, and that `setReviews` is called with `{at, grades:{}, flags:{}}` entries only for those ids.
- `previewPendingReviewIgnore` — same fakes, assert `{count}` matches the eligible set's length **without** calling `setReviews` (no mutation) — a plain assertion the fake's `setReviews` spy was never invoked.
- `clearReviews` — fake `deps.history.clearReviews`, assert pass-through with the given matchIds.

**IPC handler wiring:** per research, this codebase has no `ipcHandlers.test.ts` precedent — handlers are thin `handle(ch.x, (_e, input) => provider.x(input))` pass-throughs tested at the provider level instead (above). No new test file needed for `ipcHandlers.ts` itself, consistent with existing convention.

**Renderer (manual/browser-preview verification — no renderer unit-test harness exists in this repo):**
- `npm run preview`, drive the Review screen: set the age-cutoff field, confirm the list narrows instantly with no network delay; click "Ignore all," confirm the dialog's count, confirm, verify rows disappear and the sidebar badge drops by that count; click Undo, verify rows and badge both restore. Use the preview harness's recorded/replay match sets (per project convention) to synthesize a >150-pending backlog and confirm the confirm-dialog count and toast count both reflect the true (uncapped) figure, not just the visible 150.
- Type-check both halves (`npm run typecheck`) to catch the `OwStatsApi`/`DataProvider`/`DataProviderDeps` shape changes propagating correctly end-to-end.

## Risks & Alternatives

1. **Reversing "always unfiltered" is a real behavior change.** Someone relying on today's
   guarantee (no ungraded game ever hides, regardless of filters) will now see Review
   narrow when Role or account narrows (but deliberately *not* when Season/day-window
   changes — see part 1's exemption). This was decided explicitly across the spec's
   clarification rounds and is required for the feature to make sense; flagged in the
   README update.
2. **Preview/ignore is two round trips, not one — a small TOCTOU window.** If another
   review is saved (another window, a sync) between the preview call and the confirm
   click, the actual ignored count can come in slightly lower than previewed (never
   higher — `setReviews`'s "never overwrite" guard just skips it). Low-risk and
   self-healing: the toast reports the *real* post-mutation count, not the stale preview
   number. Not worth extra engineering (e.g. optimistic locking) for a rare, low-stakes
   race on a manual, deliberate action.
3. **Alternative rejected: session-local "ignore" (mirroring `gradedThisSession`)
   instead of backend-persisted.** Doesn't survive `store.refresh()` or an app restart —
   the spec explicitly wants a durable bulk clear of backlog, and "plain empty review"
   already commits to backend persistence.
4. **Alternative rejected: reuse `importReviews` instead of a dedicated
   `ignorePendingReviews`.** `importReviews` requires the caller to already know every
   `matchId` — the renderer only reliably has ≤150 of them. A dedicated method that
   computes eligibility server-side from `{filters, minAgeDays}` is what makes the
   beyond-150-cap requirement possible at all.
5. **Alternative rejected (superseded mid-techplan): age cutoff as a new
   `DashboardFilters` field**, per the spec's original wording. Research found this
   would touch ~8-10 call sites (`FILTER_DEFAULTS`, `Required<DashboardFilters>`, the
   filter bar's active-count/preset/reset helpers, `prefs.ts`'s `migratePresetFilters`)
   and break `test/filterMigration.test.ts`'s exact-shape assertion on `FILTER_DEFAULTS`
   — all for identical user-facing behavior to the prefs.ts route. See the spec's
   amended Resolved Questions #7.
6. **`store.refresh()` after ignore/undo re-fetches the whole dashboard, not just
   Review.** Heavier than the single-match path's snapshot-overlay trick, but simpler
   (no new client-side bookkeeping, no `shell.ts` touch) and appropriate for an
   infrequent, deliberate bulk action rather than a per-grade hot path. A client-side
   `ignoredThisSession`-style overlay (avoiding the refetch) was considered and rejected:
   it would need its own `shell.ts` badge-subtraction logic (mirroring `gradedOverlap`)
   for no clear user-facing win over a plain refresh.
7. **Bulk transaction safety at scale.** `node:sqlite`'s `PRAGMA synchronous = FULL`
   means every `tx()` commit does a full fsync — but batching hundreds of rows inside
   one `this.tx()` (as `setReviews`/`clearReviews` both do) means exactly **one** commit
   regardless of row count, matching every other bulk method already in `history.ts`.
   No new risk here; confirmed by research, not a novel concern this feature introduces.
8. **Confirm-dialog round trip latency.** `previewPendingReviewIgnore` is a local SQLite
   read + in-memory filter over data already fully loaded for every dashboard refresh —
   expected sub-50ms even for large histories. No loading spinner is planned; if it ever
   proves noticeable, a follow-up could special-case `minAgeDays === 0` to read the
   already-available `d.pendingReviews` directly instead of round-tripping, but this is
   an optional micro-optimization, not required for correctness.
