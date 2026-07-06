# Spec — notion-import

**Updated 2026-07-06** after the `feedback-batch-2026-07` Area B fix (import-merge, hidden
bookkeeping grade, no synthetic target) — see `feedback-batch-2026-07.spec.md` Area B for the
originating problem/requirements and its own acceptance criteria; this file is amended so the two
never diverge on shipped behavior.

## Intent (WHAT & WHY)
Vantage can push match history *to* Notion but never pull it *back*. That leaves users
unable to restore their history on a new machine, or seed Vantage from a log they already
keep in Notion. Add an on-demand import that reads the Gametracker database into local
history — closing the round-trip while staying local-first and opt-in.

## In-Scope
- An **on-demand "Import from Notion"** action (Settings, near the existing Sync/export
  card) using the user's existing token + configured Gametracker database.
- Read **all rows** in the Gametracker DB (including rows hand-added directly in Notion)
  and map Notion properties back to `GameRecord` fields (inverse of the export mapping in
  `notionWriter.ts`).
- **De-duplication by Match ID, with merge** (updated 2026-07-06 — supersedes the original
  skip-only behavior): a row whose Match ID already exists locally is no longer skipped
  outright.
  - If the local match has **no review**, an `Improvement Target` grade recorded in Notion is
    merged in as a **hidden bookkeeping review** (`src/core/notionMerge.ts`,
    `mergeImportedIntoLocal`): the grade is stored under the internal id
    `notion-improvement-target` (`NOTION_IMPROVEMENT_TARGET_ID`,
    `src/core/targets/notionBookkeeping.ts`) — never as a visible `AuthoredTarget`. The match
    now counts as reviewed, not pending.
  - If the local match **already has a review**, the local review is left untouched — local
    wins, always.
  - Mental flags (`Comms`, `Tilt`, `Toxic Mates`, `Leaver`) merge only when the local match has
    **no mental record at all**; an existing local mental record wins wholesale, even for
    individually unchecked flags.
  - Rows with no Vantage Match ID still get a fresh local `manual-notion-*` id and are treated
    as manual; a grade present on such a row arrives **already reviewed** the same way.
- **No visible synthetic target** (updated 2026-07-06): the importer no longer seeds a visible
  `AuthoredTarget` named "Improvement Target" on any path (merge or brand-new row). The Targets
  and Review screens never display or count the internal bookkeeping id; target scoring and
  progression exclude it (`src/core/targets/scoring.ts`).
- **One-time migration**: existing installs have the previously seeded synthetic target
  (matched **by id**, not by name) removed from the manual store on update; stored grades on
  matches are untouched, and the existing `seededBefore` guard prevents re-seeding. A
  user-authored target that merely shares the name "Improvement Target" is unaffected.
- **Round trip stays symmetric**: a bookkeeping grade created by import exports back to the
  Notion `Improvement Target` column like any other grade (see `notion-import.spec.md`'s sibling
  export spec, `feedback-batch-2026-07.spec.md` Area A's aggregate-grade rule).
- Clear import summary (imported / skipped / failed / accounts-added counts).
- **Wipe-for-re-import**: every imported record is flagged (`importedAt`), and a "Delete
  imported matches" action (behind a confirm) removes *only* those records — leaving
  hand-logged and live-tracked matches untouched — so a bad import can be corrected in
  Notion and re-run cleanly. The Notion status reports how many imported matches exist.

## Out-of-Scope
- Ongoing/continuous two-way sync or conflict resolution beyond the grade/mental merge above.
- Overwriting a local review or a fully-populated local mental record from Notion — local
  always wins.
- Deleting local matches to match Notion.
- Changes to the manual-tracking model itself (that's the overhaul spec).

## Constraints
- Local-first, opt-in guardrail: import runs only on explicit user action with their own
  token.
- Reuse the existing Notion client, token storage (`notionToken.ts`), and schema knowledge
  (`gametrackerSchema.ts`); no new secret handling.
- Mapping must tolerate rows missing optional properties without crashing the whole import
  (per-row failure isolation).
- **Depends on the overhaul spec** for any new fields (SR %, leaver-team) to round-trip;
  sequence after it. v1 imports the fields the current schema carries.
- Merge logic (`mergeImportedIntoLocal`) lives in `src/core/notionMerge.ts` — pure,
  Electron-free, unit-tested (guardrail 3).

## Acceptance Criteria
- Given a configured token + Gametracker DB, When I click Import, Then Vantage reads the
  rows and adds new matches to local history, reporting imported/skipped/failed counts.
- Given a local match without a review whose Notion row has `Improvement Target = missed`,
  When the user imports, Then the local match gets a hidden bookkeeping review with grade
  `missed`, no longer counts as pending, and no duplicate is created.
- Given a Notion row with `Improvement Target = hit` and no local counterpart, When the user
  imports, Then a new local match exists, already reviewed (grade `hit`), not in the pending
  queue.
- Given a local match the user already reviewed in the app, When an import runs with a
  different grade in Notion, Then the local review is unchanged (local wins).
- Given a local match with a mental record where `tilt` is unchecked, When the Notion row has
  `Tilt` checked and an import runs, Then the local flag stays unchecked.
- Given any completed import, When the user opens the Targets or Review screens, Then no
  "Improvement Target"/imported target is listed anywhere, and target success-rate stats are
  unaffected by imported grades.
- Given an existing install with the old synthetic target **and** a user-authored target also
  named "Improvement Target", When the app starts after the update, Then only the synthetic one
  is gone; the user's target and all its grades are untouched, and previously imported grades
  remain on their matches.
- Given a match whose only review was created by import, When it is exported or its row
  updated, Then the Notion `Improvement Target` cell carries that grade.
- Given a row hand-added in Notion with no Vantage Match ID, When imported, Then it becomes
  a local manual match with a new id.
- Given a malformed/partial row, When importing, Then that row is skipped with a reported
  error and the rest still import.
- Given no token/DB configured, When I open the import action, Then I'm told to connect
  Notion first (same gating as export).

## Resolved questions
- **Goal** → on-demand pull for restore/migrate (not continuous sync).
- **Row scope** → import all rows, dedup by Match ID; an existing row is no longer skipped
  outright — see **"On a Match ID that already exists locally"** below (resolved 2026-07-06).
- **On a Match ID that already exists locally** (resolved 2026-07-06, was Open Question) →
  **merge, not skip.** A reviewless local match adopts the Notion `Improvement Target` grade as
  a hidden bookkeeping review (`notion-improvement-target`, never a visible target); a mental
  record merges only when the local match has none at all. A local match that already has a
  review or a mental record is left untouched — local wins unconditionally. See
  `feedback-batch-2026-07.spec.md` Area B and `src/core/notionMerge.ts`.
- **Match time round-trip** (resolved 2026-07-05) → the export schema now carries a `Played At`
  **date** property. `NotionWriter` writes the match's `endedAt` into it, and the importer prefers
  it over Notion's `created_time`. This is what makes restore lossless in time: without it, imported
  matches inherited the row's *creation* time (minute-truncated, = when the row was typed), which
  silently scattered restored history — often entirely outside the default 30-day dashboard window,
  so a "successful" import looked empty. `Played At` is **additive and optional**: databases created
  before it (and hand-made ones) still validate and still export, they just fall back to `created_time`
  on import; a user may add a `Played At` date column by hand to control match dates. New auto-created
  Gametracker databases include it.
- **Provenance round-trip** (resolved 2026-07-05) → imported games no longer hard-code `source: 'manual'`.
  Source is inferred from the Match ID (a `manual`-prefixed id ⇒ manual; a real GEP id ⇒ auto), so an
  app-exported (auto-tracked) match restored on a new machine keeps its locked ⚡ facts instead of
  becoming a wrongly-editable ◎ manual row.
- **Import ↔ sync idempotency** (resolved 2026-07-05; hardened 2026-07-06 by
  `notion-sync-dedup.spec.md`, which supersedes the ledger-only mechanism described here) → a
  completed import records every imported match in the export ledger, so a subsequent "Sync to
  Notion" skips/updates instead of writing duplicate rows. Since `notion-sync-dedup`, the link no
  longer depends on local ledger state alone: import **writes the generated Match ID back onto
  id-less rows**, export **never blind-creates** (it resolves existing rows in the database
  first — by `Match ID` cell or by the id derived from the page), and an explicit "Clean up
  duplicate rows" action archives duplicates that predate the fix.
- **Empty-window safety net** (resolved 2026-07-05) → when the active date filter hides *all* history
  (filtered games = 0 but all-time games > 0), the Overview surfaces a "View all time (N games)"
  affordance instead of a blank screen, so restored history with old timestamps is never invisible.
- **Confirmation persistence** (resolved 2026-07-05) → the import result is also shown as a toast, so it
  survives the post-import dashboard re-render (the in-card chip is torn down by the refresh).
- **Accounts round-trip** (resolved 2026-07-05) → import now registers each distinct `Account` label it
  sees as a **name-only** account entry (`label → label`) in the user's config, unless a matching label
  is already mapped (compared case-insensitively). This makes imported accounts appear in the account
  manager, the filters and the rank UI without the user re-creating each by hand. Notion stores only the
  label (never the battleTag), so a name-only entry is the faithful seed — `resolveAccount`'s name-only
  fallback reconnects it to live GEP play from the real battleTag later. The import summary reports how
  many accounts were added.

## Open Questions
- SR%/`srDelta` round-trip is covered by `sqlite-storage-notion-sync.spec.md` (an additive
  Notion `SR Delta` column) — no longer an open question in *this* spec.
