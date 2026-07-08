# Feature spec: Readiness data regimes — graceful stats↔manual blending (`readiness-data-regimes`)

**Source:** Live-data diagnosis 2026-07-07 (real `history.db`, 1,538 games: 0% per-10 qualification, 100% mental/grades coverage, score pinned at 64/"steady" through a 21-day no-rest grind) + spec interview 2026-07-07. **Approved 2026-07-07** with two owner amendments: GEP patch-day outage resilience (in scope) and a metric-direction regression pin (deaths/10 lower = better, verified already implemented). **Owner revision 2026-07-08 (approved via interview):** passivity guard (output-gated deaths credit) + rank-gated undertraining hint — see In-Scope §7 and Resolved #8–#11.
**Related specs:** `readiness-score-rework.spec.md` (the current model — this spec **supersedes exactly one of its resolved decisions**: *"weight is never reallocated to noise"*; every other decision, gate, exemption, and honesty constraint carries over unchanged), `supercompensation-detection.spec.md` (already superseded), `screen-review.spec.md` / `screen-targets.spec.md` (grades feeding the dampener).

## Intent (WHAT & WHY)

The readiness model's largest signal family — objective per-10 performance, worth up to −45 of the score — requires GEP data (`perHero` stats + `durationMinutes`) that **no real user has**: Overwolf approval is pending, so every install runs on manually tracked matches. Measured on the owner's real history, the family is fully inert (`statCoverage = 0` across all 1,538 games), and the anti-reallocation rule means its weight simply vanishes. The practical consequence: for a habitual grinder the score cannot meaningfully leave the ~60–75 band — 21 consecutive days without rest at 12+ games/day reads **"steady, 64, nothing flagged."** The model is honest about its confidence but dishonest in its dynamic range.

And this is not only a pre-approval problem: **even with Overwolf approved, GEP goes dark for days after game updates** while players keep logging manually. Coverage dips are a permanent, recurring reality, not a launch-window artifact.

The rework makes the model **regime-aware**: signal-family weights flow continuously toward the strongest *available* inputs, and the price of missing data is paid in **confidence and a visible regime label** — never in dynamic range. Three ideas:

1. **A continuous regime dial** derived from objective coverage (the already-computed `statCoverage` / sample sizes). At full coverage the model **is** the current stats-first model, bit-for-bit. At zero coverage it is the manual model below. Between, weights interpolate — no cliff on the day Overwolf approval lands, and no whiplash through a patch-day outage.
2. **The manual regime weights the exposure when it cannot measure the outcome.** The stats regime rightly says "habit is not risk" because it watches consequences (per-10 decline). Without stats, absolute training load — consecutive days without rest, absolute daily volume, long sessions — becomes real evidence, and results-vs-own-baseline is promoted from capped corroboration to the primary objective arm (keeping every discipline: per-account baselines, minimum samples, sustained evidence).
3. **The regime is visible.** A badge tells the user which evidence the verdict rests on ("based on your manual logs" vs "based on live match stats"), and confidence in the manual regime is capped at medium — high confidence is something only live stats can buy.

Unchanged in spirit: evidence-informed wellness nudge, not a diagnosis; anti-false-alarm bias paramount.

## In-Scope

### 1. Regime dial (`src/core/readiness/`, pure)

- A **blend factor `b ∈ [0,1]`** computed from the acute window's objective coverage (share of comparable per-10 games and winrate sample adequacy; exact functional form in techplan). `b = 1` ⇒ stats regime; `b = 0` ⇒ manual regime; monotone and continuous in between.
- A **discrete regime label** derived from `b` for display only (`stats` / `hybrid` / `manual`; cut points in techplan). The label never feeds the math — only the badge and methodology copy.
- **Regression guarantee:** at `b = 1` the model reproduces the current engine's scores and bands exactly (the stats regime *is* the shipped model).
- **Outage resilience (patch-day scenario).** When GEP capture stops for several days (game update breaks the events package) while games continue to be logged manually, the blend declines smoothly with acute coverage and recovers smoothly when capture resumes — the regime may pass through `hybrid` in both directions. **Absence of stats is never adverse evidence**: missing per-10 data on outage days must not feed the decline index, and families that remain available (results, mental, slider) keep operating at full discipline throughout.
- Trend points evaluate `b` as-of each day, so a mixed history scores each era under the evidence that existed then.

### 2. Manual-regime weight redistribution (all scaled by `1 − b`)

- **Results vs own baseline — promoted.** The winrate-dip arm's ceiling grows (from today's −15 toward ≈ −30 at `b = 0`; constants in techplan) and, when it fires on adequate samples, sets `objectiveAdverse` — making the adverse-family gate reachable on manual data. Discipline unchanged: per-account, uncoupled baseline windows, minimum decided-game counts, dips below the variance floor stay free.
- **Absolute training-load arm — new.** Consecutive active days without a rest day, absolute games/day, long/marathon sessions, and rest-day scarcity accrue penalty **independently of the player's own norm** (scaled by `1 − b`; caps in techplan). Rationale: exposure is the only fatigue evidence available when outcomes are unmeasurable. In the stats regime (`b = 1`) this arm contributes exactly zero — "habit is not risk" continues to hold where consequences are observable.
- **Subjective cap raised.** The hard cap widens (from −15 toward ≈ −25 at `b = 0`; constants in techplan). Own-norm comparison, coverage gating, and disagreement gating all unchanged.
- **Target grades stay dampener-only.** Self-graded misses never become adverse evidence (gaming/self-punishment risk); grades only ever *soften* penalties via the existing dampener.

### 3. Band derivation — regime-aware red gate

- **Red (`in-the-hole`) always requires two adverse families.** Stats regime: unchanged (load corroboration + `objectiveAdverse` ∨ elevated tilt). Manual regime: **sustained absolute load** (the existing `sustainedLoad` arm, or a manual-specific refinement — techplan) **AND** at least one of: results decline vs own baseline, or elevated tilt.
- **Load alone maxes out at amber in every regime** — a pure grind with healthy results and calm mental logs is `loaded`, never red.
- `insufficient-data`, stale-`rusty`, `recovering`→`fresh` de-escalation, green split: all unchanged.

### 4. Confidence & contract

- Manual regime **caps confidence at `medium`**; `high` requires stats-regime coverage (existing bars). Hybrid interpolates per existing coverage rules.
- `ReadinessSummary` gains the **regime field** (naming in techplan), typed end-to-end through the IPC contract. Additive; no storage migration.

### 5. Readiness screen (`renderer/src/views/readiness.ts`)

- **Regime badge** on the verdict card: "based on your manual logs" / "based on live match stats" (hybrid copy in techplan), with the manual badge doubling as the explanation for capped confidence.
- **Methodology modal** updated: both regimes, what moves the weights, what unlocks stats mode (live capture once Overwolf approval lands), and the patch-day note (stats mode dips to hybrid during GEP outages — expected, not a bug).
- Subscore breakdown unchanged structurally; the load row's tooltip explains the absolute arm when it contributes.

### 6. Docs & tests

- README + methodology copy; **superseded-decision note** added to `readiness-score-rework.spec.md` §objective-performance pointing here.
- Full vitest coverage for the dial, the new arm, the promoted winrate ceiling, gates, and blending continuity — including a **real-data-shaped regression fixture**: manual-only history, 21 consecutive active days at 12+ games/day, results at baseline, tilt below the bar ⇒ must read `loaded` (amber), not `steady`; add an elevated-tilt or winrate-dip variant ⇒ red reachable; plus a **patch-day outage fixture** (stats-rich history, multi-day coverage gap, recovery).

### 7. Coaching refinements *(owner revision 2026-07-08)*

**7a. Passivity guard — output-gated deaths credit.** In the per-10 decline blend, the deaths metric's *favorable* direction (fewer deaths than baseline) earns credit **only while the game's output holds**: when the active non-death metrics (damage/elims — healing where applicable) are in aggregate at/above the player's baseline, fewer deaths counts as improvement exactly as today; when output is *below* baseline, the deaths improvement earns **zero credit** (never negative) — so a "playing scared" stretch (damage+elims down, deaths down) reads as the pure output decline it is, instead of cancelling out. Deaths *above* baseline stays adverse in every context (unchanged). The aggressive direction is deliberately untouched: damage+elims up with slightly more deaths already nets positive through the existing weighted blend. The gate must follow the model's continuity discipline (no hard per-game cliff at output z = 0 — graduated near the boundary, mechanism in techplan).

**7b. Rank-gated undertraining hint.** The low-frequency nudge (signal **and** its small `freqPen`, gated together — the score never dips invisibly) fires only when **all** hold: (a) low play frequency as today (`activeDaysPerWeek < lowFrequencyDaysPerWeek`); (b) **rank evidence exists** — at least one account(::role) has enough rank data to compute a net movement across the stagnation window (~14 days, constant in techplan); (c) **no account is climbing** — none shows net-positive rank movement over that window. No rank data ⇒ both stay **silent**: the app never encourages volume on zero evidence. A low-frequency player who *is* climbing is the healthy high-focus + supercompensation pattern working — the model says nothing. Signal copy shifts from "consistency builds skill faster" toward "your ranks have been flat for ~2 weeks — a bit more regular practice might be the missing stimulus" (final copy in techplan). Rank movement is computed per-day-consistently (trend days included) via the pure `core/rank` engine; `ReadinessContext` gains the rank input (anchors or precomputed trends — techplan decides the shape). The `rusty`/stale bands and rest curve are untouched.

## Out-of-Scope

- Any capture-UX change (slider prompts, mental-log nudges) — coverage grows or it doesn't; the model adapts either way.
- GEP/Overwolf integration work itself; Notion-import backfill of stats or durations.
- Detecting or surfacing the GEP outage itself (GEP health telemetry exists elsewhere — `gepHealth.ts`); this spec only makes the *scoring* robust to it.
- User-configurable weights or sensitivity; ML/fitted models.
- `breakReminder.ts`; removing any band, chip, toast, or setting.
- Re-litigating any other decision of `readiness-score-rework.spec.md` (dampener bounds, exemptions, per-account baselines, disagreement gating all stand).

## Constraints

- **Guardrails 1–5 unchanged** (GEP-only capture, pure `core/`, typed IPC, CSP renderer, local-first).
- **Anti-false-alarm bias stays paramount**: every promoted or new arm keeps own-baseline comparison where an outcome exists, minimum samples, sustained-evidence accumulation, and central tuning with rationale lines. The absolute-load arm is the sole deliberately norm-free mechanism, and it alone can never produce red.
- **Absence-of-data neutrality**: a game (or day) lacking per-10 stats contributes nothing to any adverse index — missing data lowers coverage and confidence, never the score directly.
- **Continuity of the blend**: score is continuous and monotone in `b` — adding one qualifying GEP game may only move the score by a bounded epsilon (no regime cliff), in both directions (coverage rising *or* falling).
- **Never encourage volume on zero evidence** *(owner revision 2026-07-08)*: the undertraining nudge requires positive proof of rank stagnation; missing rank data silences it entirely.
- **Deterministic & total**; `safeReadiness` stays; O(n) per refresh.
- Score continuity across the release is **not promised** (trend reshapes once; release-notes worthy).

## Acceptance Criteria

**Regime dial & blending:**

- Given a history with zero per-10-qualifying games, when computed, then `b = 0`, the regime label is `manual`, and the manual weight set applies.
- Given a GEP-rich history meeting today's high-coverage bars, when computed, then `b = 1` and score **and** band are identical to the pre-rework engine on the same input (regression fixture).
- Given two histories differing by a single qualifying game, when computed, then their scores differ by at most a small bounded epsilon (no discontinuity) — in both directions (game added or removed).
- Given a mixed history whose older days are manual and recent days GEP-covered, when the trend renders, then each day is scored under the blend that existed that day.

**GEP-outage resilience (patch-day scenario):**

- Given a stats-regime history where GEP capture stops for several days after a game update while games continue to be logged manually, when computed on each outage day, then the blend declines smoothly with acute coverage (bounded per-day score movement from the regime shift alone), the regime label may pass through `hybrid`, and no decline evidence accrues from the missing stats themselves.
- Given the same history once GEP capture resumes, when computed over the following days, then the blend returns toward `stats` as coverage recovers, with the same bounded-movement guarantee.
- Given outage-period manual games with decided results and mental logs, when computed, then those games feed the winrate, tilt, and slider components normally — an outage never blanks families that remain available.

**Manual-regime dynamic range (the core fix):**

- Given the real-data fixture — manual-only, ≥21 consecutive active days at ≥12 games/day, results at own baseline, tilt below the elevated bar — when computed, then the absolute-load arm contributes a material penalty, the score lands at or below the amber cut, and the band is `loaded` (not `steady`).
- Given that same fixture plus an acute winrate dip at/above the dip threshold on adequate samples (or acute tilt at/above the elevated bar), when computed on a played-today state, then `in-the-hole` is reachable.
- Given an extreme grind with healthy results and calm mental logs (one adverse family only), when computed, then the band is at most `loaded` — never red, in any regime.
- Given moderate, rest-punctuated manual play with neutral results and mental state, when computed, then the score stays green — the absolute arm penalizes sustained restlessness, not playing regularly.

**Promoted results arm:**

- Given a manual history with a sustained winrate decline meeting the sample gates, when computed at `b = 0`, then the results penalty may exceed the old −15 cap (up to the new ceiling) and `objectiveAdverse` is true.
- Given the identical decline at `b = 1`, when computed, then the results arm behaves exactly as today (cap −15, corroboration role).
- Given samples below the winrate gates, when computed, then the arm is silently inert in every regime.

**Metric direction & passivity guard (owner amendment 2026-07-07, revised 2026-07-08):**

- Given acute games whose deaths/10 run *below* the player's baseline (fewer deaths) **while output metrics hold at/above baseline**, when the decline index is computed, then the deaths contribution is favorable (sign-aligned: lower deaths = better) and no decline fires from it. *(The original pin, now conditional on output holding.)*
- Given acute games where damage+elims run *below* baseline **and** deaths/10 also run below baseline ("playing scared"), when computed, then the deaths improvement contributes **no** favorable credit and the sustained output decline can fire the decline index on its own.
- Given deaths/10 above baseline, in any output context and any regime, then the deaths contribution is adverse (unchanged; pins the `aligned = −z` flip so it can never silently invert).
- Given output near the baseline boundary, then the deaths-credit gate is graduated (no hard per-game cliff at output z = 0).

**Rank-gated undertraining nudge (owner revision 2026-07-08):**

- Given a low-frequency player with no rank data on any account, when computed, then neither the low-frequency signal nor `freqPen` applies, in any regime.
- Given a low-frequency player where at least one account has rank data and **some** account moved net-positive over the stagnation window, when computed, then the nudge and penalty stay silent.
- Given a low-frequency player with rank data and **no** account climbing over the window, when computed, then the signal appears with the stagnation-aware copy and the small `freqPen` applies — capped as today, never escalating the band on its own.
- Given the trend chart over a mixed period, then each day applies the gate as-of that day's rank evidence.

**Subjective & grades:**

- Given maximal adverse subjective input at `b = 0`, when computed, then the subjective pull is bounded by the widened cap (≈ −25) and never reaches red without a second adverse family.
- Given the same input at `b = 1`, then the existing −15 cap holds.
- Given all-`missed` target grades, when computed, then the grades contribute no penalty in any regime (dampener withheld, nothing more).

**Confidence, contract & screen:**

- Given `b = 0`, when computed, then confidence is at most `medium`, whatever the coverage of mental logs.
- Given any verdict over IPC, then the regime field is present and typed (no `any`).
- Given the Readiness screen in each regime, then the matching badge renders and the methodology modal describes both regimes, the path to stats mode, and the patch-day note.
- Given degenerate inputs (empty, future-stamped, single-day), then nothing throws and the existing upstream gates fire unchanged.

**Definition of Done (per CLAUDE.md):** `npm test` green, `npm run typecheck` clean (main + renderer), new pure logic fully unit-tested, README + methodology copy updated, no guardrail weakened.

## Resolved questions

1. **Regime shape — continuous blend + visible label.** Weights interpolate on objective coverage; discrete label (`stats`/`hybrid`/`manual`) is display-only. Chosen over a hard switch (score cliff at flip) and a manual-only retune (second rework later). *(Interview 2026-07-07.)*
2. **Escalation — red needs two adverse families in every regime.** Manual: sustained absolute load AND (results decline ∨ elevated tilt). Load alone maxes at amber. Chosen over an amber cap (leaves the motivating grind unreachable by red) and load-alone red (habit would read as emergency). *(Interview 2026-07-07.)*
3. **Surfacing — regime badge + capped confidence.** New contract field, badge copy on the verdict card, manual caps confidence at medium, methodology modal explains both regimes. *(Interview 2026-07-07.)*
4. **Grades stay dampener-only** — self-graded misses never count as adverse evidence (anti-gaming, anti-self-punishment). *(Brainstorm 2026-07-07, unchallenged.)*
5. **Supersession scope** — exactly one prior decision reversed ("weight is never reallocated to noise" → regime-aware reallocation, priced in confidence + label); all other `readiness-score-rework` decisions stand.
6. **GEP outages are a first-class recurring scenario** *(owner amendment 2026-07-07)* — game updates take GEP down for days while manual logging continues; the blend must smooth through outage and recovery, and absence of stats is never adverse evidence.
7. **Deaths direction already correct** *(owner amendment 2026-07-07)* — verified in `performance.ts` (`aligned = m === 'deaths' ? −z : z`); pinned by a regression AC rather than re-specified. *(Revised 2026-07-08 by #8 — the favorable direction is now output-gated.)*
8. **Passivity guard — output-gated deaths credit** *(interview 2026-07-08)* — fewer deaths earns credit only while output holds; when output is also down the credit is zero (never negative). Chosen over "passivity actively adverse" (false-alarm risk on genuine efficiency shifts) and "deaths never earn credit" (loses a real positioning-improvement signal).
9. **Aggression unchanged** *(interview 2026-07-08)* — damage+elims up with slightly more deaths already nets positive through the weighted blend; no explicit exemption added.
10. **Undertraining hint gated on proven rank stagnation** *(interview 2026-07-08)* — signal and `freqPen` gated together; silence when rank data is missing; philosophy: the app never encourages volume for its own sake — low-volume climbing is the healthy pattern working.
11. **Scope** *(interview 2026-07-08)* — both refinements land on the same branch under this spec; plan and tasks delta-updated.

## Open Questions (techplan)

- Exact blend function `b` (inputs: `statCoverage`, winrate-sample adequacy; smoothing across days?) and the `stats`/`hybrid`/`manual` label cut points — including outage decay/recovery shape.
- Manual-regime constants: results ceiling (~−30), absolute-load arm caps and thresholds (days × volume × session length), widened subjective cap (~−25) — validated against the real-data fixture and synthetic ones.
- Whether the absolute-load arm should retain a small residual weight in hybrid (`0 < b < 1`) or fade linearly.
- Regime field naming and badge copy (incl. hybrid wording).
- Whether `bandForState`'s manual red gate reuses `sustainedLoad` verbatim or needs a manual-specific definition (current one already mixes ratio/absolute arms).
