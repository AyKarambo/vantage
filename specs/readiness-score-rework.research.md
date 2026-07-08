# Composite Readiness Score for Overwatch Coaching — Research Report (2026-07-07)

## 1. Commercial Readiness/Recovery Models: Structure & Weighting

| System | Structure | Weights/Form | Notes |
|---|---|---|---|
| **Whoop Recovery** | HRV + resting HR (RHR) + sleep quality → single 0–100 score, all vs. **personal baseline**, not population norms | Unofficial estimate: HRV ~70%, RHR ~20%, sleep ~10% (proprietary). Color zones: green 67–100, yellow 34–66, red 0–33 | HRV dominates because it's the most sensitive signal. Strain is tracked *alongside* Recovery, not blended into it. |
| **Garmin Training Readiness** | 6 inputs → composite: sleep score, HRV status (vs. baseline + trend), recovery time remaining, acute training load, stress history, Body Battery | Not disclosed as linear weights; explicitly **prioritizes acute signals** over long-term trend | Six-factor design is the closest commercial analog to combining load + physiology + trend in one number. |
| **Oura Readiness** | 3 pillars → 7 named "contributors" (Sleep Balance, HRV Balance, Activity Balance, Body Temp, Resting HR, Previous Night, Recovery Index) | "Balance" contributors use 14-day EWMA-like weighting vs. ~2-month long-term average | Best commercial example of an **explicit dual-timescale comparison** baked into one contributor. |
| **TrainingPeaks PMC (CTL/ATL/TSB)** | CTL (fitness, ~42-day EWMA of daily TSS) − ATL (fatigue, ~7-day EWMA) = TSB (Form) | Pure EWMA of a single load unit. Zones: TSB −10 to −30 = productive overload; below −30 = overreaching risk; +5 to +25 = fresh/peaking | Banister's impulse-response model with the convolution replaced by two EWMAs — direct ancestor of ACWR. |
| **Strava Fitness & Freshness** | Relative Effort (TRIMP-derived) → daily load → same EWMA Fitness/Fatigue/Form architecture | Fitness decays ~2.5%/day with no training; intensity weighted supra-linearly | Commercial systems converge on **EWMA of a single load index at two time constants**, then the difference. |

**Pattern**: physiological scores (Whoop/Garmin/Oura) use a **weighted-additive composite of z-scored inputs vs. personal baseline**, one dominant signal, acute inputs outweighing long-term trend. Load scores (TrainingPeaks/Strava) use **EWMA subtraction of two time constants**. Nobody uses a multiplicative composite for the top-level score.

## 2. Load-Monitoring Math

- **ACWR** = acute (7-day) ÷ chronic (28-day) load. Coupled vs uncoupled variants; **EWMA variant** (Williams et al.) is more sensitive than rolling averages. Zones (heavily caveated): <0.8 undertrained/detraining risk, 0.8–1.3 sweet spot, 1.3–1.5 caution, >1.5 danger.
- **Session-RPE** (Foster 2001): load = RPE × duration. Validated cheap internal-load proxy — analogous to a self-rated session slider.
- **Banister Fitness-Fatigue**: performance = baseline + k₁·(fitness, slow decay ~30–45d) − k₂·(fatigue, fast decay ~7–15d). Captures "simultaneously more skilled and currently worse."
- **TSB interpretation**: sustained near/above zero = detraining risk (the undertraining signal).

## 3. Detecting Performance Decline vs. Personal Baseline

- **Z-scores**: z = (value − rolling mean) / rolling SD, per metric per player. |z|>1–2 notable, >2 significant. Natural way to normalize heterogeneous metrics onto one scale.
- **EWMA control charts**: smooth noisy per-game metrics before z-scoring; λ 0.2–0.3 fast/over-triggers, λ 0.05–0.1 stable/slow.
- **CUSUM**: better than single-point z for *gradual* drift (slow burnout) — accumulates small sustained deviations. Right tool for "quietly declining over 2 weeks."
- **Sample size** (Hopkins SWC-vs-TE): ~15–20 games minimum per hero/role bucket for rolling mean/SD; ≥25–30 games for winrate (Bernoulli, high variance).
- **Combining noisy metrics**: weighted linear composite (inverse-variance weighting), not boolean AND/OR — independent noisy signals partially cancel when averaged, reducing false alarms.

## 4. Esports-Specific Findings

- Losing produces higher physiological stress than winning (confounds "bad performance" with "stress").
- **Tilt**: frustration → anger → attention impairment, ~30 min episodes; multifaceted, self-report flags directionally useful but partial → supports down-weighting.
- **Sleep deprivation**: reaction time worsens ~50ms, ~5× attention lapses — but in-game win performance didn't always degrade (short matches act as recovery breaks). Mixed evidence.
- **"Grinding to a Halt" (CHI PLAY 2023)**: measurable win-rate decline as a function of consecutively played matches in a single session — a validated, gaming-specific overtraining/tilt proxy.

## 5. Learning Dip / Deliberate Practice Exemption

Desirable-difficulty research (Bjork) + S-shaped skill-acquisition curves: deliberately practicing something new causes a real, expected, temporary performance dip. No standardized exemption algorithm exists; the mechanism precedent: **detect a context switch (new hero/role with low game count) and gate the decline detector — suppress alerts for N games on a new hero, or use a hero-specific baseline that starts fresh.**

## 6. Recommended Architectures

**A — Weighted Z-Score Composite (recommended primary)**
Readiness = 100-point scale from clipped weighted sum of signed EWMA-smoothed z-scores vs rolling personal baselines.
- Load subscore: dual-timescale EWMA / ACWR-style ratio — flags >1.3 (overtraining) and <0.8 (undertraining) symmetrically.
- Performance subscore: per-10 elims/deaths/damage/healing z + winrate z, inverse-variance weighted, min-sample gated, new-hero exemption.
- Subjective subscore: tilt frequency + self-rated slider, capped low (10–15%), modifier semantics.
- **Starting weights: Load 40% / Objective performance 45% / Subjective 15%.**
- Pros: mirrors commercial production architecture; interpretable subscores (expose them in UI). Cons: cold-start needs history.

**B — Two-Exponential Fitness-Fatigue (Banister)** on games-as-impulses. Best used as the **load subscore's engine**, not the whole product.

**C — Gated/Hybrid: CUSUM decline-detector + ACWR ratio + subjective modifier** with a state machine (undertraining / overtraining / new-hero-suppression states). Most defensible against false alarms; more complex to tune.

**D — Multiplicative penalty composite: NOT recommended** — punishes compounding mild signals too harshly; no commercial system uses it top-level.

**Recommendation**: A as the composite, B powering the load subscore, C's CUSUM/gating powering the performance-decline subscore.

## 7. Specific Guidance

- Min samples: ≥15–20 games per baseline bucket; ≥25–30 for winrate changes.
- False alarms: (1) EWMA-smooth before z-scoring — never alert off one game; (2) composite z must cross threshold, not one metric; (3) CUSUM for slow decline; (4) sustained signal across ≥3–5 sessions (Whoop's own heuristic: 3 consecutive bad days).
- Subjective + objective: subjective as low-weight modifier (≤15%) — self-perception and objective performance frequently diverge. Only let subjective move the score when it *disagrees* with objective data.
- Deliberate practice: heroes with <10–15 games → suppress decline alerts or independent baseline; route to a "still learning this hero" state, not a penalty.

## 8. Pitfalls

- **ACWR is contested** (mathematical coupling, noise amplification, inconsistent injury-prediction meta-analyses). Frame as "workload trend," not "burnout risk score."
- **Readiness-score validity is debated generally** — a coaching *signal*, not a diagnosis (matches existing honesty constraint).
- Tilt is broader than "anger" — keep the flag's weight low.
- Sleep/fatigue → in-game outcome links are mixed; treat behavioral load as the primary proxy, don't infer sleep.
