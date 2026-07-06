# Techplan: Feedback Batch 2026-07

**Slug:** `feedback-batch-2026-07`
**Spec:** [`feedback-batch-2026-07.spec.md`](./feedback-batch-2026-07.spec.md) (Approved 2026-07-06)
**Status:** Draft
**Date:** 2026-07-06

This is the HOW for the seven areas A–G. Every design is grounded in the current code
(file:line refs re-verified). Guardrails from `CLAUDE.md` hold throughout — notably: `core/`
stays pure and Electron-free, the renderer stays CSP-friendly (one esbuild bundle, no
`eval`/inline/remote), and **outbound Notion traffic only rides an explicit user action**.

---

## 1. Architecture & Approach

### Area A — Notion export: update-on-sync, aggregate grade, per-column diagnostics

**Root cause recap (verified):** the exporter is create-only (`notionWriter.ts` has only
`pages.create`; no `pages.update` anywhere in `src/`), it discards the created page id
(`notionExporter.ts:38-47`), marks the matchId processed forever (`outbox.isProcessed`), and
reads the improvement grade only from the internal slot
`review.grades[NOTION_IMPROVEMENT_TARGET_ID]` (`notionExporter.ts:45`) that in-app reviews
never populate (they grade `t-<timestamp>` ids). Subjective columns are written only when the
live DB defines them by exact name+type (`gametrackerSchema.ts:79-94` →
`NotionRuntime.writableColumns`), else silently skipped.

**Decision A.1 — matchId→pageId persistence, NOT query-by-`Match ID`.**
We persist a `matchId → { pageId, exportedAt, signature }` map locally and reuse `pageId`
for `pages.update`. Rationale:
- The outbox JSON store already holds per-match export state on-device, so the natural home
  for `pageId` is right there — zero new API round-trips per sync to *find* the page.
- Querying by `Match ID` at update time costs one `dataSources.query` per match (or a batched
  filter query) on every sync — slower, rate-limit-exposed, and needs a fallback map anyway.
- Robustness after the user deletes a Notion row: a stored `pageId` that 404s on update is the
  clean trigger to **recreate** (spec A2). Query-by-column would instead silently find nothing
  and re-create — but without a stored id it can't distinguish "user deleted it" from "never
  exported", so the map is the source of truth either way.
- The `Match ID` column stays written (round-trip parity for import) but is not the export
  addressing key.

**Decision A.2 — extend the outbox into a keyed export ledger, with a one-time legacy backfill.**
Replace the dead `pending`/`enqueue`/`remove`/`pending()` retry queue (`outbox.ts:65-81`, zero
callers) with a `records: Record<string, ExportRecord>` map. `isProcessed(matchId)` becomes
`records[matchId] !== undefined`; `markProcessed` is superseded by `recordExport(matchId, {
pageId, signature })`. Keep `processed: string[]` load-compatibility so existing `outbox.json`
files still read (see the legacy path below), and expose which matchIds are "legacy processed
without a ledger record" (`legacyProcessed(): string[]`) so the exporter can backfill them.

**Legacy path (the pre-upgrade scenario Area A exists to fix).** Legacy `outbox.json` holds only
`processed: string[]` (`outbox.ts:5-10`) — no pageId, no signature. This is *exactly* the case
spec A AC #3 targets: a match already exported (row exists in Notion, possibly with empty
subjective cells the user has since filled in offline) that must be **updated in place**, not
duplicated. Neither naive baseline works: "baseline = current state" never pushes the completed
review (empty cells stay empty forever); "baseline = empty" recreates every reviewed legacy row
as a duplicate. Both fail the AC. And a "signature unchanged → skip" mitigation is *incoherent*
for legacy rows because they have no stored signature to compare against.

**Resolution — one-time backfill on the first sync after upgrade.** For each matchId in
`legacyProcessed()` (in `processed[]` but no ledger `pageId`), resolve its Notion page via a
**batched `dataSources.query` filtered on the `Match ID` column** (Decision A.1 rejects
query-by-`Match ID` as the *primary/steady-state* addressing key; it is used here only as a
*one-time recovery* for rows that predate the ledger). Then:
- Query finds the page → we know the found page was created by the old create-only exporter, so
  its subjective cells are whatever that exporter wrote (typically empty for the reviewed-offline
  case). Rather than diff against unknown remote state, **do one `updateMatchPage(foundPageId,
  currentLocalState)` unconditionally** — this pushes any offline-completed subjective values into
  the existing row (AC #3: "the *existing* Notion page is updated in place … no duplicate row").
  Then record `{ pageId: foundPageId, signature: matchExportSignature(currentLocalState) }` as the
  adopted baseline. Count as `updated`. From the next sync on, normal changed-since detection
  applies (no redundant write when nothing changed). *(If the local match has no subjective
  values at all — nothing to complete — the update is a harmless no-op write of empty cells; if we
  want to avoid even that, skip the update when the current signature is empty and just adopt the
  empty baseline. Either is AC-safe; prefer skipping the empty-signature write to minimize
  outbound traffic.)*
- Query finds nothing (row truly deleted) → `create` and record the new pageId; count as
  `recreated`.
This backfill is idempotent: once a ledger record exists, the query path is never taken again
for that match. Threading the importer's pageIds at import time (Decision A.1 already carries
them) covers import-then-edit rows; the query fallback covers export-only legacy rows.

**Decision A.3 — changed-since-last-export detection via a content signature.**
Store, per exported match, a stable **export signature**: a deterministic string derived from
exactly the fields that map to Notion columns and can change after export — the derived
improvement grade (A.4) plus the merged mental flags (`exportMental` output). A pure core
function `matchExportSignature(game): string` produces it (canonical JSON of the sorted,
normalized subjective payload; scalar game facts like map/result never change post-export for
GEP rows so they're excluded to avoid needless updates, but including them is harmless if we
prefer). On sync, for each in-scope game:
- Not in ledger → **create**, store `{ pageId, signature }`.
- In ledger, `signature` unchanged → **skip** (counts as `skipped`).
- In ledger, `signature` changed → **update** the stored `pageId`; if the page is gone
  (**deleted/archived/in-trash** — see A.5 for the two distinct error shapes) → **recreate**,
  overwrite `pageId`, and flag `recreated`.
- Set: happens when a flag/grade appears (signature changes from empty→value).
- Clear: happens when a flag/grade is removed locally (signature changes value→empty); the
  update **must send explicit null/empty** for cleared columns (see Decision A.6).
"Last export" state is set on every successful create/update (`signature` written); it is
*cleared* only by `deleteImportedMatches` for imported rows or a manual outbox reset (not in
scope). This makes the whole thing idempotent: re-syncing with no local change writes nothing.

**Wiring the clear (was unspecified).** Today `deleteImportedMatches` (`dataProvider.ts:220`)
only calls `deps.history.removeImported()`; `DataProviderDeps` has **no** outbox access (the
outbox lives behind `NotionRuntime`, wired at `index.ts:107`). So the "cleared by
`deleteImportedMatches`" invariant currently has no implementation path. Concretely: `NotionRuntime`
exposes a narrow `clearExports(ids: string[])` passthrough (calling `outbox.clearExport` per id),
add it to `DataProviderDeps` (as `notion.clearExports` or a thin `clearExports` dep), and have
`deleteImportedMatches` call it with the matchIds `removeImported()` returns. Listed under Area A
in Section 2 (`dataProvider.ts` + `notionRuntime.ts`).

**Decision A.4 — aggregate-grade derivation (pure core).** New pure function in a new
`src/core/targets/aggregateGrade.ts` (exported through `targets/index.ts`):

```
aggregateImprovementGrade(review, opts): TargetGrade | undefined
```

Rule (spec A1): consider only grades for **visible authored** targets — i.e. exclude the
internal id `notion-improvement-target`. If the review has ≥1 in-app authored-target grade,
aggregate them: all `hit` → `hit`; all `missed` → `missed`; any mix or any `partial` →
`partial` (which the writer maps to Notion `partially`). A single graded target passes through
unchanged. **Precedence:** in-app aggregate wins; only when there are *no* visible authored
grades does the function fall back to the imported bookkeeping grade
`review.grades[NOTION_IMPROVEMENT_TARGET_ID]` (Area B). The exporter calls this instead of
reading the internal slot directly. The set of visible authored ids is passed in (the exporter
knows the authored targets via a new dep) so `core/` stays free of storage.

**Decision A.5 — the writer gains `updateMatchPage`.** Add `updateMatchPage(pageId, m:
ResolvedMatch)` calling `client.pages.update({ page_id, properties })`. It builds the **same**
`props` as `createMatchPage` for the subjective/grade columns, but for update it must send the
*cleared* state too (create omits absent values; update must actively blank them). Factor the
subjective-column property building into a shared private `subjectiveProps(m, { forUpdate })`
so create omits empties and update emits `{ select: null }` / `{ checkbox: false }` for
columns that are present in `writableColumns` but have no value this time.

**Page-gone detection — two distinct error shapes (both must trigger recreate).** Deleting a
Gametracker row in the Notion UI *archives* it (moves to trash; the 2026-03-11 API renames
`archived`→`in_trash`, per the version note in `notionRuntime.ts:17-25`). `pages.update` behaves
differently by state:
- **Permanently deleted / unshared** → `APIResponseError` `code === 'object_not_found'` (HTTP 404).
- **Archived / in-trash (the common "user deleted the row" case)** → `APIResponseError`
  `code === 'validation_error'` (HTTP 400), message ~"Can't update a page that is archived / in
  trash". This does **not** surface as `object_not_found`.

Treating only the 404 as recreate (as an earlier draft did) would misclassify the *common* case:
the update throws `validation_error`, the match counts as `failed`, and no recreate happens —
failing spec A2's AC ("user deletes the row → next sync recreates it"). So `updateMatchPage`
signals **recreate** on *either* `object_not_found` *or* the archived/in-trash `validation_error`.
Implementation guard against over-matching a generic `validation_error` (bad property, wrong
type, etc., which are real failures, not "page gone"): on `validation_error`, `pages.retrieve`
the page and recreate only if `in_trash`/`archived` is true; any other `validation_error` stays a
real failure. Verify the exact `code`/`message` against the pinned 2026-03-11 API during
implementation.

**Decision A.6 — clearing cells.** For each column in `writableColumns`, update always sets it
to either its value or its explicit empty form:
- `Comms`: `{ select: { name: 'positive' } }` or `{ select: null }`.
- `Improvement Target`: the mapped grade select or `{ select: null }`.
- `Leaver`: `team`/`enemy` select or `{ select: null }`.
- `Tilt` / `Toxic Mates`: `{ checkbox: true }` or `{ checkbox: false }`.
Create keeps today's omit-when-absent behavior (a blank match writes no subjective columns).

**Decision A.7 — per-column diagnostics (A3).** Extend `presentSubjectiveColumns` into a
richer pure descriptor. New pure function in `gametrackerSchema.ts`:

```
diagnoseSubjectiveColumns(properties): SubjectiveColumnDiag[]
```

For each of the 5 optional subjective columns, classify (this is **schema-level** discovery, no
writes):
- `available` — present with the right type, so it *can* be written. (Named `available`, not
  `written`, deliberately: this is a validation-time check, and no cell has necessarily been
  written for any given match — calling it `written` at discovery time is misleading.)
- `wrong-type` — present but wrong type (e.g. `Comms` is `rich_text`, expected `select`) →
  reason string.
- `near-miss` — absent under the canonical name, but a live property name matches after
  `trim()` + case-fold (e.g. `comms ` or `improvement target`) → include the actual name.
- `missing` — absent, no near-miss.
`NotionAdmin.validate` returns these; `NotionRuntime` caches them; `NotionStatus` carries
`subjectiveColumns: SubjectiveColumnDiag[]` (replacing the bare `subjectiveColumns: string[]`
in `ValidateResult`, kept internally as the writable set). The Notion screen renders them
(new small `subjectiveColumnsCard` under `statusCard`, or a section appended to `statusCard`).
This is discovery-time only, so it satisfies "shown when the user opens the Notion screen or
syncs".

**Spec A3's third reason ("no value") — where it lives.** Spec A3 lists three skip reasons:
column missing, wrong type, **no value**. The first two are schema-level (above). "No value" is
**per-sync, per-match**, not a property of the schema — a correctly-typed `available` column is
simply not written for a match that carries no value. Rather than overload the schema diagnostics
with a notion of per-match emptiness, "no value" is surfaced on the **sync side**: the
create-omits / update-clears semantics (Decisions A.5/A.6) already define it (create omits absent
values; update sends explicit null/false), and `ExportResult` counts an all-empty-subjective
match toward `skipped`. So the three reasons are covered across two surfaces — schema diagnostics
(missing / wrong-type) + sync semantics (no value) — and no `available` column is ever mislabeled
"written". *A3 is a spec addition flagged veto-able — implement it; it is cheap and directly
diagnoses the reported empty-column confusion.*

**Sync result surface.** `ExportResult` gains `updated: number` and `recreated: number` (both
optional, default 0). `syncResult()` renders extra chips; the recreate note ("N row(s)
recreated") satisfies the "row recreated → mentioned in the sync result" AC.

**Guardrail 5:** all of the above runs only inside `NotionExporter.export`, which is only
reachable from the manual "Sync N games" button → no automatic outbound traffic.

---

### Area B — Notion import: accept grades, stop flooding the Review queue

**Root cause recap (verified):** `history.addMany` dedupes by matchId and skips existing rows
whole (`history.ts:117-127`), so a grade added in Notion after the original export never
reaches the already-stored local match → it stays `!review` → pending
(`dashboardData.ts:54`). And the first grade-carrying import seeds a *visible* synthetic target
(`dataProvider.ts:198-213` + `notionImporter.ts:33-45`).

**Decision B.1 — merge flow, main-process orchestration with pure decision core.**
The importer (`notionImporter.ts`) already produces per-row `GameRecord`s carrying a
bookkeeping `review` under `NOTION_IMPROVEMENT_TARGET_ID` and/or `mental`. The merge happens in
`dataProvider.importNotion` (`dataProvider.ts:194-219`), which currently calls
`history.addMany` (new rows only). Split the imported games into:
- **new** (matchId not in local history) → `addMany` as today (already-reviewed rows arrive
  reviewed; that's B2's "arrive already reviewed").
- **existing** (matchId already local) → a new `history.mergeImported(entries)` bulk op.

`mergeImported` (new `HistoryStore` method, one transaction) applies, per entry, the pure
decision from a new core function:

```
// src/core/notionMerge.ts (pure)
mergeImportedIntoLocal(local: GameRecord, imported: GameRecord): {
  review?: MatchReview;   // set only when applying a bookkeeping grade
  mental?: MatchMental;   // set only when adopting flags
} | null                  // null = nothing to change
```

Rules (spec B1):
- **Grade:** if `local.review` is `undefined` **and** `imported.review` carries a
  `NOTION_IMPROVEMENT_TARGET_ID` grade → produce a bookkeeping `review` (B2). If `local.review`
  exists → never touch it (local wins), even if the Notion grade differs.
- **Mental:** if `local.mental` is `undefined` (no mental record *at all*) **and**
  `imported.mental` exists → adopt `imported.mental` wholesale. If `local.mental` exists → keep
  it entirely (local wins, even for individually-unchecked flags).
- If neither applies → `null` (no write, counts toward `skipped`).
The store method writes only the returned keys via the existing `editManual` semantics
(review/mental patch). `importedAt` is **not** stamped on a merge (the local row keeps its own
provenance — it was already tracked/hand-logged; only genuinely-new rows are stamped
`importedAt`). This keeps `removeImported` from later deleting a live match just because a grade
was merged onto it.

*Note (spec):* if the user clears a review locally (`clearReview`), a later import re-applies
the Notion grade — intended, falls straight out of "local.review === undefined".

**Decision B.2 — hidden bookkeeping, no visible target, anywhere.**
Keep the internal id constant `notion-improvement-target` and the bookkeeping-review shape
(`{ grades: { [ID]: grade }, flags: {} }`). Remove all *visible* surfacing:
- **Do not seed** `notionImprovementTarget` on any path. Delete the seeding block
  (`dataProvider.ts:208-213`) and the `seededBefore` guard becomes moot for seeding (kept only
  if still used elsewhere — it isn't, so remove `notionImprovementTarget` export usage from the
  provider). `notionImporter.ts:33-45` (`notionImprovementTarget`) is deleted; the ID constant
  stays (importer + exporter + merge all reference it).
- **Exclude the internal id from every target-listing surface.** Enumerated below (all found):
  1. `src/core/targets/scoring.ts` `buildTargets` — filter out any authored target whose id ===
     `NOTION_IMPROVEMENT_TARGET_ID` before scoring (defense in depth; with B.3 no such target
     exists, but a stale one on an un-migrated store must never render). `core/` can't import
     from `src/notion/`, so the constant moves to `src/core/targets/types.ts` (or a new
     `src/core/targets/notionBookkeeping.ts`) and `notionImporter`/`notionExporter` import it
     from core. **This is a required refactor** (guardrail 3: notion edge may import core, not
     vice-versa).
  2. `buildTargets` scoring already keys by `t.id`; since no target has the internal id, its
     grades are simply never counted toward any visible target's `hitRate`/`attempts` — so
     "target success-rate stats unaffected by imported grades" holds automatically once the
     synthetic target is gone. The filter in (1) guarantees it even if a legacy target lingers.
  3. Review screen (`renderer/src/views/review.ts:39`) grades `d.targets.filter(active &&
     !archived)` — driven entirely by `buildTargets` output, so excluding it there covers it.
  4. Targets screen — same `d.targets` source; covered.
  5. `log-match.ts:121` active targets — same `ctx.data.targets` source; covered.
- **Reviewed, not pending:** a match carrying only the bookkeeping review has `g.review` set →
  `dashboardData.ts:54` counts it reviewed (not pending). This already works; we're just no
  longer showing a target for it. ✔

**Decision B.3 — migration (delete seeded synthetic target by id).**
One-time, idempotent, main-process. Add `ManualStore.removeTarget(NOTION_IMPROVEMENT_TARGET_ID)`
call gated behind a config flag so it runs once. Options considered: (a) run
`manual.removeTarget(ID)` unconditionally on every launch (removeTarget is a no-op when absent
— cheapest, no new flag) vs. (b) a `config.migrations` marker. **Decision: (a)** — matching by
**id** removes only the synthetic target; a user-authored target that merely shares the *name*
"Improvement Target" has a different id (`t-<timestamp>`) and is untouched. Stored grades on
matches are never read/written by this. Wire it in the composition root
(`src/main/index.ts`) right after `ManualStore` construction, or inside `ManualStore.load()`
(prefer the composition root to keep the store dumb). This satisfies the "existing install +
user-authored same-name target → only synthetic gone, grades intact" AC.

**Decision B.4 — round-trip symmetry.** The bookkeeping grade is exactly what
`aggregateImprovementGrade` (A.4) falls back to when there are no visible authored grades, so a
match whose only review is import-created exports/updates its `Improvement Target` cell. ✔

---

### Area C — Choose the data folder (first run + Settings), full-data migration

**Root cause recap (verified):** only `history.db` relocates (`history.ts:243-272`,
`main/index.ts:189-212`); `manual.json`, `outbox.json`, `rankAnchors.json`, `screenshots/`,
and legacy `history.json` are pinned to `userData/data` (`main/index.ts:71-72,99-102`). No
first-run step. Config key `historyDbFolder` (`appConfig.ts:65`); resolver
`resolveHistoryDir` (`historyLocation.ts`); loud-fail on bad configured dir
(`index.ts:82-93`).

**Decision C.1 — rename the config key `historyDbFolder` → `dataFolder`, with back-compat.**
The folder now holds *all* data files, so the name should reflect that. `loadConfig` reads
`dataFolder` but falls back to a legacy `historyDbFolder` value (adopt-on-read): if
`dataFolder` is absent and `historyDbFolder` is present, treat it as `dataFolder`. Persist
under `dataFolder` going forward. A stale `historyDbFolder` in an old config is thus honored,
not orphaned. Update `AppConfig`, `DEFAULTS` (both absent → default), and
`resolveHistoryDir` → rename to `resolveDataDir` (pure; unchanged logic, new name), keeping a
thin `resolveHistoryDir` alias only if other callers exist (none besides index.ts).

**Decision C.2 — generalize relocation into an all-files migration (new pure planner +
main-process executor).**
The set of movable data artifacts (all live under one data dir):
- `history.db` (SQLite — needs the DB handle closed before move; `HistoryStore` owns it)
- `manual.json` (+ `manual.tmp.json` if present — ignore tmp; it's transient)
- `outbox.json`
- `rankAnchors.json`
- `screenshots/` (directory, recursive copy)
- legacy `history.json` (frozen backup — move when present)

**Pure core** (`src/core/dataMigration.ts`, Electron-free, fs-injected or path-only):
`planDataMigration(files, fromDir, toDir)` → an ordered list of copy operations + which are
optional; and `isVantageDataDir(dir)` (a dir "already contains Vantage data" iff it has
`history.db`). Keep the *fs* work in a **`src/store/` module** (`src/store/dataMigration.ts`) — **not** `src/main/`.
Per CLAUDE.md, `src/store/` is the local-persistence layer and every store there (`outbox.ts`,
`history.ts`, `manualLog.ts`, `rankAnchors.ts`, `historyLocation.ts`) is Electron-free and
dir-injected precisely so `test/` can drive it with temp dirs — exactly what Section 4's executor
tests need (mirroring `historyStoreSqlite.test.ts`). Putting a unit-tested, Electron-free fs
module under `src/main/` (which is composition-root wiring) would be inconsistent with the layout;
`historyLocation.ts`, the closest analogue, already lives in `src/store/`. The executor takes the
data dirs and live store handles as arguments; `src/main/index.ts` only *wires* it. The pure
decision logic (what to move, adopt vs. migrate, ordering) stays in `src/core/dataMigration.ts`.

**Executor guarantees (spec C2, copy-verify-then-delete):**
1. Refuse if `toDir` already holds Vantage data unless the caller passed `adopt: true`
   (Settings offers adopt-or-cancel; first-run adopts automatically).
2. `mkdir -p toDir`; for each present source file, **copy** (works across drives), then
   **verify** (file exists + size matches; for the DB, re-open it at the new path and confirm
   `count()` reads — reuse `HistoryStore.relocate`'s copy-then-open-copy pattern, generalized).
3. Only after *all* copies + verifies succeed, **commit**: repoint every store to `toDir`,
   persist `config.dataFolder = toDir`, **then delete originals**. Ordering matters on Windows:
   because SQLite handles keep files locked (`history.ts` docblock), delete only *after* the
   stores are repointed (their old-dir handles closed). Retry any file that fails to delete
   (short bounded retry — a just-closed handle may linger briefly). Spec C2 says the old location
   is left "without stale copies", so this is not pure best-effort: if any originals still can't
   be removed, **surface it in the migration result** (`{ ok: true, leftovers: N }` →
   Settings shows "N file(s) couldn't be removed from the old folder") rather than silently
   leaving them. Migration still counts as succeeded (data is safely at `toDir`); the leftover
   count is informational so the user can clean up manually.
4. Any failure before commit → delete partial copies in `toDir`, leave `fromDir` fully intact,
   surface the specific error. Never overwrite.

**Store repointing.** Today `OutboxStore`, `ManualStore`, `RankAnchorStore`, `ScreenshotService`
are constructed once against `dataDir` in the composition root and never move. Two options:
(a) give each a `relocate(newDir)` like `HistoryStore` (they're JSON-file stores; reopen is
trivial — re-point `this.file`/`this.tmp` and reload), or (b) reconstruct them after migration.
**Decision: add `relocate(newDir)` to each store** (symmetry with `HistoryStore`, and they hold
in-memory state that reconstruction would reload anyway). `ScreenshotService` gets a
`relocate(newDir)` that updates its root and re-registers the protocol mapping if needed.
The composition root holds mutable `let dataDir` and passes a single migration function to the
provider.

**Decision C.3 — the pointer stays in `userData`.** `config.local.json` remains at
`app.getPath('userData')` (`appConfig.userConfigPath()`), unchanged. Only the data *files* move.
This already holds (C3 is a non-change assertion) and is preserved by C.1/C.2.

**Decision C.4 — first-run step integrated into the existing firstRun sequence.**
Today `shell.ts:206` shows `openFirstRunPrompt` (demo choice) when
`demoPreference === 'unset'`, then the tour. The data-location step must run **before
meaningful data is written** and alongside the demo prompt. Design:
- A new renderer step `openDataLocationPrompt(onDone)` (mirrors `firstRunPrompt.ts`): default
  (`userData/data`, preselected) or "Choose folder…" → native picker via a new IPC
  `chooseFirstRunDataFolder()` that validates (creatable+writable) and, if the folder already
  holds `history.db`, **adopts** it (restore-from-backup) without migrating. Invalid choice →
  specific reason, re-prompt, nothing written.
  - **Carries the same neutral sync note as the Settings card (spec C4).** The first-run prompt
    is the *most likely* place a user first points Vantage at a OneDrive/Dropbox folder, so its
    copy must include the one-line note ("synced folders are great for backup; use from one
    machine only — editing the synced files from two machines at once can corrupt them"). Both
    folder-choosing surfaces (this prompt and the Settings "Data storage" card, C.5) carry it.
- Sequence in `shell.ts` `maybeFirstRun`: run the data-location step first, then the demo
  prompt, then the tour (chain the callbacks). Gate it on a new first-run signal (below).
- **First-run detection (C5) — file existence is NOT usable here.** A tempting rule ("no
  `history.db` in the resolved data dir") **cannot** work at the point we evaluate it. The
  composition root opens `HistoryStore` during main-process startup (`history.ts:95-99` →
  `this.open()`, wired at `main/index.ts:77-80`), and opening the DB *creates* `history.db`
  before the renderer ever asks for the dashboard payload / `getDataLocation`. So on a fresh
  install the file already exists by the time the flag is computed, and any "no history.db"
  clause is **always false** → the first-run prompt would never appear (fails C1's AC).
  **Chosen rule (config-driven, self-clearing):** `firstRunNeedsDataChoice = true` iff **no
  `dataFolder` key (nor the legacy `historyDbFolder`) has ever been persisted in config AND the
  store is empty (`history.count() === 0`)**. We do *not* look at file presence. On first choice
  we persist `dataFolder` explicitly (even when the user keeps the default), so the flag
  self-clears and never re-triggers — even if the user later deletes all data. Existing installs
  already carry data (store non-empty) or a persisted folder → false → no prompt, data stays put.
  (If a pre-construction snapshot is ever wanted instead, capture "did `history.db` exist before
  we opened the store?" in the composition root *before* `new HistoryStore(...)` and thread that
  boolean through — but the config-key rule is simpler and is the one we adopt.)

**Decision C.5 — IPC additions.** New endpoints on `OwStatsApi` (+ channels, + provider):
- `getDataLocation(): Promise<DataLocation>` — `{ folder, isDefault, needsFirstRunChoice }`
  (renames/extends today's `getDatabaseLocation`; keep the old channel name working or migrate
  its single caller in `settings.ts`).
- `chooseDataFolder(): Promise<DataLocationResult>` — Settings "Change…": picker → if target
  holds Vantage data, return `{ ok: true, requiresAdopt: true, location }` so the renderer can
  show adopt-or-cancel, then a follow-up `adoptDataFolder(folder)` / `migrateDataFolder(folder)`;
  otherwise migrate straight away. (Alternatively a single call with an `adopt?: boolean` arg
  and a two-phase renderer confirm — pick the two-phase single-arg shape to keep channels
  minimal: `chooseDataFolder()` returns `requiresAdopt`, and `setDataFolder({ folder, adopt })`
  commits.)
- Settings card renamed **"Data storage"** (from "Data & backup"), copy updated to mention all
  files move, plus the C4 neutral sync note ("synced folders are great for backup; avoid two
  machines writing at once" — the card already carries a near-identical line
  `settings.ts:69-71`, so just keep/trim it).

**Decision C.6 — adopt semantics.** Adopt = repoint stores to the chosen folder and persist
`dataFolder`, **no copy, no delete** of either side. First-run adoption is automatic when the
picked fresh-install folder already has `history.db`. Settings adoption is explicit
(adopt-or-cancel). "Current data stays intact in the old location" — yes, adoption never
touches the old dir.

NSIS/installer changes are out of scope (C5).

---

### Area D — Filter bar rework: competitive-only, real seasons, no account filter

**Root cause recap (verified):** the mode filter contradicts the product; `shouldLog`
(`matchFilter.ts:42-53`) is dead (no callers), so `matchPipeline.ts:54-76` records all game
types despite `logFilter: 'Competitive'`. Season filter only knows `'season'` = current
(`dashboard.ts:20`); `season.ts` has 2026 dates but no enumeration/labels. Account filter
duplicates the switcher.

**Decision D.1 — competitive-only everywhere.**
- **Capture gate (new).** In `matchPipeline.recordGame` (or `addMatch`, before `history.add`),
  classify via `classifyGameType(game.gameType)` and drop non-`competitive`. Put the predicate
  in `core/matchFilter.ts` as a new pure `isCompetitive(gameType): boolean` (=
  `classifyGameType(...) === 'competitive'`); the pipeline (edge) calls it. Manual logs always
  pass `gameType: 'Competitive'` (see below) so they're never dropped. Rationale for gating in
  the pipeline: it's the single choke point for both live GEP and manual/simulate/replay
  (`matchPipeline.ts:80-85` `feed`; `recordGame` is also the manual entry via
  `dataProvider.recordGame`). Gate in `recordGame` so *every* path is covered, but allow manual
  competitive through — since manual logs are forced competitive, a blanket
  `recordGame` gate is safe.
- **Reading side.** Existing non-competitive rows stay in the DB but must be invisible. Filter
  them out centrally: in `computeDashboard`, run `all` through
  `all.filter(isCompetitive)` **once at the top**, and use that competitive-only list
  everywhere `all` is used (counts, `totalGamesAllTime`, `pendingReviews`, readiness,
  `applyFilters`, options). This is the smallest change that makes "everything competitive"
  true across all stats without touching each analytic.
- **Readiness + break-reminder interaction (explicit decision).** Both currently run over the
  **unfiltered** history: readiness via `safeReadiness(all)` (`dashboardData.ts:98-101`,
  documented as per-person fatigue over unfiltered history) and the break-reminder loss-streak
  via `streak(deps.history.all())` in the pipeline (`matchPipeline.ts:54-63`). If `computeDashboard`
  now passes the competitive-only list to `safeReadiness`, an existing user with non-comp rows can
  see their readiness verdict change after this update — even though Area E states readiness is
  unaffected by filters/accounts. **Decision (accepted per D1): readiness and the break reminder
  are henceforth computed over competitive games only.** The capture gate (above) already drops
  non-competitive at `recordGame`, so `history.all()` is competitive-only for all *new* rows and
  the streak is naturally competitive going forward; the reading-side filter makes readiness
  competitive-only for *existing* rows too. This is consistent (everything is competitive), and E's
  "unaffected by filters/accounts" still holds — readiness is unaffected by the *filter bar*, just
  computed over the (now competitive-only) full history. Note this in the E cross-reference. (If we
  ever want readiness over the truly-unfiltered set, pass the pre-`isCompetitive` list explicitly
  to `safeReadiness` — but that contradicts "everything competitive", so we do not.)
- **Drop `byMode` from the payload.** `DashboardData.byMode` (`dashboard.ts:94`, computed at
  `dashboardData.ts:80` via `byMode(games)`) is consumed by **no renderer view** (verified by
  grep — only the definition/emission exist). With the mode filter gone it would be a constant
  single group anyway. Remove `byMode` from `DashboardData` and stop computing it in the same
  Wave 0a contract edit; drop the now-unused `byMode` import from `dashboardData.ts:7` (the
  `analytics` `byMode` grouping helper itself can stay, it is harmless and cheap to keep). `exportNotion` similarly scopes to
  competitive (the IPC handler passes `applyFilters(provider.games(), …)`; add the competitive
  filter there too, or have `provider.games()` return competitive-only — **decision: filter in
  `computeDashboard` and in the export/heroDetail/matchDetail handlers via a shared
  `competitiveOnly(games)` helper**, rather than mutating `provider.games()`, so
  match-detail-by-id can still open a hidden row if ever needed. Simplest consistent choice:
  add `competitiveOnly` filtering wherever `provider.games()` feeds a computed surface).
- **Remove the mode filter** from the filter bar UI (`view.ts:40-42`), from `summarizeFilters`
  / `activeFilterCount` / `sameFilters`, and from `DashboardData.filters`/`options.modes`
  emission where it drives the removed UI. Keep `DashboardFilters.mode` in the contract? — see
  D.4/persistence: **drop `mode` from `DashboardFilters`** since nothing consumes it after the
  UI is gone and `applyFilters`'s mode branch (`dashboardData.ts:118`) is removed. Old persisted
  `mode` keys are ignored on load (they're extra keys on a `Partial<DashboardFilters>` parse —
  harmless) and dropped on next persist (we persist the new shape).
- **Remove `logFilter` + `OW_SYNC_FILTER`.** Delete the `logFilter` field from `AppConfig` +
  `DEFAULTS` (`appConfig.ts:46,71`), the `appsettings.json:3` key, and the env override
  (`appConfig.ts:120`). `loadConfig` ignores an unknown `logFilter` in user config
  automatically (it's just not read; `stripHelp`/spread keep unknown keys out of typed
  access). Delete `shouldLog` (dead) and the `LogFilter` type (`model/enums.ts:14`) once no
  references remain. `matchFilter.test.ts` loses its `shouldLog` cases; add `isCompetitive`
  cases.
- **Manual quick-log loses its mode picker.** In `log-match.ts`: remove `MODES`, the `modeField`
  (`:226-228`), and any mode-derived branching — but the competitive-only rank block
  (`paintRank`) currently keys off `state.mode === 'Competitive'`. Since everything is
  competitive now, always show the rank/SR block. `logMatch` always sends
  `gameType: 'Competitive'`. `LogPrefillPref.mode` in `prefs.ts` becomes vestigial — keep the
  field for back-compat read, stop writing it (or drop it; dropping requires the prefs shape to
  tolerate the missing key, which it does). **Decision: drop `mode` from `LogPrefillPref`** and
  from the `logPrefill` write; an old stored value is ignored.

**Decision D.2 — season enumeration + labeling API (new, pure, in `season.ts`).**
Add, without changing existing `seasonStart`/`currentSeason`/`SEASON_CADENCE_MS`:

```
export interface SeasonWindow {
  id: string;        // stable addressing key, e.g. 'S:2026-06-16' (the start ISO)
  start: number;     // inclusive
  end: number;       // exclusive
  label: string;     // '2026 Season 3' | 'Feb 10 – Apr 14, 2026' (pre-2026 fallback)
  year: number;
  seasonOfYear: number; // 1-based, resets each calendar year
}

// The season containing `now`, always addressable.
export function currentSeasonWindow(now: number): SeasonWindow;

// All season windows that intersect any timestamp in `timestamps`, newest first,
// with the current season always included. Used to build the filter options.
export function seasonsForData(timestamps: number[], now: number): SeasonWindow[];

// The window for a given season id (or undefined if not addressable), for applyFilters.
export function seasonWindowById(id: string, now: number): SeasonWindow | undefined;
```

Labeling rule (spec D2, verified dates): iterate `SEASON_STARTS` (+ extrapolated future
starts) and, **per calendar year of the start**, number them 1,2,3… resetting at each year
boundary. So `2026-02-10` → "2026 Season 1", `2026-04-14` → "2026 Season 2", `2026-06-16` →
"2026 Season 3"; the first extrapolated 2027 season → "2027 Season 1". Pre-2026 seasons (if
data ever exists there) → date-range label (`'Aug 20 – Oct 15, 2024'`), no legacy numbering
(out of scope). The `year`/`seasonOfYear` counter is computed by walking the season grid from
the first known start (and backward for the defensive pre-table case) so extrapolation stays
consistent. `id` is the season start ISO (stable, survives label changes if the calendar is
updated). `seasonsForData` enumerates season windows covering `[min(timestamps), now]`, keeps
those with ≥1 timestamp inside, always unions the current one, sorts newest-first. **List does
not depend on the account switcher** — callers pass the full competitive history's timestamps
(all accounts), per Resolved Q13.

**Decision D.3 — contract change for addressing a specific season.**
`DashboardFilters.days` becomes:

```
days?: number | 'all' | { season: string };  // N-day window | all time | a specific season id
```

Rationale for the `{ season: id }` object over a bare `season:<id>` string: it's
self-describing, avoids string-prefix parsing, and the discriminated union types cleanly in
`applyFilters`. A persisted **legacy `'season'`** string (old current-season sentinel) maps to
the current named season on load (renderer migration, D-persistence below); a persisted
`{ season: id }` whose id is no longer offered falls back to the default `30`.

`applyFilters` (`dashboardData.ts:114-127`) branch:
- number → rolling window (unchanged).
- `'all'` → no cutoff.
- `{ season: id }` → `const w = seasonWindowById(id, now)` → filter
  `g.timestamp >= w.start && g.timestamp < w.end`; if `w` is undefined (unknown id), fall back
  to the 30-day window (defensive; the renderer normally never sends an unlistable id, but IPC
  is untrusted).

**Decision D.3b — filter-bar UI (`view.ts`).**
- Remove the Account `filterField` (`:34-36`) and the Mode `filterField` (`:40-42`).
- Season field: options become `Last 7 days`, `Last 30 days`, one option per
  `d.options.seasons` (new payload field: `SeasonWindow[]` minus start/end if we prefer a
  slimmer `{ id, label }[]`), newest first, then `All time`. The `<select>` value encodes the
  season id (`season:<id>`); `onChange` maps `'7'|'30'`→number, `'all'`→`'all'`,
  `season:<id>`→`{ season: id }`.
- `DashboardData.options` gains `seasons: Array<{ id: string; label: string }>` (drop
  `modes`; keep `accounts` — still used by the account switcher popover in the shell — and
  `roles`). `DashboardData.filters` drops `mode`; `account` stays (switcher-driven).
- Role filter stays. Reset (`view.ts:51-56`) operates on `{ role, days }` (+ account left as-is
  — reset shouldn't change the active account since that's the switcher's job; **decision:
  reset restores role+days to defaults and leaves account untouched**). `FILTER_DEFAULTS`
  (`store.ts:80`) drops `mode`; `days` default stays `30`; `account` stays `'all'`.

**Decision D.4 — persistence + preset migration (renderer).**
- `vantageFilters` (localStorage, `store.ts:165-179`): on load, strip `mode`; map a legacy
  `days: 'season'` → the current season id (`{ season: currentSeasonWindow(now).id }`); if a
  persisted `{ season: id }` is not in the freshly-computed list, fall back to `30`. Since the
  season id depends on `now` and the offered list depends on data (only known after the first
  dashboard fetch), do the "unlistable → default" reconciliation when the first payload arrives
  (compare against `data.options.seasons`), not at cold load. At cold load only strip `mode` and
  translate the `'season'` sentinel. Persist the new shape on next `setFilters`.
- `filterPresets` (`prefs.ts:20-23`, `FilterPresetPref`): on load/apply, strip `mode` and
  `account` from each preset's `filters` (applying an old preset leaves the active account
  unchanged — we simply don't send `account`). Rewrite the preset to the new shape on next
  persist (when the user saves/edits presets, or eagerly: migrate-on-read and re-`prefs.set`).
  `sameFilters`/`summarizeFilters`/`activeFilterCount` (`view.ts:92-108`) updated to the
  `{ role, days }` shape (+ account only if still part of preset equality — drop it).

---

### Area E — Readiness view: drop schematic, exempt from filters, explainer popup

**Root cause recap (verified):** schematic lives in `chartCard` (`readiness.ts:121-130` via
`supercompensationSchematic`, `readinessChart.ts:78-104`). Readiness data is already computed
over unfiltered history (`dashboardData.ts:97-102`, `safeReadiness(all)`). The global filter
bar renders on every screen (`shell.ts:210-215`) with no per-view suppression.

**Decision E.1 — remove the schematic from the main view.** Delete the
`supercompensationSchematic()` call and its explanatory `<div>` from `chartCard`
(`readiness.ts:121-130`), leaving just the `readinessChart` + a short caption. The
`supercompensationSchematic` export stays (moved into the modal, E.3).

**Decision E.2 — per-view "hide filter bar" capability (smallest clean design).**
The shell already has the hook: `filterHost` carries a `hidden` class toggled in
`renderFilters` (`shell.ts:88,211-215`). Add a static per-view flag rather than a new context
mechanism:
- A `const FILTERLESS_VIEWS: ReadonlySet<ViewId> = new Set(['readiness'])` in `shell.ts`.
- `renderFilters(state)` toggles `hidden` on `!state.data || FILTERLESS_VIEWS.has(state.view)`.
This is the minimal change — no view API surface, no per-view opt-in plumbing, one set to grow
later. Readiness is account-agnostic in its data (`safeReadiness(...)` is not scoped by
`filters.account`), so switching accounts leaves the verdict/signals/trend unchanged — the AC
holds without further work. **Cross-reference D.1:** post-D, `safeReadiness` is fed the
**competitive-only** history (not the truly-unfiltered set), an accepted consequence of
"everything competitive" — readiness stays unaffected by the *filter bar*, but a user with
pre-existing non-comp rows may see the verdict shift once after this update. That is intended. (The off-state
`disabledView` renders under the same shell, so it's likewise filter-bar-free.)

**Decision E.3 — "How is this calculated?" modal (`openModal`).**
Add a clickable affordance to `verdictCard` (`readiness.ts:48-70`) — a small inline-link
button "How is this calculated?" opening `openModal(() => methodologyContent())`. The modal
content (a new `readinessMethodology()` builder, composed from `components/` + existing chart)
covers, per spec E3: verdict bands (reuse the `BAND` map), contributing signals and meanings,
the training-load model (acute load vs baseline ratio — reuse copy from `loadCard`), the
supercompensation model **including `supercompensationSchematic()`** (moved here), confidence
levels, and the honesty disclaimer (reuse `honestyCard` copy). It closes via Escape, backdrop
click, or a close button — `openModal`'s `mountOverlay` already gives Escape+backdrop; add a
close button inside the content (like `openDrawer` does) or rely on the two built-in dismissals
plus a visible "Close" button calling `close`. The modal is CSP-safe (pure `h()` composition,
inline SVG). The `honestyCard`/`chartCard` on the main view: keep `honestyCard` (E4 says other
cards stay) or fold its text into the modal — **decision: keep the short honesty note on the
main view AND include the fuller methodology in the modal** (spec E3 wants the modal to be
comprehensive; E4 keeps existing cards).

**Decision E.4 — everything else stays.** Trend chart + all cards remain; disabled off-state
unchanged except no filter bar (covered by E.2).

---

### Area F — Matches list: configurable info + clean meta line

**Root cause recap (verified):** `matches.ts:108` hardcodes `role · heroes-or-'—' · account`
(the `—` placeholder yields `Damage · — · account`); `:112` shows a per-row `gameType` label
(constant noise under D1). `MatchRow` (`dashboard.ts:41-54`) has `durationMinutes` but no
`srDelta`/`finalScore`.

**Decision F.1 — per-field display-mode model (renderer prefs).**
Six configurable fields with a canonical order: `role · heroes · account · srDelta · duration ·
finalScore`. Each has a mode `'hidden' | 'inline' | 'column'`. Prefs (new `prefs.ts` field):

```
type MatchFieldMode = 'hidden' | 'inline' | 'column';
type MatchColumnKey = 'role' | 'heroes' | 'account' | 'srDelta' | 'duration' | 'finalScore';
interface MatchColumnsPref { [k in MatchColumnKey]: MatchFieldMode }
// default: heroes/account/srDelta = 'inline'; role/duration/finalScore = 'hidden'
```

Add `matchColumns: MatchColumnsPref` to `PrefsShape`. A missing/partial stored value merges
over the defaults (so new fields get sane defaults). Always-visible fields (map, W/L result,
map-type pill, game time) are **not** configurable and are not in this model.

**Decision F.2 — persistence.** Via the existing `prefs` localStorage facade
(`prefs.ts:45-68`) — same hardening (failures degrade to defaults). No IPC; purely renderer.

**Decision F.3 — customize-view UI (existing popover primitive).**
Add a "Customize view" button to the Matches `viewHead` actions
(`matches.ts:29` → pass `actions` to `viewHead`). It opens `openPopover(anchor, …)` (the same
primitive the account switcher and GEP popover use) containing, per field, a 3-way segmented
control (`hidden/inline/column`) reusing the `segmented`/`choiceSegment`-style component. On
change: write `prefs.set('matchColumns', …)` and `store.rerender()` (no refetch — the row data
is already present; only layout changes). This is CSP-safe and reuses `components/`.

**Decision F.4 — row layout.**
The row is a flex container (`.match-row`): `[result badge][.row-main][pills group][time]`
(`matches.ts:98-115`). Column mode needs vertically-aligned columns across rows. Approach:
- **Inline fields** render in `.row-meta` (the meta line under the map name), joined per F3.
- **Column fields** render as fixed-width cells inserted into the row's flex layout, in
  canonical order, **between** `.row-main` and the always-visible pills/time group. Each column
  cell has a fixed `min-width`/`flex-basis` and consistent text-align so cells line up down the
  list (CSS class `.match-col` + per-field width classes). An empty value → a blank cell that
  preserves width (alignment). Add the CSS to `components.css`.
- Because every row uses the same set of column fields (driven by the single pref), widths are
  uniform and columns align without a table — a flex grid of equal-basis cells suffices. If
  perfect alignment across variable-width content proves fiddly, fall back to CSS
  `display: grid` on `.match-row` with template columns derived from the active column set; but
  the fixed-basis flex-cell approach is preferred for the smallest diff.

**Decision F.5 — meta-line join logic (F3).**
Build the inline segments as an ordered array of `{ node | text }` for only the fields whose
mode is `'inline'` **and** whose value is non-empty (heroes: the hero cross-links if any, else
the field is treated as empty → omitted; account: the label; role: `roleLabel`; srDelta: signed
colored; duration: `${n}m`; finalScore: as recorded). Join with `' · '` **only between present
segments** — no leading/trailing/doubled separators, never a `—` placeholder. If zero inline
segments → **omit `.row-meta` entirely** (no empty element). The current
`heroLinks = [...] : ['—']` placeholder logic (`matches.ts:88-97`) is replaced.

**Decision F.6 — MatchRow contract + `toMatchRow`.**
`MatchRow` gains `srDelta?: number` and `finalScore?: string`. `toMatchRow`
(`dashboardData.ts:139-154`) copies `g.srDelta`/`g.finalScore` when present (spread-guarded,
matching the `flags` pattern). SR delta renders signed + color-coded (reuse `signed()` from
`format.ts` + win/loss color classes); duration as minutes (already a number); final score
verbatim.

**Decision F.7 — remove the per-row game-type label** (`matches.ts:112`) — constant under D1.
The map-type pill stays.

---

### Area G — Shortcuts cheatsheet spacing

**Root cause recap (verified):** `openCheatsheet` renders `h('div', { class: 'cheatsheet' },
…)` into `.modal-card` (`shell.ts:400-417`). **There is no `.cheatsheet` CSS rule** — the
content sits flush against the `.modal-card` border (which has no padding of its own;
`components.css:593-603`). `.cheatsheet-row` (`components.css:1047-1056`) has `padding: 3px 0`
and `.kbd` `min-width: 64px`.

**Decision G.1 — CSS-only spacing pass** (measurable targets):
- Add a `.cheatsheet` rule: `padding: 22px 24px;` (≥20px on all sides — the modal border
  never touched). Since `.modal-card` has no intrinsic padding, this is the inner content
  padding the spec demands.
- Group-header top spacing ≥ 2× the inter-row gap: rows sit at `padding: 3px 0` (≈6px gap
  center-to-center; set an explicit uniform gap). Set the group container spacing so each
  `.nav-group` header has `margin-top` ≥ 2× the row gap (e.g. rows use `padding: 4px 0` →
  ~8px effective row gap; group header `margin-top: 18px` for all but the first, first
  `margin-top: 0`). Currently the per-group `<div>` uses an inline `marginBottom: '12px'` and
  the header an inline `padding: '0 0 4px'` (`shell.ts:404-406`) — move these into the
  `.cheatsheet` CSS so they're consistent and measurable (drop the inline styles, add
  `.cheatsheet .nav-group` + `.cheatsheet > div + div` margin rules).
- Row gaps uniform (±1px): make `.cheatsheet-row` gap a single value (`padding: 4px 0`),
  removing any competing inline spacing.
- Key badges in a fixed-width column that never touches the border: `.cheatsheet-row .kbd`
  keeps `min-width` (bump to a value that fits the widest combo, e.g. 72px) and the `.cheatsheet`
  side padding guarantees the badge column's left edge stays ≥20px from the modal border.

No TS/DOM change strictly required beyond optionally moving the inline styles into CSS for
measurability; the spec's Definition-of-Done wants before/after browser-preview screenshots
(`npm run preview`, open `?` cheatsheet).

---

## 2. Affected Files / Modules

Grouped by area; **NEW** marks files to create.

### Area A
- `src/store/outbox.ts` — extend to a keyed export ledger (`records` map, `recordExport`,
  `recordImported`, `pageIdFor`, `signatureFor`, `clearExport`, `legacyProcessed`); drop dead
  retry queue; back-compat load of legacy `processed[]`.
- `src/notion/notionWriter.ts` — add `updateMatchPage`; factor `subjectiveProps({ forUpdate })`
  (create omits empties, update blanks cleared cells).
- `src/notion/notionExporter.ts` — create/update/skip/recreate loop; call
  `aggregateImprovementGrade`; signature compare; page-gone→recreate (object_not_found **and**
  archived/in-trash validation_error, per A.5); one-time legacy backfill via `Match ID`
  `dataSources.query` for `legacyProcessed()` rows (A.2); new result counters (`updated`,
  `recreated`).
- `src/core/targets/aggregateGrade.ts` — **NEW** pure aggregate-grade function.
- `src/core/targets/notionBookkeeping.ts` — **NEW** the internal-id constant moved to core
  (so `core/` can reference/exclude it) + `matchExportSignature`. (Or place the constant in
  `targets/types.ts` and the signature in `core/notionMerge.ts` — one new file either way.)
- `src/core/targets/index.ts` — barrel the new exports.
- `src/notion/gametrackerSchema.ts` — `diagnoseSubjectiveColumns` + `SubjectiveColumnDiag`.
- `src/notion/notionAdmin.ts` — `validate` returns the diagnostics.
- `src/main/notionRuntime.ts` — cache diagnostics; pass authored-target ids + outbox ledger to
  the exporter; surface diagnostics in `status()`; expose `clearExports(ids)` passthrough to the
  outbox (for `deleteImportedMatches` — see Decision A.3).
- `src/main/dataProvider.ts` — provide authored targets to the export path (for aggregate
  precedence + internal-id exclusion); wire `deleteImportedMatches` to call
  `clearExports(removedIds)` via a new `DataProviderDeps` seam (Decision A.3).
- `src/shared/contract/notion.ts` — `ExportResult.updated/recreated`;
  `NotionStatus.subjectiveColumns: SubjectiveColumnDiag[]`; `SubjectiveColumnDiag` type.
- `renderer/src/views/notion/statusCard.ts` (or **NEW** `subjectiveColumnsCard.ts`) — render
  per-column diagnostics.
- `renderer/src/views/notion/syncCard.ts` — show updated/recreated chips.

### Area B
- `src/core/notionMerge.ts` — **NEW** pure `mergeImportedIntoLocal`.
- `src/store/history.ts` — **NEW** `mergeImported(entries)` bulk op.
- `src/main/dataProvider.ts` — split imported games into new vs existing; call `mergeImported`;
  remove synthetic-target seeding + `seededBefore` seeding logic; thread each imported page's
  Notion `pageId` into `outbox.recordImported` (Section 3, Area A ledger) so an imported-then-
  edited row updates in place without a recreate.
- `src/notion/notionImporter.ts` — delete `notionImprovementTarget`; import the internal-id
  constant from core; expose the per-row Notion `pageId` (already read) so the provider can pass
  it to `recordImported`.
- `src/core/targets/scoring.ts` — exclude the internal id from `buildTargets`.
- `src/main/index.ts` — one-time `manual.removeTarget(NOTION_IMPROVEMENT_TARGET_ID)` migration.

### Area C
- `src/main/config/appConfig.ts` — `dataFolder` (rename with `historyDbFolder` fallback);
  drop `logFilter` (also Area D).
- `src/store/historyLocation.ts` → `resolveDataDir` (rename).
- `src/core/dataMigration.ts` — **NEW** pure `planDataMigration` + `isVantageDataDir`.
- `src/store/dataMigration.ts` — **NEW** fs executor (copy-verify-commit-delete; adopt;
  leftover-surfacing). Lives in `src/store/` (Electron-free, dir-injected) so `test/` drives it
  with temp dirs like `historyStoreSqlite.test.ts`; wired from `src/main/index.ts`.
- `src/store/outbox.ts`, `src/store/manualLog.ts`, `src/store/rankAnchors.ts`,
  `src/main/screenshots.ts` — add `relocate(newDir)`.
- `src/main/index.ts` — mutable data dir; wire migration + first-run flag into the provider.
- `src/main/dashboard/provider.ts` — the `DataProvider` interface declares
  `getDatabaseLocation`/`chooseDatabaseFolder` (`provider.ts:101-104`); rename/extend to the Area
  C endpoints. `ipcHandlers.ts` (listed under Area D) compiles against this interface, so it must
  change in lockstep.
- `src/main/dataProvider.ts` — `getDataLocation`, `chooseDataFolder`/`setDataFolder`.
- `src/shared/contract/appSettings.ts` — `DataLocation`, `DataLocationResult` (extend/rename
  from `DatabaseLocation*`).
- `src/shared/contract/index.ts` — the barrel uses **explicit named re-exports**, not `export *`
  (`index.ts:52` re-exports `DatabaseLocation, DatabaseLocationResult`). New/renamed types
  (`DataLocation`, `DataLocationResult`) won't reach consumers importing from `'shared/contract'`
  (the mandated path per CLAUDE.md) until this line is edited. **Single contract owner (Wave 0a).**
- `src/shared/contract/api.ts` — new/renamed channels.
- `renderer/preview/preview.ts` — the browser-preview `const mock: OwStatsApi` (`preview.ts:230`)
  stubs `getDatabaseLocation`/`chooseDatabaseFolder` (`preview.ts:467-468`). Because
  `IPC_CHANNELS` is `satisfies Record<keyof OwStatsApi, …>` (`api.ts`) and the mock is annotated
  `OwStatsApi`, `npm run typecheck` (renderer/tsconfig includes `preview/**/*`) **fails** until
  the mock is updated: rename/extend the data-location stubs and add `setDataFolder` /
  `chooseFirstRunDataFolder` stubs. Area D also touches it (below).
- `renderer/src/app/firstRunPrompt.ts` (or **NEW** `dataLocationPrompt.ts`) — first-run step.
- `renderer/src/app/shell.ts` — sequence the data-location step before the demo prompt.
- `renderer/src/views/settings.ts` — rename card to "Data storage"; all-files copy;
  adopt-or-cancel flow.

### Area D
- `src/core/season.ts` — enumeration/labeling API (`SeasonWindow`, `currentSeasonWindow`,
  `seasonsForData`, `seasonWindowById`).
- `src/core/matchFilter.ts` — `isCompetitive`; delete `shouldLog`.
- `src/core/model/enums.ts` — delete `LogFilter` (once unreferenced).
- `src/core/model/index.ts` — the barrel re-exports `LogFilter` (`model/index.ts:9`:
  `export type { Role, Result, LogFilter }`); drop it from the export list when the type is
  deleted, else the barrel fails to compile.
- `src/main/matchPipeline.ts` — competitive capture gate.
- `src/core/dashboardData.ts` — competitive-only scoping (incl. readiness input, per D.1);
  `applyFilters` season branch; drop `mode`; emit `options.seasons`; stop computing/emitting
  `byMode` (+ drop its import at `:7`).
- `src/main/dashboard/ipcHandlers.ts` — competitive scoping on export/heroDetail/matchDetail
  feeds (shared `competitiveOnly`).
- `src/shared/contract/dashboard.ts` — `DashboardFilters.days` union; drop `mode`;
  `options.seasons`; `filters` shape; **drop `byMode` from `DashboardData`** (dead payload,
  no renderer consumer).
- `src/main/config/appConfig.ts`, `appsettings.json` — remove `logFilter` + env override.
- `renderer/src/views/view.ts` — remove Account+Mode fields; season options; reset/preset
  helpers.
- `renderer/src/store.ts` — `FILTER_DEFAULTS` drops `mode`; `vantageFilters` migration.
- `renderer/src/prefs.ts` — `FilterPresetPref` migration; drop `LogPrefillPref.mode`.
- `renderer/src/app/log-match.ts` — remove mode picker; always competitive.
- `renderer/preview/preview.ts` — the `OwStatsApi` mock's `getDashboard` returns
  `computeDashboard(...)`, whose `DashboardData` shape changes (drop `mode`/`modes`, add
  `options.seasons`). Sanity-check the mock against the new filters/options shape; the shared
  contract change is what actually drives the type, so this is mostly a compile check (also see
  Area C's preview edits — one agent owns preview.ts).

### Area E
- `renderer/src/views/readiness.ts` — remove schematic from `chartCard`; add "How is this
  calculated?" + `readinessMethodology()` modal builder.
- `renderer/src/charts/plots/readinessChart.ts` — `supercompensationSchematic` stays (used by
  the modal); export unchanged.
- `renderer/src/app/shell.ts` — `FILTERLESS_VIEWS` + `renderFilters` toggle.

### Area F
- `src/shared/contract/dashboard.ts` — `MatchRow.srDelta/finalScore`.
- `src/core/dashboardData.ts` — `toMatchRow` copies the two fields.
- `renderer/src/prefs.ts` — `matchColumns` pref + defaults + `MatchColumnKey`/`MatchFieldMode`.
- `renderer/src/views/matches.ts` — customize-view popover; meta-line join; column rendering;
  remove `—` + game-type label.
- `renderer/styles/components.css` — `.match-col` alignment classes.

### Area G
- `renderer/styles/components.css` — new `.cheatsheet` padding + group/row spacing rules;
  `.cheatsheet-row .kbd` width.
- `renderer/src/app/shell.ts` — (optional) drop the inline group/header styles so CSS owns
  spacing.

### Docs / specs (spec's in-scope list)
- `README.md` — data folder, competitive-only, season filter, match columns, Notion
  update-on-sync/import-merge behavior.
- Update affected specs: `notion-import.spec.md`, `screen-matches.spec.md`,
  `dashboard-filter-fixes.spec.md`, `sqlite-storage-notion-sync.spec.md`,
  `supercompensation-detection.spec.md`, `screen-shell.spec.md`.

---

## 3. Data Model / Interfaces

### Contract — `DashboardFilters` (dashboard.ts)
```ts
export interface DashboardFilters {
  account?: string;             // 'all' or account name (switcher-driven; no filter-bar field)
  role?: string;                // 'all' | tank | damage | support | openQ
  days?: number | 'all' | { season: string }; // window | all-time | specific season id
  // `mode` removed.
}
```
`DashboardData.filters` becomes `Required<Omit<DashboardFilters, never>>` in the new shape
(`{ account, role, days }`); `DashboardData.options` becomes
`{ accounts: string[]; roles: Role[]; seasons: Array<{ id: string; label: string }> }`
(`modes` removed).

### Contract — `MatchRow` (dashboard.ts)
```ts
export interface MatchRow {
  matchId: string; timestamp: number; account: string; role: Role;
  map: string; mapType: string; result: Result; gameType: string;
  heroes: string[]; durationMinutes?: number;
  srDelta?: number;      // NEW — signed SR change
  finalScore?: string;   // NEW — e.g. '3–1'
  flags?: Partial<Record<MatchFlagKey, true>>;
}
```

### Contract — Notion (notion.ts)
```ts
export type SubjectiveColumnStatus = 'available' | 'wrong-type' | 'near-miss' | 'missing';
// 'available' = present + correct type (writable). 'no value' is a per-sync/per-match skip
// reason (spec A3's third reason), surfaced via ExportResult.skipped + update-clears semantics,
// NOT a schema-level status.
export interface SubjectiveColumnDiag {
  column: string;                 // canonical name, e.g. 'Comms'
  status: SubjectiveColumnStatus;
  actualType?: string;            // when wrong-type
  actualName?: string;            // when near-miss (the live property's real name)
}
export interface ExportResult {
  ok: number; failed: number;
  skipped?: number; updated?: number; recreated?: number;
  unavailable?: boolean; error?: string;
}
// NotionStatus gains: subjectiveColumns?: SubjectiveColumnDiag[];
```

### Export ledger — outbox (outbox.ts)
```ts
interface ExportRecord {
  pageId: string;         // the Notion page to update in place
  signature: string;      // matchExportSignature at last successful write
  exportedAt: number;
}
interface OutboxState {
  records: Record<string, ExportRecord>; // matchId → export state (was: processed:string[] + dead pending[])
  processed?: string[];                  // legacy, read-only for back-compat
}
```
Public surface: `pageIdFor(matchId): string | undefined`, `signatureFor(matchId): string |
undefined`, `recordExport(matchId, { pageId, signature })`, `clearExport(matchId)`,
`legacyProcessed(): string[]` (matchIds present in the legacy `processed[]` with **no** ledger
record — drives the one-time backfill in Decision A.2), and `recordImported(matchId, { pageId,
signature })` (replaces the old `markManyProcessed` for import; stores the **real** Notion
`pageId` the importer already reads, so an imported-then-edited row updates in place without a
recreate). Import threads each page's `id` into the imported flow (transient on the `GameRecord`
or a parallel map) → `recordImported` persists a full ledger record, not a bare "processed"
marker. Legacy export-only rows (no importer pageId available) are handled by the A.2 query
backfill, not here.

### Season API (season.ts)
```ts
export interface SeasonWindow {
  id: string; start: number; end: number; label: string; year: number; seasonOfYear: number;
}
export function currentSeasonWindow(now: number): SeasonWindow;
export function seasonsForData(timestamps: number[], now: number): SeasonWindow[]; // newest-first, current always
export function seasonWindowById(id: string, now: number): SeasonWindow | undefined;
```

### Aggregate grade (core/targets)
```ts
export function aggregateImprovementGrade(
  review: MatchReview | undefined,
  opts: { visibleTargetIds: ReadonlySet<string>; bookkeepingId: string },
): TargetGrade | undefined;
// visible authored grades present -> aggregate (all hit->hit, all missed->missed, else partial);
// none -> fall back to review.grades[bookkeepingId]; undefined if neither.
export function matchExportSignature(game: GameRecord, grade: TargetGrade | undefined): string;
```

### Merge (core/notionMerge.ts)
```ts
export function mergeImportedIntoLocal(
  local: GameRecord, imported: GameRecord,
): { review?: MatchReview; mental?: MatchMental } | null;
```

### Prefs (renderer/prefs.ts)
```ts
export type MatchFieldMode = 'hidden' | 'inline' | 'column';
export type MatchColumnKey = 'role' | 'heroes' | 'account' | 'srDelta' | 'duration' | 'finalScore';
export type MatchColumnsPref = Record<MatchColumnKey, MatchFieldMode>;
export const MATCH_COLUMNS_DEFAULT: MatchColumnsPref = {
  heroes: 'inline', account: 'inline', srDelta: 'inline',
  role: 'hidden', duration: 'hidden', finalScore: 'hidden',
};
// FilterPresetPref.filters is the migrated DashboardFilters (no mode/account participation in equality).
// LogPrefillPref drops `mode`.
```

### Data location (contract/appSettings.ts)
```ts
export interface DataLocation { folder: string; isDefault: boolean; needsFirstRunChoice?: boolean; }
export type DataLocationResult =
  | { ok: true; location: DataLocation; changed: boolean; requiresAdopt?: boolean; leftovers?: number }
  | { ok: false; error: string };
// `leftovers` (Decision C.2): count of originals that couldn't be deleted from the old folder
// after a successful migration (Windows file locks). Migration still succeeded; Settings surfaces
// the count so the user can clean up — satisfies C2's "no stale copies" AC without silent failure.
```
New IPC (api.ts): `getDataLocation`, `chooseDataFolder`, `setDataFolder({ folder, adopt })`
(and a first-run `chooseFirstRunDataFolder`), each with a channel constant.

### Config (appConfig.ts)
```ts
// AppConfig: `dataFolder?: string` (replaces historyDbFolder; loadConfig reads dataFolder ??
//            legacy historyDbFolder). `logFilter` removed. `LogFilter` type removed.
```

---

## 4. Test Strategy

Every core/notion/store change is unit-tested (vitest, `test/*.test.ts`); renderer-only ACs are
verified via the browser-preview harness (`npm run preview`, http://localhost:5178). DoD:
`npm test` green, `npm run typecheck` clean (main + renderer).

### Area A
- **Regression (DoD): create-only/empty-columns repro — demonstrate the failure first.** The
  spec's DoD wants "a regression test reproducing the create-only/empty-columns behavior *before*
  the fix", so the process is: **(1)** write the exporter-level test in
  `test/notionExporter.test.ts` — a simulated Gametracker with `Improvement Target`+`Comms`
  present, a match reviewed with an authored target `hit` + `positiveComms`, asserting the create
  writes `Improvement Target=hit`, `Comms=positive`; **(2)** run it against the *unfixed* exporter
  (i.e. on the pre-fix code, or with the exporter temporarily reverted) and **record the failing
  run** (the internal-slot read + create-only leaves both cells empty) — capture that output in
  the PR description alongside the Area G before/after screenshots; **(3)** land the fix and
  confirm the test now passes. A one-line comment in the test documents the old bug, but the DoD
  is met by the recorded pre-fix failure, not just the passing post-fix assertion.
- AC "3 targets hit/hit/missed → partially": `aggregateGrade.test.ts` (**NEW**) covers all-hit,
  all-missed, mixed, single passthrough, any-partial→partial, internal-id exclusion, bookkeeping
  fallback precedence.
- AC "already-exported empty cells → complete review offline → sync updates in place, no
  duplicate": `notionExporter.test.ts` — ledger has `{ pageId, signature=empty }`; changed
  signature → `updateMatchPage(pageId, …)` called once, `createMatchPage` not called;
  `updated:1`.
- AC "remove positiveComms → sync clears the cell": update sends `Comms: { select: null }`
  (assert the exact property in `updateMatchPage`).
- AC "user deleted the page → recreate + noted": **two cases** — (a) mock `pages.update` to throw
  `APIResponseError` `code: 'object_not_found'` (permanent delete / unshare); (b) mock it to throw
  `code: 'validation_error'` with the archived/in-trash message (the *common* UI-delete case) and
  a `pages.retrieve` returning `in_trash: true`. Both must call `createMatchPage` and report
  `recreated:1`. Add a negative case: a `validation_error` on a *live* page (bad property) →
  counts as `failed`, no recreate.
- AC "legacy already-exported empty cells → offline review → sync updates in place, no
  duplicate" (backfill): ledger empty, `outbox.json` legacy `{ processed: [id] }`, the local
  match now carries `positiveComms`+`hit`; mock the `Match ID` `dataSources.query` to return the
  existing page → assert `updateMatchPage(foundPageId, …)` called once, `createMatchPage` **not**
  called, `updated:1`, and the ledger now records `{ pageId, signature }`. Second legacy case:
  query returns nothing → `createMatchPage` called, `recreated:1`.
- AC "Comms as text → skipped wrong type" + "near-miss name": `gametrackerSchema.test.ts`
  (extend) covers `diagnoseSubjectiveColumns` for wrong-type, near-miss (`comms `, wrong case),
  missing, available.
- Signature idempotency: two syncs with no local change → 0 updates.
- **`test/outbox.test.ts` — delete the dead-queue cases.** The retry-queue test
  ("queues and removes pending matches", `outbox.test.ts:31-37`, exercising
  `enqueue`/`pending`/`remove`) is **removed** when the dead queue is deleted in Wave 1-A; add
  ledger-shape cases in its place (`recordExport`/`pageIdFor`/`signatureFor`/`clearExport`,
  legacy `processed[]` load → `legacyProcessed()`).

### Area B
- `notionMerge.test.ts` (**NEW**): grade applied when `local.review` undefined; local review
  untouched when present (different Notion grade); mental adopted when `local.mental` undefined;
  local mental wins wholesale (unchecked flag stays); null when nothing to do.
- `importNotionProvider.test.ts` (extend): existing local without review + Notion `missed` →
  local gains `missed`, no duplicate, not pending. Notion `hit` with no local counterpart → new
  reviewed row. Local already reviewed → unchanged. Mental: local record with `tilt` unchecked +
  Notion `Tilt` checked → local unchanged.
- Synthetic-target removal: assert no `AuthoredTarget` is seeded on any import path (merge or
  new) — the existing seeding tests (`importNotionProvider.test.ts:64-106`) are **rewritten** to
  assert *no seeding*.
- `buildTargets`/scoring (`analytics.test.ts` or a targets test): internal id excluded from the
  list and from any visible target's stats.
- Migration: `manualLog.test.ts`/`stores.test.ts` — `removeTarget(internalId)` removes only the
  synthetic; a same-named user target (different id) survives with grades intact.
- Browser-preview: Targets + Review screens show no "Improvement Target".

### Area C
- `dataMigration.test.ts` (**NEW**, pure): `planDataMigration` lists exactly the present files
  (skips missing optionals), correct order; `isVantageDataDir` true iff `history.db` present.
- Executor (`test/dataMigration.test.ts` or extend `stores.test.ts`, with a temp dir like
  `historyStoreSqlite.test.ts` — the executor is in `src/store/`, fs-only, dir-injected):
  copy-verify-commit; failure mid-copy leaves source intact + no stale target; refuses non-adopt
  when target has data; adopt repoints without copy/delete; non-writable target → clear error, old
  location active; **leftover-surfacing — a source file that can't be deleted after commit yields
  `{ ok: true, leftovers: N }`** (simulate by holding a handle / making it undeletable) so the
  "no stale copies" AC is met with a user-visible count, not silence.
- `historyLocation.test.ts` (rename to data-dir) — `resolveDataDir` + `dataFolder`↔legacy
  `historyDbFolder` fallback; keep a `resolveHistoryDir` alias export test if the alias is
  retained for the cross-wave sequencing (see Section 6 greenness policy).
- `appsettings.test.ts`/config tests: `dataFolder` load; legacy `historyDbFolder` adopted;
  unknown `logFilter` ignored.
- Store `relocate` methods: `outbox`/`manualLog`/`rankAnchors` reopen at the new dir (extend
  `stores.test.ts`/`outbox.test.ts`).
- Browser-preview / manual (needs Electron for the picker): first-run prompt appears on fresh
  install, absent on existing install; Settings change moves all files; adopt-or-cancel. These
  are integration checks noted in the PR (dialogs aren't unit-testable).

### Area D
- `season.test.ts` (extend): `currentSeasonWindow`, `seasonsForData` (only-data-seasons +
  current always; fresh install → just current 2026 S3), `seasonWindowById`, labeling
  (2026 S1/S2/S3; first 2027 → 2027 S1; pre-2026 date-range fallback), `[start,end)` boundary.
- `matchFilter.test.ts`: `isCompetitive` truth table; remove `shouldLog` cases.
- `matchPipeline.test.ts`: quick-play/arcade GEP match → not written; competitive → written;
  manual (forced competitive) → written.
- `test/vantageCore.test.ts` (the real home of `computeDashboard`/`applyFilters` coverage,
  `:143-235` — **there is no `dashboardData.test.ts`**) + `analytics.test.ts`: non-competitive
  rows invisible everywhere (counts, totalGamesAllTime, pendingReviews); `applyFilters` season
  branch picks `[start,end)`; unknown season id → 30-day fallback. **Rewrite the existing
  `applyFilters` mode test** (`vantageCore.test.ts:228-235`, which asserts on `{ mode:
  'Competitive' }`) since `mode` is gone from the filter — replace with the competitive-only
  scoping + season assertions.
- Browser-preview: filter bar has no Account/Mode field; season options exactly as the AC's
  S1/S3 example; quick-log has no mode picker; persisted `mode`+`days:'season'` loads without
  crash → current named season; old preset with `mode`/`account` applies role/time only, account
  unchanged, rewritten.

### Area E
- Browser-preview only (renderer/shell): readiness view shows no schematic, no filter bar
  (coach on and off); switching accounts leaves verdict/signals/trend unchanged; "How is this
  calculated?" opens a modal containing the methodology + schematic; closes via Escape/backdrop/
  close button.

### Area F
- `test/vantageCore.test.ts` (extend — `toMatchRow`/`recentMatches` coverage lives there
  alongside the `reviewPipeline.test.ts`/`rowFlags.test.ts` row tests; **not**
  `dashboardData.test.ts`, which doesn't exist): `toMatchRow` carries `srDelta`/`finalScore` when
  present, omits when absent.
- Browser-preview: default (heroes/account/srDelta inline) with no heroes → meta line
  `MyAccount · +25` (no `—`, no dangling separators); account=column + role=inline persists
  across reload; all six hidden → only always-visible fields, no empty meta/spacer; missing SR
  while inline → segment omitted; SR as column → blank aligned cell.

### Area G
- Browser-preview (DoD: before/after screenshots): open `?` cheatsheet at default window size;
  every key badge/text bounding box ≥20px from the modal border; group headers ≥2× the row gap
  above; uniform row gaps. Measure with `preview_inspect` on `.cheatsheet`, `.cheatsheet-row`,
  `.cheatsheet-row .kbd` (padding/margins/bounding boxes).

---

## 5. Risks & Alternatives

- **Outbox schema change + legacy backfill (A).** Old `outbox.json` has `{ pending, processed }`
  — `processed[]` entries carry **no pageId and no signature**, so "signature unchanged → skip"
  is undecidable for them (there is nothing to compare against) and would read as "changed" for
  every row → duplicating the user's entire exported history on the first post-upgrade sync.
  **Resolved (Decision A.2):** on the first sync after upgrade, each legacy `processed[]` matchId
  with no ledger record is resolved via a *one-time* batched `dataSources.query` on the
  `Match ID` column (query-by-column is used here only as legacy recovery, not as the steady-state
  addressing key — that remains the ledger per A.1). Found → adopt `{ pageId, signature }` and let
  normal changed-since detection update-in-place if the local match now carries offline-completed
  subjective values (no duplicate; satisfies A AC #3). Not found (row truly deleted) → create +
  count `recreated`. Idempotent thereafter (ledger record exists → query path never retaken).
  The query fallback's own delete-detection gap (can't tell "deleted" from "never exported") is a
  non-issue because a legacy `processed[]` id means "was exported" by definition.
- **`core/` can't import `src/notion/` (guardrail 3).** Moving `NOTION_IMPROVEMENT_TARGET_ID`
  into `core/targets` is mandatory so scoring/aggregate can exclude it. Notion edge imports it
  from core (allowed). Low risk; mechanical.
- **Config key rename (C/D).** `dataFolder` with `historyDbFolder` fallback keeps old configs
  working; removing `logFilter` is safe because unknown keys are never read. Risk: a user who
  hand-set `logFilter: 'Everything'` to capture quick-play loses that — acceptable per D1
  (competitive-only is the product decision; existing non-comp rows are only hidden, not
  deleted).
- **Full-data migration atomicity (C).** SQLite move requires closing the handle; a crash
  mid-migration must not lose data. Copy-verify-then-commit-then-delete (never overwrite, never
  delete before commit) is the guarantee; the DB reuses `HistoryStore.relocate`'s proven
  rollback. Screenshots dir recursive copy is the largest artifact — verify by count/size.
  Alternative (reconstruct stores vs. `relocate`) — chose `relocate` for symmetry.
- **Season `days` union change (D).** `{ season: id }` is a breaking contract shape vs. the old
  `'season'` string. Renderer migration maps the legacy sentinel; unknown persisted ids fall
  back to 30d. Existing Notion databases are unaffected (season is a read-time filter only).
- **Existing installs' synthetic target (B).** The unconditional id-based `removeTarget` runs
  once and is a no-op thereafter; a same-named user target is safe (different id). Grades stay on
  matches; they now surface only via the export/round-trip, never as a visible target. If a user
  *wanted* the imported grades as a visible target, they no longer see it — accepted per spec
  Resolved Q3 (hidden bookkeeping is the decision).
- **Match column alignment (F).** Fixed-basis flex cells may misalign with very long hero lists;
  fallback to CSS grid template if needed. Purely visual; no data risk.
- **First-run detection (C).** File-existence checks are unusable: the store's constructor
  creates `history.db` at startup before the renderer asks, so any "no `history.db`" clause is
  always false and the prompt would never appear. The rule is therefore config-driven — prompt
  iff no `dataFolder`/legacy `historyDbFolder` was ever persisted AND the store is empty — and
  we persist `dataFolder` explicitly on first choice (even the default) so it self-clears and
  never re-triggers, even if the user later deletes all data.
- **Back-compat of old localStorage (D/F).** `vantageFilters` and `filterPresets` migrations
  strip unknown keys defensively; `matchColumns` merges over defaults, so partial/legacy prefs
  never crash.

**Rollback:** each area is independently revertible (disjoint files per Section 6). The riskiest
irreversible-ish action is the outbox schema change (A) — but it's forward-only and degrades
gracefully; no user data is destroyed.

---

## 6. Implementation Order & Parallelization

Waves are dependency-ordered; within a wave, workstreams touch **disjoint files** so parallel
agents don't collide. Shared-file hazards are called out explicitly.

**Greenness policy across waves (important — waves are NOT each independently green).** A contract
change in Wave 0 breaks its consumers until their wave lands: dropping `mode` from
`DashboardFilters` and `modes` from `DashboardData.options` (Wave 0) breaks `view.ts:40-41`
(`d.filters.mode`, `d.options.modes`), `store.ts:80` (`FILTER_DEFAULTS: Required<DashboardFilters>`
includes `mode: 'all'`), and `vantageCore.test.ts:228-235` (the `applyFilters` mode test) — all
fixed only in Wave 3 / test-wave. Likewise Wave 1's `resolveHistoryDir → resolveDataDir` rename
breaks its only caller `src/main/index.ts:10,77,208`, not touched until Wave 2. **So
`npm run typecheck`/`npm test` are red *between* waves.** This whole batch therefore lands as
**one atomic PR** — the DoD (test + typecheck green) is checked **only at the end**, not per wave;
"each area independently revertible" means at the *file/diff* granularity within the single PR, not
that intermediate commits typecheck. If per-wave green is ever required (e.g. split PRs), sequence
for it: (a) keep `mode` **optional-and-ignored** in the contract until the Wave 3 renderer edits,
(b) keep a thin `resolveHistoryDir` **alias** re-exporting `resolveDataDir` until `index.ts`
migrates in Wave 2, and (c) land the `vantageCore.test.ts` `applyFilters`/`byMode` fixes in the
same wave as the `dashboardData.ts` change (Wave 0b), **not** a nonexistent `dashboardData.test.ts`.

### Wave 0 — Foundations (contract + pure core + their tests). Do first; everything depends on it.
0a. **Contract** (`src/shared/contract/dashboard.ts`, `notion.ts`, `appSettings.ts`, `api.ts`,
    **`index.ts`** — the barrel; **`src/main/dashboard/provider.ts`** — the `DataProvider`
    interface) —
    `DashboardFilters.days` union + drop `mode`; drop `byMode` from `DashboardData`;
    `options.seasons`; `MatchRow.srDelta/finalScore`;
    `ExportResult.updated/recreated`; `SubjectiveColumnDiag`; `NotionStatus.subjectiveColumns`;
    `DataLocation*`; new channels. **Also barrel the new types through `index.ts`** (explicit
    named re-exports — `SubjectiveColumnDiag`/`SubjectiveColumnStatus`, `DataLocation`/
    `DataLocationResult`, the season-option type) and **rename/extend `provider.ts`'s
    `getDatabaseLocation`/`chooseDatabaseFolder` (`:101-104`)** so `ipcHandlers.ts` compiles.
    **Single owner** (contract is barreled and shared by everything).
0b. **Pure core** (all Electron-free, with tests):
    - `src/core/season.ts` (enumeration/labeling) + `season.test.ts`.
    - `src/core/targets/aggregateGrade.ts` + `notionBookkeeping.ts` (internal-id const +
      signature) + `aggregateGrade.test.ts`; barrel via `targets/index.ts`.
    - `src/core/notionMerge.ts` + `notionMerge.test.ts`.
    - `src/core/matchFilter.ts` `isCompetitive` (+ delete `shouldLog`); `src/core/model/enums.ts`
      drop `LogFilter` **and its `src/core/model/index.ts:9` re-export**; `matchFilter.test.ts`.
    - `src/core/dataMigration.ts` (`planDataMigration`, `isVantageDataDir`) +
      `dataMigration.test.ts`.
    - `src/core/dashboardData.ts` — `applyFilters` season branch, competitive-only scoping,
      `toMatchRow` new fields, `options.seasons`, drop `mode`. **HAZARD: `dashboardData.ts` is
      shared by D and F** — do both edits here in Wave 0 (season/applyFilters for D, `toMatchRow`
      for F) so downstream renderer work sees a stable core. `src/core/targets/scoring.ts`
      internal-id exclusion (B) also lands here.

### Wave 1 — Store + main-process edges (parallel; disjoint files).
- **A-store/notion:** `src/store/outbox.ts` (ledger), `src/notion/notionWriter.ts`
  (updateMatchPage), `src/notion/notionExporter.ts`, `src/notion/gametrackerSchema.ts`
  (diagnostics), `src/notion/notionAdmin.ts`.
- **B-store/importer:** `src/store/history.ts` (`mergeImported`),
  `src/notion/notionImporter.ts` (drop factory, import const from core).
- **`NOTION_IMPROVEMENT_TARGET_ID` import-switch protocol (A + B, Wave 1).** Today
  `notionExporter.ts:5` and `notionImporter.ts` both source the constant from `./notionImporter`.
  In Wave 1, A owns `notionExporter.ts` and B owns `notionImporter.ts` (which deletes the factory)
  — they must not break each other's imports. Sequence: **Wave 0** creates the core module
  (`src/core/targets/notionBookkeeping.ts`) exporting the constant **without deleting** the
  `notionImporter` re-export yet. Then in Wave 1, **each workstream independently repoints its own
  file's import to core** — A switches `notionExporter.ts` to import from core, B switches
  `notionImporter.ts` (and deletes the local definition). Because both point at core before B
  removes the old export, neither breaks the other.
- **C-store:** the pure `src/core/dataMigration.ts` is already in Wave 0; here
  `src/store/dataMigration.ts` (fs executor), `src/store/historyLocation.ts` rename (see the
  cross-wave note below — keep a `resolveHistoryDir` alias until Wave 2), and `relocate` on
  `outbox.ts`/`manualLog.ts`/`rankAnchors.ts`/`screenshots.ts`. **HAZARD: `src/store/outbox.ts`
  is touched by both A (ledger) and C (relocate)** — sequence A's outbox rewrite first, then add
  `relocate`, or assign both outbox edits to one agent.
- **D-pipeline:** `src/main/matchPipeline.ts` capture gate.

### Wave 2 — Composition root + config + IPC (mostly serial; shared main files).
- **`src/main/config/appConfig.ts`** — **HAZARD: shared by C (dataFolder rename) and D (remove
  logFilter + env override).** One agent lands both config edits together. `appsettings.json`
  (remove `logFilter`) rides with it.
- **`src/main/dataProvider.ts`** — **HAZARD: shared by A (authored targets to export), B (merge
  orchestration + remove seeding), C (data-location endpoints).** One agent lands all three, or
  strictly sequence A→B→C on this file.
- **`src/main/notionRuntime.ts`** — A (diagnostics cache, authored ids, ledger pageIds).
- **`src/main/index.ts`** — **HAZARD: shared by B (one-time synthetic-target migration), C
  (mutable data dir + first-run flag + migration wiring), D (already gated via pipeline).** One
  agent lands B+C wiring here.
- **`src/main/dashboard/ipcHandlers.ts`** — D (competitive scoping on export/heroDetail/
  matchDetail) + any new C/A channels' registration. Compiles against `provider.ts`'s
  `DataProvider` interface (renamed data-location endpoints landed in Wave 0a), so the interface
  must already carry the new shape by this wave.

### Wave 3 — Renderer (parallel; mostly disjoint views).
- **A-renderer:** `renderer/src/views/notion/statusCard.ts` (or new `subjectiveColumnsCard.ts`)
  + `syncCard.ts`.
- **B-renderer:** none beyond Wave 0 (Targets/Review are data-driven; verify only).
- **C-renderer:** `renderer/src/app/firstRunPrompt.ts` (or new `dataLocationPrompt.ts`) +
  `renderer/src/views/settings.ts` + **`renderer/preview/preview.ts`** (rename/extend the
  data-location mocks; add `setDataFolder`/`chooseFirstRunDataFolder` stubs). **HAZARD: `shell.ts`
  sequencing** — C touches `maybeFirstRun` in `shell.ts`. **HAZARD: `preview.ts` shared by C
  (data-location mocks) and D (getDashboard mock shape)** — one agent owns preview.ts.
- **D-renderer:** `renderer/src/views/view.ts` (filter bar), `renderer/src/store.ts`
  (`FILTER_DEFAULTS` + vantageFilters migration), `renderer/src/prefs.ts` (preset migration +
  drop `LogPrefillPref.mode`), `renderer/src/app/log-match.ts` (remove mode picker),
  **`renderer/preview/preview.ts`** (sanity-check the `getDashboard`/`DashboardData` mock against
  the new filters/options shape — see the C-renderer preview owner note).
  **HAZARD: `renderer/src/prefs.ts` is shared by D (presets/logPrefill) and F (matchColumns)** —
  one agent, or land the `PrefsShape` additions together.
- **E-renderer:** `renderer/src/views/readiness.ts` + **`renderer/src/app/shell.ts`
  (FILTERLESS_VIEWS + renderFilters)**. **HAZARD: `shell.ts` shared by C (firstRun sequencing),
  E (filter-bar suppression), and G (optional inline-style removal for the cheatsheet).**
  Assign all `shell.ts` edits to a single agent or serialize C→E→G on that file.
- **F-renderer:** `renderer/src/views/matches.ts` + `renderer/styles/components.css`
  (`.match-col`). **HAZARD: `components.css` shared by F (match columns) and G (cheatsheet).**
  Different rule blocks — low collision risk, but assign to one agent or coordinate to avoid
  merge churn.
- **G:** `renderer/styles/components.css` (`.cheatsheet*`) + optional `shell.ts` inline-style
  removal.

### Wave 4 — Docs + specs + verification.
- README + the six affected specs; browser-preview screenshots for E/F/G; full `npm test` +
  `npm run typecheck`; create the seven grouped GitHub issues.

**Shared-file hazard summary (assign one owner each):**
- `src/core/dashboardData.ts` — D + F (+ B scoring sibling).
- `src/main/config/appConfig.ts` + `appsettings.json` — C + D.
- `src/main/dataProvider.ts` — A + B + C.
- `src/main/index.ts` — B + C.
- `src/store/outbox.ts` — A + C.
- `renderer/src/app/shell.ts` — C + E + G.
- `renderer/src/prefs.ts` — D + F.
- `renderer/styles/components.css` — F + G.
- `renderer/preview/preview.ts` — C (data-location mocks) + D (dashboard-mock shape). One owner.
- `src/shared/contract/*` **+ `src/shared/contract/index.ts` (barrel)** — all areas (Wave 0a,
  single owner). `src/main/dashboard/provider.ts` (the `DataProvider` interface) moves in lockstep
  with the contract since `ipcHandlers.ts` compiles against it.
- **Test-file overlaps** (assign one owner each, same as their production siblings):
  - `test/outbox.test.ts` — A (delete dead retry-queue cases `:31-37`, add ledger cases) + C
    (store `relocate` cases).
  - `test/stores.test.ts` — B (`removeTarget` migration; also lands in `manualLog.test.ts`) + C
    (store `relocate` cases).
  - `test/vantageCore.test.ts` — D (`applyFilters` mode-test rewrite `:228-235`, competitive/season)
    + F (`toMatchRow` fields). **No `dashboardData.test.ts` exists** — do not reference it.
