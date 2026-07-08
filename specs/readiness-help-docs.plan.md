# Technical plan: Readiness help wiki (`readiness-help-docs`)

> Derived from the approved `readiness-help-docs` spec. Grounds every decision in the codebase research and cites real files/symbols. No engine/score change — this is a presentation + explanation layer plus one new pure `core/` module family.

## Architecture & Approach

### Shape of the feature
The wiki is a **renderer-only mini-app hosted inside one right-hand drawer**, backed by a **small pure `src/core/readiness/` module** for the matcher, walkthrough derivation, and curated scenario data. Nothing about the readiness *score* changes (AC10 non-regression). Two clean halves:

- **Pure core (`src/core/readiness/`, Electron-free, unit-tested — G3):**
  - `scenarios.ts` — `CURATED_SCENARIOS`: the curated archetype library (id, `group`, plain copy, `teaches`, and a runtime `match` signature). Single source of truth for renderer + tests + drift guard.
  - `nearestScenario.ts` — `matchScenarios(summary)`: deterministic nearest-scenario matcher (degradation short-circuit → hard categorical filter → 3-delta distance → `{ primary, alternates }`).
  - `walkthrough.ts` — `deriveWalkthrough(summary)`: narrative facts + 75-anchor score reconstruction, or `null` when personalization can't be honestly produced.
  - Barrelled through `src/core/readiness/index.ts` (which already exports `READINESS_TUNING`, `computeReadiness`, types).

- **Renderer (`renderer/src/app/readinessWiki/`, CSP-friendly bundled TS — G4):**
  - Drawer **host + in-panel navigation**; the tiered **article content model**; the **personalized article**; the **curated scenario library** view.
  - `deepConstants.ts` (DOM-free) — deep-tier numbers derived from `READINESS_TUNING`; and `deepCopy.ts` (DOM-free) — pure string builders that interpolate those numbers, so **both** the constants and the rendered numeric prose are unit-testable without a DOM (AC4).

### Drawer-hosted wiki: Overview → article mini-app
Reuse `openDrawer` (`renderer/src/components/overlay.ts:44`) — it supplies `.drawer-panel`, the built-in `✕`, and Escape + backdrop dismissal via `mountOverlay` (overlay.ts:12-29), satisfying AC10 with the *existing* behavior (see Risks re: focus).

Navigation follows the **`openHeroDrawer` captured-region pattern** (`renderer/src/views/heroes.ts:67-72`), **not** the hand-rolled onboarding overlay: inside `build(close)`, create one stable inner region element **appended after** `openDrawer`'s built-in `✕` (overlay.ts:50), and swap pages with `render(region, page())` (`renderer/src/dom.ts:64-75`). We never `render()` over the whole panel (that would wipe the `✕` — documented pitfall). Navigation state is a tiny in-closure page stack, mirroring the onboarding `go()/draw()` idiom (`renderer/src/app/onboarding.ts:111-190`) scoped to routes:

- `overview` — landing list of article cards + links to the scenario library and "Your readiness right now".
- `article:<id>` at a `tier` (`plain` → `how-it-works` → `deep`), always opening at `plain` (simple-first, AC3).
- Back/breadcrumb are `button()`/`.inline-link` controls that `pop()`/`goto()` and re-render the region. A breadcrumb strip (`Overview / <Article>`) sits atop the region. Focus is never torn: the overlay itself is never rebuilt — only the inner region's children are replaced.

Escape closes the whole drawer (overlay.ts:18-19). We **accept "Escape closes the wiki"** rather than intercepting the window-level listener — this matches every other overlay and keeps AC10's "closes like other overlays" literally true. In-panel **Back** is the affordance for popping one page.

### Progressive-disclosure tiers
Each article is **simple-first**: a plain intro renders before any formula (AC3). `plain → how-it-works → deep` is a **JS tier-state toggle that re-renders the region**, matching the existing `.is-active`/`.is-on` idiom (components.css:243/183), chosen over native `<details>` for full styling control and consistency (no `<details>` exists today). Deep tier reveals real constants/mechanics via `deepCopy.ts`/`deepConstants.ts` (AC4).

### Article model & the four card deep-links
Articles are bundled TS data (G4 — no runtime `.md`, no CDN, built as text children through `h()`, never the unused `html:` prop). Four data cards map to four article ids, agreed as a shared union: `verdict`, `what-moves-the-score`, `training-load`, `readiness-trend`. Each `WikiArticle` is `{ id, title, plain(), howItWorks(), deep() }`, each tier a `() => Node` builder composing `card()`, `.stack`, `.grid-2/3`, `.hint`, `statBox()`, `badge`. The `readiness-trend` deep tier **re-homes** `supercompensationSchematic()` (`renderer/src/charts/plots`) — moved out of the retired modal, not deleted (G4 "reuse it").

### Per-card "?" + global Help wiring
- **Global Help** rides `viewHead`'s optional actions slot (`renderer/src/views/view.ts:133-140`, right-aligned `.view-actions`) → `openReadinessWiki({ view: 'overview' })`. View-scoped, distinct from the app-shell footer Help that replays onboarding (shell.ts:190-195).
- **Per-card "?"** uses the `card()` actions slot (`card.ts:24`, `CardOpts.actions: Child | Child[]`). Each `?` is an `.inline-link` button → `openReadinessWiki({ view: 'article', id: <cardId>, tier: 'plain' })`. On **Verdict** the slot becomes an **array** `[regimeBadge?, helpBtn]` so the `?` renders independently of `showRegime()` (which nulls the badge for `insufficient-data`/`rusty`) — the `?` must never vanish when help is most needed (pitfall).
- The former `"How is this calculated?"` `.inline-link` (readiness.ts:148-152) swaps its handler from `openModal(readinessMethodology)` to `openReadinessWiki({ view: 'article', id: 'verdict', tier: 'plain' })` (AC2).

### Personalized "Your readiness right now"
This article's builder first checks the **caller-side disabled gate**, then calls the two pure functions on the live `ReadinessSummary`:

- **Disabled gate (caller-side, renderer):** `deriveWalkthrough`/`matchScenarios` take only a `ReadinessSummary`, which has **no `enabled` field** — `safeReadiness` always computes a full, valid summary regardless of the toggle (`dashboardData.ts:127` runs unconditionally). So `personalized.ts` reads `ctx.data.readinessSettings.enabled` and, when `false`, renders generic content **before** calling either pure function. "Disabled" is *not* a pure-function short-circuit case.
- **(a) Plain narrative** — from `deriveWalkthrough(summary)`: regime, band, confidence, and which of the three families pull (sign of each `subscores.*.delta`), all from existing contract fields — no engine change.
- **(b) Closest scenario(s)** — from `matchScenarios(summary)`: `primary` + 1-2 `alternates`, rendered as scenario tiles with the primary highlighted (AC6b).
- **(c) Score step-through** — `75 + load.delta + performance.delta + subjective.delta`, rendered with `statBox()` tiles for the anchor and three deltas, then the rounded+clamped total. Mirrors `scoreFromState` (`score.ts:216-219`): `clamp(Math.round(75 + Σdeltas), 0, 100)`. Because the displayed deltas are each `round1`'d (`index.ts:91-97`) while the engine rounds the *raw* sum once, the derivation carries both `reconstructed` and the authoritative `shown` score plus a `roundingResidual ∈ {-1,0,1}`, and surfaces a small `(rounding)` reconciliation note when they differ. We do **not** claim exact identity on pre-rounded deltas.

**Graceful degradation (AC7).** Two distinct paths:
- *Data-driven suppression (pure short-circuit):* `deriveWalkthrough` **and** `matchScenarios` return `null` when `summary.score === null` (stale/young-account, `index.ts:317/338`), `band === 'insufficient-data'`, or `confidence === 'low'` (mirrors the view's `showScore` gate at `readiness.ts:125`; low-confidence hides the score, so there is nothing to reconstruct and no numbers to match on honestly). This also correctly makes the two low-confidence rest/recovery archetypes unmatchable live (see Test Strategy AC8).
- *Feature disabled (caller-gated):* handled in `personalized.ts`/`openReadinessWiki` as above.

In both cases the personalized article renders a **concrete generic fallback** — the target article's own plain-tier intro (the model still explains itself without personal numbers) plus a short **"what unlocks this"** line composed from the existing gate reasons (enable the feature / log more sessions to clear insufficient-data / rate your games to raise confidence). No new content module — it composes existing article builders. The wiki's Overview and all four articles are fully usable with zero personalized data, and Global Help is wired so it works even on the disabled-feature early-return view (`readiness.ts:344-353`), independent of `ctx.data.readiness`.

### Curated scenario library
`CURATED_SCENARIOS` in `scenarios.ts` — a **trimmed 9-archetype** subset (NOT all 29, AC9), grouped into **4 buckets** (matching the `ScenarioGroup` union), each with plain copy and a `teaches` line:

- **Your normal / healthy** (`healthy`): `evening-hobbyist-calm` (the anchor), `measured-grind-green` (collapses the runtime-identical `grind-all-gep`/`stats-grinder-habit-b1` — "habit is not risk").
- **Rest & recovery** (`recovery`): `rest-day-3-supercompensation-peak`, `eight-day-layoff-rust`.
- **Overload → amber → red** (`overload`): `grind-all-manual`, `grind-wr-slump-red`, `grind-tilt-slider-red`.
- **Guardrails** (`guardrail`): `all-loss-week-outcome-cap`, `grind-wr-slump-dampened`.

Dropped as prose-only or unmatchable: weekend duplicates, regime-dial in-between points, per-10-direction/passivity pairs, CUSUM single-session dupes, own-norm slider pairs, young-account (that's the AC7 path, not a scored card). The user's closest is highlighted via a `card` variant/`.is-highlighted` flash.

### View-stripping (AC1/AC2) — `renderer/src/views/readiness.ts`
- **Remove** `honestyCard` fn (337-342) + its call (77) — the second "not a diagnosis" restatement.
- **Remove** `readinessMethodology` fn (157-280) entirely; re-home `supercompensationSchematic` into the wiki.
- **Keep** the `viewHead` subtitle (72) — the single retained "wellness heuristic, not a diagnosis" line (AC1).
- **Trim prose:** drop `REGIME_META.title` strings (keep terse `label`); reduce/drop `loadNote` (56-65) — verify `subscoreTile` reads cleanly with no note (falls back to `''`, line 95); drop `confidenceNote` (126-131) without leaving a dangling `' · '` before the repointed link; trim `subscoresCard` sub (107) to a terse label.
- **Import cleanup (verify by grep, not typecheck):** neither tsconfig sets `noUnusedLocals`, so tsc will NOT flag leftovers. Removing `readinessMethodology` orphans `openModal` and the `button` primitive (its only `button(...)` call site is the Close button at line 278) and moves `supercompensationSchematic` to the wiki. Reuse `button()` for the new Help/`?` affordances or drop it from the `../components/primitives` import; confirm each removed symbol has zero remaining references with `rg`.

## Affected Files/Modules

### NEW — pure core (`src/core/readiness/`, Electron-free, tested)
| File | Purpose |
|---|---|
| `src/core/readiness/scenarios.ts` | `CURATED_SCENARIOS`: 9 curated descriptors (`id`, `group`, `title`, `plain`, `teaches`, `match`) — single source for renderer + tests + drift guard. |
| `src/core/readiness/nearestScenario.ts` | `matchScenarios(summary): ScenarioMatchResult \| null` — data-driven short-circuit + categorical hard filter + 3-delta distance + alternate fallback (AC6b/AC8). |
| `src/core/readiness/walkthrough.ts` | `deriveWalkthrough(summary): WalkthroughDerivation \| null` — narrative facts + 75-anchor reconstruction (AC6), `null` on data-suppressed states (AC7). |

### NEW — renderer wiki (`renderer/src/app/readinessWiki/`, bundled, CSP-safe)
| File | Purpose |
|---|---|
| `index.ts` | `openReadinessWiki(route?)` — drawer host: `openDrawer` + in-panel page stack, breadcrumb/back, tier toggle. |
| `articles.ts` | Four-article content model (`WikiArticle[]`, plain/how-it-works/deep builders) + Overview page. Re-homes `supercompensationSchematic`. |
| `personalized.ts` | "Your readiness right now" builder — caller-side disabled gate; renders `deriveWalkthrough` + `matchScenarios`; concrete generic fallback (AC7). |
| `scenarioLibrary.ts` | Renders `CURATED_SCENARIOS` grouped by the 4 buckets, highlights the user's closest (AC9). |
| `deepConstants.ts` | **DOM-free.** Deep-tier numbers derived from `READINESS_TUNING` — the AC4 constants guard surface. |
| `deepCopy.ts` | **DOM-free.** Pure string builders interpolating `deepConstants`, so deep-tier numeric *prose* is unit-testable without a DOM (AC4 prose-drift guard). |

### NEW — tests (`test/`, vitest node env)
| File | Purpose |
|---|---|
| `test/readinessNearestScenario.test.ts` | AC8 golden matcher (matchable partition) + AC6b alternate-count + AC7 degradation-null (degraded partition). |
| `test/readinessWalkthrough.test.ts` | AC6c reconstruction within ±1; AC7 `null` branch; AC9 count + per-id band drift guard. |
| `test/readinessDocsConstants.test.ts` | AC4: `deepConstants` values pinned to numeric literals; `deepCopy` strings contain the interpolated constants. |

### CHANGED
| File | Change |
|---|---|
| `renderer/src/views/readiness.ts` | Strip `honestyCard` + `readinessMethodology`; trim `REGIME_META.title`/`loadNote`/`confidenceNote`; repoint "How is this calculated?" + add per-card `?` + global Help; clean orphaned imports (`openModal`, `button` unless reused, move `supercompensationSchematic`). (AC1/AC2/AC5) |
| `src/core/readiness/index.ts` | Re-export `scenarios`, `nearestScenario`, `walkthrough` and their types. |
| `renderer/src/components/overlay.ts` | Add optional `opts.panelClass` to `openDrawer` (mirror `openModal`, overlay.ts:34) so the wiki can request `.drawer-panel--wide`. |
| `renderer/styles/components.css` | Add `.wiki-*` article/breadcrumb/tier classes, closest-scenario highlight, and `.drawer-panel--wide` (mirroring `.modal-card--wide` at :722). |
| `README` / relevant docs | Note the readiness wiki replaces the standalone methodology modal (DoD docs update). |

### UNCHANGED (reused as-is)
`card.ts` (actions slot), `view.ts` (`viewHead` actions), `charts/plots` (`supercompensationSchematic`), `test/readinessFixtures.ts`, `src/core/readiness/{constants,score,types}.ts`.

## Data Model / Interfaces

### Curated scenario descriptor + runtime signature (`scenarios.ts`)
```ts
type ScenarioGroup = 'healthy' | 'recovery' | 'overload' | 'guardrail'; // 4 buckets

interface ScenarioSignature {
  bandGroup: BandGroup;               // hard categorical gate (see below)
  requiresFamilies?: Array<'performance' | 'subjective'>; // must be `available` in the live read
  requiresSignal?: string;            // e.g. 'target-focus' — the ONLY discriminator for the dampened slump
  adverseFamilies?: Array<'load' | 'performance' | 'subjective'>;
  // 3-value normalized centroid used ONLY to order survivors after the hard filter:
  centroid: { load: number; perf: number; subj: number }; // normalized by caps (/40, /45, /15)
}

interface CuratedScenario {
  id: string;                         // stable key, e.g. 'grind-all-manual'
  group: ScenarioGroup;
  title: string;                      // plain-language heading
  plain: string;                      // one-sentence plain explanation
  teaches: string;                    // the single lesson the archetype carries
  match: ScenarioSignature;           // named `match` consistently everywhere
}

const CURATED_SCENARIOS: readonly CuratedScenario[]; // length === 9
```
`BandGroup` collapses the seven `ReadinessBand`s into matcher buckets (`green` = fresh/steady, `recovering`, `rusty`, `loaded`, `in-the-hole`) so a live "loaded" read never matches a "fresh" archetype (band-not-score gating, per `bandForState` in `score.ts:234-255`). Note this is separate from the 4 display `ScenarioGroup` buckets.

**Simplified centroid (was a 7-dim vector).** Per the over-engineering review, ranking uses only the **three family deltas** — the exact quantities the personalization step-through already displays — normalized by their caps. `restDays`/`acutePerDay`/`coverage`/`ratio` are dropped: they are already encoded by the `bandGroup` + `requiresFamilies` gate, and as unguarded hand-authored numbers they were a new drift surface. This cuts authored constants from ~63 to 27, all pinned by the golden tests.

### The pure matcher (`nearestScenario.ts`)
```ts
interface ScenarioMatch { id: string; distance: number; scenario: CuratedScenario; }
interface ScenarioMatchResult { primary: ScenarioMatch; alternates: ScenarioMatch[]; } // 1 ≤ alternates ≤ 2

/** Deterministic. Returns null on data-suppressed states. "Disabled" is caller-gated, NOT here. */
function matchScenarios(summary: ReadinessSummary): ScenarioMatchResult | null;
```
Algorithm: (1) **short-circuit `null`** if `summary.score === null`, `band === 'insufficient-data'`, or `confidence === 'low'` (no honest deltas to match — AC7). (2) Candidate pool = `CURATED_SCENARIOS` filtered by `bandGroup(summary.band)`, excluding any whose `requiresFamilies` are not `available` in the live read (a manual read has `performance.available === false`, so results-only archetypes self-exclude) and any whose `requiresSignal` is absent from `summary.signals[].key`. (3) Rank survivors by weighted Euclidean distance on `[load.delta/40, perf.delta/45, subj.delta/15]` vs each `centroid`. (4) `primary` = nearest. `alternates` = next 1-2 in the same band-group; if fewer than 1 remain, widen to the same `ScenarioGroup`, then the nearest adjacent band-group, so **≥1 alternate is always available** (AC6b). Inputs are plain `ReadinessSummary` data → fully deterministic (AC8).

### Walkthrough derivation (`walkthrough.ts`)
```ts
interface WalkthroughDerivation {
  narrative: { regime: ReadinessRegime; band: ReadinessBand; confidence: ReadinessConfidence;
               pulls: Array<{ family: 'load'|'performance'|'subjective'; delta: number;
                              direction: 'up'|'down'|'flat' }>; };
  reconstruction: {
    anchor: number;                   // READINESS_TUNING.baseScore (75)
    deltas: { load: number; performance: number; subjective: number }; // round1'd, as displayed
    reconstructed: number;            // clamp(round(anchor + Σdeltas), 0, 100)
    shown: number;                    // summary.score — authoritative
    roundingResidual: number;         // shown - reconstructed, ∈ {-1, 0, 1}
  };
}
/** null on data-suppressed states (score===null / insufficient-data / confidence 'low'). NOT for disabled. */
function deriveWalkthrough(summary: ReadinessSummary): WalkthroughDerivation | null;
```
Uses **only existing contract fields** (`score`, `band`, `confidence`, `regime`, `subscores.*.delta`) — confirmed no engine change. Mirrors `scoreFromState`'s `Math.round` + `[0,100]` clamp (`score.ts:218`).

### Renderer-facing types & deep constants
`WikiRoute = { view:'overview' } | { view:'article'; id:WikiArticleId; tier:WikiTier } | { view:'scenarios' } | { view:'personalized' }`; `WikiArticleId = 'verdict'|'what-moves-the-score'|'training-load'|'readiness-trend'`; `WikiTier = 'plain'|'how-it-works'|'deep'`.

`deepConstants.ts` derives **every** number the deep tier quotes from `READINESS_TUNING` (so the UI can never show a stale value), spanning the full spec-item-5 set:
- Anchor & caps: `anchor: T.baseScore` (75), `loadCapDown: -T.loadDeltaMin` (40), `loadCapUp: T.loadDeltaMax` (25), `perfCapDown: -T.perfDeltaMin` (45), `perfCapUp: T.perfDeltaMax` (8), `subjCapDown: -T.subjDeltaMin` (15), `subjCapUp: T.subjDeltaMax` (8), and the **manual endpoint** `subjCapDownManual: -T.subjDeltaMinManual` (25).
- Ratio: `ratioElevated` (1.3), `ratioHigh` (1.5), `ratioFreshMax` (1.15).
- CUSUM: `cusumThreshold` (2.5), `cusumSlack` (0.25), `evidenceMinGames` (8).
- Tilt (both endpoints): `tiltPenCap` (10), `tiltPenCapManual` (16), `tiltElevatedAbs` (0.4), `tiltElevatedDelta` (0.15).
- Dampener & outcome cap: `dampFactor` (0.5), `wrPenaltyCap` (15).
- Rest/rust: `restRecoveryCap` (25), `rustFloor: T.baseScore - T.rustPenaltyCap` (40), `rustDecayPerDay` (12), `rustDays` (7).
- Rank-gated nudge: `lowFrequencyDaysPerWeek` (3), `freqPenCap` (5), `rankStagnationWindowDays` (14), `rankEvidenceMinDays` (7), `rankEvidenceMinDeltas` (5), `rankClimbMinPoints` (1).

**Regime honesty:** caps are neither symmetric nor regime-invariant. Deep-tier copy states the **stats-regime** bounds explicitly ("at full live-stat coverage: load −40/+25, performance −45/+8, subjective −15/+8") and adds a one-line "on manual logs the subjective/tilt caps widen" note, quoting `subjCapDownManual` (25) and `tiltPenCapManual` (16). `deepCopy.ts` holds these sentences as pure string builders so the exact interpolated numbers are asserted by the guard test.

## Test Strategy

Reuse the established vitest idiom (`test/readinessScenarios.test.ts:8-10`): named imports from `vitest`, core from `../src/core/readiness`, builders from `./readinessFixtures`, `READINESS_TUNING as T`, table-driven loops, `.toBe` for ints, `.toBeCloseTo`/within-1 for floats, node env. Snapshots are engine-true: `computeReadiness(games, now, ctx)` on a fixture, never hand-authored `ReadinessSummary` literals.

| AC | How verified |
|---|---|
| **AC1** honestyCard/footnotes gone; one "not a diagnosis" line | **Manual/preview** (`npm run preview`): confirm `honestyCard`/`readinessMethodology` removed and the `viewHead` subtitle is the sole disclaimer. Import removal verified by `rg` (tsc won't — no `noUnusedLocals`). |
| **AC2** link opens wiki, standalone modal gone | **Manual/preview**: "How is this calculated?" opens the drawer at the Verdict article; `rg 'readinessMethodology'` returns no definition. |
| **AC3** Overview → article opens simple-first + back/breadcrumb | **Manual/preview** (drawer interaction). |
| **AC4** deep tier constants match `READINESS_TUNING`, guarded | **Unit — `test/readinessDocsConstants.test.ts`.** (a) Pin **numeric literals**: `expect(deepConstants.anchor).toBe(75)`, `…loadCapDown).toBe(40)`, `…cusumThreshold).toBe(2.5)`, `…tiltPenCap).toBe(10)`, `…rankStagnationWindowDays).toBe(14)`, etc. — a retune diverges the literal from the derived `deepConstants` value and **fails the test**, forcing doc re-review (not the tautological `toBe(T.key)`). (b) Cross-check `deepConstants.<k> === T.<k>` so the shipped UI value stays derived. (c) **Prose-drift**: assert each `deepCopy` string `.includes(String(deepConstants.<k>))`, catching drift in the rendered numeric copy, not just the constants module. |
| **AC5** card `?` → plain tier; global Help → Overview | **Manual/preview**: `?` on all four cards deep-links to the correct article at `plain`; Help opens Overview. |
| **AC6** narrative + closest scenario(s) + 75+Δ reconstructs shown score | **Unit (6c) — `test/readinessWalkthrough.test.ts`:** across matchable fixtures, `deriveWalkthrough` non-null with `reconstruction.reconstructed` within ±1 of `summary.score` and `roundingResidual ∈ {-1,0,1}`. **Unit (6b) — `test/readinessNearestScenario.test.ts`:** `1 ≤ result.alternates.length ≤ 2` for every matchable fixture. (6a rendered narrative) **manual/preview.** |
| **AC7** insufficient-data OR disabled → generic, no fabricated walkthrough | **Unit (data path):** `deriveWalkthrough` and `matchScenarios` return `null` for insufficient-data / stale (`score===null`) / `confidence==='low'` fixtures. **Caller-gated + manual/preview (disabled path):** a disabled-but-scored summary yields a valid walkthrough from the pure fn, so the disabled case is verified at the renderer branch (`ctx.data.readinessSettings.enabled === false` → generic content before any pure call) and in preview. Generic fallback content (article plain intro + "what unlocks this") verified in preview. |
| **AC8** matcher returns expected closest deterministically | **Unit — `test/readinessNearestScenario.test.ts`**, partitioned by confidence: **matchable** fixtures (medium/high — `evening-hobbyist-calm`, `stats-grinder-habit-b1`→`measured-grind-green`, `grind-all-manual`, `grind-wr-slump-red`, `grind-tilt-slider-red`, `all-loss-week-outcome-cap`, `grind-wr-slump-dampened`) assert `matchScenarios(...).primary.id === expected` via an explicit fixtureId→curatedId table; **degraded** fixtures (low-confidence — `eight-day-layoff-rust`, `rest-day-3-supercompensation-peak`) assert `matchScenarios(...) === null` (they are covered as archetypes only by the AC9 library/drift guard). |
| **AC9** curated, grouped, trimmed, closest highlighted | **Unit:** `expect(CURATED_SCENARIOS.length).toBe(9)`; assert all 4 `ScenarioGroup` buckets are non-empty; **drift guard**: each curated id's fixture → `computeReadiness` → its documented band. Grouping render + highlight: **manual/preview.** |
| **AC10** non-regression + overlay behavior | **Automated:** full `npm test` (existing readiness suites unchanged — no engine file touched — proves score/band non-regression) + `npm run typecheck` (main + renderer). **Manual/preview:** Escape + backdrop dismissal (inherited from `mountOverlay`). |

**Honest DoD gap (flagged).** Only **AC4, AC6b/6c, AC7 (data-null branch), AC8, AC9 (count/drift)** are covered by `npm test`. AC1/AC2/AC3/AC5/AC6a/AC7-disabled-render/AC9-highlight/AC10-interaction are **DOM/interaction** and verifiable **only via preview/manual** — the test env is node-only with no jsdom (`vitest.config.ts`), `include` is `test/**/*.test.ts`. The plan claims no automated coverage for those. The `deepCopy.ts`/`deepConstants.ts` split is what lets AC4's numeric-prose check run in the node env (pure strings, no DOM).

## Risks & Alternatives

- **Content drift (deep tier vs engine) — primary risk.** Mitigation is now two-layer: `deepConstants.ts` **derives** every quoted number from `READINESS_TUNING` (so shipped copy is never stale within a release), and the AC4 guard **pins numeric literals** so a retune breaks the test and forces doc re-review (the earlier `toBe(T.key)` form was tautological and is rejected). The prose-drift assertion (`deepCopy` strings contain the interpolated constants) closes the authoring-discipline gap. `specs/*.md` are dev-facing and not bundled (esbuild has no `.md` loader; CSP forbids fetch) — the curated subset is re-authored as bundled TS, and the per-id band drift guard stops the library diverging from the engine.

- **Regime-specific caps.** The deep tier could imply a false invariant ("subjective is capped at 15"). Mitigation: copy is explicitly framed as the **stats-regime** bounds, with a one-line "manual caps widen" note quoting `subjCapDownManual` (25) and `tiltPenCapManual` (16); both endpoints are pinned in the guard.

- **"Disabled" is not observable from a summary.** `safeReadiness` always produces a full summary regardless of the toggle, so the pure functions cannot detect disabled. Mitigation: the disabled gate is strictly **caller-side** in `personalized.ts`/`openReadinessWiki` (`ctx.data.readinessSettings.enabled`); the pure-fn short-circuits cover only data-suppressed states. Doc comments and AC7 coverage reflect this split.

- **Matcher simplicity.** Ranking on the 3 family deltas (27 pinned constants) rather than a 7-dim hand-authored vector (~63 unguarded numbers) keeps AC8 deterministic, removes a drift surface, and aligns the matcher's axes with what the wiki teaches. The hard categorical filter (band-group + family-availability + required signal) does the real discrimination; the distance only orders survivors. The alternate-fallback ladder (band-group → ScenarioGroup → adjacent band-group) guarantees AC6b's 1-2 alternates even when regime/signal filtering shrinks a bucket to one survivor.

- **Low-confidence rest/recovery archetypes.** `eight-day-layoff-rust` and `rest-day-3-supercompensation-peak` read low-confidence in their canonical fixtures, so the matcher short-circuits them to `null` and they are never surfaced as a live "closest" — correct, since low-confidence hides the score. They still teach via the browsable scenario library (AC9). AC8 is partitioned accordingly rather than falsely claiming primary coverage for all nine.

- **Drawer vs modal / width.** Drawer chosen (resolved) for room + breadcrumbs; `openDrawer` already supplies `.drawer-panel` + dismissal. The 440px default may feel cramped for formula tables — mitigated by adding `opts.panelClass` + `.drawer-panel--wide` (mirroring `.modal-card--wide`), a small contained extension. A hand-rolled onboarding-style overlay is rejected (duplicates dismissal/focus wiring).

- **Focus management caveat (AC10).** `mountOverlay` provides Escape + backdrop dismissal but **no focus trap/restore** — the codebase baseline for *every* overlay. "Manages focus like other overlays" is satisfied by matching that baseline; adding a real trap would be a deliberate, scoped deviation and is not undertaken unless the reviewer requires it.

- **Over-engineering guard.** No new framework/state machine: navigation is a tiny in-closure page stack + `render(region, …)` (the proven `openHeroDrawer`/onboarding idiom); tiers are a JS re-render toggle. Only genuinely-pure, reusable logic (matcher, derivation, scenario data, constants/copy) lives in `core/` or DOM-free renderer modules; everything DOM stays in the renderer.