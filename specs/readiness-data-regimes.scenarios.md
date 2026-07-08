# Readiness scenario catalog — when do I get which score?

29 engine-verified player stories mapping the readiness state space. Every row was **hand-computed from `READINESS_TUNING` first, then verified against the real engine twice** (by its designing agent and by an independent re-run) — zero discrepancies, so the tables double as verification that the calculation is right. Each row is pinned as a regression test in `test/readinessScenarios.test.ts`. *(Updated 2026-07-08 for the owner revision: passivity guard + rank-gated undertraining nudge.)*

**How to read:** `score = 75 + loadΔ + perfΔ + subjΔ` (clamped 0–100, rounded). `b` is the stats-coverage blend: 1 = full live stats (⚡), 0 = manual logs only (◎). Band cuts: ≤60 amber `loaded`, ≤40 **plus two adverse families** red `in-the-hole`.

---

## A. Healthy play — the green zone

| Scenario | Player story | b | loadΔ | perfΔ | subjΔ | Score | Band | Why |
|---|---|---|---|---|---|---|---|---|
| `weekend-warrior` | 5 games Sat+Sun, 4 weekends, no rank data | 0 | 0 | 0 | 0 | **75** | fresh | Every arm silent — including the consistency nudge, which is **rank-gated** (rev. 2026-07-08): with no rank evidence the coach says nothing. Confidence **low** — no mental logs, no stats. |
| `evening-hobbyist-calm` | 3/night, calm logged, 1 rest day/wk | 0 | −1 | 0 | 0 | **74** | fresh | The textbook profile. Faint rest-scarcity trace (6 days/wk > 5.5 bar). Logging CALM keeps subjΔ at 0 **and** lifts confidence to medium — the manual ceiling. |
| `stats-grinder-habit-b1` | 10/day × 35 days straight, stable stats, GEP on | 1 | 0 | 0 | 0 | **75** | steady | **"Habit is not risk."** His norm IS 10/day (ratio 1.0), and at b=1 the engine watches outcomes directly — stable stats mean the volume costs nothing. Confidence **high** (stats only). |

## B. Rest, recovery & undertraining

| Scenario | Player story | b | loadΔ | perfΔ | subjΔ | Score | Band | Why |
|---|---|---|---|---|---|---|---|---|
| `rest-day-1-recovering` | 8/day × 35d grinder (56 amber), first day off | 0 | −0.7 | 0 | 0 | **74** | recovering | One rest day: penalties fade ×⅔ **and** +12 rest bonus. 56 → 74 overnight. |
| `grinder-plus-one-rest-day` | 4-week grinder who tripled volume, then 1 day off | 0 | −14.7 | 0 | 0 | **60** | recovering | Same fade math from a deeper hole (35/loaded on the last active day) — recovery is proportional, not a reset. |
| `rest-day-3-supercompensation-peak` | Same grinder, 3 full days off | 0 | +25 | 0 | 0 | **100** | fresh | The peak: +25 rest bonus exactly when the fade hits 0 and wipes every residual penalty. The model's "you are as ready as you'll ever be." |
| `eight-day-layoff-rust` | Calm month, then 8-day vacation | 0 | −35 | 0 | 0 | **40** | rusty | Past the day-3 peak, sharpness decays −12/day to the −35 floor at day 8. A layoff reads **dull, never wrecked** — 40 is the floor a pure layoff can produce. |
| `weekend-only-consistency-nudge` | Weekends only, always calm, no rank data | 0 | 0 | 0 | 0 | **75** | fresh | The nudge is **rank-gated** (rev. 2026-07-08): without proof of stagnation the coach never suggests more play. |
| `weekend-stagnant-nudge-fires` | Weekends only, SR logged every game, ranks net-flat 2 weeks | 0 | −3 | 0 | 0 | **72** | fresh | The one case the nudge fires: anchored rank + ≥5 logged SR changes over ≥7 days, **no** account climbing ⇒ "ranks not climbing over ~2 weeks — a bit more regular practice may be the missing stimulus." Climbing or unlogged ⇒ silent. |
| `young-account-insufficient-gate` | 2/day for 10 days — brand-new account | 0 | *(withheld)* | — | — | **null** | insufficient-data | Internally the young 21-day window manufactures a phantom overload (−21.9!). The 14-day-span gate exists precisely to refuse that artifact. |

## C. Overload — amber, and the three roads to red

| Scenario | Player story | b | loadΔ | perfΔ | subjΔ | Score | Band | Why |
|---|---|---|---|---|---|---|---|---|
| `manual-grind-amber` | 10/day × 5 weeks, no rest, results fine, calm | 0 | −21 | 0 | 0 | **54** | loaded | The absolute-load arm at full weight (streak 12 + volume 4 + scarcity 5). **One adverse family stops at amber** — no matter how deep. |
| `grind-wr-slump-red` | Same grind + a 20%-winrate week (base 50%) | 0 | −21 | −25 | 0 | **29** | in-the-hole | Road to red #1: load corroboration (sustained 10/day) **AND** objective results decline. Both families agree ⇒ red. |
| `grind-wr-slump-dampened` | Exact same slump, but grading target 'hit' on 14 games | 0 | −21 | −12.5 | 0 | **42** | loaded | The deliberate-practice dampener halves the results penalty (25→12.5) and lifts red back to amber: "you're worse because you're practicing." |
| `grind-tilt-slider-red` | Grind + every game tilted + self-rating 40 vs usual 70 | 0 | −21 | 0 | −23.4 | **31** | in-the-hole | Road to red #2: results are FINE — the second family is `fatigued` (elevated tilt). Widened manual subjective cap (−25) does the damage. |
| `stats-marathon-decline-red` | b=1: month of tidy 4-game days, then a 154-min, 10-loss marathon with per-10 fade | 1 | −17 | −41.7 | 0 | **16** | in-the-hole | Road to red #3, all-stats: the CUSUM accumulates a sustained per-10 decline within ONE marathon session (the corroboration arm no streak needed). The manual machinery is provably inert here. |

## D. Same grind, different data — the regime dial

The most important table for understanding the rework: an **identical 10-games/day no-rest grind**, differing only in what the data can see.

| Scenario | Data coverage | b | loadΔ | Score | Band | Why |
|---|---|---|---|---|---|---|
| `grind-all-manual` | Hand-logged only | 0 | −16 | **59** | loaded | Outcomes unmeasurable ⇒ exposure itself is the evidence (absolute arm at full weight). |
| `grind-true-hybrid` | 3 of 10 games via GEP | 0.6 | −6.4 | **69** | steady | The dial in between: 30% coverage ⇒ b=0.6 ⇒ the arm bills only (1−b)=40% of its manual value. |
| `grind-half-half-saturates` | 5 of 10 via GEP | 1 | 0 | **75** | steady | **50% coverage already saturates b to 1** — half-measured is enough for the engine to vouch for the rest. |
| `grind-all-gep` | Everything via GEP, stable stats | 1 | 0 | **75** | steady | Fully measured: the engine SEES the volume isn't hurting him and charges nothing. |
| `grind-gep-outage-day5` | Was b=1; patch broke GEP 5 days ago, kept logging | 0.57 | −7.3 | **68** | steady | The patch-day story: nothing about his play changed; the 7-day window slowly forgets measured days and the score drifts 75→68, then recovers symmetrically. |

## E. Guardrails & modifiers

| Scenario | Player story | b | loadΔ | perfΔ | subjΔ | Score | Band | Why |
|---|---|---|---|---|---|---|---|---|
| `slider-dip-below-own-average` | Rates this week 50 vs his usual 70 | 0 | −5 | 0 | −6 | **64** | fresh | Own-norm + dead-banded: a 20-point self-rating collapse costs just 6. |
| `chronic-pessimist-non-fire` | Has ALWAYS rated everything 40 | 0 | −5 | 0 | 0 | **70** | fresh | The pair's guardrail: the slider compares against YOUR OWN average — a lifetime pessimist reads neutral. |
| `tilt-agree-gate-shrinks` | Losing week, every game tilted | 0 | −5 | −30 | −4 | **36** | **loaded** | Two guardrails: tilt penalty shrinks ×0.3 when the winrate dip already tells the story (no double-billing) — and score 36 ≤ 40 still is NOT red, because the load-corroboration gate isn't armed (volume too low). Score and band answer different questions. |
| `all-loss-week-outcome-cap` | b=1, stats exactly at baseline, 21 losses | 1 | 0 | −15 | 0 | **60** | loaded | The named outcome cap: losses ALONE can never cost more than 15 — you can play your best and lose 21 coin flips. |
| `all-draws-week-silent-results` | 8/day grinder, all draws this week | 0 | −19 | 0 | 0 | **56** | loaded | Draws ⇒ no decided sample ⇒ the results arm goes silent (never "0% winrate!"); exposure still accrues. |
| `deaths-improve-damage-fall` | Damage −30%, deaths improve 5→4 per 10 | 1 | 0 | −30 | 0 | **45** | loaded | **Playing scared reads as decline** (rev. 2026-07-08): deaths only earn credit while output holds; with damage down 30% the credit is gated to zero and the pure output decline fires the CUSUM. |
| `deaths-improve-output-holds` | Damage holds at 8k, deaths improve 5→4 | 1 | 0 | 0 | 0 | **75** | fresh | The positive contrast: fewer deaths **with output intact** is a genuine positioning improvement and keeps full favorable credit — no decline, score untouched. |

---

## What the catalog verifies

- **Zero hand-math-vs-engine discrepancies across all 26** — the calculation matches the documented constants everywhere it was probed.
- The **two-adverse-families red gate** behaves exactly as specified from every direction (reachable three ways, refused when only one family fires — even at score 36).
- **b=1 inertness** of the manual machinery, **b=0 dynamic range**, the **0.5-coverage saturation**, and the **outage drift/recovery** all land on their designed numbers.
- Guardrails hold: outcome cap, draw silence, own-norm slider, agree-gating, deaths sign-flip, dampener, insufficient gate.
- **Owner revision 2026-07-08 pinned from both sides:** playing scared (output+deaths down) fires the decline index while genuine positioning improvement (output holds) keeps credit; the consistency nudge fires **only** on proven rank stagnation and is silent on missing rank data or any climbing account.

*Generated 2026-07-08 from a 5-lens agent workflow; every row re-verified independently. Fixtures: `test/readinessScenarios.test.ts` (day 0 = 2026-06-01; evaluated at 20:00 on the stated day).*
