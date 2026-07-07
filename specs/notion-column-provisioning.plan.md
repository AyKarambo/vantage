# Techplan — notion-column-provisioning

Derived from `specs/notion-column-provisioning.spec.md` (status: planned). Grounded in a read
of the Notion edge (`gametrackerSchema.ts`, `notionAdmin.ts`, `notionRuntime.ts`,
`notionWriter.ts`, `notionExporter.ts`), the IPC contract (`shared/contract/notion.ts`), the
renderer Notion views, and the `@notionhq/client` 5.22 `dataSources.update` types.

## Architecture & Approach

The schema source of truth already lives in the pure `gametrackerSchema.ts`; provisioning is a
thin additive write on top of it, wired into the existing validate→buildExporter path so a
created column is immediately writable. Four layers:

### 1. Pure manifest + diff — `src/notion/gametrackerSchema.ts` (extended, still client-free)

- **`PROVISIONABLE_PROPERTIES: Record<string, unknown>`** — the exact `dataSources.update`
  property-create payloads for every Gametracker column Vantage can add to an *existing* data
  source. Built by merging:
  - `buildGametrackerProperties(undefined)` **minus** `Name` (title) — a data source already
    has one title; `buildGametrackerProperties(undefined)` already omits `Map` (no maps id),
    so the relation is excluded for free.
  - the 5 subjective columns with their create payloads: `Comms` / `Improvement Target` /
    `Leaver` → `{ select: {} }`, `Tilt` / `Toxic Mates` → `{ checkbox: {} }`.
  Select options for `Source` / `Role` / `Result` stay pre-seeded (they come from
  `buildGametrackerProperties`), so a provisioned select matches the writer's option names.
  This is the "declarative manifest" the issue asks for — a future field is one new entry.
- **`expectedTypeOf(payload)`** = the single key of a create payload (`{ number: {} }` →
  `'number'`) — lets the diff derive expected types from the manifest, no parallel type table.
- **`classifyColumn(properties, column, expectedType): SubjectiveColumnStatus`** — the
  four-state classifier (`available` / `wrong-type` / `near-miss` / `missing`) extracted from
  the body of the existing `diagnoseSubjectiveColumns`, which is refactored to call it so the
  two can't diverge. Near-miss = a live property whose name trim/case-folds to the column but
  isn't the canonical name.
- **`planColumnProvision(properties): ColumnProvisionPlan`** — walks `PROVISIONABLE_PROPERTIES`,
  classifies each column, and returns:
  ```ts
  export interface ColumnProvisionPlan {
    toCreate: Record<string, unknown>;   // missing → its create payload (for dataSources.update)
    blocked: SubjectiveColumnDiag[];      // wrong-type | near-miss → surfaced, never created
  }
  ```
  `available` columns are skipped (idempotent — AC3); `missing` → `toCreate`; `wrong-type` /
  `near-miss` → `blocked` (AC4). Pure ⇒ direct unit tests (`test/gametrackerSchema.test.ts`).

### 2. Provisioning edge — `src/notion/notionAdmin.ts`

- **`ensureColumns(dataSourceId, toCreate): Promise<string[]>`** — returns early with `[]`
  when `toCreate` is empty (**no** network call — AC3). Otherwise one additive
  `await this.client.dataSources.update({ data_source_id: dataSourceId, properties: toCreate as any })`
  and returns the created column names (`Object.keys(toCreate)`). Additive only — never sends
  a rename/retype/remove. Errors propagate to the caller (the runtime decides fallback).
- `validate()` gains **`provisionPlan: ColumnProvisionPlan`** on its `ValidateResult`, computed
  from the same live `properties` it already reads for the other diagnostics — so the runtime
  gets the plan without a second retrieve. (`ValidateResult` already carries `dataSourceId`.)

### 3. Runtime wiring — `src/main/notionRuntime.ts`

- New cached field `private schemaProvision?: { created: string[]; error?: string }` and a
  `provisionAttempted` guard local to the validate cycle.
- **`validateConfigured()`** becomes: validate once → if `result.provisionPlan.toCreate` is
  non-empty **and** `result.dataSourceId` is known, `try { created = await
  admin.ensureColumns(dsId, toCreate); result = await admin.validate(...) }` (re-validate so
  freshly-created columns land in `writableColumns` / `hasPlayedAt` / `hasSrDelta`) `catch
  { schemaProvision = { created: [], error } }` and keep the first `result`. Set
  `schemaProvision.created` from the successful create. Then the existing tail runs unchanged:
  cache `shapeCheck` / `hasPlayedAt` / `hasSrDelta` / `writableColumns` / diagnostics from the
  (re-validated) `result`, and `buildExporter(valid ? undefined : issues)`. Bounded to one
  provision + one re-validate (no loop).
- **`rebuild()`** resets `schemaProvision = undefined` alongside the other cached fields.
- **`status()`** returns `schemaProvision: this.schemaProvision`.
- No change to `buildExporter` beyond it reading the (already re-validated) `writableColumns` —
  the created column flows into the `NotionWriter` exactly like a hand-added one does today.

### 4. Contract + surfacing + preview

- `src/shared/contract/notion.ts`: `NotionStatus.schemaProvision?: SchemaProvisionStatus` with
  `interface SchemaProvisionStatus { created: string[]; error?: string }`.
- `renderer/src/views/notion/statusCard.ts`: a small `schemaProvisionSection(s.schemaProvision)`
  appended to the connected card (next to `subjectiveColumnsSection`): a win-tone line
  "Vantage added N column(s): …" when `created.length`, and a loss-tone line "Couldn't update
  the database schema — <error>. Existing columns still sync." when `error`. Returns `null`
  when neither — no visual noise on the steady state. Composed with `h()`; extracted into
  `renderer/src/views/notion/schemaProvisionCard.ts` to mirror `subjectiveColumnsCard.ts`.
- `renderer/preview/preview.ts`: `notionStatus` stub already returns a `NotionStatus`; the new
  field is optional so the stub compiles unchanged (leave it unset → section renders nothing).

## Affected Files/Modules

| File | Change |
|---|---|
| `src/notion/gametrackerSchema.ts` | **+** `PROVISIONABLE_PROPERTIES`, `expectedTypeOf`, `classifyColumn` (refactor `diagnoseSubjectiveColumns` onto it), `planColumnProvision`, `ColumnProvisionPlan` |
| `src/notion/notionAdmin.ts` | **+** `ensureColumns`; `validate()` returns `provisionPlan` |
| `src/main/notionRuntime.ts` | validate→provision→re-validate in `validateConfigured()`; `schemaProvision` cache; reset in `rebuild()`; expose on `status()` |
| `src/shared/contract/notion.ts` | **+** `SchemaProvisionStatus`, `NotionStatus.schemaProvision?` |
| `src/shared/contract/index.ts` | barrel the new type if needed (it's exported from `notion.ts`, already re-barreled) |
| `renderer/src/views/notion/schemaProvisionCard.ts` | **new** — provisioning-outcome section |
| `renderer/src/views/notion/statusCard.ts` | append `schemaProvisionSection` to the connected card |
| `test/gametrackerSchema.test.ts` | **+** manifest/diff cases (or new file if none exists) |
| `test/notionAdmin.test.ts` | `ensureColumns` (no-op vs update call, additive payload); `validate` returns `provisionPlan` |
| `test/notionRuntime.test.ts` | validate→provision→re-validate; idempotent (no update); failure non-fatal + surfaced; `status().schemaProvision` |
| `README.md`, `specs/screen-notion.spec.md` | docs: self-healing schema on connect |

## Data Model / Interfaces

```ts
// src/notion/gametrackerSchema.ts
export const PROVISIONABLE_PROPERTIES: Record<string, unknown>;
export function expectedTypeOf(payload: unknown): string;
export function classifyColumn(
  properties: Record<string, { type?: string } | undefined>,
  column: string,
  expectedType: string,
): SubjectiveColumnStatus;
export interface ColumnProvisionPlan {
  toCreate: Record<string, unknown>;
  blocked: SubjectiveColumnDiag[];
}
export function planColumnProvision(
  properties: Record<string, { type?: string } | undefined>,
): ColumnProvisionPlan;

// src/notion/notionAdmin.ts
interface ValidateResult { /* …existing… */ provisionPlan: ColumnProvisionPlan }
ensureColumns(dataSourceId: string, toCreate: Record<string, unknown>): Promise<string[]>;

// src/shared/contract/notion.ts
export interface SchemaProvisionStatus { created: string[]; error?: string }
export interface NotionStatus { /* …existing… */ schemaProvision?: SchemaProvisionStatus }
```

`ExportResult` is unchanged — a provisioned column is written through the existing writer
buckets. `SubjectiveColumnDiag` (already in the contract) is reused for `blocked` entries.

## Test Strategy (maps to spec ACs)

Existing patterns reused: `mockClient()` in `test/notionAdmin.test.ts` (add
`dataSources.update: vi.fn()`); the `validateMock` + microtask-flush harness and
`connectedRuntime()` in `test/notionRuntime.test.ts`.

- **`test/gametrackerSchema.test.ts`** — manifest excludes `Name`/`Map`; every payload's
  `expectedTypeOf` matches `REQUIRED_PROPERTIES`/`OPTIONAL_SUBJECTIVE_PROPERTIES` expected
  types; `planColumnProvision`: all-missing → full `toCreate`, none blocked (AC2); a present
  optional (e.g. `SR Delta`) absent → in `toCreate` (AC1); all-present → empty `toCreate`
  (AC3); wrong-type + near-miss → `blocked`, absent from `toCreate` (AC4); `classifyColumn`
  parity with the pre-refactor `diagnoseSubjectiveColumns` outputs.
- **`test/notionAdmin.test.ts`** — `ensureColumns` no-op (empty `toCreate` → `update` never
  called, returns `[]`, AC3) vs. one additive `dataSources.update({ data_source_id, properties })`
  returning the created names; `validate()` result now carries a `provisionPlan` computed from
  the retrieved properties.
- **`test/notionRuntime.test.ts`** — AC1/AC2: `validate` mock returns a plan with `toCreate`
  and a `dataSourceId` → runtime calls `ensureColumns` then re-validates (second `validate`
  returns the healed shape) → `status().schemaValid` true, `schemaProvision.created` set, and
  the exporter is rebuilt from the healed `writableColumns`; AC3: plan with empty `toCreate` →
  `ensureColumns` not called (no `dataSources.update`), single validate; AC5: `ensureColumns`
  rejects → no throw, `schemaProvision.error` set, exporter still built (status `connected`),
  a still-missing required column still yields `shapeValid === false` + issues.
- **Renderer** — typecheck; manual preview check that the section renders created/error and is
  absent on the steady state.

## Risks & Alternatives

- **Auto-mutating the user's Notion DB is surprising.** Mitigated: additive + reversible;
  transparency note in `schemaProvision`; only the columns Vantage unambiguously owns; nothing
  ambiguous is ever touched. Alternative (explicit "Repair schema" button + confirm) rejected
  per the issue's recommendation — friction without safety for owned columns.
- **`dataSources.update` payload shape.** Verified against `@notionhq/client` 5.22
  `UpdateDataSourceParameters.properties` — same per-type config objects
  (`{ select: { options } }`, `{ number: {} }`, `{ date: {} }`, `{ checkbox: {} }`,
  `{ multi_select: {} }`, `{ rich_text: {} }`) the create flow already uses; cast `as any` at
  the call site exactly like `buildGametrackerProperties`.
- **Re-validate cost.** One extra `databases.retrieve` + `dataSources.retrieve` only when
  something was actually created; the steady state (nothing missing) does a single validate and
  no update — no added round-trips for the common case.
- **Title / Map exclusion.** A user whose title column isn't named `Name`, or who lacks the
  `Map` relation, is unaffected: title is never provisioned (would fail — a second title),
  `Map` stays governed by `requireMapRelation` and the create flow. Both are explicitly out of
  the manifest.
- **Provision loop.** Bounded to one attempt + one re-validate per `validateConfigured()`; a
  persistently-rejecting update surfaces the error and stops, never retries in a loop.
