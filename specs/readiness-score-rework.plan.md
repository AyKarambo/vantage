# Techplan: Readiness score rework — objective performance signals (`readiness-score-rework`)

**Spec:** `specs/readiness-score-rework.spec.md` (approved 2026-07-07). **Research:** `specs/readiness-score-rework.research.md`.
**Status:** ready for review. Grounded in a 5-area parallel codebase survey (readiness core, dataflow/targets, contract/IPC, renderer surfaces, analytics/accounts/sample-data) with verbatim file:line verification of every integration claim.

This plan **resolves all six of the spec's Open Questions** (§6) with concrete, centrally-tunable defaults, and specifies the algorithm, module layout, and exact file-by-file changes.

---

## 1. Architecture & Approach

- **One composite engine replaces two.** `scoreFromState()` + the independent `bandForState()` rule tree (`src/core/readiness/score.ts:64-129`) are rewritten: three signed subscore **deltas** are summed onto a neutral anchor, and the band becomes a pure function of `(score, driver, hard gates)`. The trend, gates, day/session model, and settings plumbing are kept.
- **Deltas, not weights-as-fractions.** Each subscore contributes a bounded signed delta from a neutral anchor of **75**: `score = clamp(round(75 + loadDelta + perfDelta + subjDelta), 0, 100)`. The bounds *are* the weights: `|perfDelta| ≤ 45`, `loadDelta ∈ [−40, +25]`, `|subjDelta| ≤ 15` — matching the spec's ~40/45/≤15 split while staying in the codebase's existing penalty-arithmetic idiom (transparent, unit-testable, renders directly as the UI's "pull per family").
- **Signature change (spec Resolved-Q8):** `computeReadiness(input, now = Date.now(), ctx: ReadinessContext = EMPTY_CONTEXT)` — target context as a **third** positional parameter with a default, so the ~40 existing two-arg test calls keep compiling (survey: `test/readiness.test.ts` always passes `now` positionally). `safeReadiness` mirrors it. `ReadinessContext = { targets: AuthoredTarget[] }` (raw authored targets; filtering happens inside the pure core).
- **Call sites (all three verified):**
  - `src/core/dashboardData.ts:113` → `safeReadiness(all, Date.now(), { targets: manual?.targets ?? [] })` — `manual?.targets` is already in scope in the same function (line 105 uses it for `buildTargets`).
  - `src/main/index.ts:441` (launch toast) → pass `{ targets: manual.targets() }` — `ManualStore` is constructed at line 131 and already used at line 240. **Included fix for a pre-existing drift found by the survey:** this site passes `history.all()` *raw*, unfiltered by `isCompetitive`, unlike the dashboard path (`dashboardData.ts:51`) — the toast verdict can disagree with the dashboard verdict today. Since the line is touched anyway, filter through `isCompetitive` here to honor the spec's "competitive-only input feed stays" constraint consistently.
  - `renderer/preview/preview.ts:264` already threads `targets` inside its `ManualData` 4th argument — no structural change (the ctx is built inside `computeDashboard`).
- **Dampener context per trend day:** `buildTrend`/`scoreAt` thread `ctx` through; for trend day *d*, targets are filtered to `createdAt ≤ endOfDay(d)` and grade evidence comes only from games on/before *d* (grades ride on `GameRecord.review.grades`, so this is mostly automatic) — implements the spec's "dampener never applies to trend days before the target's grades exist" caveat. `isActive` is current-state (historical activity is unknowable) — accepted approximation, noted in the methodology copy.
- **Where the dampener computes:** inside the new `performance.ts` subscore (it needs the mental `fatigued` flag and the perf penalty), orchestrated from `computeStateAt` — the survey confirmed the codebase idiom is post-hoc composition in the orchestrator rather than threading context through every signal function; only `computeStateAt` gains the `ctx` parameter, `loadState`/`mentalState` keep their signatures.
- **Contract growth follows the `eaea4f0` precedent** (survey: the rusty-band commit): widen types in `src/core/readiness/types.ts`; the only contract-file edit is adding the genuinely-new type names (`ReadinessSubscores`, `ReadinessDriver`) to the re-export list at `src/shared/contract/index.ts:22-25`. `DashboardData` gains one new field (`performanceStats`) for the issue-#44 analytics.
- **Issue #44 part 1 is a separate pure module** (`src/core/analytics/performanceStats.ts`) computed from the **filtered** games (analytics respect the filter bar; the readiness verdict stays on unfiltered `all`) and carried on `DashboardData` — avoids invasive changes to `HeroSummary`/`Group`; the Heroes/Maps views join by key.

---

## 2. The algorithm (concrete — resolves Open Questions 1–4, 6)

All constants land in `READINESS_TUNING` with one-line rationales (values below are the proposed defaults; every one is a named constant, no magic numbers). Existing kept mechanisms are cited by file:line.

### 2.0 Kept verbatim
Input cleaning + `insufficient-data`/stale gates (`index.ts:239-263`); `day.ts` (04:00 local reset) and `sessions.ts` (gap-based sessions) entirely; `loadState`'s EWMA machinery + `ratioTrusted` (`signals.ts:59-115`); `mentalState` incl. the elevated-tilt bar (`signals.ts:126-154`); `greenSplit` (`score.ts:109-112`); `recovering→fresh` shape (`score.ts:127`); test fixture idioms (`ts`/`game`/`span`/`TILT`/`CALM`, explicit `now`).

### 2.1 Load-balance subscore → `loadDelta ∈ [−40, +25]`

```
trust        = min(1, chronicActiveDays / minChronicActiveDays(7))     // NEW: continuous, no cliff
habitBar     = max(absElevatedPerDay(6), habitFactor(1.25) × chronicPerDay)   // NEW: own-norm-relative volume bar
volPen       = min(22, max(0, acutePerDay − habitBar) × 3)             // fires only ABOVE the player's own habit
surging      = ratioPen > 0 || volPen > 0
streakPen    = surging ? min(12, max(0, consecutiveDays − sustainedDays(5)) × 3) : 0   // streak alone at normal volume = habit, not risk
overloadPen  = min(40, ratioPen(≤22) + volPen + streakPen + longPen(8)) × trust
fade         = max(0, 1 − restDays / (restFullRecoverDays(2) + 1))     // kept (score.ts:89)
restEffect   = supercompensation curve, kept shape (score.ts:101-106): +12/rest-day to a +25 peak
               (restRecoveryCap) at day 3, −12/day (rustDecayPerDay) past day 5, floored at −35 (rustPenaltyCap, retuned from 45)
freqPen      = activeDaysPerWeek < lowFrequencyDaysPerWeek(3) ? min(5, (3 − rate) × 3) : 0
loadDelta    = clamp(restEffect − fade × overloadPen − freqPen, −40, +25)   // explicit final clamp (critique: −42 reachable at chronicActiveDays=7 without it)
```
- `ratioPen`/`longPen` keep their existing piecewise shapes (`score.ts:67,70`); **`volPen` and `streakPen` are redesigned to be own-norm-relative** (critique must-fix): the old absolute shapes made a stable 9–10-games/day habitual grinder read `overloadPen ≈ 24` → score ≈ 51 → amber, failing the spec's habitual-volume AC. Now: ratio ≈ 1 and volume at one's own chronic norm ⇒ `ratioPen = volPen = 0` ⇒ `streakPen` gated off ⇒ `loadDelta ≈ 0` ⇒ green ✓; only volume *surges above the player's own baseline* (or a genuine ratio spike) accrue load penalty. The **absolute** arms survive where they belong — inside `sustainedLoad` (red corroboration, §2.5) — so a flat high-volume grinder with a genuine performance collapse still reaches red via `perfDelta`.
- **Whiplash guard (spec AC):** the `× trust` factor multiplies all overload arms — a layoff-then-catch-up binge has a thin chronic window and cannot read as overload until the baseline re-fills. Extends the existing `ratioTrusted` rule (`signals.ts:84-85`) continuously.

### 2.2 Objective-performance subscore → `perfDelta ∈ [−45, +8]`

**Buckets (per-account, spec Resolved-Q3):** stat bucket key = `account + '|' + hero` (single-hero games only); fallback key = `account + '|role|' + role`. Winrate buckets are per-account.

**Qualifying game (per-10 component):** competitive ∧ single-hero (`heroes.length === 1` and one `perHero` row — the survey confirmed `matchToGame` back-fills a single-entry `perHero` from match totals, `gameRecord.ts:20-28`) ∧ `perHero` present ∧ `durationMinutes ≥ minPer10Minutes(6)`.

**Learning exemption (Open-Q resolved):** hero lifetime games (per account) `< heroLearnGames(12)` → the game is excluded from decline detection entirely and emits at most the neutral `still-learning` signal. Distinct from baseline trust below.

**Baseline (uncoupled):** per bucket, the trailing `baseWindowGames(40)` qualifying games **strictly before the acute window start** (acute = last `acuteMentalDays(7)` days) — mean and SD per metric. SD floor: `max(sd, sdFloorFrac(0.15) × mean, 1e-6)` so ultra-consistent stats can't produce z-blowups.

**Bucket trust — graduated, no cliff (Open-Q resolved):** `bucketTrust = clamp((n − statMinGames(15)) / statTrustRamp(5), 0, 1)` — zero influence below 15 baseline games, full at 20. Role fallback used when the hero bucket has `n < statMinGames` (but the hero is past the learning window).

**Mix-shift guard (Open-Q resolved):** role-fallback comparisons are only made when the acute window's within-role hero distribution overlaps the baseline's: `overlap = Σ_h min(shareAcute(h), shareBaseline(h)) ≥ mixOverlapMin(0.5)`. Below that, the role fallback is skipped for the window (component silently inert) — a hero-mix change can never read as decline.

**Per-game decline score:** for each qualifying acute game, per metric `m ∈ {elims10, deaths10, dmg10, heal10}`: `z_m = winsorize((x_m − mean_m)/sdFloor_m, ±zWinsor(2.5))`, sign-aligned (deaths negated). A metric is skipped (and the fixed weights — dmg `.30`, deaths `.30`, elims `.25`, heal `.15` — renormalize over active metrics) when its baseline mean is below the named per-metric floor `metricSkipMin` (dmg/heal `50` per-10, elims/deaths `0.5` per-10 — critique: "near-zero" was unnamed, violating the no-magic-numbers mandate). `g = (Σ w_m z_m) × bucketTrust`.

**Drift detector (Open-Q 1 resolved): one-sided CUSUM** — chosen over full two-sided CUSUM and over a plain sustained-z rule because it is the simplest mechanism that (a) accumulates slow drift, (b) is immune to single games by construction, and (c) satisfies the marathon-session AC within one day. Over acute-window qualifying games in time order:
```
C_i = max(0, C_{i−1} + (−g_i − cusumSlack(0.25)))
fires when C ≥ cusumThreshold(2.5)  AND  acuteQualifyingGames ≥ evidenceMinGames(8)
statPenalty = fired ? min(30, statPenaltyBase(10) + statPenaltySlope(4) × (C − 2.5)) : 0
```
Arithmetic proof against the ACs (**at full `bucketTrust = 1`, i.e. ≥ 20 baseline games — stated explicitly per critique**): one maximally-bad game contributes at most `2.5 − 0.25 = 2.25 < 2.5` → can never fire alone; a short bad session (3 games at z ≈ −1) reaches `2.25 < 2.5` → doesn't fire; a marathon session (10+ games at z ≈ −1) reaches `7.5 ≥ 2.5` → fires the same day ✓. At partial trust the per-game contribution scales down (`g × bucketTrust`) — e.g. at `bucketTrust = 0.2` a z ≈ −1 marathon accumulates nothing (`0.2 < slack`); the marathon guarantee formally holds from `bucketTrust ≥ ~0.5`, and §5 sweeps the 15→20 ramp to pin where it engages. `evidenceMinGames(8)` is an independent AND-gate: 4 games at winsorized z −2.5 reach `C = 9 ≥ 2.5` but do **not** fire (games < 8) — tested explicitly.

**Winrate component (per-account, then pooled):** per account with `acuteDecided ≥ wrMinDecidedAcute(20)` and `baselineDecided ≥ wrMinDecidedBase(30)` (baseline = chronic window excluding the acute days — uncoupled): `dip_a = baseWr_a − acuteWr_a`. Pooled `dip = Σ dip_a·n_a / Σ n_a` over qualifying accounts. `wrPenalty = dip ≥ wrDipMin(0.10) ? min(15, (dip − 0.05) × wrPenaltySlope(100)) : 0`. Accounts below the gates contribute nothing (AC: silently inert). **The 15-cap is the spec's "named outcome cap"** — a losing streak alone can move the score by at most 15 and never gates red.

**Positive side:** when `C = 0` and the acute mean `g̅ > perfBonusMinZ(0.5)`: `perfBonus = min(8, 8 × (g̅ − 0.5))`.

**Composite:** `perfDelta = perfBonus − dampen × (statPenalty + wrPenalty)`, `dampen = dampener-active ? dampFactor(0.5) : 1`. Availability flag = whether any component had usable data ("winrate never absorbs freed weight" holds structurally: the caps are separate, 30 + 15).

### 2.3 Subjective subscore → `subjDelta ∈ [−15, +8]` (disagreement-gated, Resolved-Q6)

```
tiltPen    = coverage ≥ mentalMinCoverage(0.4) && tiltKnown
             ? min(10, acuteTilt×8 + max(0, acuteTilt − baseTilt)×8) : 0
             // CONTINUOUS + coverage-gated only (critique: gating on `fatigued` was an all-or-nothing
             // cliff and made a stray below-bar tilt flag contribute exactly nothing, breaking the
             // stray-flag AC's "feeds the subjective subscore normally" clause. The elevated bar
             // (`fatigued`) is reserved solely for the dampener's void condition, §2.4.)
sliderBase = mean(performance) over ≥ sliderMinBase(10) rated games before the acute window
sliderDiff = sliderBase − acuteSliderMean            // needs ≥ sliderMinAcute(3) acute rated games
sliderPen  = sliderDiff ≥ sliderDipMin(10) ? min(8, (sliderDiff − 5) × 0.4) : 0
sliderBon  = sliderDiff ≤ −10 ? min(sliderBonCap(8), (−sliderDiff − 5) × 0.4) : 0   // cap raised 4→8 so the documented +8 bound is reachable (critique)
subjRaw    = clamp(−(tiltPen + sliderPen) + sliderBon, −15, +8)

objectiveAdverse = cusumFired || wrPenalty > 0
             // boolean, not a magnitude bar (critique: a freshly-fired decline with statPenalty in
             // [10,12) sat below the old objAdverseBar(12), double-counting the weakest fired declines)
subjDelta = subjRaw < 0 && objectiveAdverse ? subjAgreeFactor(0.3) × subjRaw       // agrees → mostly counted already
          : subjRaw > 0 && objectiveAdverse ? min(4, 0.5 × subjRaw)                // "feel great" counter-signal (cap 4 = reachable)
          : subjRaw                                                                 // disagreement → full (capped) weight
```
No mental logs and no slider usage ⇒ `subjRaw = 0` exactly (both components gated on their own coverage), availability false.

### 2.4 Target-focus dampener

- **Active targets:** `ctx.targets.filter(t => t.isActive && !t.archivedAt && t.id !== NOTION_IMPROVEMENT_TARGET_ID && t.createdAt ≤ refTime)` (Notion sentinel exclusion mirrors `scoring.ts:25`).
- **Evidence — per distinct game, not per grade entry (critique fix):** over acute-window games, a game's credit = the mean of its active-target grades (`hit=1, partial=0.5, missed=0`, mirroring the `gradeSpark` idiom, `scoring.ts:65-68` — the survey confirmed `authoredSummary`'s and `sessionRecap`'s hit-only counting are *not* reusable). Requires `≥ dampMinGraded(5)` **distinct graded games** and mean per-game credit `≥ dampHitRate(0.6)` — so N simultaneous targets graded on one game still count as *one* game of evidence; target count can never substitute for games of genuine practice.
- **Tilt void:** `mental.fatigued` (the existing elevated bar — spec Resolved-Q4).
- **Effect:** `dampFactor(0.5)` on the perf penalty only; fixed regardless of target count/grade volume (anti-farming AC); emits the `target-focus` signal.

### 2.5 Band derivation + driver (Open-Q 6 naming resolved)

```
driver: ReadinessDriver = 'overload' | 'rust' | 'neutral'
  'overload' when restDays === 0 && (fade×overloadPen) ≥ driverBar(8)
  'rust'     when restDays ≥ rustSignalDays(6)  (restEffect has turned negative)
  'neutral'  otherwise

band (after the unchanged insufficient/stale gates):
  restDays === 0:
    score ≤ redCut(40) && loadCorroborated && trust ≥ 1  → 'in-the-hole'
    score ≤ amberCut(60)                                 → 'loaded'
    else                                                 → greenSplit()   // fresh/steady, kept cosmetic
  restDays ≥ 1:
    restDays ≥ rustDays(7)                               → 'rusty'
    heavyAtLastActive                                    → restDays ≥ 2 ? 'fresh' : 'recovering'
    else                                                 → greenSplit()

loadCorroborated = sustainedLoad || marathonSession
marathonSession  = the session containing the reference day's games has
                   minutes ≥ sessionLongMinutes(150) && games ≥ marathonMinGames(10)
```
- `sustainedLoad` keeps its existing definition (`signals.ts:98-99`). **The `marathonSession` arm is a critique must-fix**: `consecutiveDays` counts calendar days, so a single-day marathon grind could never satisfy `sustainedLoad` — red was structurally unreachable for the spec's core marathon AC. A ≥2.5h, ≥10-game session on the reference day now also counts as load corroboration.
- **`trust ≥ 1` (chronicActiveDays ≥ 7) is a deliberate hard gate, not an overlooked cliff** (critique raised it): red is the model's highest-stakes claim and demands a fully populated chronic baseline; the *score* degrades continuously below full trust, but the red *label* does not fire off a thin window. Documented in the methodology copy.
- Monotonicity AC holds by construction: within a fixed `(restDays-branch, gates, driver)` context the band is a monotone step function of score.
- Equal-score/different-driver AC: grinding 55 → `loaded`/`overload`; 10-day layoff 55 → `rusty`/`rust` ✓.

### 2.6 Confidence rework

```
statCoverage    = qualifying acute games / acute games
maxAccountShare = largest single account's share of acute games
high   : chronicActiveDays ≥ 12  &&  statCoverage ≥ 0.5  &&  winrate sample gates met
         &&  maxAccountShare ≥ accountMixBar(0.7)          // mental NOT required
low    : statCoverage < 0.2  &&  mentalCoverage < mentalMinCoverage(0.4)  &&  no slider data
medium : otherwise
```
The `maxAccountShare` term is a critique fix: the spec's AC says a materially mixed acute window *lowers confidence*, not just surfaces a note — a heavily mixed window (< 70% on one account) now caps confidence at `medium` and emits the `mixed-accounts` signal.
Manual-only history ⇒ `statCoverage = 0` ⇒ never `high` (AC: "at most medium"); GEP-rich with zero mental logs ⇒ `high` (AC) ✓.

### 2.7 Signals additions
Layered onto the existing severity-sort/top-5 structure (`index.ts:123-190`); existing keys kept. New keys: `perf-decline` (high; human-readable metric summary), `winrate-dip` (watch), `target-focus` (ok; "decline dampened — you're working on your targets"), `still-learning` (ok), `slider-low` (watch), `mixed-accounts` (ok, lowers confidence context). Outcome `loss-streak` stays capped at watch.

### 2.8 Constants summary (all new/changed `READINESS_TUNING` entries)
`minPer10Minutes 6 · heroLearnGames 12 · statMinGames 15 · statTrustRamp 5 · baseWindowGames 40 · sdFloorFrac 0.15 · zWinsor 2.5 · metricWeights {dmg .3, deaths .3, elims .25, heal .15} · metricSkipMin {dmg 50, heal 50, elims 0.5, deaths 0.5} · cusumSlack 0.25 · cusumThreshold 2.5 · evidenceMinGames 8 · statPenaltyBase 10 · statPenaltySlope 4 · statPenaltyCap 30 · wrMinDecidedAcute 20 · wrMinDecidedBase 30 · wrDipMin 0.10 · wrPenaltySlope 100 · wrPenaltyCap 15 · perfBonusMinZ 0.5 · perfBonusCap 8 · mixOverlapMin 0.5 · habitFactor 1.25 · marathonMinGames 10 · sliderMinBase 10 · sliderMinAcute 3 · sliderDipMin 10 · sliderPenCap 8 · sliderBonCap 8 · subjCap 15 · subjAgreeFactor 0.3 · accountMixBar 0.7 · dampMinGraded 5 · dampHitRate 0.6 · dampFactor 0.5 · baseScore 75 · redCut 40 · amberCut 60 · driverBar 8 · rustSignalDays 6 · rustPenaltyCap 35 (retuned) · overloadPenCap 40 · freqPenCap 5` — each lands with a one-line rationale; retired: `outcomePenaltyCap`, `mentalPenaltyCap`, `loadPenaltyCap`, `objAdverseBar` (superseded by the delta bounds / the boolean `objectiveAdverse`).

---

## 3. Affected files / modules (exact change list)

**Core — readiness (`src/core/readiness/`):**
1. `constants.ts` — constants per §2.8.
2. `stats.ts` **new** — `meanSd()`, `winsorizedZ()`, per-game `ewmaSeries()` (generalizes the day-binned private `ewma` in `signals.ts:20-28`).
3. `baselines.ts` **new** — single-pass bucket builder over cleaned games → per `(account,hero)` / `(account,role)` time-ordered qualifying series with lifetime counts; baseline `meanSd` provider (uncoupled trailing window).
4. `performance.ts` **new** — `perfState(games, refOrdinal, ctx, mental)`: qualifying filter, learning exemption, bucket trust, mix-shift guard, CUSUM accumulator, winrate dips, bonus, dampener, availability/coverage stats.
5. `subjective.ts` **new** — slider baseline + disagreement gating (consumes `mentalState` output).
6. `score.ts` — rewrite: `computeStateAt(games, refOrdinal, ctx)` (extends `StateAt` with `perf`, `subj`, `deltas`, `driver`; **update `EMPTY_STATE` in lockstep**, survey warning §5.4); `scoreFromState` → §2 composite; `bandForState` → §2.5; `restEffectFor` stays (absorbed into loadDelta; still exported for its direct test import at `test/readiness.test.ts:8`).
7. `signals.ts` — `loadState`/`mentalState` unchanged; `outcomeState` trimmed to `lossStreak` only (winrate moves to `performance.ts`).
8. `types.ts` — `ReadinessDriver`, `ReadinessSubscore { delta, available, coverage? }`, `ReadinessSubscores { load, performance, subjective }`; `ReadinessSummary` gains `subscores` + `driver`.
9. `index.ts` — signature change, ctx threading (incl. `buildTrend`/`scoreAt` per-day target filtering), `confidenceFor` §2.6, `buildSignals` §2.7, barrel exports for new types.

**Core — analytics & data:**
10. `src/core/analytics/performanceStats.ts` **new** — from filtered games: `{ ratedGames, trend: {date, avg, games}[] (day-bucketed), winAvg|null, lossAvg|null, byHero: {key, avg, rated}[], byMap: {key, avg, rated}[] }`; whole-count-per-hero convention (`byHero` idiom, `grouping.ts:44-54`); filter-average-null pattern (`signals.ts:176-178`); never 0-for-empty.
11. `src/core/analytics/types.ts` + `index.ts` — `PerformanceStats` types + barrel.
12. `src/core/dashboardData.ts` — ctx into `safeReadiness` (line 113); `performanceStats: performanceStats(games)` new field.
13. `src/core/sampleData/generate.ts` — seeded `performance` on ~55% of games (`base 55 + (win ? +8 : −6) + noise`, clamped 5–95) so the demo AC exercises populated paths (survey: currently **0%** of sample games are rated).

**Contract & main:**
14. `src/shared/contract/dashboard.ts` — `performanceStats: PerformanceStats` on `DashboardData`.
15. `src/shared/contract/index.ts` — re-export `ReadinessSubscores`, `ReadinessSubscore`, `ReadinessDriver`, `PerformanceStats`.
16. `src/main/index.ts:440-448` — pass targets ctx; apply `isCompetitive` filter (drift fix, §1).

**Renderer:**
17. `renderer/src/views/readiness.ts` — subscore tiles row (3-column `statBox` grid mirroring `loadCard`'s idiom, lines 175-190) + `statBar` pull bars; methodology-modal sections (subscores/weights, own-baselines, dampener, exemptions, external-cause caveat) appended to the existing `stack` (lines 85-141).
18. `renderer/src/charts/plots/ratingChart.ts` **new** — two-series SVG (per-day avg dots/line + rolling-average polyline), scaffolding copied from `lineChart.ts` (0–100 y-scale like `readinessChart.ts:26`; `emptyChart()` guard); barrel export in `plots/index.ts`.
19. `renderer/src/views/trends.ts` — performance `chartCard` (shared component, with table toggle) + two `statBox` tiles for win-avg/loss-avg (survey: `horizontalBars` is winrate-shaped and unsuitable).
20. `renderer/src/views/heroes.ts` — `Rtg` column via lookup map from `ctx.data.performanceStats.byHero` (`fmt()` renders `null → '–'`).
21. `renderer/src/views/maps.ts` — rating column added to the `chartCard` columns + row-mapper (null → `'–'` **in the mapper** — survey warning: no per-column `render` on this path).

**Docs & tests:**
22. `README.md` (Screens/Architecture bullets), methodology copy, superseded-by note atop `specs/supercompensation-detection.spec.md`.
23. Tests — see §5.

**Not changed:** `FILTERLESS_VIEWS` (readiness already listed; new analytics stay filtered — survey confirmed); settings/chip/toast plumbing; `readinessChart` (same trend shape); `heroStats.ts` (its even-split per-10 stays for the Heroes screen; the readiness decline component deliberately does **not** reuse it).

---

## 4. Data model / interfaces

```ts
// core/readiness/types.ts (additive)
export type ReadinessDriver = 'overload' | 'rust' | 'neutral';
export interface ReadinessSubscore { delta: number; available: boolean; coverage?: number; }
export interface ReadinessSubscores { load: ReadinessSubscore; performance: ReadinessSubscore; subjective: ReadinessSubscore; }
export interface ReadinessSummary { /* existing fields unchanged */ subscores: ReadinessSubscores; driver: ReadinessDriver; }
export interface ReadinessContext { targets: AuthoredTarget[]; }        // EMPTY_CONTEXT = { targets: [] }

// core/analytics (new)
export interface PerformanceStats {
  ratedGames: number;
  trend: Array<{ date: string; avg: number; games: number }>;
  winAvg: number | null; lossAvg: number | null;
  byHero: Array<{ key: string; avg: number; rated: number }>;
  byMap: Array<{ key: string; avg: number; rated: number }>;
}
```
`ReadinessSummary` is never persisted (recomputed per call — survey §5), so no storage migration; `manual.json`/history schemas untouched.

---

## 5. Test strategy (AC → test mapping)

Extend `test/readiness.test.ts` fixtures: `game()` gains optional `perHero`/`durationMinutes`/`performance`/`review` passthrough (factory already spreads `p` last — zero-risk); new helpers `statGame(hero, per10Targets, duration)` and `gradedGame(targetId, grade)`; keep `ts()`/`span()`/`TILT`/`CALM` and explicit `now`. The `restEffectFor` direct import (line 8) keeps working (§3.6).

**Explicit migration of existing assertions (critique must-fix — these break under the new model and must be re-derived, not assumed to pass):**
- `test/readiness.test.ts:200` — `restEffectFor(60)` returns **−35** (retuned `rustPenaltyCap`), not −45.
- `test/readiness.test.ts:203-212` — the rust-fade score floor drops from ≥ 55 to **≥ 40** (new anchor 75 − 35).
- The old "load + tilt → red" fixtures (AC-D style, `span(...,{perDay:10, mental:TILT})`) land at ~`loaded` under the new formula — **correct per the new spec** (red now requires the score in the red range, which needs objective decline alongside load; the superseded load+tilt-only red criterion is gone). Migrate these fixtures: strengthen them with per-10 decline data to assert the new red recipe, and add their old shape as a `loaded`-expectation test.
- Every hard-gate boundary fixture (5-vs-4 consecutive days, ratio exactly 1.5, span exactly 14) gets its expected band re-derived against §2's arithmetic before the suite is trusted green.

New/extended files: `test/readiness.test.ts` (composite/band/coherence/load), `test/readinessPerformance.test.ts` (baselines, CUSUM, winrate, exemptions), `test/readinessDampener.test.ts`, `test/performanceStats.test.ts`.

- **Coherence:** band = f(score, driver, gates) purity + monotonicity property test over synthesized states; equal-score overload-vs-rust fixture; subjective-only adverse ≤ 15 points & never red; agree-vs-disagree subjective contribution; fresh/steady label-only; **loadDelta/perfDelta/subjDelta stay within their documented bounds** across the chronicActiveDays 5–9 boundary (critique: −42 was reachable pre-clamp).
- **Overtraining:** the red conjunction fixture (5+ days heavy + winrate dip ≥ gates + CUSUM fired) → `in-the-hole` + reasons; **marathon end-to-end**: a single ≥150-min, 12-game session (z ≈ −1, losses, full bucketTrust, chronic window populated) → CUSUM fires **and the band reaches `in-the-hole` via the `marathonSession` arm** (critique: the earlier test only checked the accumulator); same decline well-rested → ≤ amber; single bad game / 3-game session → no fire; **evidenceMinGames as independent gate**: 4 games at winsorized z −2.5 (C = 9 ≥ 2.5) → does NOT fire; **bucketTrust ramp sweep** over 15→20 baseline games during a marathon fixture (pins where the guarantee engages, and asserts smooth monotone penalty growth — no cliff); loss-streak-only fixture **explicitly clears the winrate gates** (~21 decided games over 7 days at ≤ 6/day so `wrPenalty` actually engages) → penalty ≤ wrPenaltyCap and never red; flat 9-10/day habitual grinder (ratio ≈ 1, gapless streak, healthy stats) → `overloadPen = 0` → green (critique: previously failed on volPen+streakPen); layoff→binge (thin chronic) → no overload whiplash, and chronic-trust factor asserted smooth over chronicActiveDays 1→7.
- **Baselines & exemptions:** two-hero switch (both trusted buckets) no decline; learning-window exclusion; role fallback used; mix-shift overlap < 0.5 → inert; flex player (no bucket fills) → perf shrinks, winrate stays ≤ 15, verdict resolves, **confidence ≤ medium asserted**; multi-account divergent-WR fixture (mirrors sample-data's `Main`/`Smurf` split) → per-account isolation + `mixed-accounts` note + **confidence strictly lower than the equivalent single-account fixture**; manual-only → inert stats, ≤ medium, no throw; missing duration / multi-hero / < 6-min games skipped; winrate under-sampled → inert.
- **Dampener:** dampened vs undampened score strict inequality + signal; elevated tilt → no dampening + subjective fires; single stray flag (below bars) → still dampened **and its normal `tiltPen`/`subjDelta` contribution asserted present** (critique: second AC clause was untested); ungraded → no dampening; all-partial (0.5 credit) vs all-hit threshold arithmetic; ten-trivial-targets == one-target factor **and one game carrying 5 target grades counts as ONE game of evidence** (per-distinct-game gate); load unaffected.
- **Undertraining:** rust driver/band/floor (75 − 35 = 40 ≥ floor); low-frequency nudge; recovering→fresh unchanged (existing tests keep passing).
- **Subjective/slider/confidence:** low-baseline slider neutral; slider-low signal presence; zero-subjective-data → 0 + no throw; GEP-rich zero-mental → `high`.
- **Trend/contract:** trend points equal composite (spot-check vs direct `scoreFromState`); per-day dampener (target created mid-trend → earlier points undampened); totality battery (existing) re-run against new signature defaults.
- **performanceStats:** trend bucketing, win/loss averages, byHero whole-count convention, null-not-zero, Notion-sentinel-free.
- **Sample-data validation harness:** one test computes readiness + performanceStats over `generateSampleGames(180, 42)` and asserts sanity (verdict not red, score in [35, 95], performance surfaces non-empty) — pins the demo AC and guards constant retuning.
- **DoD:** `npm test` + `npm run typecheck` (main + renderer); README/docs updated; guardrails untouched (pure core, no new deps, CSP-safe SVG).

---

## 6. Resolved Open Questions (from the spec)

1. **Drift detector** → one-sided CUSUM (`slack 0.25, threshold 2.5, min 8 qualifying acute games`) — §2.2, with the arithmetic bounds proven against the single-game/short-session/marathon ACs.
2. **Exact constants** → §2.8, all in `READINESS_TUNING`, validated by the sample-data harness test.
3. **Graduated trust** → continuous `bucketTrust` ramp (15→20 games) and the continuous chronic `trust` factor on overload — no on/off cliffs anywhere.
4. **Mix-shift guard** → acute-vs-baseline within-role hero-share overlap ≥ 0.5, else the role fallback is inert — §2.2.
5. **Analytics placement** → one `chartCard` on Trends (chart + table toggle) with two `statBox` win/loss tiles; `Rtg` column on Heroes (`dataTable` column) and Maps (row-mapper) — §3.17-21.
6. **Driver naming** → `driver: 'overload' | 'rust' | 'neutral'` on `ReadinessSummary`.

---

## 7. Risks & Alternatives

- **Constants are untuned for real OW2 data** (the spec's own honesty framing). Mitigation: central constants + the sample-data sanity harness + the preview harness for eyeballing (`npm run preview` with logged games). Alternative (fitted/ML tuning) rejected by spec Out-of-Scope.
- **Per-account buckets fragment thin histories** (flex + multi-account worst case → objective family mostly inert). Accepted: confidence reports it honestly; the alternative (person-level buckets) reintroduces the smurf-pollution defect the spec explicitly closed.
- **CUSUM is less familiar than a threshold** — explainability handled by the signals layer (plain-language decline reasons + subscore breakdown UI), not by exposing the accumulator.
- **Trend cost** rises to O(trendDays × n) with per-day bucket rebuilds — at n ≈ a few thousand games this is well under the existing read-model budget; if profiling ever disagrees, baselines can be built once and windowed per day (incremental), an internal optimization requiring no contract change.
- **`heroStats` even-split per-10 remains on the Heroes screen** while readiness uses stricter hygiene — two per-10 semantics coexist by design (display vs. inference); documented in the methodology modal to avoid "numbers don't match" confusion.
- **Score/trend discontinuity at release** — spec-accepted; release notes flag it.
- **Alternative composite forms** (multiplicative penalties; Banister-only; score-independent gated bands) were evaluated in the research and spec phases and rejected there; this plan implements the approved architecture.

---

## 8. Defects fixed after the adversarial critique (traceability)

4-lens critique (spec-conformance, formula arithmetic, codebase-fit, test-coverage), 22 findings, all triaged; the fixes:

- **Red unreachable for the marathon AC** (consecutiveDays is calendar-days; a one-day grind can never satisfy `sustainedLoad`) → `marathonSession` corroboration arm (§2.5).
- **Habitual high-volume grinder read amber** (absolute `volPen` + `streakPen` ≈ −24 → score 51) → own-norm-relative `habitBar` volume penalty; streak penalty gated on an actual surge (§2.1).
- **`loadDelta` reached −42 / `subjDelta` +8 unreachable** → explicit clamp + `sliderBonCap 8` / counter-cap 4 (§2.1, §2.3).
- **Tilt contribution cliffed on the elevated bar**, zeroing a stray flag's normal effect → continuous coverage-gated `tiltPen`; elevated bar reserved for the dampener void (§2.3).
- **`objAdverseBar 12` sat above the minimum fired penalty (10)**, double-counting weak fired declines → boolean `objectiveAdverse` (§2.3).
- **Dampener evidence counted grade entries, not games** (5 targets on one game unlocked it) → per-distinct-game evidence gate (§2.4).
- **Mixed accounts didn't actually lower confidence** (AC requires it) → `accountMixBar` term (§2.6).
- **Marathon proof silently assumed full bucketTrust** → assumption stated; ramp sweep test (§2.2, §5).
- **"Near-zero metric" skip had no named constant** → `metricSkipMin` (§2.2, §2.8).
- **Five pre-existing test assertions break silently** (`restEffectFor(60)`, the ≥55 rust floor, AC-D load+tilt red fixtures, boundary fixtures) → explicit migration list with re-derived expectations (§5).
- **Vacuous/missing tests** (loss-streak that never engaged `wrPenalty`; marathon test that stopped at the accumulator; missing confidence assertions; missing `evidenceMinGames` isolation; missing ramp-smoothness checks; stray-flag second clause) → all named explicitly in §5.
- **`trust ≥ 1` red-gate cliff** → kept, documented as a deliberate hard gate with rationale (§2.5).
