---
slug: rank-delta-and-protection-display
status: planned
updated: 2026-07-07
---

# Tasks: Rank delta & protection display

From `specs/rank-delta-and-protection-display.plan.md`. Ordered so that **every task leaves
`npm test` + `npm run typecheck` green** — the `needsReanchor` field is retired only in Task 3,
after the engine (Task 1) has already stopped setting it, so nothing compiles against a half-removed
field mid-sequence.

Note: Task 1 already delivers the **user-visible** Area B behavior — once the engine never sets
`needsReanchor: true`, the demoted rank flows through the existing renderer/core branches as a normal
tracked rank (the dead-end code becomes unreachable). Task 3 is the structural cleanup that *deletes*
that now-dead code and lets the typechecker prove every surface was caught.

---

- [x] **Task 1 — Engine: symmetric ladder carry + retire the freeze**
  - **Goal:** Replace the promotion/demotion math with one shared `ladderPoints`/`positionFromPoints`
    carry; the second protected dip now carries the buffer into the lower division and keeps tracking
    (no freeze). First-dip hold, pay-down, and the non-protected floor branch stay. `needsReanchor` is
    left on `RankState` but is now **always `false`** (removed in Task 3).
  - **Files:** `src/core/rank/engine.ts` (add `ladderPoints`/`positionFromPoints`/`MAX_POINTS`,
    rewrite `applyMatch`, delete `applyGain`/`demoteOne`), `src/core/rank/index.ts` (export
    `ladderPoints`), `test/rank.test.ts` (update the 6 demotion/freeze tests to the carry landings;
    add: `ladderPoints` unit block, carry-to-Gold4·82, Gold3·−19 anchor+loss→Gold4·76, promote-out-of-
    protection Gold3·−8+130→Gold2·22, multi-division cascade, large-overshoot floor Bronze5·0,
    win-then-loss symmetry round-trip).
  - **Check:** `npm test` + `npm run typecheck` green; **zero** `needsReanchor).toBe(true)` remain in
    `test/`; a match logged after a demotion moves the rank (not frozen); cap Champion 1·100 / floor
    Bronze 5·0 hold; the non-protected Win/Draw floor branch does **not** demote.
  - **Covers ACs:** B-i (regression), B-ii/iii/iv/v/vii (engine side), B-vi & B-viii (regression + new).
  - **Size:** M

- [ ] **Task 2 — Area A: anchor→now rank delta on the Overview KPI**
  - **Goal:** `primaryRank` gains a signed `delta` (ladder %-points, anchor→now, full history,
    filter-independent); the Overview Rank KPI shows a real ▴/▾/neutral for anchored ranks instead of
    the hard-coded ▴, keeping the in-division %.
  - **Files:** `src/shared/contract/dashboard.ts` (add `primaryRank.delta: number`),
    `src/core/dashboardData.ts` (`primaryRankOf` computes `ladderPoints(rank) − ladderPoints(anchor)`),
    `renderer/src/views/overview.ts` (`rankKpi`: `dir` from `r.delta` sign, glyph prefix, neutral when
    `delta === 0`), `test/vantageCore.test.ts` (delta up / down / neutral-when-no-matches /
    identical-across-`days` filters / multi-tier-climb > 100).
  - **Check:** `npm test` + typecheck green; anchored KPI shows ▴ when above the set rank, ▾ below,
    neutral when unchanged; `delta` identical across `days: 7 | 30 | 'all'`; no-anchor heuristic KPI
    unchanged; verify visually via `npm run preview`.
  - **Covers ACs:** A-i, A-ii, A-iii, A-iv, A-v, A-vi.
  - **Size:** M

- [ ] **Task 3 — Remove `needsReanchor` entirely + delete the dead-end UI (B5)**
  - **Goal:** Drop the now-always-false field from `RankState` and all three contract DTOs, and delete
    every "set your new rank / set %" branch. The typechecker enforces that no surface is missed.
  - **Files:** `src/core/rank/types.ts`; `src/core/rank/engine.ts` (drop the field from literals);
    `src/shared/contract/{dashboard,accounts,matchDetail}.ts` (field + docs); producers
    `src/core/dashboardData.ts:267`, `src/core/matchDetail.ts:120,122`, `src/main/dataProvider.ts:415`;
    renderer `renderer/src/views/overview.ts:114`, `renderer/src/app/shell.ts:601`,
    `renderer/src/views/settings/accounts.ts:72,112`, `renderer/src/views/matchDetail.ts:224`,
    `renderer/src/app/log-match.ts:366`; `renderer/preview/preview.ts:125`.
  - **Check:** `npm run typecheck` clean (compiler proves all reads removed); `grep needsReanchor`
    over `src/` + `renderer/src/` returns nothing; `npm test` green; `npm run preview` shows a demoted
    rank rendering as a normal chip/KPI/pill/bar with no dead-end text.
  - **Covers ACs:** B-ix, plus the spec Open-Question resolution (remove, not keep-always-false).
  - **Size:** M

- [ ] **Task 4 — Close the match-detail calculated-path test gap**
  - **Goal:** `matchDetail.test.ts` currently only exercises the `'estimate'` fallback; add
    `'calculated'`-branch coverage proving the post-demotion contract.
  - **Files:** `test/matchDetail.test.ts` (calculated w/ anchor: plain unprotected; first-dip protected
    → defined negative `progressPct`; post-demotion → `progressPct` a defined **non-negative** number
    and no `needsReanchor`).
  - **Check:** new tests green; asserts `competitive.progressPct` is never `undefined` on a demoted
    calculated match.
  - **Covers ACs:** B-ii / B-iv at the contract level (the "shown as a normal tracked rank" promise).
  - **Size:** S

- [ ] **Task 5 — Docs + preview verification**
  - **Goal:** Update any user-facing wording about rank / rank protection and confirm the two behaviors
    end-to-end in the browser preview.
  - **Files:** `README.md` (only if it describes rank/protection behavior — grep first; otherwise
    no-op), plus a `npm run preview` walkthrough of: anchored KPI ▴/▾; a logged loss→loss demotion
    showing the new Gold-4 tracked rank across Overview / sidebar / Accounts / match detail.
  - **Check:** README accurate (or confirmed nothing to change); preview shows both behaviors; final
    `npm test` + `npm run typecheck` green (Definition of Done).
  - **Covers ACs:** cross-cutting DoD (docs updated when user-visible behavior changes) + B-ix visual
    confirmation.
  - **Size:** S

---

## Consistency check (spec ACs → tasks)

| Spec acceptance criterion | Task(s) |
|---|---|
| A — climb → ▴ | 2 |
| A — drop → ▾ | 2 |
| A — no matches since anchor → neutral, still shows % | 2 |
| A — date filter doesn't move the delta | 2 |
| A — multi-division/tier climb → ▴ | 2 |
| A — no anchor → heuristic delta unchanged | 2 |
| B — first dip: Gold 3 held, 🛡, negative buffer (unchanged) | 1 |
| B — second dip: Gold 4·82%, tracked, no dead-end | 1 (engine) · 3 (UI) · 4 (contract test) |
| B — match after demotion moves the rank | 1 |
| B — directly-set protected (Gold 3·−19) + loss → Gold 4·76 tracked | 1 · 4 |
| B — Gold 3·92 + Win → Gold 2, later loss moves down | 1 |
| B — Gold 1·90 + Win → Platinum 5 | 1 |
| B — Gold 3·−8 + Win 130 → Gold 2·22 (out of protection) | 1 |
| B — cap Champion 1·100 / floor Bronze 5·0 | 1 |
| B — demoted rank consistent across KPI, sidebar, Accounts pill, no dead-end wording | 3 |

**Gaps (AC with no task):** none.
**Scope creep (task tracing to no AC):** Task 5's README update traces to the CLAUDE.md Definition
of Done ("docs updated when user-visible behavior changes"), not a numbered AC — intentional, kept
minimal (a grep-gated no-op if the README says nothing about rank).
