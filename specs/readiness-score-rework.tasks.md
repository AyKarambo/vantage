# Tasks: Readiness score rework — objective performance signals (`readiness-score-rework`)

**Spec:** `specs/readiness-score-rework.spec.md` (approved 2026-07-07). **Plan:** `specs/readiness-score-rework.plan.md`.
Ordered by dependency: core math bottom-up (A), wiring (B), renderer (C), docs/verification (D). Every task compiles and tests green on its own; plan § references give the exact algorithms/constants.

## A — Pure core (`src/core/readiness/`)

- [ ] **A1 — Tuning constants + stat helpers**
  - **Goal:** Land the full new `READINESS_TUNING` surface (plan §2.8, each with a one-line rationale; retire `outcomePenaltyCap`/`mentalPenaltyCap`/`loadPenaltyCap`) and the shared math helpers.
  - **Files:** `src/core/readiness/constants.ts`, `src/core/readiness/stats.ts` (new: `meanSd`, `winsorizedZ`, per-game `ewmaSeries`), `test/readinessStats.test.ts` (new).
  - **Check:** helper unit tests green (mean/SD, winsorize bounds ±zWinsor, EWMA recurrence vs hand-computed values); `npm run typecheck` clean (no consumer of retired constants remains except code slated for A5).
  - **Size:** S

- [ ] **A2 — Baseline buckets**
  - **Goal:** Single-pass per-`(account,hero)` / `(account,role)` bucket builder with qualifying-game filter (single-hero ∧ `perHero` ∧ duration ≥ `minPer10Minutes`), lifetime counts, and uncoupled trailing-window `meanSd` baselines (plan §2.2).
  - **Files:** `src/core/readiness/baselines.ts` (new), `test/readinessBaselines.test.ts` (new).
  - **Check:** tests: multi-hero/short/undurated games excluded; per-account separation (Main vs Smurf fixtures); baseline excludes acute-window games (uncoupled); learning-window lifetime counts correct.
  - **Size:** M

- [ ] **A3 — Objective-performance subscore + dampener**
  - **Goal:** `perfState()` — per-metric winsorized z with `metricSkipMin` renormalization, `bucketTrust` ramp, role fallback with mix-shift overlap guard, one-sided CUSUM (fires only ≥ `cusumThreshold` ∧ ≥ `evidenceMinGames`), per-account winrate dips, perf bonus, and the target-focus dampener (per-distinct-game evidence, `hit=1/partial=0.5`, elevated-tilt void, fixed `dampFactor`, Notion-sentinel excluded) (plan §2.2, §2.4).
  - **Files:** `src/core/readiness/performance.ts` (new), `test/readinessPerformance.test.ts` (new), `test/readinessDampener.test.ts` (new).
  - **Check:** CUSUM arithmetic tests (single game 2.25 < 2.5 no-fire; 3-game session no-fire; 12-game marathon fires; 4×z−2.5 → C=9 but < 8 games → no-fire); bucketTrust ramp sweep 15→20 monotone, no cliff; mix-shift overlap < 0.5 → inert; hero-switch (both trusted) → no decline; flex player → winrate ≤ `wrPenaltyCap`, perf shrinks; dampener: strict score dampening, void on `fatigued`, stray flag keeps dampening, ungraded → none, all-partial vs all-hit arithmetic, 5-targets-on-1-game = one game of evidence, ten-trivial == one-target factor.
  - **Size:** L

- [ ] **A4 — Subjective subscore**
  - **Goal:** `subjState()` — continuous coverage-gated `tiltPen` (no elevated-bar cliff), slider-vs-own-average (`sliderMinBase`/`sliderMinAcute` gates, pen/bonus caps), boolean `objectiveAdverse` disagreement gating, `subjRaw` clamp (plan §2.3).
  - **Files:** `src/core/readiness/subjective.ts` (new), `test/readinessSubjective.test.ts` (new).
  - **Check:** tests: zero-data → exactly 0 + available:false; low-personal-average slider reads neutral; agree-case contribution < disagree-case (0.3 factor); "feel great" counter capped at 4; stray tilt flag below bars contributes normal `tiltPen`; bounds [−15, +8] hold.
  - **Size:** M

- [ ] **A5 — Composite score, band derivation & state (the engine swap)**
  - **Goal:** Rewrite `score.ts`: `computeStateAt(games, refOrdinal, ctx)` composing load/perf/subj states (extend `StateAt`, update `EMPTY_STATE` in lockstep); `loadDelta` with `habitBar`-relative volPen, surge-gated streakPen, continuous chronic trust, kept `restEffectFor` (retuned `rustPenaltyCap 35`), explicit clamp; composite `scoreFromState` on the 75 anchor; `bandForState(score, driver, gates)` with the `marathonSession` red arm and documented `trust ≥ 1` hard gate; `driver` tag; trim `outcomeState` to lossStreak (plan §2.1, §2.5).
  - **Files:** `src/core/readiness/score.ts`, `src/core/readiness/signals.ts`, `src/core/readiness/types.ts` (`ReadinessDriver`, `ReadinessSubscore(s)`, `ReadinessContext`, extended `ReadinessSummary`), `test/readiness.test.ts` (migration).
  - **Check:** the plan §5 migration list executed verbatim: `restEffectFor(60) === −35`; rust floor ≥ 40; AC-D load+tilt fixtures re-derived → `loaded` (+ new red-recipe fixtures with stat decline → `in-the-hole`); habitual 9-10/day grinder (ratio≈1, gapless) → `overloadPen 0` → green; marathon end-to-end → red via `marathonSession`; layoff→binge no whiplash + trust ramp smooth 1→7; loadDelta ∈ [−40,+25] across chronicActiveDays 5–9; band monotonicity property test; equal-score overload-vs-rust drivers differ; undertraining trio (rusty floor, frequency nudge, recovering→fresh).
  - **Size:** L

- [ ] **A6 — Orchestrator, confidence, signals, trend**
  - **Goal:** `index.ts`: third `ctx` parameter on `computeReadiness`/`safeReadiness` (defaulted `EMPTY_CONTEXT`), `confidenceFor` rework (statCoverage + winrate gates + `accountMixBar` cap, mental optional), `buildSignals` additions (`perf-decline`, `winrate-dip`, `target-focus`, `still-learning`, `slider-low`, `mixed-accounts`), `buildTrend`/`scoreAt` ctx threading with per-day target `createdAt` filtering; barrel + `src/shared/contract/index.ts` re-exports (plan §2.6, §2.7, §1).
  - **Files:** `src/core/readiness/index.ts`, `src/core/readiness/types.ts` (if remaining), `src/shared/contract/index.ts`, `test/readiness.test.ts` (extend).
  - **Check:** GEP-rich + zero mental → `high`; manual-only → ≤ medium; flex ≤ medium; mixed-account fixture confidence < single-account twin + `mixed-accounts` signal; loss-streak fixture that *clears* the winrate gates (~21 decided/7d at ≤6/day) → penalty ≤ cap, never red; subjective-only ≤ 15 pts, never red; trend points equal composite (spot-check vs `scoreFromState`); target created mid-trend → earlier points undampened; totality battery green under new signature; existing 2-arg test calls compile unchanged.
  - **Size:** M

## B — Wiring & analytics

- [ ] **B1 — Call-site wiring + launch-toast fix**
  - **Goal:** Thread target context into both `safeReadiness` call sites; fix the pre-existing launch-toast drift (raw `history.all()` → competitive-filtered, matching `dashboardData.ts:51`).
  - **Files:** `src/core/dashboardData.ts` (line ~113), `src/main/index.ts` (lines ~440-448).
  - **Check:** typecheck main+renderer clean; full suite green; preview harness (`npm run preview`) renders the readiness view from sample data without error.
  - **Size:** S

- [ ] **B2 — Performance-rating analytics rollups (issue #44 part 1, core)**
  - **Goal:** `performanceStats(games)` from filtered games: day-bucketed trend, win/loss averages, `byHero`/`byMap` (whole-count convention, null-not-zero, Notion-sentinel-free) on a new `DashboardData.performanceStats` field (plan §3.10-12, §3.14).
  - **Files:** `src/core/analytics/performanceStats.ts` (new), `src/core/analytics/types.ts` + `index.ts`, `src/core/dashboardData.ts`, `src/shared/contract/dashboard.ts` + `index.ts`, `test/performanceStats.test.ts` (new).
  - **Check:** tests: trend bucketing; winAvg/lossAvg (draws excluded); multi-hero game's single rating counts once per hero; unrated heroes/maps absent (not 0); empty history → `ratedGames 0`, null averages.
  - **Size:** M

- [ ] **B3 — Sample-data performance backfill + sanity harness**
  - **Goal:** Seeded `performance` on ~55% of sample games (`55 + (win ? +8 : −6) + noise`, clamp 5–95) so demo surfaces render populated; a harness test computing readiness + performanceStats over `generateSampleGames(180, 42)` asserting sanity (not red, score ∈ [35,95], surfaces non-empty).
  - **Files:** `src/core/sampleData/generate.ts`, `test/readiness.test.ts` or `test/performanceStats.test.ts` (harness).
  - **Check:** harness test green; determinism (same seed → same ratings).
  - **Size:** S

## C — Renderer

- [ ] **C1 — Readiness screen: subscore breakdown + methodology modal**
  - **Goal:** 3-tile subscore row (statBox grid + statBar pull bars, mirroring `loadCard`'s idiom) with availability/coverage notes; new modal sections (subscores & weights, own-baselines, dampener, exemptions, external-cause caveat) (plan §3.17).
  - **Files:** `renderer/src/views/readiness.ts`.
  - **Check:** typecheck renderer clean; preview: subscore tiles render for enabled/disabled + insufficient-data states; modal opens/closes (Escape, backdrop, button) with the new sections; honesty note present.
  - **Size:** M

- [ ] **C2 — Rating chart plot**
  - **Goal:** `ratingChart` — two-series dependency-free SVG (per-day avg + rolling average), 0–100 y-scale, tooltip layer, `emptyChart()` guard, copied from `lineChart` scaffolding (plan §3.18).
  - **Files:** `renderer/src/charts/plots/ratingChart.ts` (new), `renderer/src/charts/plots/index.ts`.
  - **Check:** typecheck clean; preview: renders with sample data (B3), empty-guard with a filter that excludes all rated games.
  - **Size:** S

- [ ] **C3 — Trends: performance card + correlation tiles**
  - **Goal:** Shared `chartCard` (with table toggle) hosting `ratingChart` + two `statBox` tiles (avg rating on wins / on losses); friendly empty state when no rated games (plan §3.19).
  - **Files:** `renderer/src/views/trends.ts`.
  - **Check:** preview: card renders with data and as empty state; table toggle lists per-day rows; respects the global filter bar.
  - **Size:** S

- [ ] **C4 — Heroes & Maps rating columns**
  - **Goal:** `Rtg` column on the Heroes `dataTable` (lookup from `performanceStats.byHero`, `fmt()` → `'–'` for null) and on the Maps `chartCard` table (null → `'–'` **in the row-mapper** — no column `render` on that path) (plan §3.20-21).
  - **Files:** `renderer/src/views/heroes.ts`, `renderer/src/views/maps.ts`.
  - **Check:** preview: rated heroes/maps show averages, unrated show `'–'` (never 0); Heroes column sorts with nulls-last like the per-10 columns.
  - **Size:** S

## D — Docs & verification

- [ ] **D1 — Docs reconciliation**
  - **Goal:** README (Screens + Architecture bullets), superseded-by note atop `specs/supercompensation-detection.spec.md`, release-notes line for the one-time score/trend shift.
  - **Files:** `README.md`, `specs/supercompensation-detection.spec.md`, `docs/onboarding/03-codebase-tour.md` (if it enumerates core modules).
  - **Check:** docs mention the composite/subscores and the new Trends/Heroes/Maps surfaces; old spec points here.
  - **Size:** S

- [ ] **D2 — Definition-of-Done verification**
  - **Goal:** Full gate: `npm test`, `npm run typecheck` (main + renderer), preview walkthrough of every new surface (readiness breakdown, modal, Trends card, Heroes/Maps columns) with demo data and with an empty/manual-only dataset.
  - **Files:** none (verification only).
  - **Check:** all suites green; preview walkthrough notes attached to the PR; no guardrail weakened (pure core, no new deps, CSP-safe SVG, typed IPC).
  - **Size:** S

---

## Consistency check (spec AC → task traceability)

**Composite & band coherence:** band purity/monotonicity → A5 · equal-score driver split → A5 · subjective-cap ≤15/never-red → A4+A6 · agree-vs-disagree → A4 · insufficient/stale gates → A5 (kept, regression-tested) · fresh/steady label-only → A5.
**Overtraining:** red conjunction → A3+A5 · marathon session (fires + escalates) → A3 (accumulator) + A5 (band arm) · decline-but-rested ≤ amber → A5 · loss-streak capped/never red → A6 · single game/short session no-fire → A3 · habitual volume green → A5 · layoff→binge no whiplash → A5.
**Baselines & exemptions:** hero-switch → A3 · learning window → A2+A3 · role fallback → A3 · mix-shift → A3 · flex player (incl. confidence) → A3+A6 · multi-account isolation + note + lowered confidence → A2+A6 · manual-only → A6 · duration/multi-hero/short-game skip → A2 · winrate under-sampled inert → A3.
**Dampener (all 7):** → A3 (evidence, void, stray flag, ungraded, partial credit, anti-farming, load-unaffected) + A6 (signal).
**Undertraining (all 3):** → A5.
**Subjective/slider/confidence (4):** → A4 (slider neutral/signal precondition) + A6 (signal presence, zero-data, GEP-rich→high).
**Contract & screen:** typed subscores/driver over IPC → A6+B1 · subscore breakdown + modal + honesty → C1 · trend = composite → A6 · chip/toast/settings unchanged → B1+D2.
**Performance analytics (4):** trend card + empty state → B2+C2+C3 · correlation → B2+C3 · heroes/maps columns → B2+C4 · demo dataset renders → B3+D2.
**DoD:** → D2 (+ per-task checks).

**Gaps:** none — every spec AC traces to ≥1 task.
**Scope beyond spec ACs (all plan-sanctioned, flagged for transparency):** the launch-toast competitive-filter fix in B1 (plan §1 drift fix; traces to the spec's competitive-only *constraint*, not an AC) · the sample-data `performance` backfill in B3 (enables the demo AC, which is otherwise only satisfiable via its empty state) · A1's helper module (pure enabler). No task traces to nothing.
