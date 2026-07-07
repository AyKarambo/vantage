# Tasks: Log Match screen improvements

Ordered foundation-first. Derived from [log-match-improvements.plan.md](log-match-improvements.plan.md).

## Core & contract

- [x] **T1 — Comms tone model + helpers**
  - Goal: add `CommsTone` + `MatchMental.comms` (keep `positiveComms` legacy); add `commsTone`/`isPositiveComms`/`isAbusiveComms`.
  - Files: `src/core/analytics/types.ts`, `src/core/comms.ts` (new), `src/core/analytics/index.ts` (export), `test/comms.test.ts` (new).
  - Check: `test/comms.test.ts` green — tone prefers `comms`, falls back to legacy `positiveComms`.
  - Size: S

- [x] **T2 — Mental composite: positive via helper + surface `abusive`**
  - Goal: posShare/rowFlags read via `isPositiveComms`; `MatchFlagKey += 'abusive'`; `MentalSummary.flags.abusive`; fix `session.ts` recap + `readiness/signals.ts` positive reads.
  - Files: `src/core/mental.ts`, `src/core/analytics/session.ts`, `src/core/readiness/signals.ts`, `test/mentalSummary.test.ts`, `test/rowFlags.test.ts`, `test/readiness.test.ts`.
  - Check: a `comms:'positive'` and a legacy `positiveComms:true` game score identically; `comms:'abusive'` counts in `flags.abusive` + row flag, does not raise calm; banter neutral.
  - Size: M

- [x] **T3 — Rank anchor protection via negative %**
  - Goal: `stateFromAnchor` preserves negative `progressPct` (clamp `[-100,100]`) and sets `protected = p < 0`.
  - Files: `src/core/rank/engine.ts`, `test/rank.test.ts`.
  - Check: anchor `progressPct:-19` → `{ progressPct:-19, protected:true }`; upper-bound malformed clamp still passes; a following loss/win behaves via `applyMatch`.
  - Size: S

- [x] **T4 — Multi-hero in the contract + provider**
  - Goal: `heroes?: string[]` on `ManualMatchInput`/`MatchEditInput`; `dataProvider` maps `heroes ?? [hero]` (log + edit).
  - Files: `src/shared/contract/inputs.ts`, `src/main/dataProvider.ts`, `test/logMatchProvider.test.ts`.
  - Check: `logMatch({ heroes:['Tracer','Widowmaker'] })` → `recorded[0].heroes` equals; legacy `{ hero:'Tracer' }` → `['Tracer']`; `{ mental:{ comms:'abusive' } }` stored.
  - Size: S

## Notion

- [x] **T5 — Notion comms round-trip (all three tones)**
  - Goal: writer maps tone → `Comms` select; importer maps select→tone (tolerate legacy `'banther'`); exporter merges tone; bookkeeping signature key list uses `comms`.
  - Files: `src/notion/notionWriter.ts`, `notionImporter.ts`, `notionExporter.ts`, `src/core/targets/notionBookkeeping.ts`, (opt.) `gametrackerSchema.ts`, `test/notionExporter.test.ts`, `test/notionImporter.test.ts`.
  - Check: export writes `'positive'|'banter'|'abusive'` and clears when none; import maps all three + `'banther'`; legacy `positiveComms:true` still exports `'positive'`; signature changes on tone change.
  - Size: M

- [x] **T6 — Sample data comms tone**
  - Goal: replace the `positiveComms` boolean with a weighted random `comms` tone.
  - Files: `src/core/sampleData/generate.ts`.
  - Check: `npm run build`/typecheck clean; demo dataset shows a mix of comms tones.
  - Size: S

## Renderer — Log Match card

- [x] **T7 — Multi-hero toggle-chip grid, role-filtered + Open Queue**
  - Goal: replace the single-hero typeahead with a role-filtered chip grid (union with already-picked); add Open Queue as a 4th role; repaint heroes on role change; build `heroes[]` on save.
  - Files: `renderer/src/app/log-match.ts` (+ `src/core/heroes.ts` reuse).
  - Check (preview): Damage shows only Damage heroes; Open Queue shows all; switching role keeps picks; saved match has the chosen `heroes[]`; zero heroes allowed.
  - Size: M

- [x] **T8 — SR preset + mouse wheel**
  - Goal: SR field presets `+25/−25/0` from result, wheel ±1 (no modal scroll), editable/clearable, preset re-applies only while unedited.
  - Files: `renderer/src/app/log-match.ts`.
  - Check (preview): Win=+25/Loss=−25/Draw=0; unedited result-change updates preset; edited value preserved; wheel ±1; blank saves no SR.
  - Size: M

- [x] **T9 — SR "Set current rank" toggle (re-anchor, negative = protection)**
  - Goal: Change↔Set-current segmented toggle; Set-current shows tier/division/% picker (negatives allowed) and on save re-anchors via `setRankAnchor` with no `srDelta`.
  - Files: `renderer/src/app/log-match.ts`.
  - Check (preview): Set-current lands the tracked rank on the entered value; negative % → 🛡 protected; Change mode unchanged; first-match still sets a baseline.
  - Size: M

- [x] **T10 — Comms 3-state colored switch**
  - Goal: replace the "Positive comms" chip with a single-select colored switch (Positive/green, Banter/yellow, Abusive/red), none-by-default + click-to-clear; wire `state.comms` into `mentalFrom`; keep Tilt/Toxic-mates/Leaver chips.
  - Files: `renderer/src/app/log-match.ts`, `renderer/styles/components.css`.
  - Check (preview): three colors; clears on re-click; saving stores `comms` tone; Tilt/Toxic unaffected.
  - Size: M

## Renderer — protection display & downstream reads

- [x] **T11 — Protection display consistency + settings hint**
  - Goal: render 🛡 in the sidebar rank line and Overview KPI when `protected`; update the Set-rank `numField` placeholder to signal negatives.
  - Files: `renderer/src/app/shell.ts`, `renderer/src/views/overview.ts`, `renderer/src/views/settings.ts`.
  - Check (preview): a protected/negative anchor shows 🛡 in sidebar + Overview, not a bare `-19%`.
  - Size: S

- [x] **T12 — matchDetail + Mental view comms reads**
  - Goal: matchDetail read-side comms pill via helper; normalize `comms→positiveComms` for the binary editor chip; `FLAG_LABELS` + abusive `flagBox` in Mental view; `FLAG_LABELS` in Matches drill-down (compiler-forced by `MatchFlagKey`).
  - Files: `renderer/src/views/matchDetail.ts`, `renderer/src/views/mental.ts`, `renderer/src/views/matches.ts`.
  - Check: typecheck clean; a `comms:'positive'` match shows the positive pill; an abusive match shows an abusive count/flag; drill-down by abusive works.
  - Size: M

## Docs & finalize

- [x] **T13 — Docs + full verification**
  - Goal: update README / onboarding docs for the new log-card behavior; run the full suite + typecheck; preview smoke-test.
  - Files: `README.md`, `docs/**` as needed.
  - Check: `npm test` green; `npm run typecheck` clean (main + renderer); preview loads the log card without console errors.
  - Size: S

---

## Consistency gate (spec ↔ tasks)

Every acceptance criterion in the spec maps to at least one task:

| Spec acceptance area | Task(s) |
|---|---|
| Multi-hero selection (add/remove/zero/persist) | T4 (persist/contract), T7 (UI) |
| Role → hero filtering + Open Queue | T7 |
| SR — Change mode (preset/wheel/edit/clear) | T8 |
| SR — Set current rank mode (re-anchor, negative→protection) | T3 (engine), T9 (UI) |
| Rank protection in account settings | T3 (engine), T11 (settings hint + display) |
| Comms switch (3-state colored, clearable, positive/abusive semantics) | T10 (UI), T1/T2 (model + surfacing) |
| Notion round-trip (all tones + legacy banther/positiveComms) | T5 |
| Model compatibility & regression (legacy positiveComms, tests, typecheck) | T1, T2, T5, T13 |

**Gaps:** none identified.

**Scope-creep check:** T6 (sample data), T11 (sidebar/Overview shield), T12 (Mental/Matches labels) are
not literal acceptance criteria but are **required for correctness/consistency** once the model changes
(compiler-forced `Record`s; otherwise a negative anchor renders as a bare unexplained `-19%`, and demo
data would use a now-legacy field). Kept, justified. No task traces to a non-existent requirement.

**Out-of-scope confirmed untouched:** Review-screen 3-state UI, Matches-editor multi-hero UI, Tilt/Toxic
scoring — none of the tasks modify these beyond legacy-compatible reads.
