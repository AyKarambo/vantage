# Tasks — notion-column-provisioning

Derived from `notion-column-provisioning.plan.md`. Ordered by dependency; each task is
individually implementable and testable. Tick with `- [x]` as they land.

- [x] **T1 — Pure manifest + diff (`gametrackerSchema.ts`)**
  - **Goal:** add `PROVISIONABLE_PROPERTIES` (create payloads for every provisionable column —
    `buildGametrackerProperties` minus `Name`/`Map`, plus the 5 subjective columns),
    `expectedTypeOf`, a shared `classifyColumn` (refactor `diagnoseSubjectiveColumns` onto it),
    `ColumnProvisionPlan`, and `planColumnProvision(properties)` → `{ toCreate, blocked }`.
    Client-free.
  - **Files:** `src/notion/gametrackerSchema.ts`, `test/gametrackerSchema.test.ts`
  - **Check:** unit tests — manifest excludes `Name`/`Map` and every payload's `expectedTypeOf`
    matches the schema's expected type; all-missing → full `toCreate`/no blocked; all-present →
    empty `toCreate` (AC3); wrong-type + near-miss → `blocked`, absent from `toCreate` (AC4);
    optional missing (`SR Delta`) → in `toCreate` (AC1); `classifyColumn` parity with the old
    `diagnoseSubjectiveColumns` outputs. `npm test` green.
  - **Size:** M

- [x] **T2 — `NotionAdmin.ensureColumns` + `validate` returns `provisionPlan`**
  - **Goal:** `ensureColumns(dataSourceId, toCreate)` — early `[]` on empty (no network call),
    else one additive `dataSources.update({ data_source_id, properties })`, returns created
    names; `validate()` computes and returns `provisionPlan` from the retrieved properties.
  - **Files:** `src/notion/notionAdmin.ts`, `test/notionAdmin.test.ts`
  - **Check:** tests — empty `toCreate` → `update` never called, returns `[]` (AC3); non-empty →
    single `dataSources.update` with the additive properties, returns the names; `validate`
    result carries `provisionPlan`. Typecheck clean.
  - **Size:** M

- [x] **T3 — Contract: `SchemaProvisionStatus` + `NotionStatus.schemaProvision`**
  - **Goal:** add `SchemaProvisionStatus { created: string[]; error?: string }` and optional
    `NotionStatus.schemaProvision`, barrelled through `shared/contract`.
  - **Files:** `src/shared/contract/notion.ts`, `src/shared/contract/index.ts` (only if the new
    type needs an explicit re-export)
  - **Check:** main + renderer typecheck clean.
  - **Size:** S

- [x] **T4 — Runtime: validate → provision → re-validate + surface**
  - **Goal:** `validateConfigured()` provisions `toCreate` via `ensureColumns` when a data
    source id is known, then re-validates once so created columns flip into
    `writableColumns`/`hasPlayedAt`/`hasSrDelta` and `buildExporter` picks them up; cache
    `schemaProvision` (created names / error); non-fatal on failure (keep pre-provision result,
    still build exporter); reset `schemaProvision` in `rebuild()`; expose on `status()`. Bounded
    to one provision + one re-validate.
  - **Files:** `src/main/notionRuntime.ts`, `test/notionRuntime.test.ts`
  - **Check:** tests — AC1/AC2: plan with `toCreate` + `dataSourceId` → `ensureColumns` called,
    re-validate healed shape, `status().shapeValid` true, `schemaProvision.created` set,
    exporter rebuilt from healed columns; AC3: empty `toCreate` → `ensureColumns`/update not
    called; AC5: `ensureColumns` rejects → no throw, `schemaProvision.error` set, exporter still
    built (`connected`), still-missing required column keeps `shapeValid === false`.
  - **Size:** L

- [x] **T5 — Renderer: provisioning-outcome section**
  - **Goal:** `renderer/src/views/notion/schemaProvisionCard.ts` exporting
    `schemaProvisionSection(s.schemaProvision)` (win-tone "added N column(s): …", loss-tone
    "Couldn't update the database schema — …; existing columns still sync", `null` when
    neither); append it to the connected `statusCard`. Compose `components/`/`h()`.
  - **Files:** `renderer/src/views/notion/schemaProvisionCard.ts`,
    `renderer/src/views/notion/statusCard.ts`
  - **Check:** renderer typecheck clean; preview harness renders created/error and shows nothing
    on the steady state.
  - **Size:** S

- [x] **T6 — Docs + spec finalize**
  - **Goal:** README Notion bullet + "Optional: Notion sync" note gain the self-healing-schema
    behavior; `specs/screen-notion.spec.md` gains a provisioning constraint/AC; this spec's
    lifecycle → `done`.
  - **Files:** `README.md`, `specs/screen-notion.spec.md`, `specs/notion-column-provisioning.spec.md`
  - **Check:** docs describe auto-provisioning + the transparency note; `npm test` +
    `npm run typecheck` green.
  - **Size:** S

## AC ↔ Task consistency

| Acceptance criterion (spec) | Task(s) |
|---|---|
| AC1 optional column created + written same run | T1 (diff) · T2 (create) · T4 (re-validate → writer) |
| AC2 required column self-heals the sync | T1 · T2 · T4 |
| AC3 idempotent — provision only what's missing | T1 (empty `toCreate`) · T2 (no-op update) · T4 (no call) |
| AC4 wrong-type / near-miss never clobbered | T1 (`blocked`, not `toCreate`) — surfacing via existing diagnostics (T5 shows the provision note; wrong-type/near-miss stay on their existing surfaces) |
| AC5 no permission → report + still export | T4 (catch → `schemaProvision.error`, exporter still built) · T3 (field) · T5 (surface) |
| AC6 DoD: pure diff unit-tested, tests+typecheck green, docs | T1 · T6 |

Gaps: none — every AC maps to ≥1 task. T3 (contract) and T5 (renderer) are the surfacing
enablers for AC5's "reported clearly"; T6 is the Definition-of-Done docs requirement. No task
traces to nothing.
