# Task breakdown: Readiness help wiki (`readiness-help-docs`)

Derived from [`readiness-help-docs.plan.md`](readiness-help-docs.plan.md) and [`readiness-help-docs.spec.md`](readiness-help-docs.spec.md). Ordered dependencies-first: pure `core/` foundation → DOM-free renderer helpers → wiki content → drawer host → view surgery → docs → verification. Presentation-only; **no readiness engine/score change**.

Legend — Size: **S** ≈ <1h focused, **M** ≈ a session, **L** ≈ content-heavy. `[core]` = pure & Electron-free (Guardrail 3); `[rndr]` = renderer bundle (Guardrail 4).

**Cross-cutting design decisions** (from the breakdown verification):
- **`core/` edits stay additive.** T1–T3 touch `src/core/readiness/index.ts` only to append re-export lines — zero changes to `computeReadiness`/`safeReadiness`/`round1`. New modules import shared types from `./types`, **not** `./index`, so re-exporting them can't form a core-side import cycle. This is why "no engine change" holds even though `index.ts` doubles as the compute engine.
- **Wiki navigation is injected, never imported.** The T9 host owns the page stack and passes a `nav` callback (`{ goto(route), pop(), close() }`) into every page/article builder (T6a/T6b/T7/T8). Builders must **not** import `openReadinessWiki` — keeps the dependency edges one-directional (host → content).

---

## Tasks

- [x] **T1 — Curated scenario data + types** `[core]`
  - **Goal:** Author `CURATED_SCENARIOS` — the 9 archetypes in 4 buckets (`healthy`/`recovery`/`overload`/`guardrail`) — plus the `ScenarioGroup`, `BandGroup`, `ScenarioSignature`, `CuratedScenario` types (in `scenarios.ts`, importing base types from `./types`), and a band-drift guard test.
  - **Files:** `src/core/readiness/scenarios.ts` (new), `src/core/readiness/index.ts` (append re-export only), `test/readinessScenarios.help.test.ts` (new).
  - **Check:** `npm test` — `expect(CURATED_SCENARIOS.length).toBe(9)`, all 4 `ScenarioGroup` buckets non-empty, each curated id's fixture → `computeReadiness` → its documented `BandGroup` (drift guard). `npm run typecheck` clean.
  - **Size:** M

- [x] **T2 — Nearest-scenario matcher + golden test** `[core]`
  - **Goal:** `matchScenarios(summary): ScenarioMatchResult | null` — null short-circuit (`score===null` / `insufficient-data` / `confidence==='low'`), band-group + family-availability + `requiresSignal` hard filter, 3-delta (`/40,/45,/15`) distance ranking, and the alternate-fallback ladder (band-group → `ScenarioGroup` → adjacent band-group) guaranteeing 1–2 alternates.
  - **Files:** `src/core/readiness/nearestScenario.ts` (new; types from `./types`/`./scenarios`), `index.ts` (append re-export only), `test/readinessNearestScenario.test.ts` (new).
  - **Check:** `npm test` — matchable fixtures (medium/high confidence) assert `primary.id` via an explicit `fixtureId→curatedId` table (incl. `grind-all-gep`→`measured-grind-green`); degraded low-confidence fixtures (`eight-day-layoff-rust`, `rest-day-3-supercompensation-peak`) assert `=== null`; every matchable fixture asserts `1 ≤ alternates.length ≤ 2`. Deterministic.
  - **Size:** M · **depends:** T1

- [x] **T3 — Walkthrough derivation + test** `[core]`
  - **Goal:** `deriveWalkthrough(summary): WalkthroughDerivation | null` — narrative (regime/band/confidence + signed family `pulls`) and the 75-anchor reconstruction (`anchor`, three `round1`'d deltas, `reconstructed = clamp(round(75+Σ),0,100)`, authoritative `shown`, `roundingResidual ∈ {-1,0,1}`). Returns `null` **only** on data-suppressed states — the doc comment states explicitly this excludes "disabled" (a summary cannot express it; that's caller-gated in T7).
  - **Files:** `src/core/readiness/walkthrough.ts` (new; types from `./types`), `index.ts` (append re-export only), `test/readinessWalkthrough.test.ts` (new).
  - **Check:** `npm test` — across matchable fixtures `reconstructed` within ±1 of `summary.score` and `roundingResidual ∈ {-1,0,1}`; null branch fires for insufficient-data / `score===null` / low-confidence.
  - **Size:** M · **depends:** T1 (types)

- [x] **T4 — Deep-tier constants + copy + drift guard** `[rndr, DOM-free]`
  - **Goal:** `deepConstants.ts` derives **every** deep-tier number from `READINESS_TUNING` (full spec-item-5 set incl. tilt caps `10/16`, ratio/CUSUM/dampener/rest-rust constants, rank-nudge keys, and the manual endpoints `subjDeltaMinManual` −25 / `tiltPenCapManual` 16). `deepCopy.ts` holds pure string builders interpolating them, framed as **stats-regime** bounds with a one-line "manual caps widen" note.
  - **Files:** `renderer/src/app/readinessWiki/deepConstants.ts` (new), `renderer/src/app/readinessWiki/deepCopy.ts` (new), `test/readinessDocsConstants.test.ts` (new).
  - **Check:** `npm test` — numeric-**literal** pins (`anchor).toBe(75)`, `loadCapDown).toBe(40)`, `perfCapDown).toBe(45)`, `subjCapDown).toBe(15)`, `subjCapDownManual).toBe(25)`, `cusumThreshold).toBe(2.5)`, `dampFactor).toBe(0.5)`, `tiltPenCap).toBe(10)`, `rankStagnationWindowDays).toBe(14)`, …); a `deepConstants.<k> === T.<k>` cross-check; and each `deepCopy` string `.includes(String(deepConstants.<k>))` (prose-drift). Pure — runs in the node test env.
  - **Size:** M · **independent**

- [x] **T5 — Drawer `panelClass` option + wiki CSS** `[rndr]`
  - **Goal:** Add optional `opts.panelClass` to `openDrawer` (mirroring `openModal`); add `.drawer-panel--wide` (mirror `.modal-card--wide`) and the `.wiki-*` classes (article/breadcrumb/tier-toggle/closest-scenario highlight).
  - **Files:** `renderer/src/components/overlay.ts`, `renderer/styles/components.css`.
  - **Check:** `npm run typecheck` clean; existing overlays unaffected; CSP-safe (classes only, no inline script). Wide drawer + wiki classes render in preview (T12).
  - **Size:** S · **independent**

- [x] **T6a — Article model + `verdict` + `what-moves-the-score` articles** `[rndr]`
  - **Goal:** The `WikiArticle` model (`{ id, title, plain(nav)/howItWorks(nav)/deep(nav) }`, tier builders receiving the injected `nav`) and the first two articles, each simple-first (`plain` before any formula), composing `card()`, `.stack`, `.hint`, `statBox()`, `badge`, and (deep tier) `deepCopy`.
  - **Files:** `renderer/src/app/readinessWiki/articles.ts` (new).
  - **Check:** `npm run typecheck` clean; both articles render plain-before-formula in preview; deep-tier numbers come only from `deepCopy`/`deepConstants` (no stray literals).
  - **Size:** M · **depends:** T4, T5

- [x] **T6b — `training-load` + `readiness-trend` articles (schematic re-home)** `[rndr]`
  - **Goal:** The remaining two articles in the same model; re-home `supercompensationSchematic()` into the `readiness-trend` deep tier (import from `charts/plots`).
  - **Files:** `renderer/src/app/readinessWiki/articles.ts` (extend).
  - **Check:** `npm run typecheck` clean; both render plain-first in preview; `readiness-trend` deep shows the schematic.
  - **Size:** M · **depends:** T6a, `charts/plots`

- [x] **T7 — Personalized "Your readiness right now" article** `[rndr]`
  - **Goal:** The personalized builder (receives injected `nav`): **caller-side disabled gate** (`ctx.data.readinessSettings.enabled === false` → generic content **before** any pure call), then `deriveWalkthrough` narrative + step-through tiles and `matchScenarios` primary/alternate tiles; and the concrete generic fallback (the target article's `plain` intro + a "what unlocks this" line) when a pure fn returns `null`.
  - **Files:** `renderer/src/app/readinessWiki/personalized.ts` (new).
  - **Check:** Preview — a scored account shows narrative + closest scenario tiles + `75+Δ` tiles (AC6a/AC6b-render/AC6c-render); a disabled account and an insufficient-data/low-confidence account both show generic content + the unlock note, never a fabricated walkthrough. `npm run typecheck` clean.
  - **Size:** M · **depends:** T2, T3, T6a+T6b (reuses article plain intros for fallback)

- [x] **T8 — Curated scenario library view** `[rndr]`
  - **Goal:** Render `CURATED_SCENARIOS` grouped by the 4 buckets with plain copy + `teaches` line (receives injected `nav`); highlight the user's closest scenario(s) (from `matchScenarios`) via the `.wiki`-highlight class; browsable with zero personalized data.
  - **Files:** `renderer/src/app/readinessWiki/scenarioLibrary.ts` (new).
  - **Check:** Preview — 4 groups render; with a live match the closest tile is highlighted; with no match (degraded) it is simply browsable. `npm run typecheck` clean.
  - **Size:** M · **depends:** T1, T2, T5

- [x] **T9 — Drawer host + in-panel navigation + Overview** `[rndr]`
  - **Goal:** `openReadinessWiki(route?)` — `openDrawer` (wide) hosting a stable inner region (appended after the built-in `✕`), a tiny in-closure page stack (`overview` / `article:<id>@tier` / `scenarios` / `personalized`), breadcrumb + Back, and the tier toggle; articles always open at `plain`. **Build the Overview landing here** (article cards + links to the scenario library and the personalized article) — note: the plan sketched Overview in `articles.ts`; it lives in `index.ts` (the host owns the page-stack root). Owns and injects the `nav` callback into every builder. Never `render()` over the whole panel.
  - **Files:** `renderer/src/app/readinessWiki/index.ts` (new).
  - **Check:** Preview — Overview → article opens at plain, Back/breadcrumb return, tier toggle reveals the deep tier with its real constants (AC4 reveal), Escape + backdrop close the drawer. `npm run typecheck` clean.
  - **Size:** M · **depends:** T6a, T6b, T7, T8, T5

- [x] **T10 — Strip the Readiness view + wire entry points** `[rndr]`
  - **Goal:** In `readiness.ts`: remove `honestyCard` (fn + call) and `readinessMethodology` (fn); trim `REGIME_META.title` / `loadNote` / `confidenceNote` / verbose `sub` copy to terse labels; keep the `viewHead` subtitle as the sole "wellness heuristic, not a diagnosis" line; add a global **Help** action (via `viewHead` actions) and a per-card **?** (via `card()` actions — Verdict as `[regimeBadge?, helpBtn]` so it survives `showRegime`) → `openReadinessWiki(...)`; repoint "How is this calculated?" to the Verdict article; make Help reachable from the disabled-feature view too; clean orphaned imports (`openModal`, `button` unless reused, and `supercompensationSchematic` now moved to T6b) — verified by `rg`, since tsc has no `noUnusedLocals`.
  - **Files:** `renderer/src/views/readiness.ts`.
  - **Check:** Preview — cards show data + terse labels; one disclaimer line; each card `?` deep-links to its article at plain; Help opens Overview; old link opens the wiki. `rg 'readinessMethodology|honestyCard'` returns no definitions; `npm run typecheck` clean.
  - **Size:** M · **depends:** T9 (`openReadinessWiki`), T6b (schematic re-homed)

- [x] **T11 — Docs update** `[docs]`
  - **Goal:** Update README (and any user-facing readiness note) to say the Readiness view is data-only with an in-app help wiki that replaces the standalone methodology modal.
  - **Files:** `README.md` (and/or the relevant `specs/screen-*.md` if it documents the readiness surface).
  - **Check:** Docs mention the wiki; no reference to the removed "How to read this" card / methodology modal remains. (DoD #4.)
  - **Size:** S · **depends:** behavior finalized (after T10)

- [x] **T12 — DoD + preview verification gate** `[verify]`
  - **Goal:** Prove the automated ACs and manually verify the DOM/interaction ACs the node-only test env can't cover.
  - **Files:** none (verification only).
  - **Check:** `npm test` green (incl. T1–T4 suites; existing readiness suites unchanged → score/band non-regression) and `npm run typecheck` clean (main + renderer); `npm run preview` walkthrough confirming **AC1, AC2, AC3, AC4-deep-tier-reveal, AC5, AC6a, AC6b-render, AC6c-render, AC7-render, AC9-highlight, AC10-interaction**.
  - **Size:** M · **depends:** all

---

## Consistency check (spec ⇄ tasks)

Every acceptance criterion in the spec maps to ≥1 task:

| Acceptance criterion | Task(s) | Verified by |
|---|---|---|
| **AC1** view stripped, one disclaimer visible | T10 | preview (T12) |
| **AC2** old link opens wiki; methodology modal gone | T10 (+T9 provides `openReadinessWiki`) | preview + `rg` (T12) |
| **AC3** Overview→article simple-first + back/breadcrumb | T9 (nav) + T6a/T6b (plain-first content) | preview (T12) |
| **AC4** deep-tier constants match `READINESS_TUNING` **and** appear on drill-down | T4 (constants/prose match) + T6a/T6b (deep builders) + T9 (tier toggle reveal) | **automated** drift guard (T4) **+ preview** deep-tier reveal (T9, in T12) |
| **AC5** card `?`→plain tier; global Help→Overview | T10 (wiring) + T9 (routes) | preview (T12) |
| **AC6a** narrative | T7 (+T3 derivation) | preview (T12) |
| **AC6b** closest scenario primary +1–2 alternates | T2 (invariant) + T7 (tile render) | **automated** (T2) **+ preview** render (T12) |
| **AC6c** 75+Δ step-through reconstructs shown score | T3 (invariant) + T7 (tile render) | **automated** (T3) **+ preview** render (T12) |
| **AC7** insufficient-data/disabled → generic, no fabrication | T2 + T3 (data-null, automated) · T7 (disabled gate + fallback render) | unit + preview (T12) |
| **AC8** matcher deterministic golden | T2 | **automated** |
| **AC9** curated, grouped, trimmed, closest highlighted | T1 (count/group/band-drift, automated) + T8 (grouped render + highlight) | unit + preview (T12) |
| **AC10** non-regression + overlay behavior | T12 (npm test + typecheck; Escape/backdrop) — every task's Check contributes | automated + preview |

**Gaps (AC with no task):** none.

**Scope-creep (task tracing to no criterion):** none. Two enabling/DoD tasks are intentional — **T5** (drawer `panelClass` + CSS) enables AC3/AC5/AC10 (breadcrumb room, wiki styling, dismissal parity); **T11** (docs) satisfies the spec's DoD #4, not a numbered AC.

**Honest coverage note (from the plan):** the test env is node-only (no jsdom), so the **render halves** of AC1/AC2/AC3/AC4-reveal/AC5/AC6a/AC6b/AC6c, the AC7 disabled-render path, AC9 highlight, and AC10 interaction are verifiable **only via preview/manual** (T12). Pure logic — the matcher (AC6b/AC8), walkthrough (AC6c/AC7-data-null), scenario drift (AC9-data), and constants/prose drift (AC4) — is automated in `npm test`.
