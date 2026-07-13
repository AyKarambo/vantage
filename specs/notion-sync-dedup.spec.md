---
slug: notion-sync-dedup
status: done
updated: 2026-07-06
---

# Spec — notion-sync-dedup

## Intent (WHAT & WHY)

Users who hand-track matches in Notion end up with **duplicate rows in their Gametracker
database after a sync**. Their hand-added rows have an empty `Match ID` column, and the only
link between a local match and its Notion page is the local export ledger (`outbox.json`).
Whenever that link is missing, "Sync to Notion" cannot find the existing row and blindly
creates a new one:

1. **Legacy backfill hole (the reported bug).** Imports made before the full-ledger change
   only marked ids in the legacy `processed[]` list. The one-time backfill resolves those via
   a `Match ID` query — hand-added rows have an empty `Match ID` cell, the query finds
   nothing, and the "row truly gone → recreate" path duplicates every one of them.
2. **Ledger loss.** Restoring history on a new machine (or losing `outbox.json`) makes every
   match "not in the ledger"; sync then re-creates rows that already exist in Notion —
   including GEP rows whose `Match ID` *is* in Notion, because the create path never queries.

The fix makes the Notion row itself the durable link (write the match id back onto the row at
import — the user's suggestion) and makes export **never blind-create** (resolve existing rows
in the configured database first, by `Match ID` text or by the page id embedded in
`manual-notion-*` ids). An explicit, opt-in cleanup action removes the duplicates that already
exist. Result: sync is idempotent against the Notion database itself, not just against local
ledger state.

## In-Scope

- **Match ID write-back on import.** When an imported row has an empty `Match ID` cell, the
  import stamps the generated `manual-notion-<hex>` id into it (best-effort, per-row isolated
  — a failed stamp never fails the row's import). Rows that already carry an id are untouched.
- **Export create-guard (no blind creates).** Before creating a page for a match that has no
  usable ledger record, the exporter resolves existing rows in the configured database and
  adopts a match found there (update in place + re-ledger) instead of creating. Resolution
  matches by `Match ID` text, and for rows with an *empty* `Match ID` cell by the derived id
  `manual-notion-<page id>` — exactly the id the importer would generate — so hand-added rows
  are found even though their column is empty. Lookups are served from **one lazy paged scan**
  of the database per sync run (only when at least one unledgered match is encountered), not
  per-match queries.
- **Legacy backfill uses the same resolution.** The pre-ledger `processed[]` backfill goes
  through the same find-or-create guard, so hand-added rows heal (adopt + stamp `Match ID`)
  instead of duplicating. Adopting a row whose `Match ID` cell is empty stamps the id as part
  of the adoption.
- **Deterministic duplicate handling on import.** When several Notion rows map to the same
  match id (the shape existing duplicates have: original hand row + re-created copy), import
  picks one **canonical row** deterministically — the page whose id the `manual-notion-*` id
  embeds, else the ledgered page, else the earliest-created — imports/ledgers only that one,
  and reports the redundant copies as a `duplicates` count in the import summary. Redundant
  copies are *not* stamped with a match id and *not* deleted by import.
- **Opt-in duplicate cleanup.** A "Clean up duplicates" action on the Notion screen (visible
  when connected), behind an explicit confirm, re-scans the database at action time, groups
  rows by effective match id (cell text, else derived from page id), keeps the canonical row
  of each group (stamping its `Match ID` if empty, re-pointing the ledger at it) and archives
  the redundant copies (Notion trash — restorable ~30 days). Reports archived/kept/failed
  counts. Nothing is ever archived implicitly by sync or import.
- `ImportResult` gains `duplicates?: number`; the sync card's import summary and toast show it.
- Docs: README Notion section updated.

## Out-of-Scope

- Correlating a hand-tracked Notion row with a *locally tracked GEP match* of the same real
  game (no shared key exists — different-id duplicates across tracking methods stay as-is).
- Continuous two-way sync, conflict resolution, or merging *content* between duplicate rows
  (the canonical row wins wholesale; archived copies are recoverable from Notion trash).
- Deleting anything in Notion without the explicit cleanup action + confirm.
- Changes to the local merge rules (`mergeImportedIntoLocal` — local always wins) or to the
  export signature scheme.
- Normalizing dashed/undashed database-id formats in config (noted as a possible follow-up).

## Constraints

- Guardrail 5 (local-first, opt-in): all new Notion writes (stamping, cleanup archiving) run
  only inside the user's explicit Import / Sync / Clean-up actions with their own token.
- Guardrail 3: grouping/canonical-selection logic is pure and lives under `src/core/` (or as
  pure functions in `src/notion/` without client imports) with unit tests; Notion API calls
  stay at the edge.
- Per-row failure isolation everywhere: a failed stamp, failed adoption lookup, or failed
  archive affects only that row's outcome and is counted, never thrown.
- The lazy scan reuses the existing paged `dataSources.query` pattern; no new API surface
  beyond `pages.update` (already used) and the existing query/retrieve calls.
- Keep the IPC contract typed end-to-end (`shared/contract`); renderer changes compose
  existing `components/` (confirm modal, toast) — no hand-rolled markup.
- `Match ID` stamping must not alter the export signature semantics (signature covers grade +
  mental flags only) — a stamp alone must not flip a `skipped` match to `updated`.

## Acceptance Criteria

1. **Import write-back.** Given a hand-added Notion row with an empty `Match ID` cell, When
   the user runs Import, Then the row is imported under `manual-notion-<page id>` as before
   And the row's `Match ID` cell in Notion now contains that id.
2. **Write-back is best-effort.** Given a row whose `Match ID` stamp fails (e.g. API error),
   When the user runs Import, Then the row still imports normally and the import summary is
   unaffected except that the stamp is skipped.
3. **No duplicate from the legacy backfill.** Given a local `manual-notion-*` match that is
   only in the legacy `processed[]` list (no ledger record) whose originating Notion row still
   exists with an empty `Match ID` cell, When the user syncs, Then the existing row is updated
   in place (and its `Match ID` stamped), the ledger adopts it, And no new row is created.
4. **No duplicate after ledger loss (hand row).** Given a local `manual-notion-*` match with
   no ledger record at all whose originating row exists in the configured database, When the
   user syncs, Then the existing row is adopted (no create).
5. **No duplicate after ledger loss (GEP row).** Given a local GEP match with no ledger record
   whose exported row (with `Match ID` text) exists in the configured database, When the user
   syncs, Then that row is adopted and updated in place (no create).
6. **Genuinely new matches still export.** Given a local match with no ledger record and no
   matching row in the database, When the user syncs, Then a new row is created exactly as
   before, And the scan runs at most once per sync run.
7. **Database switch still creates fresh.** Given a match ledgered against a previously
   configured database, When the user syncs into a newly configured database that has no
   matching row, Then a fresh row is created in the new database (existing affinity behavior
   preserved).
8. **Duplicate detection on import.** Given a database containing a hand row (empty
   `Match ID`) and its re-created copy (`Match ID` = the hand row's derived id), When the user
   runs Import, Then exactly one local match exists, the ledger points at the canonical (hand)
   row, And the import summary reports `duplicates: 1`.
9. **Cleanup archives redundants only.** Given the same duplicate pair plus an unrelated
   unique row, When the user runs "Clean up duplicates" and confirms, Then the redundant copy
   is archived, the canonical row remains (with `Match ID` stamped), the unique row is
   untouched, And the result reports archived=1.
10. **Cleanup is explicit.** Given duplicates exist, When the user only runs Import or Sync,
    Then no Notion row is archived.
11. **Cleanup failure isolation.** Given a duplicate group whose archive call fails, When the
    user runs cleanup, Then other groups still process and the failure is counted in the
    result.
12. **Stamp doesn't dirty the signature.** Given an imported-and-ledgered match with no local
    changes, When the user syncs, Then the match is still `skipped` (the stamp/adoption
    doesn't force an update of unchanged matches).

## Resolved questions

*(Autonomous run — clarifications self-answered from the codebase, git history and the user's
message; recorded here for review.)*

- **What actually caused the user's duplicates?** → The legacy `processed[]` backfill
  (`backfillLegacy`) re-creating hand-added rows it couldn't find by `Match ID` query (their
  cell is empty). Confirmed by reading `notionExporter.ts` + `outbox.ts`: `recordImported`
  full-ledger records only exist since feedback-batch-2026-07; earlier imports left only
  `processed[]` markers.
- **"Write back the match id" — import direction or export direction?** → Import ("when
  importing [from] Notion"): stamp the generated id onto id-less rows. Also adopted on the
  export side: any adoption of an id-less row stamps it, so both directions heal.
- **Per-match query vs. one scan for the create-guard?** → One lazy paged scan per sync run
  (100 rows/page), built only when the first unledgered match is hit. Cheaper (500 rows = 5
  requests vs. 500 queries), and it can index id-less rows by derived id, which a `Match ID`
  query can never find.
- **Should cleanup run automatically after import detects duplicates?** → No. Archiving rows
  in the user's Notion is destructive-adjacent; guardrail 5's spirit demands an explicit
  action + confirm. Import only *reports* the count.
- **Which duplicate row is canonical?** → The page whose id the `manual-notion-*` id embeds
  (the user's original hand row — it may carry hand-authored extra columns Vantage doesn't
  track), else the ledgered page, else the earliest `created_time`. Deterministic and
  data-preserving.
- **Does stamping `Match ID` require a schema change?** → No. `Match ID` (rich_text) is a
  required Gametracker column; stamping uses the existing `pages.update` call. Wrong-typed
  columns fail per-row and are skipped (best-effort).

## Open Questions

- None blocking. Possible follow-up: normalize dashed/undashed Notion ids before database-
  affinity comparison (defensive; not observed in the wild).
