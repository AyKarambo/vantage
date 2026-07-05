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

## Open Questions
- On a Match ID that already exists locally: skip (v1) vs. update-in-place (later).
- Whether to extend the export schema to carry the overhaul's new fields so import is
  lossless (decide once the overhaul lands).
