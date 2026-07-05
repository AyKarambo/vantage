# Spec — notion-import

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
- **De-duplication by Match ID**: rows whose Match ID already exists locally are skipped;
  rows with no Vantage Match ID get a fresh local `manual-notion-*` id and are treated as
  manual.
- Clear import summary (imported / skipped / failed counts).

## Out-of-Scope
- Ongoing/continuous two-way sync or conflict resolution beyond dedup.
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

## Acceptance Criteria
- Given a configured token + Gametracker DB, When I click Import, Then Vantage reads the
  rows and adds new matches to local history, reporting imported/skipped/failed counts.
- Given a row whose Match ID already exists locally, When importing, Then it is not
  duplicated.
- Given a row hand-added in Notion with no Vantage Match ID, When imported, Then it becomes
  a local manual match with a new id.
- Given a malformed/partial row, When importing, Then that row is skipped with a reported
  error and the rest still import.
- Given no token/DB configured, When I open the import action, Then I'm told to connect
  Notion first (same gating as export).

## Resolved questions
- **Goal** → on-demand pull for restore/migrate (not continuous sync).
- **Row scope** → import all rows, dedup by Match ID.
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
- **Import ↔ sync idempotency** (resolved 2026-07-05) → a completed import marks every imported Match ID
  as already-processed in the export outbox, so a subsequent "Sync to Notion" skips them instead of
  writing duplicate rows back into the same Gametracker database.
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
- On a Match ID that already exists locally: skip (v1) vs. update-in-place (later).
- SR%/`srDelta` still does not round-trip (the schema carries no SR column), so calculated rank over
  purely-imported history stays near its anchor — deferred to the tracking overhaul.
