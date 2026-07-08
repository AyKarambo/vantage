# Feature spec: Readiness score rework — objective performance signals (`readiness-score-rework`)

**Source:** Spec interview 2026-07-07 + web-research synthesis (commercial readiness scores, load-monitoring math, decline detection, esports fatigue — `specs/readiness-score-rework.research.md`) + GitHub issue [#44](https://github.com/AyKarambo/vantage/issues/44). Hardened against a 5-lens adversarial critique (intent-fidelity, research-honesty, codebase-fit, AC-quality, edge-cases) before review. **Approved 2026-07-07.**
**Related specs:** `supercompensation-detection.spec.md` (the current model — this spec **supersedes its score/band-relationship sections**; band vocabulary, screen surfaces, honesty framing, settings, and launch-toast behavior carry over), `log-match-improvements-2.spec.md` (the 0–100 performance slider this consumes), `screen-targets.spec.md` / `screen-review.spec.md` (active targets + per-match grades), `screen-trends.spec.md`, `screen-heroes.spec.md`, `screen-maps.spec.md` (analytics surfaces).
**Implements:** issue #44 (both parts: performance-rating analytics + readiness integration).

## Intent (WHAT & WHY)

The current readiness model has three structural problems:

1. **Two disagreeing engines.** The band (verdict) is rule-gated while the 0–100 score is a separate, "illustrative" formula — they can and do contradict each other, which undermines trust in both.
2. **It ignores what the app measures best.** Objective, automatically-captured evidence — winrate against the player's own baseline and per-10-minute combat stats (eliminations, deaths, damage, healing) — plays no role. Meanwhile the most heavily weighted non-load signal (tilt flags) is subjective self-report, which most users rarely log, leaving the score driven by play volume alone.
3. **It predates the performance slider.** The 0–100 self-rated performance per match (issue #44) is captured but feeds nothing.

The rework replaces the two engines with **one score-first composite**: a 0–100 readiness score built from three weighted signal families — **behavioral load** (dual-timescale, detecting both overtraining *and* undertraining/rust), **objective performance vs. the player's own baselines** (winrate + per-10 stats), and **subjective self-report** (tilt + performance slider, deliberately down-weighted) — with the band *derived from* the score plus a small set of hard safety gates. Declining objective performance **in conjunction with** heavy uninterrupted play and losing is the strongest overtraining read the app can make, and now drives the verdict — including within one long, break-free grinding session, not only across days.

One deliberate exemption: **a player actively working on improvement targets is expected to play worse.** When active targets are being hit while results dip, the performance decline is dampened (the "learning dip") — unless the player's tilt is clearly elevated versus their own norm, which voids the benefit of the doubt.

The feature remains an **evidence-informed wellness nudge, not a diagnosis** — the honesty constraint from the original spec is unchanged and reinforced by the research (commercial readiness scores are themselves unvalidated heuristics; ACWR-style ratios are contested and must be framed as "workload trend", not "burnout risk").

## Evidence base (research summary — what the design leans on, and where it extrapolates)

- **Commercial readiness scores** (Whoop, Garmin, Oura) are weighted-additive composites of inputs z-scored against the *player's own rolling baseline*, with one dominant signal family and acute signals outweighing chronic trend. None uses a multiplicative top-level composite. → Justifies the weighted composite architecture.
- **Load math** (TrainingPeaks/Strava/Banister): dual-timescale EWMA (fast "fatigue" vs slow "fitness") captures overload *and* detraining symmetrically. → The load subscore's engine; absorbs the existing supercompensation/rust curve. Applying this day-level math to gaming is a design **extrapolation** from endurance sport, as before.
- **Decline detection**: EWMA-smooth per-game metrics before comparing to baseline (never alert off one game); combine noisy metrics as a weighted linear composite (noise partially cancels); accumulate sustained deviation rather than thresholding single points. Minimum samples: ~15–20 games to trust a stat baseline bucket, ~25–30 decided games for winrate shifts, and a distinct, smaller ~10–15-game window for the new-hero learning exemption. → The performance subscore's guardrails.
- **Esports-specific**: *within-session* winrate decay over consecutive matches is empirically validated ("Grinding to a Halt", CHI PLAY 2023). → Directly supports letting one sufficiently long, loss-heavy session satisfy the sustained-evidence rule (below); the cross-day mechanisms remain extrapolations. Tilt is real but multifaceted; self-report captures it only partially → tilt flags stay down-weighted.
- **Subjective + objective**: self-perception and objective performance frequently diverge; research guidance is to let subjective input act as a low-weight *modifier that adds information when it disagrees with the objective read*, rather than double-counting when they agree. → Adopted (see Subjective subscore).
- **Learning dip**: deliberate practice of new skills produces a real, temporary performance drop (desirable difficulties; S-shaped skill curves). The **new-hero exemption** is directly grounded in this. The **target-focus dampener** generalizes the same idea to self-authored improvement targets — a deliberate, owner-requested design extrapolation beyond what the literature directly validates, bounded accordingly (fixed cap, tilt override).

## In-Scope

### 1. Score-first composite model (`src/core/readiness/`, pure)

- **The 0–100 score becomes the primary output**; the band is derived from the score plus hard gates (below). Score and band can no longer contradict.
- Three subscores, each an EWMA-smoothed comparison against the player's own baselines, combined by fixed, centrally-tunable weights (starting point from research — **load ~40%, objective performance ~45%, subjective ≤15%** — final constants in the techplan):

  - **Load-balance subscore (behavioral, ~40%).** Dual-timescale EWMA of play volume (games/day, session minutes) — the existing acute(3d)/chronic(21d) structure — plus consecutive active days and long-session detection. **Symmetric:** high acute:chronic ratio / sustained volume ⇒ overload (negative); long gaps and chronically low frequency ⇒ rust/detraining (also negative, floored so a layoff reads "dull, not wrecked"). Absorbs and replaces the current separate load penalties, rest-fade, supercompensation `restEffectFor` curve, rust decay, and low-frequency nudge — one continuous balance curve instead of four bolted-on mechanisms.
    - **Trust gating extends to the overload classification**: overload arms (ratio *and* absolute volume) are only trusted when the chronic window has enough active days (the existing ratio-trust rule, applied consistently) — a layoff followed by a normal catch-up binge must not whiplash `rusty` → `in-the-hole` within days.
    - Note on habitual high volume: because the model is score-first, a player whose *normal* is 9–10 games/day with stable performance keeps a healthy score (no decline ⇒ no penalty); absolute volume alone corroborates a red verdict but never produces one.

  - **Objective-performance subscore (~45%).** Two components, both computed against **per-account baselines** (a smurf's easy-lobby numbers must never inflate the main account's baseline, or vice versa; evidence is normalized per account, then aggregated person-level):
    - **Winrate vs. personal baseline:** acute winrate against the player's own rolling baseline per account (promotes today's weak `winrateDip`), gated on a minimum decided-game count. When underpowered, this component is silently inert.
    - **Per-10 stat decline:** eliminations, deaths, damage, healing per 10 minutes, each compared to the player's **per-hero rolling baseline where that hero has enough games, falling back to a per-role baseline** — a Mercy game after a Tracer game must never read as "damage collapsed". Metrics are EWMA-smoothed and combined into one decline index (weighted linear composite). Only single-hero GEP games carrying `perHero` stats *and* a usable duration feed this component: **multi-hero games are excluded** (per-hero playtime within a match is not recorded, so per-10 attribution would be systematically biased), as are **games below a minimum duration** (per-10 rates explode on 4-minute stomps).
    - **Sustained evidence, session-aware:** the decline index fires only on accumulated evidence over enough games — satisfiable **within a single sufficiently long session** (the marathon-grind case the within-session research validates) or across several sessions. A single bad game, or a short bad session, never fires it.
    - **Weight is never reallocated to noise:** when the stat-decline component is unavailable (manual games, flex players whose buckets never fill), the winrate component does **not** absorb the freed objective weight; the objective subscore's maximum pull shrinks and confidence drops instead. **⚠️ SUPERSEDED by `readiness-data-regimes.spec.md` (2026-07-08):** with Overwolf unapproved, this rule left the score pinned near 75 for every real (manual) user. The rework instead reallocates the dormant weight — via a continuous stats↔manual blend `b` — onto a promoted results-vs-baseline ceiling, a widened subjective cap, and a norm-free absolute-load arm, pricing the missing data in **confidence + a visible regime label** rather than lost dynamic range. Bit-identical at `b=1`. All other decisions in this spec still stand.
    - **No decline from hero-mix changes:** a shift in *which* heroes are played (within a role or across roles) must not itself read as decline — comparisons happen inside hero buckets, and role-fallback comparisons are guarded against material within-role mix shifts (mechanism: techplan).
    - **New-hero exemption:** games on a hero below the learning window (~10–15 games — deliberately distinct from the baseline-trust minimum) are excluded from decline detection entirely and may surface a neutral "still learning this hero" note. The techplan must avoid a hard on/off cliff at the threshold (graduated trust near the minimum).

  - **Subjective subscore (≤15% — hard-capped, disagreement-gated).** Tilt rate (acute vs. baseline, coverage-gated as today) + the 0–100 performance slider compared against the player's **own average slider rating** (chronic pessimists/optimists must not skew it). Following the research: subjective input contributes at full (capped) weight when it *disagrees* with the objective read (e.g. "I feel awful" while stats look fine — early warning; "I feel great" while stats decline — dampens alarm slightly), and contributes little when it merely agrees (no double-counting a decline both objectively and subjectively). With no mental logs and no slider usage it contributes exactly zero and confidence drops.

- **Target-focus dampener (cross-cutting modifier, not a subscore).** When (a) ≥1 improvement target is active, (b) the acute window shows **positive evidence of hitting them** (per-match `review.grades` hit-rate at/above a threshold; `hit` full credit, `partial` half, no grades = no evidence = no dampening), and (c) the player's acute tilt is **not elevated** — then the objective-performance penalty (winrate + stat decline) is reduced by a **fixed, capped dampening factor**. Precisely:
  - **Tilt voids it at the elevated bar** (owner decision, Resolved #4): the dampener is removed when the acute tilt rate crosses the existing elevated-tilt thresholds (absolute rate, or delta above the player's own baseline — the same bar as the current fatigued signal). A single stray tilt flag below that bar does **not** void it (it still feeds the subjective subscore normally); when tilt *is* elevated, the un-dampened objective penalty and the subjective tilt penalty fire together, so a real tilt episode reads as one clear, explainable decline. Absent mental data = benefit of the doubt (dampener applies), consistent with the model's conservative bias.
  - **Bounded by design (anti-farming):** the factor is fixed — it reduces the performance penalty, never eliminates it, and does **not** scale with the number of active targets, grade volume, or hit-rate margin. Ten trivial always-hit targets buy exactly the same dampening as one honest target; a genuine overtraining episode still degrades the score, just more slowly.
  - The dampener never affects the load subscore — grinding is grinding regardless of practice intent.

- **Band derivation.** Bands come from score ranges **plus a direction tag** (dominant driver: overload vs. rust vs. neutral — a 55 from grinding is `loaded`, a 55 from a 10-day layoff is `rusty`) **plus hard gates** that survive from the current model:
  - `insufficient-data` and the stale gate (≥14 days silent → `rusty`, score withheld) stay upstream, unchanged.
  - **Red (`in-the-hole`) requires load corroboration**: reachable only while actively grinding (played today) with sustained heavy load — a losing streak, stat decline, or subjective signals alone can **never** produce red, whatever the score.
  - `recovering` → `fresh` de-escalation after 1–2 rest days off a heavy state stays.
  - `fresh`/`steady` green split stays cosmetic (label-only; identical recommendation and confidence treatment).
- **Confidence rework:** confidence now reflects the coverage of the *objective* inputs (share of acute games with usable per-10 stats, winrate sample size, active-day count) with mental coverage as a secondary factor — **a stats-rich GEP history reaches high confidence without any mental logging** (today it cannot).
- **Signals list additions:** performance-vs-baseline decline (human-readable, e.g. "deaths up and damage down vs your usual across your last long session"), "decline dampened — you're working on your targets" note, slider-vs-own-average signal, "still learning `<hero>`" neutral note, "mixed account activity" note when more than one account contributes materially to the acute window.

### 2. Contract & plumbing (typed IPC)

- **`computeReadiness`/`safeReadiness` gain a second input** carrying the target context (active targets + their acute grades — e.g. the relevant slice of manual data); both existing call sites are updated: the dashboard read-model (`computeDashboard`, `src/core/dashboardData.ts`) and the launch-toast path (`src/main/index.ts`). *(Active targets are not derivable from `GameRecord` alone.)*
- `ReadinessSummary` gains the three **subscores** (each: value plus an availability/coverage flag) and the **dominant-driver tag**, so the UI can show *why*. Existing fields keep their meaning; additive change, **no storage migration** (all per-game inputs — `perHero`, `durationMinutes`, `performance`, `mental`, `review.grades` — already exist on stored records).
- Settings (`enabled`, `launchToast`), chip, and toast behavior are unchanged.

### 3. Readiness screen updates (`renderer/src/views/readiness.ts`)

- **Subscore breakdown** on or beneath the verdict card: the three families with their current state and pull on the score — research is explicit that exposing subscores is what makes composite scores trustworthy.
- **"How is this calculated?" modal** updated for the new model: subscores, weights, baselines ("compared against *your own* usual stats"), the target-focus dampener, the new-hero exemption, and the honesty note (extended: workload ratio framed as trend, not risk prediction; the model cannot distinguish external causes — e.g. a balance patch nerfing your hero — from fatigue).
- Trend chart plots the **new composite** over `trendDays` (same chart semantics). **Continuity caveat:** the whole visible trend curve reshapes once when this ships (points are recomputed live, not persisted), and later actions (grading old games, creating targets) can legitimately reshape past points — the dampener never applies to trend days before the target's grades exist on those days' games.

### 4. Performance-rating analytics (issue #44 part 1)

- **Trends screen:** a performance card — self-rating over time (dependency-free SVG, existing chart idioms) with a rolling average; empty state when no rated games exist.
- **Correlation surface** (same card or adjacent): average self-rating on wins vs. on losses over the filtered range.
- **Heroes screen:** average self-rating per hero (shown when that hero has ≥1 rated game), following the existing per-hero-row attribution convention (a multi-hero match's single rating counts toward each hero played, consistent with the adjacent winrate/per-10 columns).
- **Maps screen:** same, per map.
- These analytics surfaces respect the global filter bar like their host screens (they are ordinary analytics — the *readiness verdict* stays filter-independent as before).

### 5. Docs & tests

- README (Screens + Architecture bullets), methodology-modal copy, and a superseded-by note at the top of `supercompensation-detection.spec.md` pointing here.
- Full vitest coverage for all new pure logic (`test/readiness*.test.ts` extended/added; performance-rating rollups unit-tested too).

## Out-of-Scope

- Physiological capture, sleep inference, wearables — unchanged from original spec.
- ML / fitted per-player models; the composite stays a transparent, hand-tuned heuristic.
- Changing the **performance slider capture UX** (log-match/review) — ships as-is from `log-match-improvements-2`.
- Changing `breakReminder.ts` (short-horizon nudge stays independent).
- Teammate/roster-based fatigue signals.
- User-configurable weights/sensitivity (constants stay central and fixed; a settings surface is a possible later increment).
- Notion export of readiness or performance analytics.
- Removing the `rusty` band or any existing surface (chip, toast, settings).
- Target *difficulty* validation (targets stay free-text and self-graded; the dampener is bounded instead — see above).
- The exact drift-detection algorithm (full CUSUM vs. sustained-EWMA-z) and exact constants — techplan decisions.

## Constraints

- **Guardrails 1–5 unchanged**: GEP-only post-hoc analysis, pure Electron-free `src/core/`, typed IPC end-to-end, CSP-friendly renderer, local-first.
- **Anti-false-alarm bias is paramount** (research-backed): per-game metrics are EWMA-smoothed before baseline comparison; a decline fires only from the *combined* index, never a single metric; only on accumulated evidence over enough games (one long session qualifies; one game or a short session never does); minimum samples per baseline bucket (~15–20 games per hero/role stat bucket, ~25–30 decided games for winrate, ~10–15-game learning window for the new-hero exemption — final constants in techplan). Below minimums the component is silently inert, never guessed.
- **Baselines are per-account** (within-account per-hero/per-role buckets); the verdict still aggregates person-level across accounts, and heavy mixed-account windows surface a confidence-lowering note rather than polluted baselines.
- **Per-10 hygiene:** multi-hero games and games under a minimum duration are excluded from the per-10 decline component; games missing `durationMinutes` likewise. Nothing is fabricated.
- **Honesty hard requirement** (carried over, extended): heuristic not diagnosis; workload ratio presented as a trend observation; no clinical labels; subscore transparency in the UI; the methodology copy acknowledges the model cannot distinguish external performance causes (patches, meta shifts) from fatigue.
- **Graceful degradation, never fabricate**: manual-only histories get load + winrate + subjective only; no slider usage → slider component inert; no mental logs → tilt component inert and the dampener defaults to benefit-of-the-doubt; every degradation lowers stated confidence rather than inventing data.
- **Deterministic & total**: degenerate inputs never throw; `safeReadiness` wrapper stays.
- **Competitive-only input** feed and **filter-independence of the verdict** stay as-is (original spec Area D/E behavior).
- **Performance**: O(n) per dashboard refresh for the verdict (per-hero/per-account baselines built in the same pass); trend stays O(trendDays·n).
- **Conservative thresholds, centrally defined**: every window/weight/cutoff in `READINESS_TUNING` with a one-line rationale; no magic numbers.
- Score continuity across the release is **not** promised — the score *and the whole visible trend curve* will shift once when this ships (release-notes worthy, not a regression).

## Acceptance Criteria

**Composite & band coherence (pure, unit-tested):**

- Given any computed state, when the band is derived, then it is a pure function of (score, dominant driver, hard gates) — equal inputs always map to the same band, and a higher score never maps to a worse band within the same driver/gate context.
- Given two states with equal composite scores — one produced by sustained heavy load, the other by a long layoff — when computed, then the dominant-driver tags differ (overload vs. rust) and the resulting bands differ accordingly (e.g. `loaded` vs `rusty`).
- Given default tuning and a state where only subjective inputs are adverse (max tilt rate, slider far below the personal average) with load and objective performance neutral, when scored, then the score drops by at most the subjective cap (~15 points) and the band never reaches `in-the-hole`.
- Given adverse subjective inputs that merely *agree* with an already-detected objective decline, when scored, then the subjective contribution is materially smaller than in the disagreement case (no double-counting).
- Given a history below the minimum baseline or ≥14 silent days, when computed, then the existing `insufficient-data` / stale-`rusty` gates fire exactly as today (score withheld).
- Given states that would previously split `fresh`/`steady`, when computed, then the split is preserved label-only, with identical recommendation and confidence.

**Overtraining detection (the core new behavior):**

- Given sustained heavy load (≥ the configured consecutive active days at high volume), acute winrate below the player's baseline by at least the winrate-decline threshold (with the minimum decided-game count met), and the per-10 decline index fired (enough samples, accumulated per the sustained-evidence rule), with no dampener active, when computed on a played-today state, then the score lands in the red range and the band is `in-the-hole` with a rest recommendation naming the objective decline among the reasons.
- Given **one single marathon session** — many consecutive games without a break, heavy losses, per-10 stats visibly below baseline within that session — when computed at its end, then the sustained-evidence rule is satisfied by that session alone and the verdict escalates (red reachable when the load gate concurs). *(The owner's core scenario; directly supported by the within-session research.)*
- Given the identical performance decline but moderate, well-rested play (load subscore healthy), when computed, then the band is at worst amber — **never** `in-the-hole`.
- Given a losing streak alone (no load elevation, no stat decline), when computed, then the outcome contribution never exceeds its named cap in `READINESS_TUNING` and the band never reaches red.
- Given a single bad game, or a single short bad session, against an otherwise healthy baseline, when computed, then no decline signal fires.
- Given a player whose acute volume matches their own long-established chronic volume (ratio ≈ 1) with healthy performance, when computed, then the load-balance subscore reads neutral-to-mild and the band stays green regardless of the absolute game count.
- Given a rust-conducive layoff followed by a few days of normal-volume play, when computed, then the verdict does not whiplash to `loaded`/`in-the-hole` while the chronic window is still too thin to trust the overload classification.

**Baselines & exemptions:**

- Given a player who switches between two heroes with very different stat profiles (both with sufficient per-hero history), when the decline index is computed, then each game is compared only against its own hero's baseline and no decline is flagged from the switch itself.
- Given games on a hero below the learning window, when computed, then those games are excluded from decline detection and may only produce a neutral "still learning" signal — never a penalty.
- Given a hero without enough games but a role bucket that has enough, when computed, then the role-level baseline is used as the fallback.
- Given a hero-mix shift within a role where no hero clears the per-hero minimum, when computed, then no decline fires purely from the mix change.
- Given a flex player whose per-hero buckets never clear the minimum, when computed, then the objective subscore's pull shrinks (winrate does not absorb the freed weight), confidence drops, and the verdict still resolves from the remaining families.
- Given a multi-account history with divergent skill levels (e.g. main + smurf), when baselines are computed, then each account's games are compared against that account's own baselines, and a materially mixed acute window surfaces the mixed-account note with lowered confidence.
- Given a manual-only history (no `perHero`, no durations), when computed, then the stat-decline component is inert, a valid verdict still emerges from load + winrate + subjective, confidence is at most medium, and nothing throws.
- Given GEP games missing `durationMinutes`, multi-hero games, or games below the minimum duration, when computed, then those games are skipped by the per-10 component (no fabricated or distorted rates).
- Given fewer than the minimum decided games for the winrate gate, when computed, then the winrate component is silently inert while the rest of the composite still resolves.

**Target-focus dampener:**

- Given active targets with an acute hit-rate at/above the threshold, declining stats and losses, and acute tilt below the elevated bar, when computed, then the objective-performance penalty is reduced by the dampening factor (score strictly higher than the identical state without targets) and a signal explains the dampening.
- Given the same state but acute tilt at/above the elevated bar (absolute rate, or delta above the player's own baseline), when computed, then no dampening occurs (identical penalty to the no-targets case) — and the subjective tilt penalty applies simultaneously, so the decline reads clearly.
- Given the same state with a single stray tilt flag whose acute rate stays below both elevated bars, when computed, then the dampening still applies, and the flag feeds the subjective subscore normally.
- Given active targets that were not graded in the acute window, when computed, then no dampening occurs (no positive evidence of hitting).
- Given an acute window of all-`partial` grades vs. an all-`hit` window, when the hit-rate evidence is computed, then partial counts at half credit (and may or may not cross the threshold accordingly).
- Given ten trivially-easy active targets all graded `hit` on every game, when computed, then the dampening is exactly the same bounded factor as for a single hit target — and a sustained genuine decline still degrades the score through the dampener, only more slowly.
- Given the dampener active, when the load subscore is computed, then it is unaffected.

**Undertraining:**

- Given a long layoff within the stale bound, when computed, then the load-balance subscore turns negative on the rust side, the dominant driver is rust, the band is `rusty`, and the score stays above the floor (a layoff reads dull, never wrecked).
- Given chronically low play frequency without a full layoff, when computed, then the consistency nudge still surfaces.
- Given a red-conducive history followed by 1–2 zero-game local days, when recomputed, then the band de-escalates `recovering` → `fresh` exactly as today.

**Subjective inputs, slider & confidence:**

- Given a player whose slider ratings run consistently low, when recent ratings match that personal average, then the slider component reads neutral (own-baseline comparison, not absolute) and no slider signal fires.
- Given recent slider ratings materially below the player's own average, when computed, then the slider-vs-own-average signal appears in the signals list.
- Given no slider usage and no mental logs, when computed, then the subjective subscore contributes zero, confidence reflects the missing coverage, and nothing throws.
- Given a GEP-rich history (ample per-hero/duration coverage, winrate sample met, ample active days) with **zero** mental logs and no slider usage, when computed, then confidence reaches `high`.

**Contract & screen:**

- Given the new `ReadinessSummary`, when delivered over IPC, then it carries the three subscores with availability flags and the dominant-driver tag, fully typed (no `any`).
- Given the Readiness screen with any verdict, when rendered, then the subscore breakdown is visible, the methodology modal describes the new model (weights, baselines, dampener, exemptions, external-cause caveat), and the honesty note is present.
- Given the trend chart, when rendered, then each point equals the new composite score at that day (not the legacy formula).
- Given the Overview chip, launch toast, and settings toggles, when the feature runs, then their behavior is unchanged from the current release.

**Performance analytics (issue #44 part 1):**

- Given rated games in the filtered range, when Trends renders, then the performance card shows the rating-over-time chart with a rolling average; given no rated games, then a friendly empty state (no crash, no fake zeros).
- Given rated games with decided results, when the correlation surface renders, then it shows average self-rating on wins vs. losses for the filtered range.
- Given a hero (or map) with ≥1 rated game, when the Heroes (or Maps) table renders, then it shows that hero's/map's average self-rating; heroes/maps without ratings show an empty cell, not 0.
- Given the demo/sample dataset, when all new surfaces render, then they work without error from sample data.

**Definition of Done (per CLAUDE.md):** `npm test` green, `npm run typecheck` clean, new pure logic fully unit-tested, README + methodology copy updated, no guardrail weakened.

## Resolved questions

1. **Score-first architecture** — the composite score is the primary model; bands derive from score + dominant driver + hard gates. Score and band can no longer contradict. *(Interview 2026-07-07.)*
2. **Issue #44 scope** — **both parts** in scope: performance-rating analytics surfaces *and* the readiness integration. This spec closes the whole issue.
3. **Stat baselines** — per-role with per-hero refinement when the hero has enough games; **per-account** (critique: smurf pollution); manual games never feed the decline component; multi-hero and too-short games excluded from per-10.
4. **Target-caveat tilt bar** — voided at the **elevated-tilt bar** (acute tilt rate at/above the absolute threshold, or the delta above the player's own baseline — the existing fatigued-signal bar). Decided at review 2026-07-07 after a mechanics walkthrough: the literal "any tilt flag voids" reading was considered and rejected because a lone stray flag would swing the score by the dampener's full width with no visible tilt signal explaining it; the elevated bar makes both tilt mechanisms (un-dampened objective penalty + subjective tilt penalty) fire together, so real tilt reads as one clear decline, and it reuses existing tested constants. Absent mental data = benefit of the doubt. Hitting requires positive evidence (acute `review.grades`; `hit` full, `partial` half; no grades = no dampener).
5. **Anti-farming bound** — the dampener is a fixed, capped factor: reduces the performance penalty, never eliminates it, never stacks with target count or grade volume. Target difficulty stays unvalidated by design; the bound is the guard. *(Critique: trivial-target farming.)*
6. **Subjective disagreement-gating** — adopted from research: subjective input carries full (capped) weight only when it disagrees with the objective read; near-zero when redundant. *(Critique: silently dropped research nuance.)*
7. **Starting weights** — Load ~40% / Objective performance ~45% / Subjective ≤15% (hard cap); exact constants and functional forms in `READINESS_TUNING` via techplan.
8. **Wiring** — `computeReadiness`/`safeReadiness` gain a target-context input; both call sites (dashboard read-model, launch toast) update. *(Critique: the prior "wiring unchanged" assumption was factually wrong.)*
9. **Docs reconciliation** — the shipped-but-undocumented mechanics (rusty band, rest-fade, `restEffectFor` curve, low-frequency nudge) are absorbed into the load-balance subscore and documented here; the old spec gets a superseded-by note.

## Open Questions

- **Drift-detector implementation**: full CUSUM vs. a simpler sustained-EWMA-z accumulation — techplan decides against the false-alarm budget and testability.
- **Exact constants**: windows, min-sample counts (baseline-trust vs. learning-window vs. winrate), the marathon-session evidence threshold (games/minutes), dampening factor, subscore weights, score→band cut points, minimum per-10 duration — techplan, validated against the sample dataset and synthetic fixtures.
- **Graduated trust near minimums**: how the decline index scales in just above a bucket's minimum sample (avoid the on/off cliff) — techplan.
- **Within-role mix-shift guard**: the concrete mechanism for suppressing role-fallback comparisons when the hero mix shifted — techplan.
- **Analytics placement details**: one card or two on Trends; exact Heroes/Maps column treatment — techplan/UX pass following existing screen idioms.
- **Dominant-driver contract naming**: e.g. `driver: 'overload' | 'rust' | 'neutral'` — techplan.
