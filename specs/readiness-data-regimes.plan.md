# Technical plan: Readiness data regimes (`readiness-data-regimes`)

**Spec:** `specs/readiness-data-regimes.spec.md` (approved 2026-07-07).
**Method:** Derived from a 21-agent adversarial workflow — 3 codebase-research agents, 11 design proposals (statistician / sports-scientist / engineer lenses across 4 workstreams), 4 judge merges, and 3 red-team verification passes (false-alarm, exploit-gaming, continuity-whiplash — all returned *needs-fixes*). This plan is the reconciliation: where the judges disagreed, the red-team findings are the tiebreaker. Every reconciliation is called out in **§2**.

---

## 1. Architecture & Approach

**One engine, weights that follow the data — not two engines.** The composite stays `score = clamp(round(baseScore + loadDelta + perfDelta + subjDelta), 0, 100)`. A single scalar **blend `b ∈ [0,1]`** — the share of the acute window whose *outcomes* the objective (GEP) family can actually measure — continuously reweights three families toward whichever evidence exists:

- `b = 1` (full per-10 coverage): **every** new term is exactly zero and every cap is its shipped value ⇒ the engine reproduces today's output **bit-for-bit** (regression AC).
- `b = 0` (manual-only, today's universal reality): the dormant per-10 weight is redistributed to a **norm-free absolute training-load arm**, a **promoted results-vs-baseline ceiling**, and a **widened subjective cap**.
- In between (`hybrid`): linear `(1−b)` interpolation — no cliff when Overwolf approval lands, and a GEP patch-day outage eases the score toward manual and back symmetrically.

**Invariants preserved by construction (zero-diff to the gate code):**
1. **b threads only into continuous magnitudes**, never into a discrete gate. `bandForState` and `heavy` ship with a **zero-line diff**, so "b=1 bit-identical", "de-escalation unchanged", and "red needs two adverse families everywhere" hold via untouched code. A blend shift can shrink/grow penalties smoothly but can never flip a gate.
2. **Load alone never reaches red, in any regime.** The absolute arm feeds only the score delta and the `overload` driver tag — never `objectiveAdverse`, `fatigued`, `sustainedLoad`, `highLoad`, `heavy`, or `marathonSession`. Red still requires `score ≤ redCut` **AND** load corroboration **AND** an independent adverse family (`objectiveAdverse ∨ fatigued`). Verified arithmetically: max purely-absolute manual load = `absArmCap 24 + longSessionPen 8 = 32` ⇒ score 43 > redCut 40.
3. **Absence-of-stats neutrality.** Missing per-10 data only lowers `b` (via a lower coverage numerator) ⇒ moves the score only through `(1−b)`-scaled arms, which each need real load/tilt/dip evidence to be non-zero. During an outage `declineFired` gets strictly *harder* to fire (`countedGames < evidenceMinGames`) — missing stats can only raise the score, never lower it.

**Where b is computed (single source of truth):** inside `perfState` (`performance.ts`), right after the acute per-10 loop, from data that loop already produces — no extra pass, still O(n). It threads out on `PerfState.blend` to `loadParts`, `subjState`, `confidenceFor`, and the regime label. `computeStateAt` already runs `perfState` (line 124) before `subjState` (125) and `loadParts` (131), so no reordering.

---

## 2. Reconciliation decisions (red-team-driven — the heart of this plan)

The four judges converged on the architecture but diverged on constants and on `b`'s numerator. The red team broke the ties:

**R1 — `b` numerator is *continuous trust-weight*, not binary `countedGames`.** *(continuity red-team #1, HIGH.)*
The blend-dial judge derived `b` from `countedGames`, and proved `|Δb| ≤ 0.1` per *added acute game*. But `countedGames` is incremented binary and gated by the per-hero baseline `trustFor(base.n) > 0` (i.e. `n ≥ 16`) — a step function applied to a hero's **whole acute cohort**. As days pass and one baseline game ages in (`n: 15→16`), *all* of that hero's acute games flip counted at once ⇒ `b` jumps 0→0.7 and the score ~11–25 pts **in a single day**, flapping band and badge. The proof was continuity-in-`b`, not continuity-in-time.
**Fix:** the numerator becomes `blendCoverage = Σ trustFor(base.n)` over the *same* acute games the CUSUM already visits (accumulated in the existing loop). `trustFor` already ramps 0→1 over `base.n` 15→20, so a hero crossing the trust floor contributes `~0.2` per game (not `1`), and keeps ramping — the per-day step shrinks ~5× and is smooth. At full coverage every `trust = 1` ⇒ `blendCoverage = countedGames` ⇒ `b` identical at saturation ⇒ **b=1 bit-identity preserved**. An onboarding-ramp fixture (a single-hero history whose baseline crosses n=15→16) pins bounded day-over-day movement — the current fixtures never exercise this ramp.

**R2 — absolute-load streak/scarcity sub-arms are VOLUME-GATED.** *(false-alarm red-team #1, HIGH.)*
An ungated streak arm flags a 4-games/day-*every*-day hobbyist (same volume as the must-stay-green fixture, only difference = no rest days) at amber 59 — a regression from today's green 75, firing on pure *consistency*. **Fix (gates-and-hybrid):** the streak sub-arm fires only when `acutePerDay ≥ absElevatedPerDay(6)`. A calm daily player stays green; the real 12.33-games/day fixture is unaffected. Verified: gated → 70 green; ungated → 58 false-amber.

**R3 — absolute-arm trust gets a TENURE ramp, not just an active-day ramp.** *(false-alarm red-team #2, HIGH.)*
`absTrust` on active-days-only saturates for a daily newcomer around day 14–17 (their active-days == calendar-days), so both thin-history guards (the `minSpanDays 14` gate and the active-day ramp) saturate together and a 6/day honeymoon newcomer is flagged "ease up" in week 3. Because `chronicActiveDays` caps at `chronicDays 21`, no active-day ramp can require >3 weeks of tenure. **Fix:** multiply `absTrust` by a second ramp on **uncapped history span** (`historySpanDays`), reaching full weight only ~5 weeks in. The 111-day real fixture is unaffected (factor 1); the day-17 newcomer drops from absArm 16 → ~2.3 ⇒ green 73. A backlog-import (111-day span imported on day 1) correctly reads full tenure.

**R4 — winrate promotion is CAP-ONLY; slope stays 100.** *(false-alarm red-team #3, MEDIUM; also gates-and-hybrid + blend-dial.)*
The manual-constants judge added a slope-150 extra term. At the manual sample floor a 0.12 dip is <2σ noise, and slope-150 makes it worth ~10.5 pts — enough to redden a genuinely-fine grinder. **Fix:** promote only the *cap* (`wrPenaltyCap 15 → 30` via `(1−b)`), keep `wrPenaltySlope 100` and `wrDipMin 0.1` regime-invariant. For realistic dips ≤0.20 the penalty is *identical* across regimes; the cap only bites at deep, unambiguous dips. Red on the motivating fixture comes from the absolute arm already sitting the score at ~41, so only ~1–5 pts of second-family are needed — the slope promotion isn't required and would only add noise.

**R5 — ONE regime-cut set, ONE confidence-cap site.** *(continuity red-team #2, MEDIUM.)*
Two judges shipped contradictory cuts (0.8/0.4 vs 0.85/0.15) and two different confidence-cap conditions. **Fix:** a single pair `regimeManualMax = 0.4`, `regimeStatsMin = 0.8` (0.4 ties to the existing `statCoverageLow/blendCoverageTarget` landmark where the engine already refuses stats-confidence; 0.8 keeps the badge off the b=1 knife-edge). Confidence caps at one site in `confidenceFor`, keyed on the discrete `regimeFor(b) === 'manual'` label — the same function the badge uses, so badge and cap can never disagree.

**Accepted-as-is (documented, not fixed here):**
- **wrPenalty 0→5 discontinuity at `wrDipMin`** (exploit #5): pre-existing shipped behavior; making it continuous would change the `(wrDip−0.05)·100` formula and **break b=1 bit-identity**. Out of scope; noted as a manual-data limitation.
- **Target-grade dampener over the promoted winrate arm** (exploit #2): because R4 makes manual wrPenalty ≈ stats wrPenalty for dips ≤0.20, the dampener's effect is no worse than the shipped engine's; deep dips (>0.20) still leave ≥15 pts after halving — ample for red. Kept as-is.
- **Multi-account winrate dilution** (exploit #3) and **manual+GEP double-logging** (exploit #4): the absolute-load arm (computed across all accounts) still fires; only the winrate red-corroborator dilutes. Follow-ups, not core — see §8.

---

## 3. Affected files / modules

**Core engine (`src/core/readiness/`, pure):**
- **`regime.ts` (NEW)** — `blendFor(blendCoverage, acuteGameCount)` and `regimeFor(b)`. Pure, imports only constants/types.
- **`performance.ts`** — accumulate `blendCoverage += trustFor(base.n)` in the existing acute loop; compute `blend = blendFor(...)`; expose `PerfState.blend`, `PerfState.blendCoverage`. Winrate cap becomes `min(wrPenaltyCap + wrManualCapBoost*(1−blend), (wrDip−0.05)*wrPenaltySlope)`. `EMPTY_PERF.blend = 0`. Everything else (CUSUM, deaths sign-flip line 146, dampener, `objectiveAdverse`) byte-identical.
- **`signals.ts`** — `LoadState` gains `historySpanDays: number` (uncapped `refOrdinal − dayOrdinal(games[0].timestamp) + 1`), for the tenure ramp. No other change.
- **`score.ts`** — `loadParts` gains a `blend` param and the absolute-load arm (below), added *inside* the existing `overloadPen` min-sum. `StateAt` gains `blend: number` and `regime: ReadinessRegime`, set in `computeStateAt` right after `perfState`. `EMPTY_STATE` gets `blend: 0, regime: 'manual'`. `bandForState` / `heavy` / `greenSplit` **unchanged**. `loadParts` is exported (like `restEffectFor`) for the bit-identity test.
- **`subjective.ts`** — `subjState` gains a `blend` param; the two component caps and the lower clamp lerp via `manualLerp`. Slopes/gates unchanged.
- **`constants.ts`** — `manualLerp` helper + new `--- absolute-load arm ---`, winrate-manual, subjective-manual, and `--- regime dial ---` constant blocks (§5).
- **`index.ts`** — `computeReadiness` sets `regime: state.regime`; `toSubscores` sets `load.coverage = round2(state.blend)`; `confidenceFor` gains the one-line manual cap; `insufficientSummary`/`staleSummary` set `regime: 'manual'`; barrel re-exports `ReadinessRegime`.
- **`types.ts`** — `ReadinessRegime` union + `ReadinessSummary.regime` (after `driver`); widen `ReadinessSubscore.coverage` doc.

**Contract:** `src/shared/contract/index.ts` — add `ReadinessRegime` to the readiness re-export. `dashboard.ts` carries `ReadinessSummary` wholesale (no change). `tsc --noEmit` enumerates every required-field miss across the 3 producers.

**Renderer:**
- `renderer/src/components/primitives/labels.ts` — `badge()` kind union gains `'hybrid'` + optional `title` (backward-compatible; all existing 2-arg calls compile).
- `renderer/styles/components.css` — one `.badge--hybrid` rule (reuses the sanctioned amber literal from `.chip--stale.is-on`; no new token).
- `renderer/src/views/readiness.ts` — `REGIME_META` table; badge in `verdictCard`'s `actions` slot guarded by `showRegime = band !== 'insufficient-data' && band !== 'rusty'`; capped-confidence hint clause; `loadNote(r)` on the Load subscore tile; two new methodology sections + a confidence-levels sentence.

**Docs:** `README.md` (readiness bullet + `core/readiness/` bullet); superseded-decision note atop `specs/readiness-score-rework.spec.md` §objective-performance.

**Tests:** `test/readinessRegime.test.ts` (NEW) + extensions to existing `readiness*.test.ts`; builders in `test/readinessFixtures.ts`.

---

## 4. Data model / interfaces

```ts
// types.ts
export type ReadinessRegime = 'stats' | 'hybrid' | 'manual';
// ReadinessSummary gains:  regime: ReadinessRegime;   // after `driver`
// ReadinessSubscore.coverage doc widened: for load it now carries b.

// regime.ts
export function blendFor(blendCoverage: number, acuteGameCount: number): number {
  return Math.min(1, blendCoverage / Math.max(T.blendMinCounted, T.blendCoverageTarget * acuteGameCount));
}
export function regimeFor(b: number): ReadinessRegime {
  if (b >= T.regimeStatsMin) return 'stats';
  if (b <= T.regimeManualMax) return 'manual';
  return 'hybrid';
}

// constants.ts
export const manualLerp = (stats: number, manual: number, b: number): number => b * stats + (1 - b) * manual;
```

Absolute-load arm inside `loadParts` (after `longPen`, before the `overloadPen` line):

```ts
const absTrust =
  clamp((load.chronicActiveDays - T.minChronicActiveDays) / T.absTrustRampDays, 0, 1) *
  clamp((load.historySpanDays - T.minSpanDays) / T.absTenureRampDays, 0, 1);          // R3 tenure ramp
const restlessPen = load.acutePerDay >= T.absElevatedPerDay                            // R2 volume gate
  ? Math.min(T.absStreakPenCap, Math.max(0, load.consecutiveDays - T.absStreakFreeDays) * T.absStreakSlope) : 0;
const absVolPen   = Math.min(T.absVolPenCap,   Math.max(0, load.acutePerDay - T.absElevatedPerDay) * T.absVolSlope);
const scarcityPen = Math.min(T.restScarcityPenCap, Math.max(0, load.activeDaysPerWeek - T.restScarcityFreePerWeek) * T.restScarcitySlope);
const absRaw = Math.min(T.absArmCap, restlessPen + absVolPen + scarcityPen);
const absArm = blend >= 1 ? 0 : (1 - blend) * absTrust * absRaw;                        // exact-zero at b=1
const overloadPen = Math.min(T.overloadPenCap, ratioPen + volPen + streakPen + longPen + absArm) * trust * fade;
```
**Critical:** `surging = ratioPen > 0 || volPen > 0` stays verbatim — `absArm` must **not** set `surging`, or the own-norm streak arm double-counts at `b<1` (pinned by a test asserting `streakPen === 0` on the real fixture). Long sessions stay out of the arm — `longSessionPen` already prices them regime-free.

---

## 5. Final reconciled constants (`READINESS_TUNING`, each with a rationale line)

| Constant | Value | Rationale |
|---|---|---|
| `absStreakFreeDays` | 6 | A full week of daily play is free; streak penalty accrues only beyond it. Volume-gated (R2). |
| `absStreakSlope` | 1 | 1 pt/rest-less-day past the free week — slow, sustained-evidence accrual (one day = bounded epsilon). |
| `absStreakPenCap` | 12 | Restlessness saturates ~18 straight days (mirrors `streakPenCap`). |
| `absVolSlope` | 1 | 1 pt/game-day above `absElevatedPerDay(6)` — a third of the own-norm slope (norm-free volume is weaker evidence). |
| `absVolPenCap` | 10 | Volume alone stays a sub-amber nudge even at 16+/day; days-without-rest carries the arm, not raw volume. |
| `restScarcityFreePerWeek` | 5.5 | Continuous ramp start; 5 active days/week (a rest-punctuated cadence) reads exactly 0. |
| `restScarcitySlope` | 4 | Steep because the range is narrow (5.5→7.0 spans the whole risk band). |
| `restScarcityPenCap` | 5 | Corroborates the streak arm, never alarms alone; the 5-vs-4 choice buys the tilt-variant red margin under baseTilt drift. |
| `absArmCap` | 24 | Cap on the whole `(1−b)·absTrust`-scaled arm; lands the real grind at amber 41 and a second family at threshold reaches red. Excludes long sessions. |
| `absTrustRampDays` | 7 | Active-day ramp: 0 at 7 chronic active days, full at 14 — norm-free claims need a populated window. |
| `absTenureRampDays` | 21 | History-span ramp (R3): full arm weight only ~5 weeks (`minSpanDays 14` + 21) after first game — a daily newcomer isn't flagged in week 3. |
| `wrManualCapBoost` | 15 | Winrate cap 15→30 via `(1−b)`; **slope 100 and `wrDipMin 0.1` unchanged** (R4) so `objectiveAdverse` never flips with b and noise never reddens. |
| `tiltPenCapManual` | 16 | Manual endpoint of `tiltPenCap`(10); exactly the slope-8 theoretical max (bound, not new sensitivity). Slopes stay regime-invariant. |
| `sliderPenCapManual` | 12 | Manual endpoint of `sliderPenCap`(8); same 1.5× widening; slider slope/threshold/gates unchanged. |
| `subjDeltaMinManual` | −25 | Manual subjective floor (−15 at b=1); 16+12=28 over-provisions it so it isn't dead code; positive side (+8) unchanged. |
| `blendMinCounted` | 10 | Blend-denominator floor: caps per-game step at 1/10 and is the MAX safe floor — `statCoverageHigh 0.5 × wrMinDecidedAcute 20 = 10` guarantees b=1 at today's high-confidence bars. |
| `blendCoverageTarget` | 0.5 | Coverage at/above which b saturates to 1 (mirrors `statCoverageHigh` as an independent knob); headroom absorbs manual bursts + ~3.5 outage days at b=1. |
| `regimeManualMax` | 0.4 | b ≤ this ⇒ 'manual' badge AND confidence cap (R5, one constant feeds both). ≈ `statCoverageLow/blendCoverageTarget`. |
| `regimeStatsMin` | 0.8 | b ≥ this ⇒ 'stats'; below 1.0 so one stray non-qualifying game (step ≤0.1) can't flap the badge. |

---

## 6. Fixture math (pinned outcomes, re-derived under the reconciled set; all b=0, played today)

- **Real-data fixture** (chronicPerDay 19.32, acutePerDay 12.33, consecutiveDays 21, adw 7.0, spanDays 111, longSession, wrDip 0.02, tilt 0.28): absTrust 1; restlessPen 12; absVolPen 6.33; scarcityPen 5; absRaw 23.33; overloadPen `min(40, 8+23.33)=31.33`; loadDelta −31.33; perfDelta 0; subjDelta −2.64 ⇒ **score 41 → `loaded` (amber)**, driver `overload`, confidence `medium`, regime `manual`. Red blocked: 41>40 and one adverse family. ✓ (was 64/`steady`.)
- **Red variant** (+ wrDip 0.10, adequate samples): wrPenalty 5, `objectiveAdverse` true, subj agree-gated −0.79 ⇒ undamped **38 → `in-the-hole`**; damped (0.5) **40 → `in-the-hole`** (knife-edge, pinned exactly). Gate: `sustainedLoad`(21≥5 ∧ 12.33≥9) ∧ `objectiveAdverse` ∧ chronic 21≥7. ✓
- **Tilt variant** (acuteTilt 0.45, baseTilt drifts to ~0.30): `fatigued` true; tiltPen 4.8 ⇒ **39 → `in-the-hole`** across the drift range. ✓ *(Note: tilt-alone red needs ~0.45+, marginally above the 0.40 elevated bar — see §8 open risk; fixtures use 0.45.)*
- **Green fixture** (4/day, Mon–Fri, weekends off): arms all 0 (gate 4<6; adw 5.0<5.5) ⇒ **~73 → green**, ~12 pt margin. ✓
- **Hobbyist** (4/day *every* day — R2 target): streak gated off (4<6), only scarcityPen 5 ⇒ **~70 green**. ✓ *(ungated → 58 false-amber.)*
- **Newcomer honeymoon** (6/day every day, day 17 — R3 target): tenure factor 0.14 ⇒ absArm ~2.3 ⇒ **~73 green**. ✓ *(no tenure ramp → 59 false-amber.)*
- **b=1 identity** (stats-rich profile): absArm `(1≥1?0)`; wrCap `15+15·0=15`; subj floor −15 ⇒ **score 64 / `steady`**, bit-identical. ✓
- **3-day GEP outage** (stats-rich, manual logging continues): window coverage floor 4/7 > 0.5 ⇒ **b stays 1, score moves 0**; extended outage D4–D7 steps down ≤5 pts/day to 60/`loaded` (never red — `objectiveAdverse`/`fatigued` false throughout); recovery symmetric to b=1/75. ✓

---

## 7. Test strategy (maps every spec AC)

New `test/readinessRegime.test.ts` + extensions, using `test/readinessFixtures.ts` builders and injectable `now`:

- **Regime dial & blending:** `blendFor` unit table (0-coverage⇒0; saturation at 0.5/10; monotone; per-game step ≤0.1 sweep); `regimeFor` cuts; zero-qualifying⇒b=0/`manual`; **b=1 deep-equality golden snapshot** of the whole `ReadinessSummary` on a stats-rich fixture (guards against expression-restructuring, not just score); one-game epsilon pin (`|Δscore| ≤ 5`); monotonicity-in-b sweep; mixed-history trend scores each day under its own b.
- **R1 onboarding-ramp fixture (new):** single-hero history whose baseline crosses n=15→16 across a day — assert bounded `|Δscore|` and `|Δb|` day-over-day (the cliff the current fixtures never hit).
- **GEP-outage resilience:** 7-day outage day-by-day trace (bounded steps down and back; `declineFired` never fires from coverage loss; families that remain keep operating); **non-uniform-volume** outage variant (rest days inside the gap — the continuity-#3 denominator wobble).
- **Manual dynamic range:** real-data fixture ⇒ `loaded`/`manual`/`medium`/driver `overload`; +wrDip and +tilt variants ⇒ red reachable (exact-score pins 38/40/39); green fixture ⇒ green; **hobbyist 4/day-every-day ⇒ green (R2 pin)**; **day-17 newcomer ⇒ green (R3 pin)**; one-adverse-family grind ⇒ at most `loaded`.
- **Promoted results arm:** manual deep dip may exceed −15 up to −30 and sets `objectiveAdverse`; identical dip at b=1 behaves as today; sub-gate samples inert in every regime.
- **Metric direction (owner amendment):** deaths/10 *below* baseline ⇒ favorable, no decline; above ⇒ adverse. Pins the `aligned = deaths ? −z : z` flip.
- **Subjective & grades:** max adverse subj at b=0 bounded by −25, no red without a 2nd family; b=1 keeps −15; all-`missed` grades add no penalty.
- **Confidence/contract/screen:** b=0 ⇒ ≤`medium` whatever mental coverage; `regime` present & typed on all 3 producers; `showRegime` band-guard; degenerate inputs never throw.
- **Regression audit:** every existing `readiness*.test.ts` fixture that lands at `0 < b < 1` (e.g. exactly `evidenceMinGames=8` counted) re-derived by hand and either densified to counted ≥10 (stats intent) or deliberately re-pinned (cross-release continuity not promised).
- **`streakPen === 0` on the real fixture** (proves `surging` untouched by `absArm`).

---

## 8. Risks & alternatives

**Rejected alternatives:** two-mode hard switch (score cliff at flip; rejected in spec); winrate slope-150 additive extra (R4 — reddens on noise); `b` from binary `countedGames` (R1 — day-index cliff); ungated streak arm (R2 — hobbyist false-amber); shaped/`(1−b)²` fade and residual-at-b=1 floor (curvature is an evidence-free knob; residual breaks bit-identity or double-counts); a manual-specific/`b`-dependent red-gate predicate (fresh false-alarm surface + gate flips discontinuously on one game — `sustainedLoad`'s absolute branch already fires on the fixture); winrate-adequacy as a `b` input (breaks the b=0 AC on the 1,538-manual-game fixture, violates absence-neutrality).

**Open risks (carried forward):**
1. **Knife-edge red variants** land at pre-round 40.4–40.5. Every red fixture is an exact-score assertion; any future retune of `absArmCap`, `dampFactor`, `subjAgreeFactor`, or `tiltPenSlope` must re-run §6.
2. **Tilt-alone red needs ~0.45**, marginally above the 0.40 elevated bar (baseTilt drifts up as acute tilt rises, since the base window contains the acute window). Spec AC ("at/above the elevated bar ⇒ reachable") is satisfied but tight — fixtures use 0.45. *A genuine product call the owner may want to revisit* (widening the manual tilt slope would lower it, at the cost of taxing everyday tilt — deliberately not done). **Flagged, defaulted conservative.**
3. **Label/arm coherence at b∈[0.8,1):** the `(1−b)` arm carries ≤20% residual (≤~4.8 pts) while the badge reads `stats`; the hybrid `loadNote` shows the real coverage %. Accepted (pure-linear fade is the most defensible; early-zero fade is the alternative if this reads wrong in QA).
4. **Denominator wobble** (continuity-#3): `b`'s denominator moves with acute volume, so a rest day can nudge `b` a few points/one badge step in hybrid. Bounded and cosmetic; pinned by the non-uniform-volume outage fixture; wide hybrid band (0.4–0.8) limits label flap.
5. **Manual data is user-editable** — winrate discontinuity at `wrDipMin`, streak-reset via deletion, multi-account winrate dilution, target-grade farming (exploit red-team #2–#6). Consistent with the spec's "wellness nudge, not tamper-proof, confidence capped at medium." Absolute-load arm (all-account) still fires. **Follow-ups (non-blocking):** cross-source dedup (prefer `gep`) when Overwolf lands (protects b=1 from manual+GEP double-logging), and a "results diluted across accounts" signal.
6. **Existing manual-fixture test pins shift** when the arm lands — a re-baseline audit is its own task; the green case survives *only* because of the R2 volume gate.
7. **Demo dataset reads `manual`** (empirically: uniform hero picks never clear `heroLearnGames`/`statMinGames`) — the `stats`/`hybrid` badge paths aren't exercised by eye; covered by unit fixtures, with an optional generator "pocket heroes" follow-up.
