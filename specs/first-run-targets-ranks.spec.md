# Spec: First-run demo choice, honest empty targets, current rank model, editable per-match tracking

- **Slug:** `first-run-targets-ranks`
- **Status:** Draft (autonomous run — user reviews at the end)
- **Date:** 2026-07-04

## Intent (WHAT & WHY)

Four related problems all stem from the app presenting *fabricated defaults as if they were the
user's real data*, and from manual data being write-once. They erode trust in a product whose
entire promise is honest, account-safe coaching.

1. **Demo data is forced, never offered.** A brand-new user is silently shown a 180-game sample
   season. There is no moment where they decide whether they want a demo sandbox or a clean slate.
   The demo is only distinguishable by a small "Demo data" badge. **Why it matters:** users can't
   tell which numbers are theirs; some want to explore with demo data, others want to start
   tracking immediately with nothing in the way.

2. **Default ("sample") targets masquerade as the user's targets.** Improvement targets fall back
   to a hardcoded sample library whenever the user has authored none — *regardless* of whether the
   user is in demo mode or is a real user who simply hasn't set targets yet. A real user with real
   matches but no targets sees four fake targets they never created. **Why it matters:** it's
   confusing and dishonest; "no targets" should read as "no targets."

3. **The rank model is out of date.** Overwatch changed competitive months ago: every tier is
   split into **divisions 1–5**, progress within a division is shown as a **percentage (0–100%)**
   rather than raw points, and there is a new top tier **Champion (1–5)** above Grandmaster. Vantage
   still models 7 tiers (Bronze→Grandmaster) and shows raw SR points. **Why it matters:** the rank
   readout is simply wrong for the current game.

4. **Manually tracked target outcomes are write-once.** After a match is graded on the Review
   screen (self-rated target grades + mental flags), there is no way to change them. The match
   detail is read-only and the Review inbox only shows *ungraded* matches. **Why it matters:** users
   make grading mistakes or want to revisit a call; manual tracking that can't be corrected is
   frustrating and, again, undermines trust in the numbers.

The benefit: a new user gets an honest, deliberate first-run choice; empty means empty; the rank
readout matches the live game; and manual tracking is correctable.

## In-Scope

### A. First-run demo-data choice
- A persisted, **main-process-backed** demo preference (survives restarts; readable by the data
  provider that decides demo vs. real).
- A first-run prompt (shown once) asking the user whether to load demo data or start fresh.
- Reconciling the prompt with the existing onboarding tour so the tour no longer hard-asserts
  "you're seeing demo data."
- A way to change the choice later (Settings toggle).

### B. Honest empty targets
- Sample/"default" targets appear **only** in demo mode. In real mode with no authored targets, the
  targets list is empty.
- Empty-state UI on the Targets screen (and consistent messaging on Review) when there are no
  targets and demo mode is off.

### C. Current Overwatch rank model
- Add the **Champion** tier (divisions 1–5) as the top tier above Grandmaster.
- Keep divisions **1–5** (5 = lowest in a tier, 1 = highest), matching Overwatch.
- Present within-division progress as a **percentage 0–100%** instead of raw SR points, everywhere
  rank/progress is shown (sidebar account card, Overview KPI, match detail competitive section).
- Express the signed rank change (the "+/- elo") in the same percentage terms.

### D. Editable per-match manual tracking
- An entry point (primary: **match detail**, reached from the matches list) to (re-)open the manual
  tracking for any match — graded or not — pre-filled with its current self-rated target grades and
  mental flags, allowing changes and re-save.
- Extract the Review screen's grade/flag controls into a reusable component so Review and the new
  editor compose the same UI (no hand-rolled duplicate markup).

## Out-of-Scope (non-goals)

- **Reading real SR/rank from the game.** GEP does not expose SR; rank stays a heuristic derived
  from winrate. This spec only fixes how that heuristic is *modelled and displayed*, not its source.
  (Guardrail 1: GEP-only, no memory reading.)
- **Custom/user-defined manual tracking fields** (e.g., free-form per-match notes or new metrics).
  Item D is strictly about editing the *existing* self-rated target grades and mental flags.
- **Editing target definitions** — already supported via the Targets builder's Edit button; no
  change needed there.
- **Auto-graded (measured) target outcomes** remain auto-derived from match stats; the editor
  covers self-rated grades and mental flags. Measured targets may be shown read-only for context.
- **New rank icons/colors/art.** Rank stays text + progress bar; no new visual assets.
- **Notion export schema changes** for any of the above.
- **Migrating historical demo installs' data.** Existing real match history is untouched.

## Constraints

- **Guardrails (CLAUDE.md) hold:** GEP-only data (1); no secrets in git (2); `src/core/` stays pure
  & Electron-free (3); renderer stays CSP-friendly, one esbuild bundle, no inline script/eval/remote
  code (4); local-first, opt-in export (5).
- **Typed IPC end-to-end.** Any new state crossing the boundary (demo preference, per-match review
  payload) goes through `src/shared/contract/` with no `any`.
- **Pure core is unit-tested.** New/changed logic in `src/core/` (rank model, target gating) ships
  with vitest tests under `test/`. (Definition of Done.)
- **Composition-first renderer.** Views compose `components/`; charts stay dependency-free SVG.
- **Backward compatible persistence.** Config and stored records must load older files without
  crashing; new fields default sensibly on upgrade.
- **Definition of Done:** `npm test` green, `npm run typecheck` clean (main + renderer), core tests
  added, README/docs updated for user-visible changes.

## Acceptance Criteria

### A. First-run demo-data choice

- **A1 — Prompt on first run.**
  Given a fresh install where the demo preference has never been set,
  When the dashboard first loads,
  Then a modal appears asking whether to load demo data or start fresh, and no fabricated match data
  is presented as the user's own behind an unanswered prompt.

- **A2 — Choosing "demo".**
  Given the first-run prompt is shown,
  When the user chooses to load demo data,
  Then the preference persists as enabled, the sample season is shown, the "Demo data" badge is
  visible, and the prompt does not appear again on subsequent launches.

- **A3 — Choosing "start fresh".**
  Given the first-run prompt is shown,
  When the user chooses to start fresh,
  Then the preference persists as disabled, no sample matches are shown (empty states appear), the
  "Demo data" badge is hidden, and the prompt does not appear again.

- **A4 — Preference is main-backed and durable.**
  Given the user has made a demo choice,
  When the app is restarted,
  Then the same choice is in effect without re-prompting.

- **A5 — Reversible in Settings.**
  Given any state after the first-run choice,
  When the user toggles the demo-data setting in Settings,
  Then demo data turns on/off accordingly (subject to A6), persisted across restarts.

- **A6 — Demo yields to real data.**
  Given demo data is enabled,
  When the user has one or more real tracked/logged matches,
  Then real data is shown (not the sample season) and the demo badge is hidden — i.e. effective demo
  display = (preference enabled) AND (no real history).

- **A7 — Tour no longer hard-asserts demo.**
  Given the onboarding tour runs,
  When the user has chosen to start fresh,
  Then the tour does not claim "you're seeing demo data"; its messaging reflects the fresh-start
  state instead.

### B. Honest empty targets

- **B1 — No sample targets in real mode.**
  Given demo mode is off and the user has authored no targets,
  When the targets are computed,
  Then the result is an empty list (no sample/default targets). *(Pure-core, unit-tested.)*

- **B2 — Sample targets only in demo mode.**
  Given demo mode is on and the user has authored no targets,
  When the targets are computed,
  Then the sample target library is returned (current demo behavior preserved). *(Unit-tested.)*

- **B3 — Authored targets always win.**
  Given the user has authored one or more targets,
  When targets are computed in either mode,
  Then the authored targets are returned and no sample targets are appended. *(Unit-tested.)*

- **B4 — Targets empty state.**
  Given real mode with no authored targets,
  When the Targets screen renders,
  Then an empty state invites the user to create their first target (instead of showing fake ones),
  and the Review screen shows no fabricated active targets.

### C. Current Overwatch rank model

- **C1 — Champion tier exists.**
  Given a rating at the very top of the ladder,
  When the tier is resolved,
  Then it can resolve to "Champion" with a division 1–5. *(Unit-tested.)*

- **C2 — Divisions 1–5 ordering preserved.**
  Given any rating within a tier,
  When the division is resolved,
  Then it is an integer in 1–5 where 5 is the tier's lowest band and 1 is the highest. *(Unit-tested.)*

- **C3 — Progress as percentage.**
  Given a rating within a division,
  When progress within that division is computed,
  Then it is a percentage 0–100% (not raw SR points). *(Unit-tested.)*

- **C4 — Percentage displayed everywhere rank shows.**
  Given the account card, the Overview rank KPI, and the match-detail competitive section,
  When rank is displayed,
  Then within-division progress is shown as a 0–100% value and the signed change is shown in
  percentage terms; raw SR is no longer the primary progress readout.

- **C5 — Champion reachable end-to-end.**
  Given a top-of-ladder rank,
  When it is displayed,
  Then "Champion N" renders correctly in the UI (no clamping to Grandmaster).

### D. Editable per-match manual tracking

- **D1 — Edit entry point from a match.**
  Given any match in the matches list,
  When the user opens its detail,
  Then there is a clear affordance to edit that match's manual tracking (target grades + mental
  flags), whether or not the match was previously graded.

- **D2 — Pre-filled with current values.**
  Given a match that already has grades/flags,
  When the user opens the editor,
  Then the editor is pre-populated with the existing self-rated grades and mental flags.

- **D3 — Changes persist and recompute.**
  Given the user changes grades/flags and saves,
  When the save completes,
  Then the new values overwrite the prior review, and dependent views (targets hit-rate, mental
  stats) reflect the change on next refresh.

- **D4 — Shared control, no duplication.**
  Given the Review screen and the new match editor,
  When both render the grade/flag controls,
  Then they compose the same reusable component (no divergent hand-rolled markup).

- **D5 — Measured targets stay auto.**
  Given a measured (stat-based) target,
  When the match editor is used,
  Then its outcome is not manually overridden by the editor (self-rated grades and flags only);
  measured targets may appear read-only for context.

### Cross-cutting / Definition of Done

- **X1** `npm test` passes; **X2** `npm run typecheck` clean (main + renderer); **X3** new pure-core
  logic (rank model, target gating) has vitest tests; **X4** no `any` smuggled across IPC; **X5**
  README/docs updated for the demo choice, empty-targets behavior, rank model, and per-match editing;
  **X6** none of the five guardrails weakened.

## Resolved questions

Decisions taken autonomously (user waived the clarification gate; each is reversible on review):

1. **What does "update the manually tracked targets" mean (item D)?**
   Investigation showed target *definitions* are already editable (Targets builder → Edit). The real
   gap is that a match's **self-rated target grades and mental flags become read-only once graded**
   (match detail is read-only; Review shows only ungraded matches). **Decision:** item D = make those
   *per-match manual outcomes* editable after the fact, with the primary entry point on the **match
   detail** view (reached from the matches list). The backend `saveReview` already overwrites, so
   this is a UI + contract-surfacing change, not new persistence.

2. **How is the demo choice modelled and where does it live?**
   **Decision:** a persisted preference in the **main app config** (`config.local.json`) as a
   tri-state (`unset` | `on` | `off`), surfaced to the renderer through the typed IPC contract. It
   must be main-backed because `dataProvider` (main) decides demo vs. real. `unset` triggers the
   first-run prompt. **Effective demo display = (preference === on) AND (history is empty)** so demo
   gracefully yields to real data (A6). Reversible via a Settings toggle.

3. **Relationship between the new demo prompt and the existing onboarding tour.**
   **Decision:** the demo-data choice is a distinct prompt shown **before** the existing 7-step tour;
   the tour's demo-specific step becomes conditional on the chosen mode (A7). The tour's own
   `vantageOnboarded` localStorage flag is left as-is.

4. **How is rank progress represented now that it's a percentage?**
   **Decision:** keep an internal continuous scalar (winrate-derived, since GEP has no SR) for
   computation, but the **model exposes tier + division (1–5) + progress percent (0–100)**, and the
   UI shows the percentage, not raw SR. Champion is added as an 8th tier (1–5). Exact numeric
   thresholds are heuristic and finalized in the tech plan; acceptance is behavioral (Champion
   reachable, divisions 1–5, progress 0–100%).

5. **Default demo state before the user answers / on upgrade.**
   **Decision:** pre-choice (`unset`) behaves as demo-off (empty) behind the blocking prompt, so no
   fabricated data is ever presented as the user's own. Existing installs get `unset` on upgrade and
   see the prompt once; real match history is never touched.

## Open Questions

Proceeding on the stated default for each; flag on review if any should change.

- **O1 — Exact prompt/empty-state copy.** Default: concise, on-brand wording drafted during
  implementation (e.g., "Explore with demo data, or start fresh?"). Not blocking.
- **O2 — Matches-list quick action.** Primary edit entry point is match detail. Default: also add a
  lightweight edit affordance on the matches-list row only if it stays visually clean; otherwise
  detail-only. Not blocking.
- **O3 — Champion numeric band / ceiling.** Default: extend the tier table to 8 tiers × 5 divisions
  with a clean percentage mapping; precise SR band chosen in the tech plan since the source is a
  heuristic anyway.
- **O4 — Re-enabling demo after real data exists.** Per A6, toggling demo on has no visible effect
  once real history exists. Default: the Settings toggle still persists the preference but shows a
  note that it applies only with an empty history. Not blocking.
