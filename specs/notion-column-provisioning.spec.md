---
slug: notion-column-provisioning
status: done
updated: 2026-07-07
---

# Spec — notion-column-provisioning

## Intent (WHAT & WHY)

When Vantage introduces a field that maps to a Notion Gametracker column, that column is
**never added to a user's existing database**. Vantage's expected schema and the live Notion
schema drift apart, and the user has to fix it by hand or re-create the database. Today the
app only ever *validates* the schema — the only schema-writing call anywhere in `src/notion/**`
is `databases.create` (the auto-create flow for a brand-new DB); there is no
`dataSources.update`. So:

- **Required columns** (`REQUIRED_PROPERTIES`): if one is missing, `validate()` returns
  not-ok and `NotionExporter.export()` short-circuits with `"Database is missing: …"` — the
  whole sync refuses to run.
- **Optional columns** (`Played At`, `SR Delta`, and the 5 subjective columns): if absent,
  each write is guarded by `writableColumns.has(...)` and **silently skipped** — the user
  only ever gets the column by adding it themselves or re-creating the DB.

Net: adding a field breaks existing users' syncs (required) or silently no-ops (optional).
Neither reaches an existing database.

This feature makes the Gametracker schema **self-healing**: on validation (which runs
whenever the client is (re)built — token set, database selected, app launch), Vantage
detects the columns it owns and expects but that are **missing** from the configured
database, and **creates them in place** via the Notion data-source update API — additively,
never removing or retyping anything. A required column that used to hard-stop the sync now
heals itself; an optional column a Vantage upgrade adds appears automatically; and the sync
that follows writes the freshly-created columns in the same session. Ambiguous cases
(present-but-wrong-type, near-miss name) are **never clobbered** — they are surfaced, not
touched.

## In-Scope

- **Declarative provisioning manifest.** A single, pure list of every Gametracker column
  Vantage can auto-create on an existing data source, with its exact `dataSources.update`
  property payload (select options pre-seeded to match the writer). Derived from the existing
  schema source of truth (`buildGametrackerProperties` + `OPTIONAL_SUBJECTIVE_PROPERTIES`),
  so a future field addition is a one-line manifest entry. Excludes the two columns that
  can't be provisioned additively: the `Name` **title** (a data source already has exactly
  one title; a second can't be created) and the `Map` **relation** (a relation needs a target
  data source — see Out-of-Scope).
- **Pure schema-diff.** `planColumnProvision(liveProperties)` → `{ toCreate, blocked }`:
  `toCreate` is the subset of the manifest genuinely **missing** from the live schema (with
  their create payloads); `blocked` lists columns present-but-wrong-type or shadowed by a
  near-miss name (trim/case-fold match) — the columns Vantage must **not** create over.
  Idempotent: a column already present with the right type is neither created nor reported.
  Client-free, unit-tested.
- **Provisioning step in `NotionAdmin`.** `ensureColumns(dataSourceId, toCreate)` issues a
  single additive `client.dataSources.update({ data_source_id, properties })`; a no-op when
  `toCreate` is empty (no wasted network call, keeps AC3 idempotent end-to-end).
- **Runtime wiring (self-healing on validate).** `NotionRuntime.validateConfigured()`
  validates, and when the plan has creatable columns and a known data source id, provisions
  them once, then **re-validates** so a just-created column flips into `writableColumns` /
  `hasPlayedAt` / `hasSrDelta` and the rebuilt exporter writes it in the same sync run. The
  provisioning attempt is bounded to once per validate cycle (no retry loop).
- **Failure is non-fatal.** If `ensureColumns` throws (e.g. a token without permission to
  edit the schema), the runtime keeps the pre-provision validation result, surfaces the
  failure, and **still builds the exporter** so the sync runs for the columns that already
  exist. A still-missing *required* column keeps today's clear short-circuit (no crash, no
  partial write); a missing *optional* column is skipped as before.
- **Transparency surfacing.** `NotionStatus` gains a `schemaProvision` field reporting the
  column names Vantage added this cycle and any provisioning error. The Notion status card
  shows a short, honest note ("Vantage added N column(s) to your database" / "Couldn't update
  the database schema — …; existing columns still sync"), because the app is now mutating the
  user's Notion database and should say so.

## Out-of-Scope

- **Auto-creating the `Map` relation.** A relation column needs a target Maps data source;
  that is the auto-create/`createGametracker` flow's job, not additive column provisioning.
  The existing `requireMapRelation` nuance is untouched (Map is only *required* when a Maps
  database is configured), and `Map` is simply excluded from the provisioning manifest.
- **Retyping or renaming existing columns.** Wrong-type and near-miss columns are surfaced,
  never altered or overwritten — destructive schema changes are out of scope (AC4). Renaming
  a near-miss to the canonical name stays a manual user action.
- **Reconciling row data or select-option sets.** This provisions *columns*; it does not
  backfill option values, sync row content, or add missing select options to an existing
  select column.
- **A separate "Repair schema" button / explicit consent gate.** Provisioning of the columns
  Vantage fully owns runs automatically on validate (see Resolved questions); no new button.
- Changing the auto-create-from-scratch flow, the export dedupe/ledger, or the import path.

## Constraints

- **Guardrail 3 (pure core / edges).** The manifest + diff (`planColumnProvision`) are pure
  and client-free (live in `src/notion/gametrackerSchema.ts` alongside the existing validators)
  with unit tests; the `dataSources.update` call stays at the `NotionAdmin` edge.
- **Guardrail 5 (local-first, opt-in).** The schema write happens only inside the user's own
  connected session with their own token, as part of the Notion export they opted into by
  connecting a database. Additive only — never deletes or retypes user columns; non-Vantage
  columns are never touched.
- **Additive only.** `ensureColumns` sends only new properties; it must never send a payload
  that could rename, retype, or remove an existing property.
- **Idempotent.** A second validate against a now-complete schema produces an empty `toCreate`
  and makes **no** `dataSources.update` call.
- **Typed IPC.** `NotionStatus.schemaProvision` is a typed field in `shared/contract`; the
  renderer composes existing `components/` — no hand-rolled markup, no `any` across the
  boundary. Preview harness stubs stay in sync.
- **Bounded provisioning.** At most one provision + one re-validate per `validateConfigured()`
  call — a persistently-failing create must never loop.

## Acceptance Criteria

1. **Optional column created + written same run.** Given a configured DB missing an optional
   Vantage column (e.g. `SR Delta`), When validation runs (on connect / rebuild), Then the
   column is created with the correct type, the re-validation flips it into the writer's
   capabilities, And the subsequent sync exports its value onto the row.
2. **Required column self-heals the sync.** Given a configured DB missing a *required* column,
   When validation runs, Then the column is auto-created and the re-validation reports a valid
   shape, so the export no longer short-circuits with "Database is missing" and the sync
   proceeds.
3. **Idempotent — provision only what's missing.** Given every expected column already present
   (even with extra unrelated user columns around them), When validation runs, Then
   `toCreate` is empty And **no** `dataSources.update` call is made.
4. **Wrong-type / near-miss never clobbered.** Given a column present but the wrong type, or a
   near-miss name (e.g. `sr delta` vs `SR Delta`, `comms ` vs `Comms`), When validation runs,
   Then that column is **not** created over (it appears in `blocked`, not `toCreate`), the
   live column is left exactly as-is, And it is surfaced to the user (via the existing
   shape-mismatch / subjective-column diagnostics, unchanged).
5. **No schema-edit permission → report + still export.** Given a token that cannot edit the
   database schema, When validation attempts provisioning and the `dataSources.update` fails,
   Then the failure is reported in `NotionStatus.schemaProvision`, no exception escapes, And
   the exporter is still built so the sync runs for the columns that already exist (a
   still-missing required column keeps the existing clear short-circuit — no crash, no partial
   corruption).
6. **DoD.** The pure schema-diff logic (expected vs live → to-create list, with blocked
   classification) is unit-tested; `npm test` and `npm run typecheck` (main + renderer) are
   green; README and this spec's screen doc (`specs/screen-notion.spec.md`) are updated.

## Resolved questions

*(Autonomous run — the issue's open questions self-answered from the issue's own
recommendations, the codebase and the guardrails; recorded here for review.)*

- **Auto on every sync vs. explicit action + consent?** → Auto-provision the columns Vantage
  **fully owns** (exact name + type defined by the manifest) on validate, matching the
  issue's recommendation. Gate *ambiguous* cases (wrong-type / near-miss) behind no write at
  all — surface them, never touch them. Rationale: the write is additive and reversible (the
  user can delete a column), Vantage already auto-creates the whole schema in the create flow,
  and a per-sync confirm dialog for columns the app unambiguously owns is friction without
  safety. Transparency is provided by the `schemaProvision` status note instead of a gate.
- **Which columns count as "Vantage-owned" and provisionable?** → Everything in the
  create-from-scratch schema (`buildGametrackerProperties`) **plus** the 5 subjective columns
  (`OPTIONAL_SUBJECTIVE_PROPERTIES`) — the issue names both as the diff's source of truth.
  The writer already writes all of them when present; provisioning simply makes "present" the
  default so the export→import round-trip is symmetric instead of silently lossy. Excluded:
  the `Name` title and the `Map` relation (can't be added additively).
- **Where does provisioning run so a created column is written in the same sync?** → Inside
  `validateConfigured()` (the issue's stated wiring): validate → provision → **re-validate** →
  `buildExporter` with the healed capabilities. `validateConfigured` already runs on every
  `rebuild()` (token set, app launch) and `adopt()` (database select/create), so by the time
  the user hits Sync the columns exist and are writable.
- **What if provisioning partially/fully fails?** → Best-effort and non-fatal: catch, surface
  in `schemaProvision.error`, fall back to the pre-provision validation, and still build the
  exporter. A missing optional column stays skipped (today's behavior); a missing required
  column keeps today's "Database is missing" short-circuit. No regression, no crash.
- **Does the diff need its own type machinery?** → No — the expected type of each provisionable
  column is read straight off its create payload's single key, and the wrong-type / near-miss
  classification reuses the exact logic already proven in `diagnoseSubjectiveColumns`
  (refactored into a shared classifier so the two never diverge).

## Open Questions

- None blocking. Possible follow-up (out of scope here): surface a near-miss / wrong-type on
  the two non-required, non-subjective Vantage columns (`Played At`, `SR Delta`) in the UI —
  today those two shadow cases stay silent (same as pre-feature behavior), whereas required
  and subjective shadow cases are already surfaced.
