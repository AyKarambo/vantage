# Tasks: `target-templates`

Derived from [`target-templates.plan.md`](./target-templates.plan.md).
Autonomous overnight run — gates self-approved; implementation by a sonnet subagent,
reviewed & preview-verified by the orchestrating session.

- [x] **T1 — Template data + tests** _(S)_ — `src/core/targets/templates.ts` (+ barrel),
  `test/targetTemplates.test.ts`. AC 5.
- [x] **T2 — Builder prefill + template chips** _(M)_ — `renderer/src/views/targets/builder.ts`.
  AC 1, 2.
- [x] **T3 — Focus quick-create + params plumbing** _(S)_ — `renderer/src/views/focus.ts`,
  `renderer/src/views/targets/index.ts`, `renderer/src/store.ts`, `renderer/src/app/shell.ts`.
  AC 3, 4.
- [x] **T4 — Verify + docs** _(S)_ — preview walkthrough AC 1–4; README line. AC 5.

**Consistency:** AC 1→T2, 2→T2, 3→T3, 4→T3, 5→T1/T4. Gaps/creep: none.
