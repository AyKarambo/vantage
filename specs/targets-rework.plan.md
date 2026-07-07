# Techplan: `targets-rework`

Implements [`specs/targets-rework.spec.md`](targets-rework.spec.md). Grounded in a codebase survey (file:line refs throughout). Five work areas: **A** field width, **B** scroll/stepper, **C** rotation + staleness, **D** templates, **E** fully-automatic measured grading (+ Notion). Plus a small **config** addition for the staleness thresholds.

---

## Architecture & Approach

### Guiding seams (why this is smaller than it looks)
- **In-app scoring is already stat-ready.** `buildTargets(games, demo, authored)` ([scoring.ts:24](../src/core/targets/scoring.ts)) is called from `computeDashboard` with the date-filtered `games`, and every `GameRecord` carries `perHero: HeroStat[]` + `durationMinutes` ([analytics/types.ts:84,89](../src/core/analytics/types.ts)). So measured grading is a **pure core change in `scoring.ts`** — no IPC/provider edits for the dashboard `targets`.
- **One shared evaluator.** A single pure function `evaluateMeasured(game, target)` backs *all three* consumers — in-app scoring, the Review read-only display, and the Notion export — so the number a user sees in-app always equals what's exported. This is the linchpin of the whole area E.
- **Everything that persists follows an existing twin.** `activatedAt` mirrors the additive `isActive` field pattern; the staleness config mirrors `breakReminder` end-to-end; the bulk "fresh focus" IPC method mirrors the auto-generated channel wiring.

### A. Threshold field width
`.vt-num` (`width: 64px`, [components.css:821-823](../renderer/styles/components.css)) is used **only** by the measured threshold input ([builder.ts:171-174](../renderer/src/views/targets/builder.ts)); the match-editor/account inputs use `.vt-input`. So widen `.vt-num` directly to fit 5 digits + spinner (~`96px`). Add per-10 unit clarity in `measuredBlock`'s hint copy ([builder.ts:178-180](../renderer/src/views/targets/builder.ts)) and in the preview badge label ("Damage/10 ≥ 9,000") — **without** changing the serialized stat token (constraint: round-trip stability).

### B. Scroll-wheel + stepper
Precedent: `attachWheelNudge(el, get, set)` ([log-match.ts:570-577](../renderer/src/app/log-match.ts)) — `preventDefault` under `{ passive: false }`, ±1 per `deltaY` sign. It is not exported. We generalize it.
- New pure helper in core: `stepFor(stat: string): number` → `1` (Deaths/Eliminations/Assists), `0.1` (KDA), `250` (Damage/Healing/Mitigation). Lives in `src/core/targets/stepSizes.ts`, exported via the barrel — unit-testable per DoD.
- New renderer helper `attachStepper(input, { stepFor: () => number, coarse: 10, min: 0, onChange })`: on `wheel` (passive:false, preventDefault → no page scroll), delta = `stepFor() × (e.shiftKey ? 10 : 1) × -sign(deltaY)`; clamp `≥ 0`; round to the step's precision (1 decimal when step < 1, else integer) to avoid float drift; write `input.value`; call `onChange`.
- **Arrow-key + spinner parity (AC6)** comes free by setting the native `input.step` attribute to `stepFor(stat)`; update it whenever the stat `select` changes ([builder.ts:169](../renderer/src/views/targets/builder.ts)). The wheel handler reads the *current* `state.stat` each tick so it tracks stat changes.
- Wire in `measuredBlock` where `state.stat`/`update()` are in scope; `onChange` reuses the existing `update()` so the live preview badge refreshes (AC2).

### C. Active-set rotation + staleness
**`activatedAt` field** on `AuthoredTarget` ([types.ts:10-22](../src/core/targets/types.ts)), optional/additive:
- Set at creation alongside `isActive: true` in provider `saveTarget` ([dataProvider.ts:110-114](../src/main/dataProvider.ts)) and the preview stub ([preview.ts:483](../renderer/preview/preview.ts)).
- Set on the inactive→active transition in `ManualStore.setActive` ([manualLog.ts:64-69](../src/store/manualLog.ts)); keep the `isActive === active` short-circuit so re-activating an already-active target does **not** re-stamp (only real transitions do). Mirror in preview `setTargetActive` ([preview.ts:517-522](../renderer/preview/preview.ts)).
- Backfill legacy rows to `createdAt` in `ManualStore.load` ([manualLog.ts:98](../src/store/manualLog.ts)) and preview load ([preview.ts:91-92](../renderer/preview/preview.ts)).

**Staleness** is computed with a pure predicate `isStale(activatedAt, matchesSinceActive, now, settings)` in the new `src/core/staleness.ts`. To keep `core/` clock-free, `now` is supplied by the **renderer** (`Date.now()`), so the final comparison happens client-side:
- `TargetSummary` gains `activatedAt?: number` and `matchesSinceActive?: number` (both set only for active, non-archived targets). `matchesSinceActive` is counted over **unfiltered** competitive history (`all` at [dashboardData.ts:51](../src/core/dashboardData.ts)), *not* the date-filtered `games` — "30 matches since you activated it" must ignore the dashboard range. computeDashboard computes it and attaches to the summaries after `buildTargets`.
- Renderer: `isStale(t.activatedAt, t.matchesSinceActive, Date.now(), ctx.data.staleness)` → shows a "getting stale — rotate or archive" nudge; the panel also shows "active {N}d" from `activatedAt`.

**Active-set panel** — a new `card` inserted in `targets(ctx)` ([index.ts:23-30](../renderer/src/views/targets/index.ts)) between `builder.el` and the library:
- Lists `ctx.data.targets.filter(t => t.isActive && !t.archivedAt)`: each a removable chip (`bridge.setTargetActive(id,false)` → `ctx.refresh()`), with the staleness nudge inline.
- **Quick-add**: a `select`/chip row of inactive live targets → `bridge.setTargetActive(id,true)`.
- **"Start a fresh focus"** `button` → new bulk bridge method `deactivateAllTargets()` (one atomic write, one refresh — vs N round-trips looping `setTargetActive`).
- All mutations follow the **local-mutate-then-`ctx.refresh()`-in-`.then()`** idiom (builder/library precedent) to respect the mid-click-swallow mitigation.

### D. Templates (flat 9, collapsible)
Replace `TARGET_TEMPLATES` ([templates.ts:18-55](../src/core/targets/templates.ts)) with the 9 spec entries (2 removed, "Cover before cooldown"→"Improve cover usage"). All measured rules (`Deaths ≤ 3`, `Damage ≥ 9000`, `Healing ≥ 8000`, `Mitigation ≥ 7000`) parse under the existing round-trip regex and use in-`STATS` tokens.
- **Collapsible section**: wrap the template chip block ([builder.ts:90-99](../renderer/src/views/targets/builder.ts)) in a self-managed region with a closure `templatesOpen` boolean. Default `open = liveAuthoredCount < 3` (count = `ctx.data.targets.filter(t => !t.archivedAt).length`); otherwise render a subtle "Show templates" toggle that flips `templatesOpen` and re-renders just that region. Local state only — no store round-trip (segmented/builder precedent).

### E. Fully-automatic measured grading
**Shared evaluator** (new, pure, `src/core/targets/`): 
- `parseMeasuredRule(rule): { stat, op, value } | null` + `formatMeasuredRule(...)` — extracted so main + renderer share one parser (removes the duplicated regex the builder NOTE warns about). Builder imports these (core→renderer one-way is clean).
- `matchStatValue(game, stat): number | null` — sums `perHero` for the stat; rate stats (Damage/Healing/Mitigation/Eliminations/Assists/Deaths) → `sum × 10 / durationMinutes` using the **same rounding as [heroStats.ts:66-76](../src/core/analytics/heroStats.ts)** (`round1` for count rates, integer for damage/healing/mitigation); `KDA` → `(Σelims+Σassists)/max(Σdeaths,1)`. Returns `null` when `perHero` or `durationMinutes` is missing (rate stats).
- `evaluateMeasured(game, target): { grade: TargetGrade; value: number } | null` — `null` when `matchStatValue` is null (skip / "no stat"); else applies bands with margin `m = 0.10`:
  - `≥`: `≥ v`→hit; `≥ 0.9v`→partial; else missed.
  - `≤`: `≤ v`→hit; `≤ 1.1v`→partial; else missed.
  - `=`: within `±10%`→hit; `±20%`→partial; else missed.

**In-app scoring** — branch `buildTargets`/`authoredSummary` ([scoring.ts:28,39](../src/core/targets/scoring.ts)) on `t.mode`:
- `self` → unchanged (stored `review.grades`).
- `measured` → new `measuredSummary(t, games)`: over games with `g.timestamp >= t.createdAt`, map `evaluateMeasured`; drop `null`s (skipped, no attempt — AC15); attempts/hits/hitRate/win-splits/spark computed exactly like `authoredSummary` but from derived grades. Stored `review.grades[id]` for a measured target is **ignored** (prevents double-counting — the survey's design fork).

**Review screen** ([review.ts](../renderer/src/views/review.ts)) — measured active targets render **read-only**; the renderer can't derive them itself (`MatchRow` omits `perHero`), so grades are delivered from core:
- `MatchRow` ([toMatchRow, dashboardData.ts:166-183](../src/core/dashboardData.ts)) gains `measuredGrades?: Record<targetId, { grade: TargetGrade; value: number } | 'no-stat'>`, computed for the currently **active measured** targets against each inbox game.
- `expanded()` ([review.ts:101-165](../renderer/src/views/review.ts)) splits active targets: `self` → existing manual `targetGradeRow`; `measured` → a read-only row showing "⚡ {grade} — {stat}/10 = {value}" or "— no stat this match". Keyboard grading (`kbHook`, [review.ts:153-163](../renderer/src/views/review.ts)) cycles **self-rated rows only**. `saveReview`'s `grades` map naturally contains no measured entries (no controls emit them).

**Notion export** — derive on the fly (spec Open-Q1 → **option b**, per the export survey; keeps `matchExportSignature` correct across retroactive rule edits with no history rewrite):
- Thread the full `AuthoredTarget[]` (not just ids) to the exporter. Today only ids flow, built at [index.ts:238-239](../src/main/index.ts) and carried through `NotionRuntimeDeps` ([notionRuntime.ts:52](../src/main/notionRuntime.ts)) → `buildExporter` ([notionRuntime.ts:374-376](../src/main/notionRuntime.ts)) → `NotionExporter` ctor ([notionExporter.ts:45](../src/notion/notionExporter.ts)). Add a parallel `authoredTargets()` getter (keep `authoredTargetIds()` for `visibleTargetIds`).
- At the three call sites — `export()` ([notionExporter.ts:185](../src/notion/notionExporter.ts)), `backfillLegacy()` ([notionExporter.ts:293](../src/notion/notionExporter.ts)), import-ledger ([notionRuntime.ts:176](../src/main/notionRuntime.ts)) — build effective grades **before** `aggregateImprovementGrade`:
  `effectiveGrades = foldMeasured(game.review?.grades, measuredTargets, game)` where measured ids are set to their derived grade or **deleted** when `evaluateMeasured` is `null` (never fall back to a stale stored grade). Pass `effectiveGrades` into `aggregateImprovementGrade` (unchanged) — measured ids are already in `visibleTargetIds`, so aggregation + `matchExportSignature(game, grade)` fold them in for free.
- The import-ledger site **must** use the identical derivation (survey caveat) or the first post-change sync spuriously updates.

### Config: staleness thresholds (mirror `breakReminder`)
`src/core/staleness.ts`: `StalenessSettings { staleAfterDays; staleAfterMatches }`, `DEFAULT_STALENESS = { staleAfterDays: 14, staleAfterMatches: 30 }`, `normalizeStaleness` (clamp), and the `isStale` predicate above. Then mirror the `breakReminder` pipeline exactly (see Affected Files). Surfaced on `DashboardData.staleness` so the Targets view reads it synchronously; edited via a new `stalenessEditor` in Settings → General.

---

## Affected Files / Modules

### New (pure `core/` — unit-tested)
- `src/core/targets/stepSizes.ts` — `stepFor(stat)` (+ `COARSE_FACTOR = 10`).
- `src/core/targets/measured.ts` — `parseMeasuredRule`, `formatMeasuredRule`, `matchStatValue`, `evaluateMeasured`, `foldMeasuredGradesForExport`. Barrel-exported from `src/core/targets/index.ts`.
- `src/core/staleness.ts` — `StalenessSettings`, `DEFAULT_STALENESS`, `normalizeStaleness`, `isStale`.

### Changed — core / contract
- `src/core/targets/types.ts` — `AuthoredTarget.activatedAt?`; `TargetSummary.activatedAt?` + `matchesSinceActive?`.
- `src/core/targets/scoring.ts` — mode-branch; add `measuredSummary`; ignore stored grades for measured.
- `src/core/targets/templates.ts` — new 9-entry list.
- `src/core/dashboardData.ts` — attach `activatedAt`/`matchesSinceActive` (from unfiltered `all`) to active summaries; populate `MatchRow.measuredGrades`; put `staleness` on `DashboardData`.
- `src/shared/contract/dashboard.ts` — `MatchRow.measuredGrades?`; `DashboardData.staleness`.
- `src/shared/contract/api.ts` — `deactivateAllTargets()`, `getStaleness`/`setStaleness` methods + channels (the `satisfies` guard at :220 enforces channels).
- `src/shared/contract/index.ts` — re-export `StalenessSettings`.

### Changed — main / store (edges)
- `src/store/manualLog.ts` — `setActive` stamps `activatedAt`; `load` backfills; new `deactivateAll()` (single `save()`).
- `src/main/dataProvider.ts` — `saveTarget` stamps `activatedAt`; impl `deactivateAllTargets`, `getStaleness`/`setStaleness`; deps `persistStaleness`.
- `src/main/dashboard/provider.ts` — `DataProvider` iface: `deactivateAllTargets`, `getStaleness`, `setStaleness`.
- `src/main/dashboard/ipcHandlers.ts` — register the 3 new channels; pass `staleness: provider.getStaleness()` into `computeDashboard` options.
- `src/main/index.ts` — thread `authoredTargets()` to the Notion runtime; `persistStaleness: (staleness) => saveLocalConfig({ staleness })`.
- `src/main/config/appConfig.ts` — `AppConfig.staleness`, `DEFAULTS`, `loadConfig` merge line.
- `src/main/config/index.ts` — export `StalenessSettings` if imported via `./config`.
- `src/notion/notionExporter.ts` + `src/main/notionRuntime.ts` — accept `authoredTargets()`; fold measured grades before `aggregateImprovementGrade` at the 3 sites.
- **No edits** to `preload.ts` / `renderer/src/bridge.ts` (auto-generated from `IPC_CHANNELS`).

### Changed — renderer
- `renderer/styles/components.css` — widen `.vt-num` (~96px).
- `renderer/src/views/targets/builder.ts` — collapsible templates; per-10 hint/preview copy; wire `attachStepper` + `input.step`; import core `parseMeasuredRule`/`formatMeasuredRule`.
- `renderer/src/views/targets/index.ts` — insert the active-set panel card.
- `renderer/src/views/targets/activeSet.ts` (new) — the panel (or inline in `index.ts`).
- `renderer/src/app/wheelStepper.ts` (new) — `attachStepper` (generalizes `attachWheelNudge`).
- `renderer/src/views/review.ts` — read-only measured rows; keyboard cycles self-rated only.
- `renderer/src/components/stalenessEditor.ts` (new) — mirror `breakReminderEditor.ts`; surfaced in `renderer/src/views/settings/general.ts`.
- `renderer/preview/preview.ts` — mirror `activatedAt` (create/backfill/setActive), `deactivateAllTargets`, `getStaleness`/`setStaleness` stubs.

### Docs
- `README.md` — Targets bullet (:59-63) new templates + auto-grading + rotation; Review bullet (:56-58) measured read-only.
- `specs/screen-targets.spec.md` + `specs/screen-review.spec.md` — reflect auto-grading, rotation, collapsible templates.

---

## Data Model / Interfaces

```ts
// src/core/targets/types.ts
interface AuthoredTarget { …; activatedAt?: number; }        // additive; legacy → createdAt
interface TargetSummary { …; activatedAt?: number; matchesSinceActive?: number; }

// src/core/staleness.ts
interface StalenessSettings { staleAfterDays: number; staleAfterMatches: number; }
const DEFAULT_STALENESS = { staleAfterDays: 14, staleAfterMatches: 30 };
function isStale(activatedAt: number | undefined, matchesSinceActive: number | undefined,
                 now: number, s: StalenessSettings): boolean;   // days OR matches, whichever first

// src/core/targets/measured.ts
function evaluateMeasured(game: GameRecord, t: AuthoredTarget):
  { grade: TargetGrade; value: number } | null;                 // null = stat unavailable → skip

// src/shared/contract/dashboard.ts
interface MatchRow { …; measuredGrades?: Record<string, { grade: TargetGrade; value: number } | 'no-stat'>; }
interface DashboardData { …; staleness: StalenessSettings; }

// src/shared/contract/api.ts (OwStatsApi)
deactivateAllTargets(): Promise<void>;
getStaleness(): Promise<StalenessSettings>;
setStaleness(input: StalenessSettings): Promise<StalenessSettings>;
```

Serialization unchanged: measured `rule` stays `"${stat} ${op} ${value}"`; stat tokens stay `Damage`/`Healing`/`Mitigation` (per-10 conveyed only in copy).

---

## Test Strategy

Vitest (`test/**/*.test.ts`, `environment: node`). Import from `src/core/**` barrels only (renderer's builder touches `document`). Fixtures: copy the `game()`/`review()`/`authored()` trio from [reviewPipeline.test.ts:14-34](../test/reviewPipeline.test.ts); build `perHero`+`durationMinutes` matches like [analytics.test.ts:87-101](../test/analytics.test.ts).

- **stepSizes** (`test/stepSizes.test.ts`) — `stepFor` per stat (1 / 0.1 / 250); unknown stat default.
- **measured evaluator** (`test/measuredTargets.test.ts`) — `parseMeasuredRule` round-trips all 9 templates; `matchStatValue` per-10 math + rounding matches heroStats; `evaluateMeasured` bands: `Damage ≥ 9000` at 11,240→hit, 8500→partial, 7000→missed (AC13); `Deaths ≤ 3` at 3.2→partial, 4→missed (AC14); missing `perHero`/`durationMinutes`→`null` (AC15); KDA path.
- **scoring** — extend [reviewPipeline.test.ts](../test/reviewPipeline.test.ts): a measured target scores from stats not `review.grades`; only games `≥ createdAt`; skipped matches aren't attempts; a stray stored grade on a measured id is ignored.
- **templates** — [targetTemplates.test.ts](../test/targetTemplates.test.ts): bump upper bound `8→9` (:14); existing round-trip/no-dupe asserts cover the new list.
- **staleness** (`test/staleness.test.ts`) — `isStale` true at ≥14 days OR ≥30 matches, false below both; `normalizeStaleness` clamps; missing `activatedAt`→not stale.
- **Notion fold** — extend [aggregateGrade.test.ts](../test/aggregateGrade.test.ts): effective-grades fold makes a measured target contribute to the aggregate + flips `matchExportSignature` when the underlying stat crosses a band (AC17); no stat → measured id absent from the aggregate.
- **Manual verification (preview harness)** — AC1/2/4/5/6 (field/scroll/stepper), AC7-10 (rotation + staleness nudge), AC11/12 (template collapse), AC16 (Review read-only) via `npm run preview` with logged games; screenshot before/after the widened field + scroll.
- DoD gate: `npm test` + `npm run typecheck` (main + renderer) green.

---

## Risks & Alternatives

- **Notion double-derivation drift (highest risk).** The export site and the import-ledger site ([notionRuntime.ts:176](../src/main/notionRuntime.ts)) must fold measured grades **identically**, or the first post-deploy sync spuriously rewrites rows. *Mitigation:* one shared `foldMeasuredGradesForExport` helper used at all three sites; a unit test asserting the ledger and export signatures agree for the same game+targets.
- **Rule-edit retroactivity vs. Notion churn.** Deriving on the fly means editing a measured rule re-grades all history → the next sync legitimately updates affected rows. This is correct but can produce a large one-off update batch. *Accepted*; the alternative (store-at-save, spec option a) is strictly more plumbing and *breaks* change-detection (stored grades go stale silently) — rejected.
- **`matchesSinceActive` source.** Counting over unfiltered `all` (not the date-filtered `games`) is deliberate so a narrow dashboard range doesn't suppress the staleness nudge; it's an extra pass over history in `computeDashboard` (cheap; history is already in memory).
- **Measured targets ignore `isActive` for scoring.** A measured target accrues hit-rate whether active or not (objective), while self-rated only accrue while active (need a Review read). This asymmetry is intended and matches "measured = automatic"; documented in the screen spec.
- **`=` operator on per-10 floats** is nearly never exactly hit; bands make it a ±10/20% window. Low-value but harmless; kept for round-trip completeness.
- **Field width.** `.vt-num` is used only by the threshold input, so widening it globally is safe (verified); no modifier class needed.
- **Alternative for staleness config — renderer-only `prefs`** (localStorage): lighter (zero contract/main edits) but invisible to main and inconsistent with the existing `breakReminder`/`readiness` pattern. Rejected in favor of the established main-persisted path.

---

## Resolved (was Open) Questions
1. **Notion architecture** → **derive on the fly** (option b) — least plumbing, correct change-detection across rule edits.
2. **Template auto-collapse threshold** → **≥ 3 live authored targets** (confirm in review).
