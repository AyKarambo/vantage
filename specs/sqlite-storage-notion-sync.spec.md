# Spec: `sqlite-storage-notion-sync`

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
- **Configurable database location:** the user can choose the folder where the SQLite DB lives
  (default: the current `userData` dir). Pointing it at a cloud-synced folder
  (OneDrive/Dropbox/etc.) gives off-machine redundancy via the sync client. Changing the
  location relocates the existing DB to the new path and persists the choice.
- Close the export/import field gap so a full `GameRecord` round-trips Vantage→Notion→Vantage,
  **except documented local-only fields**.
- **Additive Notion schema migration**: add the columns needed for full parity (notably an
  **SR-delta** number column, currently unsynced), guarded by column-presence like `Played At`
  so legacy databases keep working.
- Keep syncing as **two discrete, idempotent, user-triggered actions** (export, import);
  re-import updates rows changed in Notion.

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

**Configurable database location**
5. **Given** the user sets a new database folder, **when** they confirm, **then** the existing
   DB is relocated there, subsequent reads/writes use the new path, and the setting survives
   restart.
6. **Given** a configured DB path that's missing or unwritable at launch (e.g. the synced
   folder is offline), **when** the app starts, **then** it surfaces a clear error and does
   **not** silently create a fresh empty DB elsewhere (same anti-data-loss principle as #4).

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
10. **Given** a match already exported, **when** export runs again, **then** no duplicate row
    is created; **and given** a Notion row changed since import, **when** import runs again,
    **then** the local record is updated (idempotent both directions, no background merge).

**Guardrails / DoD**
11. **Given** the full suite, **when** `npm test` and `npm run typecheck` run, **then** both
    pass; new pure logic under `src/core/` (e.g. field mapping) ships with unit tests, and
    `README`/docs are updated for the new storage + Notion columns.

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

## Open Questions (for `/techplan`)
1. **SQLite driver:** `better-sqlite3` (sync, native rebuild for ow-electron) vs `node:sqlite`
   vs a WASM build — including how the WAL/journal sidecar files behave inside a cloud-synced
   folder.
2. **New Notion column(s)** for SR-delta (name/type) plus anything else a gap analysis against
   the live Gametracker DB surfaces.
