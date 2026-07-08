# Tasks: Readiness data regimes (`readiness-data-regimes`)

Derived from `specs/readiness-data-regimes.plan.md`. Ordered dependencies-first. Each task keeps `npm test` + `npm run typecheck` green (score-changing tasks re-pin the existing manual fixtures they shift — cross-release continuity is not promised, per spec). `b=1` bit-identity is the guardrail every engine task must preserve.

- [x] **T1 — Tuning constants + `manualLerp` helper**
  - **Goal:** Add every new `READINESS_TUNING` constant (§5 of the plan) and the `manualLerp` helper; no behavior change yet (nothing reads them).
  - **Files:** `src/core/readiness/constants.ts`.
  - **Check:** `npm run typecheck` clean; `npm test` unchanged (green). Constants present with one-line rationales; `manualLerp(a,b,1)===a`, `manualLerp(a,b,0)===b` (trivial unit test).
  - **Size:** S

- [x] **T2 — Blend factor `b` in `perfState` (+ `regime.ts`)**
  - **Goal:** New pure `regime.ts` (`blendFor`, `regimeFor`); accumulate `blendCoverage = Σ trustFor(base.n)` in the existing acute CUSUM loop (R1 — continuous, not binary `countedGames`); expose `PerfState.blend` + `PerfState.blendCoverage`; `EMPTY_PERF.blend = 0`. Score still unchanged (b computed, not yet consumed).
  - **Files:** `src/core/readiness/regime.ts` (new), `performance.ts`, `constants.ts` (already has cuts).
  - **Check:** `blendFor` unit table (0-coverage⇒0; saturation at 0.5/10; monotone; per-game step ≤0.1 sweep); real fixture ⇒ b=0, stats-rich ⇒ b=1; **onboarding-ramp fixture** (baseline crossing n=15→16) ⇒ bounded per-day Δb (the R1 cliff); existing perf tests green (perfDelta byte-identical).
  - **Size:** M

- [x] **T3 — Regime on state + contract (surface only, score unchanged)**
  - **Goal:** `ReadinessRegime` union + `ReadinessSummary.regime` (after `driver`); `StateAt.blend`+`regime` set in `computeStateAt`; `EMPTY_STATE`; fill all 3 producers (`computeReadiness`, `insufficientSummary`, `staleSummary`); `toSubscores` load.coverage=b; barrel + `shared/contract` re-export; widen `ReadinessSubscore.coverage` doc.
  - **Files:** `types.ts`, `score.ts`, `index.ts`, `src/shared/contract/index.ts`.
  - **Check:** `npm run typecheck` clean (required field enumerated across producers); `regime` correct on all 3 producer paths; deep-equal snapshot of a stats-rich `ReadinessSummary` score/band unchanged vs pre-change.
  - **Size:** M

- [x] **T4 — Absolute-load arm in `loadParts` (the core manual-regime lever)**
  - **Goal:** Add `historySpanDays` (uncapped) to `LoadState`; thread `blend` into `loadParts`; add the volume-gated (R2) streak + absolute-volume + rest-scarcity sub-arms with the active-day × tenure `absTrust` (R3), inside the existing `overloadPen` min-sum; exact-zero at b=1. `surging` untouched; long sessions excluded.
  - **Files:** `signals.ts`, `score.ts`, `constants.ts`.
  - **Check:** real fixture ⇒ **41 / `loaded` / driver `overload`**; green fixture ⇒ green; **hobbyist 4/day-every-day ⇒ green (R2)**; **day-17 newcomer 6/day ⇒ green (R3)**; b=1 ⇒ score/band bit-identical; `streakPen===0` on the real fixture (surging intact); one-adverse-family grind never red. Re-pin any shifted existing load fixtures.
  - **Size:** L

- [x] **T5 — Promoted results (winrate) ceiling**
  - **Goal:** `wrPenalty` cap lerps `wrPenaltyCap → wrPenaltyCap+wrManualCapBoost` via `(1−b)` (R4 — **slope 100 and `wrDipMin` unchanged**). `objectiveAdverse` already `wrPenalty>0` (no change).
  - **Files:** `performance.ts`, `constants.ts` (already has boost).
  - **Check:** manual deep dip may exceed −15 up to −30 and sets `objectiveAdverse`; identical dip at b=1 behaves exactly as today; sub-gate samples inert every regime; **red variant**: real fixture + wrDip 0.10 ⇒ 38 (undamped) / 40 (damped) `in-the-hole` (exact-score pins).
  - **Size:** S

- [x] **T6 — Subjective widening**
  - **Goal:** Thread `blend` into `subjState`; lerp `tiltPenCap→16`, `sliderPenCap→12`, and the lower clamp `subjDeltaMin→−25` via `manualLerp`. Slopes/gates/disagreement-gating unchanged.
  - **Files:** `subjective.ts`, `score.ts` (pass `perf.blend`), `constants.ts` (already has caps).
  - **Check:** max adverse subj at b=0 bounded by −25, no red without a 2nd family; b=1 keeps −15; **tilt variant** acuteTilt 0.45 ⇒ 39 `in-the-hole` (exact pin); calm tilt unchanged at every b (sub-cap penalties regime-invariant).
  - **Size:** S

- [x] **T7 — Confidence cap in manual regime**
  - **Goal:** One guard in `confidenceFor`: `if (conf==='high' && regimeFor(state.blend)==='manual') conf='medium'` (single site, R5).
  - **Files:** `index.ts`.
  - **Check:** b=0 ⇒ ≤`medium` whatever mental coverage (pin); stats-rich ⇒ `high` still reachable; hybrid unchanged.
  - **Size:** S

- [x] **T8 — Regime badge, confidence hint, load tooltip, methodology (renderer)**
  - **Goal:** `badge()` gains `'hybrid'` kind + optional `title`; `.badge--hybrid` CSS (reuse amber literal); `REGIME_META` table; badge in `verdictCard` actions guarded by `showRegime = band!=='insufficient-data' && band!=='rusty'`; capped-confidence hint clause; `loadNote(r)` on the Load tile; two methodology sections + confidence-levels sentence.
  - **Files:** `renderer/src/components/primitives/labels.ts`, `renderer/styles/components.css`, `renderer/src/views/readiness.ts`.
  - **Check:** renderer `npm run typecheck` clean; badge/copy per regime; guard hides badge on rusty/insufficient; existing 2-arg `badge()` calls compile; preview harness renders the manual badge without error.
  - **Size:** M

- [x] **T9 — Comprehensive regime test suite + regression re-baseline audit**
  - **Goal:** New `test/readinessRegime.test.ts`: b=1 deep-equality golden snapshot; one-game epsilon (|Δscore|≤5) + monotonicity-in-b sweep; **7-day GEP outage** trace (bounded steps, `declineFired` never fires from coverage loss) + **non-uniform-volume** variant (continuity-#3); **deaths-direction regression pin** (lower deaths/10 = favorable); trend scores each day under its own b. Audit every existing `readiness*.test.ts` fixture landing at `0<b<1` and densify or deliberately re-pin.
  - **Files:** `test/readinessRegime.test.ts` (new), `test/readinessFixtures.ts` (builders as needed), existing `readiness*.test.ts` (re-baseline).
  - **Check:** full `npm test` green; every spec AC has an assertion (see consistency map below).
  - **Size:** M

- [x] **T10 — Docs**
  - **Goal:** README readiness bullet + `core/readiness/` bullet; superseded-decision note atop `specs/readiness-score-rework.spec.md` §objective-performance pointing here.
  - **Files:** `README.md`, `specs/readiness-score-rework.spec.md`.
  - **Check:** docs describe regimes, the patch-day note, "load alone never red", and confidence cap; superseded note present.
  - **Size:** S

- [x] **T11 — Passivity guard: output-gated deaths credit** *(revision 2026-07-08)*
  - **Goal:** Deaths' favorable credit scaled by `clamp(1 + outputZ/passivityRampZ, 0, 1)` (weight leaves the blend with it); deaths-adverse unchanged; raw `metricSums` kept; `passivityRampZ = 0.5` constant.
  - **Files:** `src/core/readiness/performance.ts`, `constants.ts`, tests.
  - **Check:** scared-play fixture (damage+elims down, deaths down) fires the decline index; deaths-down-while-output-holds still favorable (T9 pin unchanged); deaths-up unchanged in every context; graduated boundary (no cliff at outputZ 0); `deaths-improve-damage-fall` scenario re-pinned.
  - **Size:** M

- [x] **T12 — Rank-gated undertraining nudge** *(revision 2026-07-08)*
  - **Goal:** New pure `rankTrend.ts` (`'climbing'|'stagnant'|'unknown'` from anchors + srDelta-carrying comps over a 14-day window, evidence-gated); `ReadinessContext.rankAnchors`; `StateAt.rankTrend`; `freqPen` + low-frequency signal fire only on `stagnant` with new copy; both call sites pass anchors; methodology + README lines.
  - **Files:** `src/core/readiness/rankTrend.ts` (new), `constants.ts`, `score.ts`, `performance.ts` (ctx type), `index.ts`, `src/core/dashboardData.ts`, `src/main/index.ts`, `renderer/src/views/readiness.ts`, docs, tests.
  - **Check:** no rank data ⇒ nudge+penalty silent; evidenced climbing ⇒ silent; evidenced stagnation ⇒ signal (new copy) + capped freqPen; unlogged-srDelta window reads `unknown`, never `stagnant`; per-day gate on trend days; typecheck clean across ctx change.
  - **Size:** L

- [x] **T13 — Catalog + docs re-pins for the revision**
  - **Goal:** Re-pin affected scenario rows (`deaths-improve-damage-fall` → scared-play decline; weekend scenarios → 75 silent); add two new rows (scared-play; weekend + proven stagnation → hint); refresh `.scenarios.md` tables; full suite green.
  - **Files:** `test/readinessScenarios.test.ts`, `specs/readiness-data-regimes.scenarios.md`, affected `readiness*.test.ts`.
  - **Check:** `npm test` green; catalog tables match engine output; scenario count ≥ 28.
  - **Size:** M

---

## Consistency check (every spec AC → task)

**Regime dial & blending:** zero-qualifying⇒b=0/manual → T2/T3; high-coverage⇒b=1 bit-identical → T2/T3/T4/T9 (golden snapshot); one-game bounded epsilon (both directions) → T2/T9; mixed-history trend per-day blend → T2/T9. ✓
**GEP-outage resilience:** smooth down/up, label passes through hybrid, no adverse from missing stats → T2/T4/T9 (outage trace, incl. non-uniform volume). ✓
**Manual dynamic range:** real fixture ⇒ loaded → T4; +winrate/+tilt ⇒ red reachable → T5/T6; one-family grind ≤ loaded → T4; moderate rested play stays green → T4/T9 (green + hobbyist + newcomer pins). ✓
**Promoted results arm:** manual dip may exceed −15/sets objectiveAdverse → T5; b=1 unchanged → T5; sub-gate inert → T5. ✓
**Metric direction & passivity (owner amendment, revised 2026-07-08):** deaths lower=favorable-while-output-holds + scared-play fires decline + graduated boundary → T9 (original pin) / T11. ✓
**Rank-gated undertraining nudge (revision 2026-07-08):** all four ACs (no-data silent / climbing silent / stagnation fires with copy+penalty / per-day gate) → T12; catalog rows → T13. ✓
**Subjective & grades:** max adverse bounded −25, no solo red → T6; b=1 keeps −15 → T6; all-`missed` grades add no penalty → T6/T9. ✓
**Confidence:** b=0 ≤ medium whatever mental coverage → T7. ✓
**Contract & screen:** regime present & typed on all producers → T3; badge + methodology per regime, guard → T8; degenerate inputs never throw → T3/T9. ✓
**DoD:** `npm test` green (every task), typecheck clean (every task), new pure logic unit-tested (T2/T4/T5/T6/T7/T9), README + methodology updated (T8/T10), no guardrail weakened (architecture §1: core stays pure, contract typed, CSP-safe renderer, GEP-only). ✓

**Gaps:** none — every AC maps to ≥1 task.
**Scope-creep (tasks tracing to no AC):** T1 (constants) and T3 plumbing are enablers for the AC-bearing tasks, not independent scope. T10 docs is a DoD requirement. None dropped.

**Owner-flagged decision (non-blocking, defaulted conservative):** tilt-*alone* red needs acuteTilt ≈0.45 (marginally above the 0.40 elevated bar) because baseTilt drifts up with acute tilt — plan §8 risk #2. Fixtures use 0.45. Revisit if the owner wants moderate tilt (~0.4) to redden on its own.
