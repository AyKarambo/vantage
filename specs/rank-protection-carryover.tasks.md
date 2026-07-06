# Tasks: Rank-protection SR carryover

**Slug:** `rank-protection-carryover` — plan: `specs/rank-protection-carryover.plan.md`.

- [x] **1. Fix `applyMatch` to preserve the negative rank-protection carry**
  - **Goal:** Compute `next = progressPct + delta` once and key both the Loss and
    Win/Draw branches off its sign, so a protected loss keeps its true negative value
    instead of clamping to `0`, and a following win/draw pays down that carry instead of
    applying its delta on top of a phantom `0`.
  - **Files:** `src/core/rank/engine.ts` (`applyMatch`); `src/core/rank/types.ts`
    (`RankPosition.progressPct`, `RankState.protected` doc comments).
  - **Check:** the exact code shape from the techplan compiles; no test run yet (test
    file isn't updated until task 2) — sanity-checked by reading the diff against the
    hand-trace in the plan.
  - **Size:** S

- [x] **2. Update rank-engine tests for the new carryover semantics**
  - **Goal:** Correct the two existing tests that assert the old (buggy) clamped-to-0
    values, and add tests for the reported scenario and its edge cases.
  - **Files:** `test/rank.test.ts`.
  - **Check:** `npm test` passes, including:
    - updated: `'a loss that would drop below 0%...'` now expects `progressPct: -10`.
    - updated: `'a win while protected...'` now expects `progressPct: 15` (`-10 + 25`).
    - updated: `'a draw counts as "not losing"...'` now expects `protected: true`,
      `progressPct: -10` (unchanged by a `0`-delta draw).
    - new: regression test with the reporter's exact numbers — anchor `Gold 3 / 1%`,
      `[loss(-20), win(26)]` → after the loss `progressPct === -19`, `protected === true`;
      after the win `progressPct === 7`, `protected === false`.
    - new: `[loss(-20), win(6)]` from `Gold 3 / 10%` stays `protected: true`,
      `progressPct: -4` (win insufficient to clear the debt).
    - all pre-existing promotion/demotion/re-anchor tests still pass unmodified.
  - **Size:** S

- [x] **3. Update IPC contract doc comments**
  - **Goal:** Describe the negative-during-protection carry in the two contract DTOs
    that surface it, so future readers don't assume `progressPct` is always `0..100`.
  - **Files:** `src/shared/contract/accounts.ts` (`RankSummary.protected`),
    `src/shared/contract/matchDetail.ts` (`competitive.progressPct`).
  - **Check:** comment-only diff; `npm run typecheck` stays clean (no shape change).
  - **Size:** S

- [x] **4. Full verification pass**
  - **Goal:** Confirm the Definition of Done and that no renderer file needs a change.
  - **Files:** none (verification only); browser preview harness driven manually.
  - **Check:** `npm test` and `npm run typecheck` both clean; via `npm run preview`,
    simulate a protected/negative rank (anchor a role, replay a loss that goes negative
    in the preview harness) and confirm the Overview KPI / Settings account row / Match
    detail competitive card show the negative percentage with an empty (not broken)
    progress bar; screenshot for the PR description.
  - **Size:** S

## Consistency check (spec ↔ plan ↔ tasks)

Every acceptance criterion in `specs/rank-protection-carryover.spec.md` maps to a task:

| Acceptance criterion | Task |
| --- | --- |
| Protected loss keeps the true negative carry (not `0`) | 1, 2 |
| Win pays down the carry (`-19 + 26 = 7`) | 1, 2 |
| Win insufficient to clear the debt stays protected | 1, 2 |
| Draw doesn't falsely clear protection | 1, 2 |
| Second loss while protected still demotes (unaffected) | 1 (no behavior change), 2 (existing tests re-verified) |
| Unprotected play unaffected | 1 (no behavior change), 2 (existing tests re-verified) |
| Renderer shows the true negative % with no error, no renderer code change | 4 |

No task traces to zero criteria (no scope creep); no criterion is left without a task.
