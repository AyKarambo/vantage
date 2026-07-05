# Feature spec: Readiness & training-load coach (`supercompensation-detection`)

**Source:** Spec interview + `/deep-research` synthesis (supercompensation, overtraining/overreaching, esports fatigue), 2026-07-05. **Approved 2026-07-05.**
**Related specs:** `screen-mental.spec.md` (mental self-report + break reminder this builds on), `screen-overview.spec.md` (secondary surface), `screen-settings.spec.md` (enable/disable).
**Extends, does not replace:** the short-horizon loss-streak break reminder in `src/core/breakReminder.ts`.

## Intent (WHAT & WHY)

Sports training theory has a well-established idea — **supercompensation**: a training stimulus first *lowers* capacity (fatigue), then recovery lifts it *above* the prior baseline; but if load keeps piling on without recovery, cumulative fatigue drives performance *below* baseline — the athlete "trains into the hole" (*im Keller trainieren*). The user's hypothesis is that competitive Overwatch behaves the same way: grinding ranked while fatigued digs a hole, and a deliberate 1–2 day break lets form rebound.

Vantage should turn that principle into a concrete, honest coaching signal: **automatically estimate the player's current training load and readiness from their own history + self-reported mental state, tell them — at a glance — when they are likely grinding into the hole, and recommend rest (including full days off) so form can supercompensate.** Because rest needs are individual and the science does not transfer cleanly to a video game, the feature is an **evidence-informed wellness nudge, not a diagnosis** — and the product must say so plainly.

## Evidence base (what the science supports — and its limits)

Load-bearing for the whole feature: the detection is built to respect this, and the UI must not overclaim beyond it.

- **Solid:** Supercompensation as a *concept* and the overreaching→overtraining continuum (functional overreaching recovers in days-to-weeks *with* rebound; deeper states take weeks-to-months) are established sports-science consensus. Session-load monitoring via *effort × duration* (session-RPE) is validated. → Justifies a load-and-recovery framing and a "take 1–2 days off" rebound recommendation *as guidance*.
- **Weak / must not overclaim:**
  - **No single marker diagnoses overtraining**, even with full physiological instrumentation — detection is multi-signal and, clinically, retrospective. → We combine several weak signals and never claim to *diagnose* a stage.
  - **Match outcomes are a low-sensitivity fatigue signal** (best esports experiment: ~29h sleep deprivation degraded cognition but *not* in-game results). → SR/win-rate/loss-streaks are **weak, corroborating** inputs; the model leans on **behavioral load + self-reported mental state**.
  - **Streak/momentum effects on play are real but tiny** and easily swamped by matchmaking variance. → Thresholds are **conservative**; a losing streak alone never triggers a red verdict.
  - The acute-vs-chronic load ratio we borrow (ACWR) is **methodologically contested**; we use its *structure* as intuition, not its thresholds as truth. Recent play is weighted more than older (EWMA rationale).
  - The supercompensation curve is shown as a **conceptual illustration**, never a fitted per-player prediction.

## In-Scope

- A pure **readiness model** (`src/core/`) consuming the player's stored `GameRecord[]` (across all accounts/roles — fatigue is a property of the *person*) plus existing per-match mental flags, outputting:
  - a **readiness score** (0–100) and a **band** — traffic-light + plain label: `fresh` / `steady` (green), `loaded` (amber), `in-the-hole` (red), `recovering` (blue), `insufficient-data` (grey);
  - the **top contributing signals** as human-readable reasons (e.g. "5 days in a row without a rest day", "sessions longer than your norm", "tilt rate rising");
  - a **recommendation** (none / consider a break / **take 1–2 rest days**) with reasoning;
  - a lightweight **readiness trend** over recent days for the curve/sparkline.
- Signal families (weighted; behavioral + mental primary, outcomes weak):
  1. **Load (behavioral):** gap-based **session** detection from timestamps → session length & games-per-session; games-per-day; **consecutive active days without a rest day**; **acute-vs-chronic play volume** (recent window vs longer EWMA-weighted baseline).
  2. **Mental (self-report):** tilt rate and its trend, positive-comms trend, calm/tilted composites — reusing the existing `mental` layer (`GameRecord.mental` + `review.flags`).
  3. **Outcome (corroborating, low weight):** loss streak, win-rate vs rolling baseline, `srDelta` trend *when present*.
- **"In-the-hole" detection:** a red verdict requires **sustained cumulative load** (consecutive days without rest + acute:chronic above a conservative bound) **and** elevated subjective fatigue — corroborated, but not gated, by an outcome dip.
- **Rest recommendation & recovery:** on red, recommend 1–2 full rest days; **detect a rest day** (a local calendar day with zero games) and, after 1–2 rest days, de-escalate `recovering` → `fresh` and clear the recommendation ("readiness to return").
- A new **Readiness/Form screen** (`renderer/src/views/`): current verdict (traffic-light + score), the top reasons, the recommendation, a **dependency-free SVG** conceptual supercompensation curve with the player's recent readiness trend, and a **plain-language honesty note**.
- A **secondary Overview surface**: a compact readiness chip (always shown when the feature is enabled) that deep-links to the screen; when red, a gentle, dismissible nudge on the chip.
- An **optional tray toast** at app launch when the current verdict is red — **off by default**, opt-in via Settings (mirrors the existing break-reminder toast pattern without adding noise).
- **Typed IPC:** a new contract type + channel delivering the readiness result to the renderer (via the existing dashboard read-model plumbing).
- **Settings:** an enable/disable toggle (default on) and the opt-in launch-toast toggle (default off), next to the existing break-reminder settings.
- **Graceful degradation:** when mental self-report is sparse, the model down-weights it, leans on behavioral load, lowers stated confidence, never fabricates data, and gently encourages (never forces) logging mental state.

## Out-of-Scope

- Any physiological capture (HRV, heart rate, sleep, wearables) — no hardware; not GEP-sanctioned.
- A new **mandatory** daily wellness questionnaire (interview: build on existing mental tracking; a richer opt-in daily check is a possible future increment).
- Changing/replacing the existing **loss-streak break reminder** (`breakReminder.ts`) — it stays the short-horizon, in-session nudge; this feature is the multi-day layer above it (may cross-reference; behavior unchanged).
- Predictive/ML modeling or fitting a real supercompensation curve to the player — the curve is illustrative only.
- Per-hero, per-role, or per-map fatigue models.
- Clinical/medical stage classification (FOR/NFOR/OTS labels) in the UI.
- In-game blocking, session locks, or anything touching the running game (impossible and against account-safety).
- OS-level scheduled reminders while the app is closed.
- User-configurable *aggressiveness* of the verdict (interview chose a fixed "clear" verdict; sensitivity tuning is later).

## Constraints

- **Guardrail 1 (GEP-only) & account safety:** reads only already-stored match history + self-report; never reads live memory or affects gameplay. Pure post-hoc analysis.
- **Guardrail 3 (pure core):** all detection logic in `src/core/` (e.g. `src/core/readiness/`), Electron/Overwolf-free, with vitest unit tests (DoD 3); drivable from the browser preview harness.
- **Typed IPC end-to-end** (no `any` across the boundary): new types in `src/shared/contract/` barreled through `index.ts`; new channel in `IPC_CHANNELS`; handler in the main dashboard read-model.
- **Renderer:** the screen composes existing `components/`; the curve is **dependency-free SVG** in `charts/`; CSP-friendly single bundle (guardrail 4).
- **In-app copy is English**, consistent with the existing app locale (spec itself stays English per repo convention).
- **Honesty is a hard requirement:** the screen carries a plain-language note — evidence-informed wellness heuristic, sports-science analogy, limited esports evidence, **not a diagnosis** — and shows no clinical stage labels or per-player predictive curves.
- **Conservative, centrally-defined thresholds:** all windows/weights/cutoffs are named constants in one place (tunable), chosen to avoid false alarms; outcomes weighted below behavioral+mental; recent games weigh more (EWMA). No scattered magic numbers.
- **Works without SR:** `srDelta` is frequently absent (manual only) — a sensible verdict must come from timestamps, results, and mental flags alone; SR only sharpens when present.
- **Fatigue is per-person:** the verdict aggregates across all accounts/roles regardless of the dashboard account/role filter (the range/`days` filter may still scope the trend view; the verdict uses a fixed recent horizon).
- **Day boundaries:** "rest day" / "games-per-day" use a **local** day boundary (configurable reset hour a candidate — see Open Questions), since the existing UTC `dayKey` can misattribute late-night sessions; "session" uses a **time-gap** boundary independent of calendar day.
- **Minimum history:** below a defined baseline (e.g. < ~14 active days or < N games) the model returns `insufficient-data` rather than guessing.
- Computed O(n) over in-memory history on the normal read-model refresh — no measurable performance cost.

## Acceptance Criteria

**Core readiness model (pure, unit-tested with synthetic `GameRecord[]`):**

- Given a history below the minimum baseline, when readiness is computed, then the band is `insufficient-data`, the score is withheld/neutral, and no rest recommendation is made.
- Given moderate, consistent daily play with low tilt and ≥1 recent rest day, when computed, then the band is `fresh`/`steady` (green) with no rest recommendation.
- Given rising acute load (recent games/day and session length well above the player's longer baseline) but low subjective-fatigue markers, when computed, then the band is `loaded` (amber) with a caution — not a mandatory rest.
- Given sustained cumulative load (≥ the configured consecutive days without a rest day **and** acute:chronic above the conservative bound) **and** elevated subjective fatigue (rising tilt / falling positive comms), when computed, then the band is `in-the-hole` (red) with an explicit "take 1–2 rest days" recommendation and human-readable reasons.
- Given identical load and mental signals, a losing streak alone does **not** escalate the band to red (outcomes corroborating, low weight) — guarding against firing on matchmaking variance.
- Given a red verdict followed by 1–2 local days with zero games, when recomputed on return, then the band de-escalates (`recovering` → `fresh`) and the recommendation clears.
- Given ordinary ranked variance (e.g. a 4-game losing streak inside otherwise moderate, well-rested play), when computed, then the band stays green/amber — no red false alarm.
- Given multiple accounts/roles, when computed, then it aggregates play across all of them regardless of the active filter.
- Given sparse/absent mental flags, when computed, then the model still returns a band from behavioral load, marks lower confidence, and does not crash or invent flags.
- Given no `srDelta` on any match, when computed, then a valid band is still produced (SR optional).

**Readiness/Form screen & surfaces:**

- Given the player opens the Readiness screen, then it shows the traffic-light band + score, top contributing signals as plain text, the recommendation, and an SVG supercompensation curve with the recent readiness trend.
- Given a red (`in-the-hole`) verdict, then the screen states a clear, plain-language rest recommendation with its reasoning.
- Given the screen renders in any state, then it displays the honesty note and shows no clinical stage labels or per-player predictive claims.
- Given the feature is enabled, then Overview shows a compact readiness chip linking to the screen; when red, a gentle dismissible nudge appears on it.
- Given the launch-toast setting is on and the verdict is red at app launch, then one gentle tray toast fires; given it is off (default), then no toast fires regardless of verdict.
- Given the user disables the feature in Settings, then no readiness chip, nudge, toast, or verdict is surfaced anywhere.
- Given demo/sample data is active, then the screen renders from it without error, clearly as the sample layer.

## Resolved questions

1. **Intervention strength** — a **clear readiness verdict** (traffic-light + score) with an explicit rest recommendation, purely advisory. Vantage cannot and will not block the game.
2. **Data source** — build on the **existing mental self-report + match data**; no new mandatory daily check in v1.
3. **Placement** — a **new dedicated Readiness/Form screen**, plus a secondary compact chip on Overview.
4. **Signal weighting (from research)** — behavioral load + self-reported mental state **primary**; match outcomes (win/loss, streaks, SR) **weak, corroborating**, cannot trigger red alone.
5. **Scope of "detection"** — flags **elevated overtraining *risk* / fatigue-conducive conditions** and surfaces performance-vs-baseline as an observation; does **not** diagnose an overtraining stage.
6. **Fatigue is per-person** — aggregates across accounts/roles, not per the dashboard filter.
7. **Relationship to break reminder** — **extends, not replaces** `breakReminder.ts` (short-horizon loss-streak nudge stays).
8. **The curve** — a conceptual **illustration**, not a fitted prediction.
9. **Launch nudge** — Overview chip always shown (when enabled); the tray toast on a red verdict at launch is **opt-in, off by default**.
10. **In-app copy language** — **English**, matching the existing app locale.

## Open Questions

- **Concrete thresholds/windows for OW2.** No OW2/OW study exists; all streak/break evidence is League-of-Legends and tiny in effect. Proposed: conservative, centrally-tunable defaults (acute ≈ last 2–3 days, chronic ≈ last 3–4 weeks EWMA; "sustained" ≈ ≥5 consecutive days without a rest day) — finalized in the techplan, likely refined against real data.
- **Rest length & readiness-to-return.** 1–2 days extrapolates from the functional-overreaching timescale but isn't calibrated for gamers. Default "1–2 days off, then re-evaluate", or scale with how deep the hole is?
- **Minimum-history threshold.** Concrete default for `insufficient-data` (proposed ~14 active days or ~N games) — confirm N in the techplan.
- **Day-boundary reset hour.** Local midnight vs a configurable reset hour (e.g. 04:00) so a session ending at 01:00 still counts as the prior "day"?
