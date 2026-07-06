# Tasks: `notion-v5-migration`

Derived from [`notion-v5-migration.plan.md`](./notion-v5-migration.plan.md).
Autonomous run — gates self-approved; sonnet implementation, orchestrator-reviewed;
live-workspace validation by the user (they asked for this migration and will test it).

- [x] **T1 — Data-source resolver** _(S)_ — `src/notion/dataSourceResolver.ts` +
  `test/dataSourceResolver.test.ts`. AC 1, 2.
- [x] **T2 — Schema module** _(S)_ — `gametrackerSchema.ts` relation build/read on
  data-source ids (+ its tests). AC 3.
- [x] **T3 — Query paths** _(M)_ — `mapsCache.ts`, `notionImporter.ts` on
  `dataSources.query` via the resolver (+ their tests). AC 1, 2.
- [x] **T4 — Admin** _(M)_ — search/list/create/validate on the data-source model
  (+ its tests). AC 3, 4.
- [x] **T5 — Writer + runtime threading** _(S)_ — data-source page parents; runtime passes the
  validated source id (+ writer/exporter/round-trip tests). AC 5.
- [x] **T6 — Verify** _(S)_ — typecheck + full suite; PR #27 body updated; user live-tests. AC 6.

**Consistency:** AC 1→T1/T3, 2→T1/T3, 3→T2/T4, 4→T4, 5→T5, 6→T6. Gaps/creep: none.
