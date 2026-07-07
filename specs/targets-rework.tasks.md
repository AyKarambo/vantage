# Tasks: `targets-rework`

Derived from [`targets-rework.plan.md`](targets-rework.plan.md) (`/breakdown` was skipped; `/implement all tasks` did the whole plan in one pass). All items implemented, typecheck + tests green, renderer verified in the browser preview.

## A. Threshold field width
- [x] Widen `.vt-num` 64→96px so a 5-digit per-10 value shows without clipping — `renderer/styles/components.css`.

## B. Scroll-wheel + stepper
- [x] Pure per-stat step map `stepFor` + `COARSE_FACTOR` — `src/core/targets/stepSizes.ts` (+ barrel).
- [x] `attachStepper` wheel helper (Shift ×10, clamp 0, preventDefault) — `renderer/src/app/wheelStepper.ts`.
- [x] Wire into the measured block: per-stat `step`/`min`, live preview with comma formatting — `renderer/src/views/targets/builder.ts`.

## C. Active-set rotation + staleness
- [x] `activatedAt` on `AuthoredTarget`; stamp on activate + create; legacy backfill — `types.ts`, `store/manualLog.ts`, `main/dataProvider.ts`, `preview.ts`.
- [x] Bulk `deactivateAllTargets` IPC (contract → provider → store → preview).
- [x] Pure `isStale` / `StalenessSettings` / `normalizeStaleness` — `src/core/staleness.ts`.
- [x] Staleness config end-to-end (mirror `breakReminder`): `AppConfig`, DashboardData, IPC, `stalenessEditor` in Settings → Coaching.
- [x] `TargetSummary.activatedAt`/`matchesSinceActive` enriched in `computeDashboard` from unfiltered history.
- [x] **Active focus** panel: removable chips, quick-add, "Start a fresh focus", stale nudge — `renderer/src/views/targets/activeSet.ts`.

## D. Templates (flat 9, collapsible)
- [x] New 9-entry coaching-grounded list — `src/core/targets/templates.ts`.
- [x] Collapse to "Show templates" at ≥3 authored; re-expand toggle — `builder.ts`.
- [x] Bump the template-count test bound 8→9 — `test/targetTemplates.test.ts`.

## E. Fully-automatic measured grading
- [x] Shared evaluator: `parseMeasuredRule`/`matchStatValue`/`evaluateMeasured`/`foldMeasuredGradesForExport`/`effectiveImprovementGrade` — `src/core/targets/measured.ts`.
- [x] `scoring.ts` measured branch (`measuredSummary`), createdAt-scoped, skips unmeasurable, ignores stored grades.
- [x] Review screen: measured targets read-only; keyboard cycles self-rated only — `renderer/src/views/review.ts`; `MatchRow.measuredGrades` on the inbox rows.
- [x] Notion export folds measured grades via one shared helper at export + backfill + import-ledger sites (identical derivation) — `notionExporter.ts`, `main/notionRuntime.ts`, `main/index.ts`.

## Tests & docs (DoD)
- [x] New unit tests: `stepSizes`, `staleness`, `measuredTargets` (evaluator + bands + fold + export-signature + measured scoring).
- [x] `npm test` (782 passing) + `npm run typecheck` (main + renderer) green.
- [x] README + `screen-targets.spec.md` + `screen-review.spec.md` updated.
- [x] Browser-preview verification: field width, per-stat scroll steps + Shift-coarse + clamp, comma preview, new templates, template collapse/expand, active-set add/remove + fresh-focus.
