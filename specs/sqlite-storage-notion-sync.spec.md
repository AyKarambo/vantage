# Spec: `sqlite-storage-notion-sync`

## Intent

Vantage's match history persists in an embedded **SQLite** database (`history.db`) behind the existing `HistoryStore` interface — ACID-durable (no silent fallback-to-empty data-loss footgun) and a foundation for future SQL-driven analytics. The user controls **where all data files live**, so a cloud-synced folder can provide off-machine redundancy. **Notion is the backup target with round-trip parity:** every analytics-meaningful field Vantage stores exports to Notion and imports back, with a small, explicitly documented set of inherently-local exceptions.

## Storage engine

- The storage engine behind `HistoryStore` is SQLite; the public interface and observable behavior are preserved exactly (callers in `core/`, `main/`, renderer are unchanged).
- **One-time auto-migration:** an existing `history.json` is imported into SQLite on first launch; the JSON file is left on disk untouched as a frozen backup and is no longer written.
- Every `HistoryStore` operation (`add`, `addMany`, `editManual`, `relabelAccount`, `removeImported`, `setReview`, `clearReview`, `setReviews`, …) returns the same results and enforces the same match-id dedupe semantics as the old JSON implementation.
- The SQLite native dependency builds for ow-electron and packages into the release installer. The browser preview runs `core/` against fixtures, not the real store, so the edge swap doesn't touch that path.

## All-files data folder

- **First run** (alongside the demo-data prompt, before meaningful data is written) asks where to store data: the default (`userData/data`, preselected) or a custom folder via a native directory picker. An invalid choice (not creatable/writable) shows the specific reason and re-prompts, writing nothing. If the chosen folder already contains Vantage data (a `history.db`), it is **adopted as-is** — no migration, no overwrite. Existing installs (data already present) see no prompt.
- **Settings → Data storage** shows the current folder and offers **Change…**, migrating **all** data files (`history.db`, `manual.json`, `outbox.json`, `rankAnchors.json`, and the frozen legacy `history.json` when present) with a copy-verify-then-delete guarantee: originals are removed only after the switch is committed; failures leave the old location fully intact; missing optional files are skipped. A target that already contains Vantage data offers **adopt or cancel** — never overwrite.
- The pointer (`config.local.json`, `dataFolder`) stays in `userData`; all data files live under the chosen folder. `loadConfig` reads `dataFolder ?? historyDbFolder` for back-compat with the old DB-only pointer.
- UI copy notes that synced folders are great for backup but should be used from one machine only (simultaneous multi-machine writes can corrupt the DB).

## Notion round-trip parity

Both directions (export, import) stay **explicit, user-triggered** actions — there is no automatic outbound Notion traffic (guardrail 5).

- A full `GameRecord` round-trips Vantage → Notion → Vantage on all synced fields, except documented local-only fields.
- **Update-on-sync export ledger** (`src/store/outbox.ts`, `OutboxState.records: matchId → { pageId, signature, exportedAt }`): each manual sync compares a match's **content signature** (`matchExportSignature` — a hash of the post-export-mutable fields: review grade + mental flags) against the last-recorded one. A changed signature updates the existing page in place (`pages.update`), symmetric — setting a value fills the cell, clearing a flag/grade clears it. A deleted/archived page is recreated and the result notes it. Import-created rows get a full ledger entry too, so an imported-then-locally-edited row updates in place instead of being recreated.
- The `Improvement Target` value is the **aggregate grade** derived from the review's target grades (`aggregateImprovementGrade`, `src/core/targets/aggregateGrade.ts`): all `hit` → `hit`; all `missed` → `missed`; any mix (or any `partial`) → `partially`; a single-target review passes through unchanged.
- **No silent column skips:** the Notion screen shows a per-column sync status (written / skipped, with the reason: column missing, wrong type, no value); a near-miss column name (matches after trimming whitespace and case-folding) is called out explicitly.
- Dedupe against the Notion database itself (never blind-create) is specified in `notion-sync-dedup.spec.md`; additive schema self-healing (creating missing Vantage-owned columns) in `notion-column-provisioning.spec.md`.

## Field coverage (defines "analytics-complete")

**Synced & round-tripped:** matchId, endedAt (Played At), account, role, map, result, gameType, source (gep↔Auto / manual↔Manual), srDelta, durationMinutes, heroes, finalScore, battleTag, queueType, eliminations, deaths, assists, damage, healing, mitigation, groupSize, mental flags (Tilt / Toxic Mates / Leaver / Comms), primary improvement-target grade.

**Documented local-only exceptions (intentionally not synced):** `roster` (other players' TAB stats — scope + not the user's own analytics), `perHero` (within-match per-hero splits), improvement-target grades beyond Notion's single `Improvement Target` column, `review.at` timestamp, `importedAt` (internal import bookkeeping — must never sync).

## Out-of-Scope

- Continuous/background two-way sync, live conflict resolution, or per-field merge.
- Moving existing analytics computation into SQL queries (future work; the door is left open).
- Multi-device sync, or simultaneous multi-machine access to a cloud-synced DB file.
- NSIS installer custom pages for the data folder — the folder is chosen in-app only.

## Constraints

- **Guardrails intact:** `core/` stays pure & Electron-free (SQLite lives at the `src/store/` edge only); GEP-only data; renderer stays one CSP-friendly bundle; Notion export stays opt-in with the user's own token; no secrets in git.
- **Backward compatibility:** users upgrading mid-stream (JSON→SQLite), and legacy Notion databases missing newer columns, both keep working without manual steps.
- Export/import mappings for shared fields stay **exact inverses**.
- A write interrupted by crash or power loss leaves the database intact with no committed data lost (no silent fallback to empty).
- Cloud-synced DB folders are supported for **single-machine redundancy only**; simultaneous multi-machine access to the synced file remains a non-goal.

## Acceptance Criteria

1. Given an existing `history.json` and no SQLite DB, when the app launches after update, then every game is imported into SQLite, `history.json` is left byte-for-byte unmodified, and the dashboard shows an identical dataset.
2. Given a populated SQLite DB, when the app launches, then `history.json` is not read again and SQLite is the sole source of truth.
3. Given a write interrupted by crash or power loss, when the app restarts, then the database is intact and no committed data is lost.
4. Given a `GameRecord` with every synced field populated, when it is exported to Notion and then imported into a fresh history, then the reconstructed record equals the original on all synced fields.
5. Given the user's Gametracker DB lacks a newer column (e.g. SR-delta), when export runs, then the missing column is added/surfaced additively and all existing columns and rows are untouched (see `notion-column-provisioning.spec.md`).
6. Given a documented local-only field (roster, perHero, extra named-target grades, importedAt), when round-tripping, then it is intentionally absent in Notion and its absence after import is expected — not flagged as data loss.
7. Given a match already exported whose review/mental flags changed since, when the user syncs, then the existing page is updated in place (no duplicate row); given the page was deleted, it is recreated and the result notes it.
8. Given a match reviewed with three targets graded hit / hit / missed, when it is exported, then the Notion row has `Improvement Target = partially`.
9. **First run:** given a fresh install, when the app launches for the first time, then the user is asked for a data location with the default preselected, and all subsequently written data files land in the chosen folder; a non-writable choice shows the reason and re-prompts, writing nothing there.
10. **Adopt:** given a fresh install pointed at a folder containing a previous installation's data, when first run completes, then that data is adopted and none of it is overwritten.
11. **Settings migration:** given data in the default location, when the user changes the folder to an empty writable folder, then all data files move, the old location is left without stale copies, and a relaunch loads the same history from the new location; a folder that already holds Vantage data offers adopt-or-cancel (never overwrite); a non-writable target is rejected with a clear error and the old location stays active.
12. Given an existing install updating to this version, when the app launches, then no data-location prompt appears and data stays in place.
