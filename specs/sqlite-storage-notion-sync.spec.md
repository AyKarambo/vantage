# Spec: `sqlite-storage-notion-sync`

**Updated 2026-07-06** after the `feedback-batch-2026-07` fix — Area A (export ledger +
update-on-sync) and Area C (the configurable database location becomes an **all-files** data
folder, chosen at first run too) — see `feedback-batch-2026-07.spec.md` Areas A and C for the
originating problems/requirements and their own acceptance criteria. This file is amended so it
never diverges from shipped behavior; superseded passages are struck through and annotated
rather than deleted, so the "two idempotent, discrete syncs" history stays legible.

## Intent (WHAT & WHY)
Vantage's entire match history lives in one `history.json` that is loaded wholly into
memory and rewritten on every mutation. This is fine at today's scale but has two real
weaknesses: **(1)** a single corrupt/truncated read silently falls back to an empty dataset
and the next save overwrites real history (a data-loss footgun in `HistoryStore.load()`),
and **(2)** there's no queryable substrate to grow richer analytics on.

Replace the JSON persistence with an embedded SQLite database behind the existing
`HistoryStore` interface — giving ACID durability (killing the footgun) and a foundation for
future SQL-driven analytics. Give the user control over **where the database file lives** so a
cloud-synced folder can provide off-machine redundancy. Separately, make **Notion the backup
target with full round-trip parity**: extend the Gametracker schema so every
analytics-meaningful field Vantage stores can be exported to Notion and imported back, with a
small, explicitly documented set of inherently-local exceptions.

## In-Scope
- Swap the storage engine behind `HistoryStore` from `history.json` to SQLite; **preserve the
  public interface and observable behavior exactly** (all callers in `core/`, `main/`,
  renderer unchanged).
- One-time **auto-migration** of an existing `history.json` into SQLite on first launch; the
  JSON file is left on disk untouched as a frozen backup and no longer written.
- ~~**Configurable database location:** the user can choose the folder where the SQLite DB
  lives (default: the current `userData` dir).~~ **Superseded 2026-07-06, Area C** — the
  choice is no longer just the DB file. See "All-files data folder (Area C)" below.
- Close the export/import field gap so a full `GameRecord` round-trips Vantage→Notion→Vantage,
  **except documented local-only fields**.
- **Additive Notion schema migration**: add the columns needed for full parity (notably an
  **SR-delta** number column, currently unsynced), guarded by column-presence like `Played At`
  so legacy databases keep working.
- ~~Keep syncing as **two discrete, idempotent, user-triggered actions** (export, import);
  re-import updates rows changed in Notion.~~ **Refined 2026-07-06, Area A** — export is no
  longer create-only; see "Update-on-sync export ledger (Area A)" below. Both directions stay
  explicit, user-triggered actions (guardrail 5) — only *what a sync does* to already-exported
  rows changed, not *when* syncs run.

### Update-on-sync export ledger (Area A, added 2026-07-06)
Originally, export only ever created new Notion pages: the created page id was discarded and
the matchId marked processed forever, so a match synced before its review was completed kept
empty subjective (`Improvement Target`/`Comms`) cells permanently, even after the user reviewed
it and ran another sync. Fixed by an **export ledger** (`src/store/outbox.ts`,
`OutboxState.records: Record<string, ExportRecord>` where `ExportRecord = { pageId, signature,
exportedAt }`), replacing the old `processed: string[]` + dead `pending[]` shape (kept, read-only,
for back-compat via `legacyProcessed()`):
- `pageIdFor(matchId)` / `signatureFor(matchId)` read the ledger; `recordExport(matchId, {
  pageId, signature })` and `clearExport(matchId)` maintain it; `recordImported(matchId, {
  pageId, signature })` gives import-created rows a full ledger entry too (not a bare
  "processed" marker), so an imported-then-locally-edited row updates in place on the next sync
  instead of being recreated.
- On each manual sync, a match with a ledger entry whose **content signature**
  (`matchExportSignature(game, grade)` — a hash of the fields that can change post-export:
  review grade, mental flags) differs from the last-recorded one is **updated in place**
  (`pages.update`, not `pages.create`) — symmetric: setting a value fills the cell, clearing a
  flag/grade clears it on the next sync. If the Notion page was deleted/archived, the row is
  recreated and the sync result notes it (`ExportResult.recreated`).
- The `Improvement Target` value is the **aggregate grade** derived from the review's target
  grades (`aggregateImprovementGrade`, `src/core/targets/aggregateGrade.ts`): all graded targets
  `hit` → `hit`; all `missed` → `missed`; any mix (or any `partial`) → `partially`; a
  single-target review passes its grade through unchanged. If the review carries no visible
  authored grades, an import-created bookkeeping grade (`notion-improvement-target` internal id,
  see `notion-import.spec.md`) is used as-is.
- **No silent column skips**: the Notion screen shows a per-column sync status — written /
  skipped, with reason (column missing, wrong type, no value); a near-miss column name (matches
  after trimming whitespace and case-folding) is called out explicitly
  (`SubjectiveColumnDiag`/`SubjectiveColumnStatus` in `src/shared/contract/notion.ts`).
- Updates ride the explicit manual sync only — no automatic outbound Notion traffic
  (guardrail 5 unchanged).

### All-files data folder (Area C, added 2026-07-06)
Originally only `history.db` was relocatable, and only from Settings; everything else
(`manual.json`, `outbox.json`, `rankAnchors.json`, `screenshots/`, the frozen legacy
`history.json` backup) stayed pinned to `userData/data`, and nothing was offered at first run.
Now:
- **First run** (alongside the existing demo-data prompt, before meaningful data is written)
  asks where to store data: default (`userData/data`, preselected) or a custom folder via native
  directory picker. An invalid choice (not creatable/writable) shows the specific reason and
  re-prompts, writing nothing to the invalid location. If the chosen folder already contains
  Vantage data (a `history.db`), it is **adopted as-is** (restore-from-backup) — no migration, no
  overwrite. Existing installs (data already present in the current data dir) see no prompt.
- **Settings** ("Data storage" card, was "Data & backup") shows the current folder and offers
  "Change…", now migrating **all** data files with the existing copy-verify-then-delete
  guarantee: originals are removed only after the switch is committed; failures leave the old
  location fully intact; missing optional files are skipped, not errors. A target that already
  contains Vantage data offers **adopt or cancel** — never overwrite.
- The pointer (`config.local.json`, `dataFolder` — replaces `historyDbFolder`; `loadConfig`
  reads `dataFolder ?? historyDbFolder` for back-compat) stays in `userData`; all data files live
  under the chosen folder.
- UI copy carries a neutral note: synced folders are great for backup; avoid two machines
  writing at the same time.
- NSIS installer custom pages are out of scope — the folder is chosen in-app only.

## Out-of-Scope (non-goals)
- Continuous/background two-way sync, live conflict resolution, or per-field merge.
- Moving existing analytics computation into SQL queries (future work; door left open).
- Uploading screenshots to Notion as file attachments.
- Multi-device sync, or simultaneous multi-machine access to a cloud-synced DB file.

## Constraints
- **Guardrails intact:** `core/` stays pure & Electron-free (SQLite lives at the `src/store/`
  edge only); GEP-only data; renderer stays one CSP-friendly bundle; Notion export stays
  opt-in with the user's own token; **no secrets in git** (token in user config, never
  committed).
- **Browser preview must keep working** — it runs `core/` against fixtures, not the real
  store, so the edge swap must not touch that path.
- The SQLite native dependency must **build for ow-electron and package into the release
  installer**.
- **Backward compatibility:** users upgrading mid-stream (JSON→SQLite), and legacy Notion
  databases missing the new columns, must both keep working without manual steps.
- Export/import mappings for shared fields stay **exact inverses** (extends the symmetry
  established in the Notion-export fix).
- Cloud-synced DB folders are supported for **single-machine redundancy only**. Simultaneous
  multi-machine access to the synced file is unsafe (sync conflicts can corrupt SQLite) and
  remains a non-goal.

## Field coverage (defines "analytics-complete")
**Synced & round-tripped:** matchId, endedAt (Played At), account, role, map, result,
gameType, source (gep↔Auto / manual↔Manual), **srDelta → new column**, durationMinutes,
heroes, finalScore, battleTag, queueType, eliminations, deaths, assists, damage, healing,
mitigation, groupSize, mental flags (Tilt / Toxic Mates / Leaver / Comms), primary
improvement-target grade.

**Documented local-only exceptions (intentionally not synced):** `screenshots` (local PNG
paths), `roster` (other players' TAB stats — scope + not the user's own analytics), `perHero`
(within-match per-hero splits), improvement-target grades beyond Notion's single
`Improvement Target` column, `review.at` timestamp, `importedAt` (internal import bookkeeping —
must never sync).

## Acceptance Criteria (Given / When / Then)

**Storage migration**
1. **Given** a user with an existing `history.json` and no SQLite DB, **when** the app launches
   after update, **then** every game is imported into SQLite, `history.json` is left
   byte-for-byte unmodified, and the dashboard shows an identical dataset.
2. **Given** a populated SQLite DB, **when** the app launches, **then** `history.json` is not
   read again and SQLite is the sole source of truth.
3. **Given** any `HistoryStore` operation (`add`, `addMany`, `editManual`, `relabelAccount`,
   `removeImported`, `addScreenshots`, `setReview`, `clearReview`, `setReviews`), **when**
   invoked, **then** it returns the same results and enforces the same match-id dedupe
   semantics as the JSON implementation.
4. **Given** a write is interrupted by crash or power loss, **when** the app restarts, **then**
   the database is intact and no committed data is lost (no silent fallback to empty).

**Configurable database location — superseded 2026-07-06 by the Area C all-files data folder**
5. ~~Given the user sets a new database folder, when they confirm, then the existing DB is
   relocated there, subsequent reads/writes use the new path, and the setting survives
   restart.~~ **Superseded** — see Area C ACs below (the folder now carries *all* data files,
   not only `history.db`).
6. ~~Given a configured DB path that's missing or unwritable at launch (e.g. the synced folder
   is offline), when the app starts, then it surfaces a clear error and does not silently create
   a fresh empty DB elsewhere (same anti-data-loss principle as #4).~~ **Superseded** — the
   anti-data-loss guarantee is unchanged but now applies to the whole data folder; see Area C.

**Notion parity**
7. **Given** a `GameRecord` with every synced field populated, **when** it is exported to
   Notion and then imported into a fresh history, **then** the reconstructed record equals the
   original on all synced fields.
8. **Given** the user's existing Gametracker DB lacks a new column (e.g. SR-delta), **when**
   export runs, **then** the missing column is added/surfaced additively and all existing
   columns and rows are untouched.
9. **Given** a documented local-only field (screenshots, roster, perHero, extra named-target
   grades, importedAt), **when** round-tripping, **then** it is intentionally absent in Notion
   and its absence after import is expected — not flagged as data loss.
10. ~~Given a match already exported, when export runs again, then no duplicate row is created;
    and given a Notion row changed since import, when import runs again, then the local record
    is updated (idempotent both directions, no background merge).~~ **Refined 2026-07-06, Area
    A** — export re-runs now go further than "no duplicate": if the review/mental flags changed
    since the last export, the *existing* page is updated in place (not left stale). See Area A
    ACs below.

**Guardrails / DoD**
11. **Given** the full suite, **when** `npm test` and `npm run typecheck` run, **then** both
    pass; new pure logic under `src/core/` (e.g. field mapping) ships with unit tests, and
    `README`/docs are updated for the new storage + Notion columns.

**Area A — update-on-sync export ledger (added 2026-07-06)**
12. **Given** a Gametracker with `Improvement Target` and `Comms` (both select) and a local
    match reviewed with a single target graded `hit` and `positiveComms` flagged, **when** the
    user syncs, **then** the new Notion row has `Improvement Target = hit` and
    `Comms = positive`.
13. **Given** a match reviewed with three targets graded hit / hit / missed, **when** it is
    exported, **then** the Notion row has `Improvement Target = partially`.
14. **Given** a match already exported with empty subjective cells, **when** the user completes
    its review (grades aggregating to `partially`, positive comms) — even while offline — and
    later runs a successful sync, **then** the *existing* Notion page is updated in place to
    `Improvement Target = partially`, `Comms = positive`; no duplicate row exists.
15. **Given** an exported match with `Comms = positive` in Notion, **when** the user removes the
    positive-comms flag and syncs, **then** the Notion `Comms` cell is cleared.
16. **Given** an exported match whose Notion page the user deleted, **when** the next sync runs,
    **then** the row is recreated and the sync result mentions it.
17. **Given** a Gametracker where `Comms` exists as a *text* column, **when** the user opens the
    Notion screen or syncs, **then** a visible status reports
    `Comms: skipped — wrong type (expected select)`.
18. **Given** a Gametracker column named `comms ` (trailing space) or `improvement target`
    (wrong case), **when** the user opens the Notion screen, **then** the status calls out the
    near-miss name explicitly.

**Area C — all-files data folder, first run + Settings (added 2026-07-06)**
19. **Given** a fresh install, **when** the app launches for the first time, **then** the user
    is asked for a data location with the default preselected, and all subsequently written data
    files land in the chosen folder.
20. **Given** the first-run picker, **when** the user selects a non-writable folder, **then**
    the specific reason is displayed, the picker is offered again, and nothing was written
    there.
21. **Given** a fresh install pointed at a OneDrive folder containing a previous installation's
    data, **when** first run completes, **then** that data is adopted (matches, targets,
    settings-relevant stores load from it) and none of it was overwritten.
22. **Given** an existing install with data in the default location, **when** the user changes
    the data folder in Settings to an empty writable folder, **then** all data files (including
    screenshots and legacy `history.json` if present) are moved, the old location is left
    without stale copies, and a re-launch loads the same history from the new location.
23. **Given** a Settings folder change targeting a folder that already contains Vantage data,
    **when** the user confirms "adopt", **then** the app switches to that folder's data without
    overwriting it; current data stays intact in the old location. Cancel changes nothing.
24. **Given** a migration target that is not writable, **when** the user tries to change to it,
    **then** the change is rejected with a clear error and the old location remains active.
25. **Given** an existing install updating to this version, **when** the app launches, **then**
    no data-location prompt appears and data stays in place.

## Resolved questions
- **Sync model** → Two discrete idempotent syncs (export + import as separate user actions;
  re-import updates changed rows; no live merge).
- **Completeness bar** → Analytics-complete with documented local-only exceptions (not
  truly-lossless; screenshots/roster/perHero/extra grades excluded).
- **Migration** → Auto-migrate `history.json` into SQLite on launch; keep the JSON file as a
  frozen one-time backup; stop writing it thereafter.
- **Analytics location** → SQLite is a drop-in durable backend behind `HistoryStore`; existing
  analytics stays in pure `core/` for now. SQL-driven analytics is a future door, not this
  feature.
- **perHero / roster** → Excluded (local-only exceptions), not synced to Notion.
- **Local backup mechanism** → Instead of an app-managed periodic copy, the user chooses the DB
  folder and may point it at a cloud-synced folder for redundancy.
  **(superseded 2026-07-06, Area C)** — the chosen folder now carries *all* data files
  (`history.db`, `manual.json`, `outbox.json`, `rankAnchors.json`, `screenshots/`, legacy
  `history.json`), not just the SQLite DB, and the choice is also offered at first run (not
  Settings-only). The pointer config key is `dataFolder` (falls back to reading legacy
  `historyDbFolder` for back-compat).
- **(added 2026-07-06) Export update-on-sync mechanism →** an export ledger
  (`OutboxState.records`, matchId → `{ pageId, signature, exportedAt }`) replaces the old
  processed-id list; a content signature detects review/mental-flag changes since last export
  and triggers `pages.update` instead of skip. See "Update-on-sync export ledger (Area A)" above.
- **(added 2026-07-06) Aggregate grade rule →** all graded targets `hit` → `hit`; all `missed` →
  `missed`; any mix (or any `partial`) → `partially`; a single-target review passes through
  unchanged (`aggregateImprovementGrade`, `src/core/targets/aggregateGrade.ts`).

## Open Questions (for `/techplan`)
1. **SQLite driver:** `better-sqlite3` (sync, native rebuild for ow-electron) vs `node:sqlite`
   vs a WASM build — including how the WAL/journal sidecar files behave inside a cloud-synced
   folder. **(resolved during the Area C techplan — see `feedback-batch-2026-07.plan.md` §1
   Area C for the shipped mechanism.)**
2. **New Notion column(s)** for SR-delta (name/type) plus anything else a gap analysis against
   the live Gametracker DB surfaces. **(resolved 2026-07-06 — see the Field coverage section
   above: `srDelta` ships as a new Notion number column, additive/guarded like `Played At`.)**
