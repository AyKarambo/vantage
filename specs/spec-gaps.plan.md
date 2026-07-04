# Techplan: Spec gaps (`spec-gaps`)

**Source:** derived from the ten screen specs of 2026-07-04 (`specs/screen-*.spec.md`).
**Provenance:** every gap item below is a `[confirmed]` user decision from those specs' "Known
gaps" sections and serves directly as a requirement here — no new product decisions are made in
this document. `screen-heroes.spec.md`, `screen-maps.spec.md`, `screen-trends.spec.md`, and
`screen-focus.spec.md` have no gaps and are out of scope for this plan.

## Coverage

Every "Known gaps" bullet across the six specs with gaps, mapped to its work stream. This table is
the completeness contract for this plan.

| Spec | Gap (short paraphrase) | Work stream |
|---|---|---|
| screen-overview.spec.md | Mental card claims "Break reminder is on after N losses" but no reminder mechanism exists | WS2 |
| screen-matches.spec.md | Match rows aren't clickable; no detail page (scoreboard, per-hero tabs, progress, player history, screenshots) exists | WS4 |
| screen-mental.spec.md | Break-reminder line is misleading — hardcoded constant, nothing fires; needs a real, user-configurable mechanism | WS2 |
| screen-mental.spec.md | Review flags must feed Mental stats — flags currently live only in renderer `localStorage`, never reach the main store | WS1 |
| screen-targets.spec.md | No edit or delete for saved targets — need edit (keep accrued stats) + archive (restorable) + permanent delete | WS1 |
| screen-targets.spec.md | Drop the "This match" scope option — saves a value that changes nothing downstream | WS1 |
| screen-targets.spec.md | Remove the Cancel button — no handler, nothing to cancel | WS1 |
| screen-targets.spec.md | Active-target selection UI needed — "first 3 library rows" is a placeholder | WS1 |
| screen-targets.spec.md | Grading pipeline: Review grades must persist and drive real hit-rates/sparklines/win-splits, replacing permanent "New · 0/0" | WS1 |
| screen-targets.spec.md | Measured-block preview badge always reads "auto-grade Hit" regardless of the rule | WS1 |
| screen-review.spec.md | Inbox must ignore global filters — currently hides older ungraded games when range narrows | WS1 |
| screen-review.spec.md | Active targets should be user-selected — "first 3" is a placeholder | WS1 |
| screen-review.spec.md | Full manual-data pipeline — reviews live only in `localStorage`, never reach the main-process store | WS1 |
| screen-notion.spec.md | Database selection needs a UI — picker listing accessible databases, plus an auto-create option | WS3 |

## Sequencing & dependencies

**WS1 first.** It is the biggest product debt item — it single-handedly resolves the shared
grading-pipeline gap that `screen-review.spec.md`, `screen-targets.spec.md`, and
`screen-mental.spec.md` all point at, and unlocks correct behavior across those three screens at
once. Land it before the others so downstream contract churn doesn't stack.

**WS2 and WS3 are small and independent** of WS1 and of each other — a pure state-machine module
plus config/IPC plumbing (WS2), and a Notion admin edge plus a picker card (WS3). Either can be
picked up in parallel with WS1 by a different contributor, or slotted in afterward; nothing in
their Data Model sections depends on WS1's types.

**WS4 phasing:** v1 (page + routing + data already on `GameRecord`) is independent of the other
streams and can ship any time. v2 (roster/finalScore/competitive capture from GEP) is gated on
verifying real GEP key names via the `OW_SYNC_RECORD=1` capture flow before the `K`-table aliases
are trusted — do not guess key spellings into shipped code. v3 (player index + screenshots) is
best-effort and lands last; its screenshot half may never land if neither capture API proves
viable, which is spec-sanctioned (permanently collapsed gallery).

**Collision note.** WS1, WS2, and WS4 all touch the same edge files: `src/shared/contract.ts`,
`src/main/preload.ts`, `renderer/src/bridge.ts`, `renderer/preview/preview.ts`,
`src/main/dashboard.ts`, and `src/main/index.ts`. WS1 and WS2 additionally both touch
`src/core/mental.ts` (WS1 merges review flags into `mentalSummary()`; WS2 removes the fake
`breakReminderAfterLosses` field from the same function). Because of this overlap, **streams land
serially, not concurrently, against these files** — pick one stream, land its edge changes fully,
then start the next. Within any single stream, every `OwStatsApi` addition must land with its
`preload.ts` + `bridge.ts` + `preview.ts` counterparts in the same change, or `npm run typecheck`
fails (this is treated as a feature: the typed contract catches drift).

**Guardrail audit, one line per stream:**
- **WS1:** GEP-only (no new live-data source; reviews are manual input, same as today) · no secrets
  (no credentials touched) · core purity (all scoring/merging logic in `src/core/`, edges only move
  bytes) · CSP-friendly (no new remote code) · local-first (review data stays in `history.json`,
  no new outbound path).
- **WS2:** GEP-only (streak logic reads only already-ingested `history`) · no secrets ·
  core purity (`nextBreakReminder` pure in `src/core/breakReminder.ts`, tray notification is the
  only edge-side effect) · CSP-friendly (native `Notification`, no remote content) · local-first
  (setting persists to local `config.local.json` only).
- **WS3:** GEP-only (unaffected — Notion is export, not live data) · no secrets (token handling
  unchanged; new admin calls reuse the existing injected `Client`, no new credential storage) ·
  core purity (`gametrackerSchema.ts` has no `Client` import) · CSP-friendly (no renderer-side
  remote fetches; all Notion calls happen in main) · local-first (export remains opt-in via the
  user's own token; selection persisted locally in `config.local.json`).
- **WS4:** GEP-only (scoreboard/roster/competitive fields are strictly optional and sourced only
  from GEP's end-of-match-screen-visible data — v2 explicitly stores only TAB-screen fields, no
  memory reads) · no secrets · core purity (`matchDetail()` builder and `playerIndex.ts` are pure;
  `screenshots.ts` is edge-only and wrapped so failure is a no-op) · CSP-friendly (screenshot
  delivery via a scoped local `vantage-media://` protocol, not remote/CDN content) · local-first
  (player index and screenshots never leave the device; `notionExporter.ts`'s `gameToMatchRecord`
  must **not** be extended to include roster data).

## WS1 — Manual-data pipeline & targets lifecycle

(source: plan-manual-pipeline.md)

### Architecture & Approach

**End-to-end data flow (target state).** A review saved on the Review screen travels:
`renderer/src/views/review.ts` → `bridge.saveReview()` (`renderer/src/bridge.ts`) →
`window.owstats.saveReview` (`src/main/preload.ts`) → `ipcMain.handle('manual:save-review')`
(`src/main/dashboard.ts`) → `provider.saveReview()` (`src/main/index.ts`) →
`HistoryStore.setReview(matchId, review)` (`src/store/history.ts`), which attaches a `review` block
to the `GameRecord` and atomically rewrites `history.json`. On the next `getDashboard`,
`computeDashboard()` (`src/core/dashboardData.ts`) derives everything from that one persisted fact:
`mentalSummary()` merges `g.review.flags` with `g.mental`, a new grade-scoring path in
`src/core/targets.ts` turns `g.review.grades` into real hit-rates/sparklines/win-splits, and a new
unfiltered `reviewInbox` feeds the inbox and sidebar badge. The renderer's `reviews.ts` localStorage
module stops being a source of truth and shrinks to (1) a one-time migration shim and (2) an
in-session "graded just now" set that preserves the spec-confirmed no-refetch-on-save behavior
(screen-review.spec.md constraint, line 29).

**Core vs edges.** All new logic that computes anything lives in `src/core/` (pure, Electron-free,
per CLAUDE.md guardrail 3): review-aware target scoring, mental-flag merging, inbox derivation. The
edges only move bytes: `contract.ts` gains typed methods, `preload.ts`/`bridge.ts` forward them,
`dashboard.ts` registers handlers, `index.ts` wires them to the two stores, and
`renderer/preview/preview.ts` mirrors them so the browser harness keeps working (guardrail: preview
drives the same core).

**Grading semantics (one decision, applied everywhere):** an *attempt* = a saved review containing
any grade for that target id; a *hit* = grade `'hit'`; `'partial'` and `'missed'` count as attempts
but not hits. Win-splits: `winWhenHit` = `winLoss()` over games graded `'hit'`, `winWhenMissed` over
games graded `'partial' | 'missed'`; either side falls back to the player baseline at 0 games
(preserves current `authoredSummary` behavior at `src/core/targets.ts:100-114`). Sparkline = the
last 8 attempts chronologically mapped `hit→1, partial→0.5, missed→0`, left-padded with 0 (same
8-slot shape `buildSpark`/`Array(8).fill(0)` already produce). Measured targets are still graded
manually on Review in this work stream; true auto-grading from `perHero` stats is out of scope (see
Risks).

**Ordering of sub-steps** (each leaves `npm test` + `npm run typecheck` green):
1. **Core types + logic (pure):** add `TargetGrade`/`MatchReview` to `src/core/analytics.ts` next to
   `MatchMental`; extend `AuthoredTarget` with `isActive`/`archivedAt`; rewrite the authored branch
   of `buildTargets()` to score grades; merge review flags in `mentalSummary()`; add
   `reviewInbox`/`pendingReviews` to `computeDashboard()`. Vitest coverage lands in the same step.
2. **Stores:** `HistoryStore.setReview()` + bulk `setReviews()`; `ManualStore.updateTarget()`,
   `setActive()`, `setArchived()` (+ load-time defaulting of the new fields). Tests follow the
   existing temp-dir pattern in `test/manualLog.test.ts`.
3. **Contract + all edges together:** `src/shared/contract.ts` API additions,
   `src/main/preload.ts`, `renderer/src/bridge.ts`, IPC handlers in `src/main/dashboard.ts`
   (`DataProvider` methods), implementations in `src/main/index.ts`, and the preview mock in
   `renderer/preview/preview.ts` — done as one step so `OwStatsApi` never has an unimplemented
   member.
4. **Renderer — review pipeline:** `views/review.ts` reads `d.reviewInbox` and
   `d.targets.filter(t => t.isActive && !t.archivedAt)` (deleting `ACTIVE_LIMIT`, line 15); save
   calls `bridge.saveReview()` then `store.rerender()`; `app/shell.ts:158` badge switches from
   `reviews.pending(...)` to `d.pendingReviews` minus the in-session graded set; `reviews.ts` is
   repurposed (migration + session set, flags renamed to `MatchMental` keys). One-time migration
   runs after the first successful non-sample dashboard load.
5. **Renderer — targets lifecycle + cleanup (E):** library rows in `views/targets.ts` gain Active
   toggle, Edit (re-opens the builder pre-filled, saves via `updateTarget`), Archive/Restore, and
   Delete behind an `openModal` confirmation (`renderer/src/components/overlay.ts`, same pattern as
   `app/log-match.ts:40`); remove the Cancel button (line 70) and the Scope segmented control
   (lines 96–102); make the measured preview badge (line 116) render `Hit when ${stat} ${op}
   ${value}` and update it inside the select/input handlers.
6. **Docs:** update README + the three specs' "Known gaps" sections (Definition of Done item 4).

### Affected Files/Modules

**Modified (core):**
- `src/core/analytics.ts` — add `TargetGrade`, `MatchReview`; extend `GameRecord` (line 24–38) with
  `review?: MatchReview`.
- `src/core/targets.ts` — extend `AuthoredTarget` (17–24) and `TargetSummary` (26–38); replace
  `authoredSummary()` (100–114) with grade scoring; `sampleTargets()` (59–81) sets `isActive: true`
  so the demo Review strip still works; `buildTargets()` (87–93) excludes archived rows from the
  library output but keeps them (flagged) so the renderer can offer Restore; the sample-vs-authored
  switch keys off *any* authored target existing (archived included) so archiving everything
  doesn't resurrect demo data.
- `src/core/mental.ts` — `mentalSummary()` (27–56): per game, merge `g.mental` and
  `g.review?.flags` with logical OR per flag before counting (a game flagged tilt in both sources
  counts once).
- `src/core/dashboardData.ts` — `computeDashboard()` (21–64) gains `reviewInbox` + `pendingReviews`
  computed from the **unfiltered** `all` argument (it already receives it; `applyFilters()` at
  66–76 is untouched).

**Modified (stores/edges):**
- `src/store/history.ts` — add `setReview(matchId, review): boolean` and `setReviews(entries:
  ReviewInput[]): number` (bulk = one atomic save, reusing the tmp+rename pattern at 50–53).
- `src/store/manualLog.ts` — add `updateTarget(id, patch)`, `setActive(id, active)`,
  `setArchived(id, archived)`; `load()` (50–57) backfills `isActive: true` on legacy records
  missing the field.
- `src/shared/contract.ts` — new types + 6 `OwStatsApi` methods (see Data Model); drop `scope` from
  `AuthoredTargetInput` (135–140); add `reviewInbox`/`pendingReviews` to `DashboardData` (63–90).
- `src/main/preload.ts` — 6 new `ipcRenderer.invoke` forwards.
- `src/main/dashboard.ts` — 6 new `DataProvider` members (13–31) + `ipcMain.handle` registrations
  next to the existing manual writes (61–65).
- `src/main/index.ts` — implement the provider methods against `history`/`manual` (63–99);
  `saveTarget` (80–82) sets `isActive: true`, `scope: 'season'`.
- `renderer/src/bridge.ts` — 6 new pass-throughs.
- `renderer/preview/preview.ts` — mock the 6 methods; persist preview reviews to a
  `vantagePreviewReviews` localStorage key overlaid onto `dataset()` so the harness exercises the
  full pipeline.

**Modified (renderer):**
- `renderer/src/reviews.ts` — repurposed: delete the localStorage CRUD as source of truth; keep
  `migrateLegacyReviews(bridge): Promise<void>` (reads key `vantageReviews`, maps old `Flags
  {tilted, comms, toxic, leaver}` → `MatchMental {tilt, positiveComms, toxicMates, leaver}`, calls
  `bridge.importReviews`, clears the key on success) and `gradedThisSession: Set<string>`.
- `renderer/src/views/review.ts` — inbox from `d.reviewInbox` filtered by `gradedThisSession`;
  active strip from `isActive`; save via `bridge.saveReview` (replacing `reviews.set` at 104–110);
  local `Grade` type replaced by contract `TargetGrade`.
- `renderer/src/app/shell.ts` — badge (158, 168) from `d.pendingReviews` − session-graded overlap;
  trigger migration after first non-sample load.
- `renderer/src/views/targets.ts` — cleanup E + lifecycle row actions + edit mode for the builder;
  library composes `badge`/`button`/`segmented` from `components/primitives` (composition-first
  rule).

**Created:**
- `test/reviewPipeline.test.ts` — core scoring/merging/inbox tests (or fold into
  `test/vantageCore.test.ts`; separate file preferred for size).
- No new source modules: scoring belongs in `src/core/targets.ts`, review types in
  `src/core/analytics.ts`, matching where their consumers already live.

### Data Model / Interfaces

**Core record shapes** (`src/core/analytics.ts`, re-exported through `contract.ts` like
`MatchMental` already is at contract.ts:10):

```typescript
export type TargetGrade = 'hit' | 'partial' | 'missed';

/** The manual (◎) read attached to a tracked game on the Review screen. */
export interface MatchReview {
  at: number;                              // when the review was saved
  grades: Record<string, TargetGrade>;     // targetId → grade (inert if target deleted)
  flags: MatchMental;                      // reuses the existing shape — no parallel Flags type
}

export interface GameRecord {
  // ...existing fields unchanged (matchId, timestamp, …, mental?)
  review?: MatchReview;
}
```

**Target shapes** (`src/core/targets.ts`):

```typescript
export interface AuthoredTarget {
  id: string; name: string; mode: TargetMode; rule: string; createdAt: number;
  scope?: 'match' | 'season';  // legacy field, kept for old manual.json; new writes always 'season'
  isActive: boolean;           // graded on the Review screen
  archivedAt?: number;         // set = hidden from library + active set, restorable
}

export interface TargetSummary {
  // ...existing fields
  isActive: boolean;
  archivedAt?: number;
}
```

**IPC contract** (`src/shared/contract.ts`; every payload fully typed, no `any`):

```typescript
export interface ReviewInput {
  matchId: string;
  grades: Record<string, TargetGrade>;
  flags: MatchMental;
}

export interface TargetEditInput {
  id: string; name: string; mode: TargetMode; rule: string;
}

export interface DashboardData {
  // ...existing fields
  /** Ungraded tracked games, newest first — ALWAYS unfiltered (inbox source). */
  reviewInbox: MatchRow[];
  /** Total ungraded count (badge) — unfiltered, uncapped. */
  pendingReviews: number;
}

export interface OwStatsApi {
  // ...existing members
  saveReview(input: ReviewInput): Promise<void>;
  /** One-time legacy localStorage migration; skips unknown matchIds and existing reviews. */
  importReviews(inputs: ReviewInput[]): Promise<{ imported: number; skipped: number }>;
  updateTarget(input: TargetEditInput): Promise<void>;      // preserves createdAt/isActive/archivedAt → stats accrue across edits
  setTargetActive(id: string, active: boolean): Promise<void>;
  setTargetArchived(id: string, archived: boolean): Promise<void>;
  deleteTarget(id: string): Promise<void>;                  // permanent; stored grades stay inert in reviews
}
```
Channels: `manual:save-review`, `manual:import-reviews`, `manual:update-target`,
`manual:set-target-active`, `manual:set-target-archived`, `manual:delete-target` — matching the
existing `manual:*` namespace (dashboard.ts:62–65). `AuthoredTargetInput` drops `scope`.

**Migration notes:**
- *Reviews (renderer → main, one-time):* main cannot read renderer localStorage, so migration is
  renderer-initiated. After the first `getDashboard` where `data.isSample === false`,
  `migrateLegacyReviews()` reads `vantageReviews`, remaps flag keys (`tilted→tilt`,
  `comms→positiveComms`, `toxic→toxicMates`, `leaver` unchanged), sends one `importReviews` batch,
  and clears the key only on a resolved IPC call. Idempotent: failure leaves the key for the next
  launch; `importReviews` never overwrites an existing `GameRecord.review` and drops unknown
  matchIds (returned as `skipped`). Guarding on `!isSample` avoids a retry loop in demo mode where
  no history ids exist.
- *history.json:* `review` is additive-optional — old files parse unchanged (`load()` at
  history.ts:41–48 needs no change).
- *manual.json:* `ManualStore.load()` backfills `isActive: true` and leaves `archivedAt` unset for
  legacy targets — all existing targets become active, replacing the first-3 placeholder with an
  explicit, user-editable state (alternative in Risks).

### Test Strategy

All new pure logic gets vitest coverage (Definition of Done item 3), reusing the `game(p:
Partial<GameRecord>)` helper pattern from `test/vantageCore.test.ts` and the temp-dir pattern from
`test/manualLog.test.ts`.

**`src/core/targets.ts` — grade scoring (highest-value suite):**
- N games with reviews grading target `t1` → correct `hits`/`attempts`/`hitRate`; `partial` counts
  as attempt, not hit.
- `winWhenHit`/`winWhenMissed` split from actual results; baseline fallback when one side has 0
  games; still baseline/`New · 0/0` for a target with no grades.
- Sparkline: chronological ordering, last-8 window, `hit=1/partial=0.5/missed=0` mapping, left-pad
  under 8 attempts.
- Archived target excluded from library output; grades keyed to a deleted target id are silently
  ignored; sample library only when zero authored targets exist (archived included).

**`src/core/mental.ts` — flag merging:**
- Review flags alone produce counts and calm/tilt splits; quick-log `mental` alone unchanged
  (regression); both on one game counts each flag once (OR-merge, no double count);
  `winWhenTilted` includes games tilted via either source.

**`src/core/dashboardData.ts` — inbox decoupling:**
- Old ungraded game outside `days: 7` still appears in `reviewInbox` and `pendingReviews` while
  `matches` respects the filter; graded games leave both; `pendingReviews` counts past any inbox
  cap.

**`src/store/history.ts` / `manualLog.ts` — persistence round-trips:**
- `setReview` on existing/unknown matchId (true/false), survives re-instantiation; bulk
  `setReviews` imports many with one file state and skips ids that already have reviews.
- `ManualStore`: `updateTarget` preserves `createdAt`/`isActive`/`archivedAt`; active toggle and
  archive/restore persist; `removeTarget` still deletes; legacy record without `isActive` loads as
  active.

Renderer views stay untested per current repo convention (no renderer test harness exists); their
logic is deliberately thin over the tested core fields.

### Risks & Alternatives

- **Where active/archived state lives.** Chosen: on `AuthoredTarget` in `manual.json` — it must
  drive main-side `computeDashboard` and survive reinstall/export, so renderer localStorage is
  disqualified; a separate settings file would split one entity across two stores. Trade-off:
  `manual.json` schema grows, mitigated by load-time defaulting.
- **Rule-edit history mixing.** Editing `Deaths ≤ 4 → ≤ 2` keeps accrued attempts, so the hit-rate
  blends two rule eras — explicitly accepted in screen-targets.spec.md (line 39). Alternative
  (rejected for scope): store `ruleHistory: Array<{rule, from}>` and segment sparklines; the
  additive `MatchReview.at` timestamp keeps that door open later without re-migration.
- **Legacy-target activation default.** Chosen: all existing targets become active on migration
  (simple, transparent, user can deactivate). Alternative: replicate today's placeholder by
  activating only the 3 newest — closer to current visible behavior but encodes the placeholder
  into data. If the user has many targets, the Review card gets long for one session until they
  curate.
- **Badge/inbox freshness without refetch.** The spec constraint (review.spec line 29) keeps saves
  refetch-free, so the badge is `d.pendingReviews` minus an in-memory session set — it can briefly
  diverge if a game finishes tracking mid-session, and self-heals on the existing focus-refresh
  (`shell.ts:196`). Alternative: refetch on every save — simpler, but grading would visibly
  reshuffle every dashboard number mid-inbox, which the constraint exists to prevent.
- **Demo-mode migration deadlock.** `importReviews` against an empty history would skip everything;
  clearing localStorage then loses data, not clearing retries forever. Mitigated by only migrating
  when `isSample === false`. Residual risk: reviews saved against demo matchIds are unrecoverable
  by design (they reference synthetic games).
- **Partial-grade semantics.** Chosen: attempt-not-hit (unambiguous `hits/attempts` display).
  Alternative: weight partial 0.5 into `hitRate` — richer but makes `hits/attempts` and the percent
  disagree; the 0.5 weighting is used only in the sparkline where no count is displayed.
- **Measured auto-grading is out of scope.** Measured targets remain manually graded on Review;
  only the preview badge (E) becomes truthful (`Hit when Deaths ≤ 4`). Real auto-grading needs
  reliable end-of-match `perHero` stats from GEP (`matchToGame`, index.ts:218–243, often lacks
  them) — deferred; the `TargetGrade` model already accommodates it (a future auto-grader just
  writes `grades[id]` itself).
- **Permanent delete leaves orphaned grades.** Confirmed-intended (inert). Scoring ignores unknown
  ids, so no cleanup pass is needed; risk is only cosmetic if a raw-JSON export ever surfaces them.

## WS2 — Real break reminder

(source: stream 1 of plan-settings-edges.md)

### Architecture & Approach

Keep the decision logic pure in `src/core`, the persistence in the existing config mechanism, and
the side effect (toast) at the tray edge — exactly the layering CLAUDE.md mandates.

1. **Pure streak/reminder logic — new `src/core/breakReminder.ts`.** Reuse `streak(games)` from
   `src/core/analytics.ts:194–204` (already sorts decided games desc and counts the consecutive
   run). Add a small pure state machine:
   - `DEFAULT_BREAK_REMINDER = { enabled: true, afterLosses: 2 }` — the single source of truth for
     defaults, imported by main config, `computeDashboard`, and the preview mock.
   - `nextBreakReminder(streak, settings, state) → { fire: boolean; state }`: fires when
     `settings.enabled && streak.type === 'L' && streak.count >= clamp(settings.afterLosses)` and
     it has not yet fired for this streak; re-arms when the streak type flips to `'W'`/`'none'`;
     optionally re-fires every further `afterLosses` losses (fire at 2, 4, 6 for N=2). Threshold
     clamped to 1–10.
   - Remove the fake `breakReminderAfterLosses` from `MentalSummary` (`src/core/mental.ts:12,21,51`)
     — it is config, not game-derived data, and its presence is what makes the UI lie today.

2. **Settings persistence — extend `AppConfig`** (`src/main/config.ts:14–35`) with `breakReminder:
   { enabled: boolean; afterLosses: number }`, defaulted from core in `DEFAULTS` (line 27). Deep-
   merge it in `loadConfig()` exactly like `notion` is merged at `src/main/config.ts:70`. Persist
   via the existing `saveLocalConfig(patch)` (`src/main/config.ts:81–85`) — the object is always
   written whole, so the shallow merge is safe.

3. **Edge wiring — `src/main/index.ts`.** Introduce a single `recordGame(game)` helper that wraps
   `history.add(game)` (which returns `boolean`, `src/store/history.ts:30–35`) and, on a successful
   add, computes `streak(history.all())` and runs `nextBreakReminder` against a closure-held
   `reminderState`. Call it from both ingestion paths: `addMatch()` (`src/main/index.ts:153–156`,
   fed by `feed` at 160–163) **and** the manual `logMatch` provider (`src/main/index.ts:83–98`) — a
   manually logged loss must count too. When `fire` is true, call `tray.notify('Time for a
   break?', 'That's N losses in a row — step away for a few minutes.')` —
   `TrayController.notify` (`src/main/tray.ts:55–57`) already handles `Notification.isSupported()`
   and the app icon; `app.setAppUserModelId` at `src/main/index.ts:34` means Windows toasts already
   work.

4. **Typed IPC + renderer state.** Two additions to `OwStatsApi` (`src/shared/contract.ts:143–
   159`): `getBreakReminder()` / `setBreakReminder(input)`, channels
   `settings:get-break-reminder` / `settings:set-break-reminder`, registered in `DashboardWindow`'s
   constructor next to the `notion:*` handlers (`src/main/dashboard.ts:56–59`) via two new
   `DataProvider` methods (`src/main/dashboard.ts:13–31`). For **display**, thread the effective
   settings into the dashboard payload: extend `ManualData` (`src/core/dashboardData.ts:17–19`)
   with `breakReminder?` and surface it as a new top-level `DashboardData.breakReminder`
   (defaulting to `DEFAULT_BREAK_REMINDER` when absent) — main passes `config.breakReminder` at
   `src/main/dashboard.ts:43–47`. This lets Overview render synchronously from `ctx.data` with no
   extra async fetch.

5. **Renderer copy + editor.**
   - `renderer/src/views/mental.ts:21–22` — replace the hardcoded hint in the State card with a
     real editor: an on/off toggle (`button`/checkbox from `components/primitives`) + a threshold
     `select` (1–5 losses). On change: `await bridge.setBreakReminder(...)` then `ctx.refresh()`
     (`renderer/src/views/view.ts:13`) so the whole snapshot recomputes.
   - `renderer/src/views/overview.ts:120–121` — render from `d.breakReminder`: enabled → "Break
     reminder is **on** after N losses." (`is-win` accent); disabled → "Break reminder is **off** —
     turn it on in Mental." (muted, no green badge). Never claims "on" when off.
   - `renderer/src/bridge.ts:26–43` and `src/main/preload.ts:7–22` gain the two pass-throughs; the
     preview mock (`renderer/preview/preview.ts:45–79`) implements them against `localStorage` so
     `OwStatsApi` still typechecks and the browser harness stays honest.

Sequencing: core module + tests → config → contract/preload/bridge/preview → main wiring →
renderer views → docs (README per Definition of Done).

### Affected Files/Modules

- **New:** `src/core/breakReminder.ts` (pure settings type, defaults, `nextBreakReminder`),
  `test/breakReminder.test.ts`.
- `src/core/mental.ts` — remove `breakReminderAfterLosses` (lines 12, 21, 51).
- `src/core/dashboardData.ts` — extend `ManualData` (17–19); add `breakReminder` to the returned
  `DashboardData` (31–64).
- `src/shared/contract.ts` — `BreakReminderSettings` re-export; `DashboardData.breakReminder`; two
  `OwStatsApi` methods (143–159).
- `src/main/config.ts` — `AppConfig.breakReminder`, `DEFAULTS`, deep merge in `loadConfig()`
  (66–73).
- `src/main/index.ts` — `recordGame()` helper around `history.add`; reminder state; provider
  methods `breakReminder()`/`setBreakReminder()`; pass settings into the dashboard provider path.
- `src/main/dashboard.ts` — `DataProvider` methods + `ipcMain.handle('settings:get/set-break-
  reminder')` (next to lines 56–59); pass `breakReminder` into `computeDashboard` (43–47).
- `src/main/preload.ts`, `renderer/src/bridge.ts`, `renderer/preview/preview.ts` — bridge plumbing.
- `renderer/src/views/mental.ts` (21–22 → editor UI), `renderer/src/views/overview.ts` (120–121 →
  truthful copy).
- `test/vantageCore.test.ts` — adjust `mentalSummary` expectations (31–53).

### Data Model / Interfaces

```ts
// src/core/breakReminder.ts (pure, Electron-free)
export interface BreakReminderSettings { enabled: boolean; afterLosses: number } // clamped 1..10
export const DEFAULT_BREAK_REMINDER: BreakReminderSettings = { enabled: true, afterLosses: 2 };
export interface BreakReminderState { firedAtCount: number } // 0 = armed
export function nextBreakReminder(
  s: { type: 'W' | 'L' | 'none'; count: number },   // Streak from contract.ts:29–32
  settings: BreakReminderSettings,
  state: BreakReminderState,
): { fire: boolean; state: BreakReminderState };

// src/shared/contract.ts
export interface DashboardData { /* … */ breakReminder: BreakReminderSettings }
export interface OwStatsApi {
  /* … */
  getBreakReminder(): Promise<BreakReminderSettings>;
  setBreakReminder(input: BreakReminderSettings): Promise<BreakReminderSettings>; // returns persisted value
}

// src/main/config.ts
export interface AppConfig { /* … */ breakReminder: BreakReminderSettings }
```

`MentalSummary` loses `breakReminderAfterLosses`. Persisted shape in
`%APPDATA%/Vantage/config.local.json`: `{ "breakReminder": { "enabled": true, "afterLosses": 3 } }`.

### Test Strategy

- `test/breakReminder.test.ts` (vitest, mirrors the `game()` factory pattern of
  `test/vantageCore.test.ts:11–20`):
  - fires exactly at the threshold (`L,L` with N=2), not before (`L` only) and not on the game
    after (`L,L,L` fires once, or at 2 and 4 if re-fire is adopted — pin whichever behavior is
    chosen);
  - re-arms after a win (`L,L,W,L,L` fires twice);
  - draws neither extend nor reset (documenting `streak()`'s draw filter at
    `src/core/analytics.ts:195`);
  - `enabled: false` never fires; threshold clamping (0 → 1, 99 → 10);
  - `DEFAULT_BREAK_REMINDER` equals `{ enabled: true, afterLosses: 2 }`.
- Update `mentalSummary` tests (`test/vantageCore.test.ts:31–53`) for the removed field; add a
  `computeDashboard` assertion that `breakReminder` defaults when `ManualData` omits it.
- Manual verification: `OW_SYNC_SIMULATE=1` / `OW_SYNC_REPLAY` (per CLAUDE.md dev flags) drive
  `feed()` through the same pipeline, so a simulated loss run exercises the toast without a real
  game. `npm run preview` verifies both copy states.
- No unit tests for the toast itself (Electron edge, deliberately untested like the rest of
  `src/main`).

### Risks & Alternatives

- **Default on vs. off:** plan defaults to **on** (matches the long-advertised copy and the
  product intent of the Mental screen); if notification fatigue is a concern, flip
  `DEFAULT_BREAK_REMINDER.enabled` in one place. Either default is truthful now — the guardrail is
  only "never claim on when off".
- **Re-fire cadence:** firing once per streak is the least annoying; firing every `afterLosses`
  further losses nags harder. Plan implements re-fire-every-N (a 6-loss tilt spiral is exactly when
  the nudge matters); trivially reducible to once-per-streak by dropping the modulo branch.
- **Reminder state is in-memory:** a restart mid-streak re-arms the reminder, so the next loss may
  re-fire. Acceptable (a restart is itself a break); persisting `firedAtCount` to
  `config.local.json` is the alternative if it proves noisy.
- **Global vs. filtered streak:** the reminder evaluates the unfiltered history (all
  accounts/modes), unlike the dashboard's filter-scoped `streak`. That matches "you, the human, are
  losing" intent; scoping to Competitive-only via `config.logFilter` is the alternative if QP
  losses shouldn't count.
- **Contract churn:** every `OwStatsApi` change must land in `preload.ts`, `bridge.ts`, and
  `preview.ts` in the same commit or `npm run typecheck` fails — that's a feature (the typed
  contract catches drift), just sequence it.

## WS3 — Notion database selection

(source: stream 2 of plan-settings-edges.md)

### Architecture & Approach

Three layers: a new **admin edge module** in `src/notion` (search / create / validate via the
existing `@notionhq/client ^2.2.15`, which ships `client.search`, `client.databases.create`,
`client.databases.retrieve`), a **pure schema module** shared by auto-create and validation, and
**typed IPC + a picker card** on the Notion screen. Selection persists through the existing
`config.local.json` override chain, which gives the appsettings fallback/migration for free.

1. **Pure schema — new `src/notion/gametrackerSchema.ts`** (no `Client` import, unit-testable):
   - `REQUIRED_PROPERTIES`: exactly what `NotionWriter.createMatchPage` writes
     (`src/notion/notionWriter.ts:30–57`): `Name` title; `Source`/`Account`/`Role`/`Result`/`Game
     Type`/`Queue Type` selects; `Map` relation; `Hero(es) Played` multi_select; `Eliminations`,
     `Deaths`, `Assists`, `Damage`, `Healing`, `Mitigation`, `Match Duration (min)`, `Group Size`
     numbers; `Final Score`, `Battletag`, `Match ID` rich_text.
   - `buildGametrackerProperties(mapsDatabaseId?)` → the `properties` payload for
     `databases.create` (pre-seeding select options: `Source` = Auto/Manual, `Result` =
     Win/Loss/Draw, `Role` = tank/damage/support/openQ; `Map` relation only when a maps id is
     supplied).
   - `validateGametrackerShape(properties)` → `{ ok, missing: string[], mismatched: string[] }`,
     given the `properties` map from `databases.retrieve`. Extra user columns (the subjective
     Leaver/Comms/Tilt fields mentioned in the writer docstring, `src/notion/notionWriter.ts:14–
     21`) are tolerated; `Map` is only required when a maps DB is configured.

2. **Admin edge — new `src/notion/notionAdmin.ts`** (constructor-injected `Client`, mirroring
   `MapsCache`'s pattern at `src/notion/mapsCache.ts:9–17`):
   - `listDatabases()` — `client.search({ filter: { property: 'object', value: 'database' },
     page_size: 100 })`, paginated like `MapsCache.load` (`mapsCache.ts:21–33`); returns `{ id,
     title, url }` (database objects carry `title` rich-text directly).
   - `listParentPages()` — same search with `value: 'page'` (auto-create needs a parent page; the
     API cannot create a workspace-level database).
   - `createGametracker(parentPageId)` — creates a **Maps** database under the parent, populates it
     with one page per key of `MAP_MODES` (`src/core/maps.ts:8–15`, ~31 sequential `pages.create`
     calls), then creates the **Gametracker** database with the `Map` relation pointing at it.
     Returns both ids + urls. This yields a database matching the export schema exactly — no
     `NotionWriter` changes.
   - `validate(databaseId)` — `databases.retrieve` + `validateGametrackerShape`.

3. **Persistence & fallback — `src/main/config.ts`.** Add `saveLocalNotionConfig(patch:
   Partial<NotionConfig>)` that deep-merges the `notion` key of the local file (the existing
   `saveLocalConfig` at `config.ts:81–85` shallow-merges top-level keys and would clobber sibling
   notion fields). Selection writes `gametrackerDatabaseId` + `gametrackerUrl` (and
   `mapsDatabaseId`/urls on auto-create) to `config.local.json`; `loadConfig()`'s merge
   (`config.ts:70`) already prefers local over the bundled `appsettings.json`, so a hand-edited
   appsettings id remains the fallback when nothing was ever selected — the required migration
   path, zero code. Add `notionDatabaseSource(): 'selected' | 'appsettings' | 'none'` comparing the
   raw local file against the merged config so the status card can say where the id came from.
   After a save, main does `config = loadConfig(); rebuildNotion();` (same pattern as
   `onReloadConfig`, `src/main/index.ts:112–116`) — this also keeps the tray's "Open Gametracker in
   Notion" (`index.ts:117–119`) working via the stored url.

4. **Graceful sync validation.**
   - `rebuildNotion()` (`src/main/index.ts:137–150`) constructs `NotionAdmin` alongside
     writer/maps and kicks off an async `validate()` whose result (`shapeValid`, `shapeIssues`) is
     cached in main and surfaced by `notionStatus()` (`index.ts:51–61`).
   - `MapsCache` becomes tolerant of an empty `mapsDatabaseId`: `resolve()` returns an unmatched
     `MapMatch` instead of letting `databases.query('')` throw (`mapsCache.ts:19–47`) —
     `NotionWriter` already skips the `Map` relation when `mapPageId` is absent
     (`notionWriter.ts:38`), so export degrades to "row without map link" instead of "every game
     fails".
   - `NotionExporter.export` (`src/notion/notionExporter.ts:15–40`) short-circuits when the cached
     validation failed, returning the new `ExportResult.error` (e.g. "Database is missing: Result,
     Map") instead of N silent `failed++`.

5. **Typed IPC + renderer picker.** Four `OwStatsApi` additions (channels
   `notion:list-databases`, `notion:list-pages`, `notion:select-database`,
   `notion:create-database`) registered next to the existing notion handlers
   (`src/main/dashboard.ts:56–59`) via new `DataProvider` methods. In
   `renderer/src/views/notion.ts`, add a fourth region `databaseRegion` between `setupRegion` and
   `syncRegion` (`notion.ts:13–39`), reusing the established region/`paint`/`refresh` pattern:
   - hidden note when no token; once a token is saved: "Choose database" (calls
     `listNotionDatabases`, renders rows with a Select button per DB, current selection
     highlighted) and "Create one for me" (loads `listNotionPages`, user picks the parent, confirm
     → `createNotionDatabase`, which selects it on success; show a "Creating database — this takes
     ~15s…" note while the single invoke runs).
   - `statusCard` (`notion.ts:42–73`) reasons get richer: replace line 62's "configured in
     appsettings.json" copy with "No database selected yet — pick one below or let Vantage create
     it."; add "Using database from appsettings.json (fallback)" and "Database shape mismatch:
     missing X, Y" states from the new `NotionStatus` fields; connected state shows the database
     title.
   - `syncResult` (`notion.ts:165–170`) renders `res.error` as a loss-colored line.
   - `preload.ts`, `bridge.ts`, and the preview mock (`renderer/preview/preview.ts:45–79`, canned
     lists) gain the four methods.

Sequencing: schema module + tests → NotionAdmin → config helpers → contract/preload/bridge/preview
→ main provider + validation caching → renderer picker/status → MapsCache/Exporter graceful paths →
docs.

### Affected Files/Modules

- **New:** `src/notion/gametrackerSchema.ts` (pure), `src/notion/notionAdmin.ts` (client edge),
  `test/gametrackerSchema.test.ts`, `test/notionAdmin.test.ts`.
- `src/shared/contract.ts` — `NotionDatabaseSummary`, `NotionPageSummary`, extended `NotionStatus`
  (110–121), `ExportResult.error` (101–107), four `OwStatsApi` methods (143–159).
- `src/main/config.ts` — `saveLocalNotionConfig()`, `notionDatabaseSource()` (next to 81–85).
- `src/main/index.ts` — `NotionAdmin` in `rebuildNotion()` (137–150); cached validation state;
  richer `notionStatus()` (51–61); provider methods for list/select/create.
- `src/main/dashboard.ts` — `DataProvider` + four `ipcMain.handle('notion:…')` (56–59).
- `src/main/preload.ts`, `renderer/src/bridge.ts`, `renderer/preview/preview.ts` — plumbing.
- `renderer/src/views/notion.ts` — `databaseRegion` picker card; `statusCard` states (42–73, esp.
  59–63); `syncResult` error line (165–170).
- `src/notion/mapsCache.ts` — empty-id tolerance (19–47); `src/notion/notionExporter.ts` —
  validation short-circuit (15–40).
- `src/core/maps.ts` — consumed (read-only) as the canonical map list for auto-create.

### Data Model / Interfaces

```ts
// src/shared/contract.ts
export interface NotionDatabaseSummary { id: string; title: string; url?: string }
export interface NotionPageSummary { id: string; title: string; url?: string }

export interface NotionStatus {
  tokenSet: boolean;
  databaseConfigured: boolean;
  connected: boolean;
  gametrackerUrl?: string;
  trackedGames: number;
  // new:
  databaseSource: 'selected' | 'appsettings' | 'none'; // where the id came from
  databaseTitle?: string;                               // resolved on validate
  shapeValid?: boolean;                                 // undefined = not yet checked
  shapeIssues?: string[];                               // missing/mismatched property names
}

export interface ExportResult { ok: number; failed: number; skipped?: number; unavailable?: boolean; error?: string }

export interface OwStatsApi {
  /* … */
  listNotionDatabases(): Promise<{ databases: NotionDatabaseSummary[]; error?: string }>;
  listNotionPages(): Promise<{ pages: NotionPageSummary[]; error?: string }>;
  selectNotionDatabase(databaseId: string): Promise<NotionStatus>;
  createNotionDatabase(parentPageId: string): Promise<NotionStatus>; // create → select → status
}

// src/notion/gametrackerSchema.ts (pure)
export const REQUIRED_PROPERTIES: Record<string, string>; // name → notion type
export function buildGametrackerProperties(mapsDatabaseId?: string): Record<string, unknown>;
export function validateGametrackerShape(
  properties: Record<string, { type?: string }>,
  opts?: { requireMapRelation: boolean },
): { ok: boolean; missing: string[]; mismatched: string[] };
```

Persisted (deep-merged into `config.local.json.notion`): `gametrackerDatabaseId`,
`gametrackerUrl`, and on auto-create additionally `mapsDatabaseId`. Bundled `appsettings.json`
values remain the fallback via the existing merge at `src/main/config.ts:70`.

### Test Strategy

- `test/gametrackerSchema.test.ts` (pure, no mocks): `buildGametrackerProperties()` output contains
  every `REQUIRED_PROPERTIES` entry with the right Notion type, includes the `Map` relation only
  when a maps id is given, and round-trips — `validateGametrackerShape(buildGametrackerProperties(
  id))` is `ok`. Negative fixtures: missing `Result` → listed in `missing`; `Eliminations` as
  rich_text → `mismatched`; extra user columns tolerated.
- `test/notionAdmin.test.ts` with a constructor-injected mock client (the DI pattern the survey
  recommends and `MapsCache`/`NotionWriter` already enable): `listDatabases` follows
  `has_more`/`next_cursor` pagination; `createGametracker` issues creates in order (Maps DB → one
  page per `MAP_MODES` key → Gametracker with relation to the Maps id) and returns both ids;
  `validate` maps a retrieve payload through the schema module.
- Extend exporter coverage: `NotionExporter.export` returns `{ error }` without calling the writer
  when validation failed; `MapsCache.resolve` with empty `mapsDatabaseId` returns unmatched without
  throwing (add alongside existing store-test patterns like `test/outbox.test.ts`).
- Manual verification: `npm run preview` exercises the picker card against the canned mock (list,
  select, create states); a real end-to-end pass needs a throwaway Notion workspace — validate
  picker, auto-create (check both DBs appear, maps populated), sync into the created DB, and the
  fallback path by clearing `config.local.json`'s notion key with an id present in
  `appsettings.json`.

### Risks & Alternatives

- **Notion API drift:** `@notionhq/client ^2.2.15` pins API version 2022-06-28 (`databases.*` +
  `search`), consistent with the existing `mapsCache.ts:23` / `notionWriter.ts:59` calls. Newer API
  versions split databases into data sources; upgrading the SDK later would touch this stream and
  the existing writer equally — stay on v2 for now and note it in README.
- **Auto-create cost:** populating ~31 map pages sequentially under Notion's ~3 req/s limit takes
  ~10–15s in one IPC invoke. Mitigate with the in-card progress note; alternative is a
  **single-database** variant (no Maps DB, `Map Name` as a select instead of the relation), which
  is instant but requires a `NotionWriter` branch and diverges from the documented export schema —
  kept as the fallback option, not the default.
- **Search scope:** `client.search` only returns objects explicitly shared with the integration; a
  user who shared nothing sees empty lists. The picker must render that as guidance ("Share a page
  with your integration in Notion, then retry" — mirroring step 2 of `stepList()`,
  `notion.ts:119–127`), not as an error.
- **Local override semantics:** once a database is selected, `config.local.json` permanently
  shadows `appsettings.json` (per `config.ts:70`). "Reset to config file" requires deleting the
  local key, not writing `''` — `saveLocalNotionConfig` should support key removal if a reset
  affordance is added later.
- **Validation freshness:** shape is validated at select/create and on `rebuildNotion`, cached in
  main; a user deleting a column mid-session is only caught at the next sync attempt (the export
  short-circuit re-checks). Re-validating on every `notion:status` poll is the alternative but
  burns rate limit for a rare case.
- **Title extraction duplication:** database titles live on the object (`db.title`), page titles
  inside a title property (like `extractTitle`, `mapsCache.ts:51–60`); factor a tiny shared helper
  into the admin module rather than exporting mapsCache internals.

## WS4 — Match detail page

(source: plan-match-detail.md)

### Architecture & Approach

**Overall shape.** The detail page is a new **parameterized top-level view** (`matchDetail`) that
extends the existing `ViewId`/`VIEWS` routing (`renderer/src/app/shell.ts:27`,
`renderer/src/store.ts:11-21`) with a `matchId` param, backed by a new **`matchDetail` IPC call**
that mirrors the `heroDetail` pipeline end-to-end: pure builder in `src/core` → IPC handler in
`src/main/dashboard.ts` → preload in `src/main/preload.ts` → `bridge` in `renderer/src/bridge.ts` →
view. Everything GEP cannot provide is optional in the payload and every UI section renders only
when its data exists — the page degrades section-by-section (header always renders because it
derives from `GameRecord` fields that exist today).

**Why a view, not a drawer.** The confirmed design (spec `specs/screen-matches.spec.md:18-24`) is a
full page: header + two-team scoreboard + tabs + progress + player history + gallery. The Heroes
drawer (`renderer/src/views/heroes.ts:40-46`, `renderer/src/components/overlay.ts:41-49`) is the
right *fetch* pattern (async load via bridge into a mounted host) but the wrong container for a
scoreboard of up to 10 rows × 8 columns. The routing extension is small: `AppState` gains `params:
{ matchId?: string }`, `store.setView(view, params?)`, `ViewContext.navigate` gains the same
optional param, and `matchDetail` is registered in `VIEWS` but not in `NAV` (sidebar keeps
`matches` highlighted while `state.view === 'matchDetail'` via a one-line mapping in
`renderSidebar`, `shell.ts:159-171`).

**Phasing:**

**v1 — ships from data already stored today (`GameRecord`, `src/core/analytics.ts:24-38`):**
1. `MatchDetail` type in `src/shared/contract.ts` + `matchDetail(games, matchId)` pure builder in
   `src/core/analytics.ts` (next to `heroDetail`, line 235) — looks the game up by `matchId`,
   returns metadata, per-hero stats, mental flags, and *empty/absent* scoreboard, competitive,
   playerHistory, screenshots fields.
2. IPC: `dashboard:match-detail` handler in `src/main/dashboard.ts` (mirror lines 52-54); preload
   entry (`preload.ts`); `bridge.matchDetail()`; mock in `renderer/preview/preview.ts:45-79` (one
   line, reusing the core builder — this keeps the browser preview working).
3. Routing param plumbing (store, shell, `view.ts` `ViewContext`).
4. Clickable rows in `renderer/src/views/matches.ts:23-37` (`matchRow` gains an `on: { click }` +
   `is-clickable` class, navigates with the matchId).
5. `renderer/src/views/matchDetail.ts`: back-link to Matches, header (result `pill`, map,
   `mapType` via `mapMode`, duration, heroes, relative time), **per-hero tabs** using the existing
   `segmented()` (`renderer/src/components/primitives.ts:93-114`) + `statBox` grid (heroes drawer
   precedent, `heroes.ts:56-63`), **local-player scoreboard row only** (the tracked player's line
   from `perHero` totals), **competitive section** showing the existing heuristic `Progression`
   (`src/core/progression.ts`) clearly labeled as an estimate, and **collapsed placeholder
   sections** for Player History and Screenshots per spec line 34 ("layout reserves their
   sections"). No share/publish affordance anywhere (spec line 28).
6. New `renderer/src/components/scoreboard.ts` presentational factory (two team blocks, VS
   divider, best-per-column highlight, tracked-row tint) — built in v1 against whatever entries
   exist (1 in v1, up to 5/10 after v2), so v2 is data-only.

**v2 — GEP capture upgrades (strictly GEP, all fields optional):**
1. `MatchAggregator.applyRoster` (`src/core/matchAggregator.ts:106-126`) currently *drops*
   non-local roster entries; keep a `Map<rosterKey, RosterPlayer>` of the latest snapshot per
   `roster_N` key and attach it to the finished record as `MatchRecord.roster` in `finalize()`.
   `RosterPlayer` gains optional `team` (parsed via the existing alias-tolerant `parseRoster`, line
   294 — add `team`/`team_id` aliases). Per `src/core/model.ts:35` GEP may deliver the local team
   only; the scoreboard therefore renders whatever teams arrive (one team + "opposing team not
   reported by the game feed" note when team 2 is absent). Only end-of-match-screen-visible fields
   are stored (name, hero, role, E/A/D, DMG/HEAL/MIT — all TAB-screen data).
2. Plumb already-aggregated but currently dropped fields through `matchToGame`
   (`src/main/index.ts:218-243`): `finalScore` (round score for the header, already computed at
   `matchAggregator.ts:192-194`) and the new `roster`. Extract `matchToGame` to a pure module
   (`src/core/gameRecord.ts`) so the mapping is unit-testable (Definition of Done rule 3).
3. Competitive progress capture: add candidate keys to the `K` table (`matchAggregator.ts:14-35`)
   for rank/progression info-updates, stored raw as `MatchRecord.competitive` — **gated on
   verifying real key names via the existing `OW_SYNC_RECORD=1` capture flow
   (`src/main/index.ts:171-178`) first**; until confirmed, the UI keeps the v1 heuristic fallback.
4. Duration already works (`matchAggregator.ts:179-181`); no change.
5. Extend `generateSampleGames` (`src/core/sampleData.ts`) to emit rosters/finalScore on *some*
   records and omit them on others, so demo mode exercises graceful degradation.

**v3 — player index + screenshots (best-effort):**
1. **Player History:** pure `src/core/playerIndex.ts` — derived at query time from stored
   `GameRecord.roster[]` across history (no new store, no migration): normalize names with the
   same `nameOf` logic as `matchAggregator.ts:288-291`, prefer full battleTag when present, return
   `{ name, encounters, lastSeen, results }` for players in the target match seen in ≥1 other
   match. Called inside the `matchDetail` builder; O(games × 10) over a local JSON history is fine.
2. **Screenshots:** ow-electron ships a `recorder` package name
   (`node_modules/@overwolf/ow-electron/ow-electron.d.ts:162`) but **no local typings exist**
   (`@overwolf/ow-electron-packages-types` contains only `overlay.d.ts`) — this is explicitly
   **best-effort/uncertain**. Plan: new `src/main/screenshots.ts` that (a) tries
   `app.overwolf.packages.recorder` for a still capture, (b) falls back to Electron
   `desktopCapturer` of the game window, triggered when the aggregator returns a finished record
   (hook beside `addMatch` in `src/main/index.ts:160-163`, with a ~2s delay to land on the
   end-of-match screen). Files go to `userData/data/screenshots/<matchId>/`; a sidecar list is
   stored on the record. Renderer display via a read-only custom protocol (e.g.
   `vantage-media://`) registered in main and scoped to that directory — keeps guardrail #4 (no
   remote code; local files only) and #5 (nothing leaves the device). If neither API proves
   viable, the gallery section stays permanently collapsed — acceptable per spec line 48.

### Affected Files/Modules

| File | Change | Phase |
|---|---|---|
| `src/shared/contract.ts` | `MatchDetail`, `ScoreboardEntry`, `PlayerEncounter` types; `matchDetail(matchId, filters)` on `OwStatsApi` (line 143-159) | v1 |
| `src/core/analytics.ts` | `matchDetail()` builder beside `heroDetail` (line 235); optional `roster`, `finalScore`, `competitive`, `screenshots` fields on `GameRecord` (line 24-38, all optional → old `history.json` loads unchanged via the lenient `HistoryStore.load`, `src/store/history.ts:41-48`) | v1/v2 |
| `src/main/dashboard.ts` | `dashboard:match-detail` handler mirroring `dashboard:hero-detail` (line 52-54) | v1 |
| `src/main/preload.ts` | `matchDetail` invoke entry | v1 |
| `renderer/src/bridge.ts` | `matchDetail` passthrough | v1 |
| `renderer/preview/preview.ts` | mock `matchDetail` using the core builder (line 45-79) | v1 |
| `renderer/src/store.ts` | `AppState.params`, `setView(view, params?)` (line 57-60) | v1 |
| `renderer/src/app/shell.ts` | register `matchDetail` in `VIEWS` (line 27), nav-highlight mapping (line 159-171), pass params via `context()` (line 113-122) | v1 |
| `renderer/src/views/view.ts` | `ViewContext.params`, widened `navigate` (line 8-16) | v1 |
| `renderer/src/views/matches.ts` | clickable `matchRow` (line 23-37) | v1 |
| `renderer/src/views/matchDetail.ts` | **new** — page composition from `card`/`pill`/`statBox`/`segmented`/`viewHead` | v1 |
| `renderer/src/components/scoreboard.ts` | **new** — teams/VS/best-per-column/tracked-tint factory | v1 |
| `renderer/styles/components.css`, `app.css` | scoreboard + detail-header + gallery styles | v1 |
| `src/core/model.ts` | `RosterPlayer.team`; `MatchRecord.roster`, `MatchRecord.competitive` (line 36-83) | v2 |
| `src/core/matchAggregator.ts` | retain full roster snapshots (line 106-126), attach in `finalize()` (line 176-211), candidate rank keys in `K` (line 14-35) | v2 |
| `src/core/gameRecord.ts` | **new** — `matchToGame` extracted from `src/main/index.ts:218-243`, + `finalScore`/`roster`/`competitive` mapping | v2 |
| `src/core/sampleData.ts` | rosters/finalScore on a subset of sample games | v2 |
| `src/core/playerIndex.ts` | **new** — derived encounter index | v3 |
| `src/main/screenshots.ts` | **new** — best-effort capture + `vantage-media://` protocol | v3 |
| `src/main/index.ts` | wire capture hook + protocol registration | v3 |
| `specs/screen-matches.spec.md`, `README.md` | doc updates per Definition of Done | each phase |

### Data Model / Interfaces

```ts
// src/shared/contract.ts
export interface ScoreboardEntry {
  name: string;                 // battleTag or display name, as GEP reports it
  hero?: string;
  role?: Role;
  team?: 0 | 1;                 // absent when GEP doesn't report team
  isLocal: boolean;             // tracked-player tint
  eliminations?: number; deaths?: number; assists?: number;
  damage?: number; healing?: number; mitigation?: number;
  perks?: string[];             // not in GEP today — column hidden when absent everywhere
}

export interface PlayerEncounter {
  name: string;
  encounters: number;           // prior matches (excluding this one)
  lastSeen: number;             // ms epoch
}

export interface MatchDetail {
  matchId: string;
  timestamp: number;
  account: string;
  role: Role;
  map: string;
  mapType: string;              // via mapMode()
  result: Result;
  gameType: string;
  durationMinutes?: number;
  finalScore?: string;          // v2; absent on old records
  heroes: string[];
  perHero: HeroStat[];          // [] when GEP gave no per-hero data → tabs section hidden
  mental?: MatchMental;
  scoreboard?: ScoreboardEntry[]; // v2; grouped by `team` in the renderer; absent → local-row-only
  competitive?: { note: 'estimate' | 'reported'; tier?: string; division?: number; delta?: number };
  playerHistory: PlayerEncounter[]; // [] until v3
  screenshots: string[];        // vantage-media:// URLs; [] until v3
}
// OwStatsApi += matchDetail(matchId: string, filters: DashboardFilters): Promise<MatchDetail | null>;
```

```ts
// src/core/model.ts (v2)
interface RosterPlayer { /* existing */ team?: number; }
interface MatchRecord  { /* existing */ roster?: RosterPlayer[]; competitive?: Record<string, string | number>; }

// src/core/analytics.ts (v2) — all optional, backward compatible with existing history.json
interface GameRecord   { /* existing */ finalScore?: string; roster?: RosterPlayer[];
                         competitive?: Record<string, string | number>; screenshots?: string[]; }
```

Renderer store: `AppState.params: { matchId?: string }`; `ViewId` gains `'matchDetail'`;
`navigate(view, params?)`.

### Test Strategy

Vitest, `test/*.test.ts`, core-only per existing convention:
- **`test/analytics.test.ts` (extend):** `matchDetail()` — found/missing matchId (`null`), record
  with full v2 fields vs. a minimal legacy record (asserts every optional section is absent, not
  throwing — the degradation contract), per-hero fallback when only match totals exist (mirrors
  `matchToGame` single-hero synthesis).
- **`test/matchAggregator.test.ts` (extend):** feed the `buildCompetitiveMatch` message sequence
  (`src/main/simulate.ts:16-56`) plus extra `roster_N` entries → finished record carries the full
  roster with latest-snapshot-per-slot semantics; local-player stat behavior unchanged; unknown
  rank keys ignored, candidate keys captured into `competitive`.
- **`test/gameRecord.test.ts` (new, v2):** extracted `matchToGame` maps
  `finalScore`/`roster`/`competitive`, returns `null` without an outcome (current behavior
  preserved).
- **`test/playerIndex.test.ts` (new, v3):** encounter counting across matches, name normalization
  (`Name#123` vs `name`), self-exclusion, matches-without-roster tolerated.
- **Manual/integration:** `npm run preview` — click rows, verify each degradation tier using the
  mixed sample data (some sample games with rosters, some without); `OW_SYNC_REPLAY=<capture>` to
  validate v2 aggregation against a real recorded session before trusting GEP key spellings;
  `npm run typecheck` both tsconfigs (contract change touches both sides).
- **v3 screenshots:** manual only (needs live ow-electron runtime); the capture module is wrapped
  so its absence/failure is a logged no-op, asserted by keeping it out of the pure pipeline.

### Risks & Alternatives

- **GEP roster scope is unknown for the enemy team** (`src/core/model.ts:35` says local team only;
  key spellings shift between patches, `matchAggregator.ts:10-13`). Mitigation: scoreboard renders
  per-team blocks from whatever `team` values arrive and shows an explicit "not reported by the
  game feed" placeholder; verify real payloads via `OW_SYNC_RECORD` before finalizing `K`-table
  aliases. This is compliant by construction — only TAB-screen data is stored.
- **Perks and hero-specific stats are not in GEP.** The perks column and extended per-hero stats
  are declared optional and hidden when absent; if a capture ever shows them, they slot into
  `ScoreboardEntry.perks` / an `extra` map without schema churn. Do not promise them.
- **Competitive progress may never be exposed** (progression is currently an explicit heuristic,
  `src/core/progression.ts:4-8`). The section ships in v1 labeled "estimate"; if GEP rank keys are
  confirmed it upgrades to "reported". Alternative: drop the section when filters make the
  heuristic meaningless — decided in UI review.
- **Screenshot API is unverified** — the `recorder` package name exists (`ow-electron.d.ts:162`)
  but no typings ship locally; `desktopCapturer` fallback needs the game in windowed/borderless
  mode and correct timing relative to the end-of-match screen. Entire feature is flagged
  best-effort; failure mode is the spec-sanctioned collapsed gallery. Media delivery via custom
  protocol needs a CSP check against `renderer/index.html`; alternative is small base64 thumbnails
  over IPC (simpler, heavier payloads).
- **Routing alternative — drawer instead of a view** (Heroes pattern): lower plumbing cost, but
  cramped for a 10-row scoreboard + tabs + gallery and contradicts the confirmed "dedicated detail
  page". Kept as fallback if the param-routing change proves invasive.
- **Player index derivation cost** grows linearly with history; if `history.json` gets large,
  switch from query-time derivation to a persisted index following the `ManualStore` single-JSON
  pattern (`src/store/manualLog.ts`). Also note: storing other players' battleTags is local-only
  (guardrail #5) and Notion export (`src/notion/notionExporter.ts:44` `gameToMatchRecord`) must
  **not** be extended to include rosters.
- **History file compatibility:** all `GameRecord` additions are optional and `HistoryStore.load`
  already tolerates unknown/missing fields; no migration needed. Risk of writing larger records is
  minor (10 roster entries/match).
