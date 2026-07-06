---
slug: rank-protection-carryover
status: done
updated: 2026-07-06
---

# Spec: Rank-protection SR carryover

**Slug:** `rank-protection-carryover`
**Reported by:** user, 2026-07-06

## Intent (WHAT & WHY)

Overwatch 2's rank-protection buffer lets a division-dropping loss go **negative**
instead of demoting (the in-game bar can show e.g. `-19%`). That negative value is a
debt: the next match's SR delta is added *on top of it*, so a subsequent `+26%` win
should land at `26 - 19 = 7%`.

Vantage's calculated-rank engine throws the debt away. The first protected loss clamps
the stored position to `0%` instead of keeping the true negative value
(`src/core/rank/engine.ts:76`), and the following win/draw always applies its delta on
top of that clamped `0` while unconditionally clearing the protection flag
(`src/core/rank/engine.ts:80`). The user's repro: shown `-19%` in-game while protected,
won the next match (`+26%`), and Vantage reported `26%` instead of `7%` — the debt
silently vanished. This makes every rank displayed after a protected loss wrong until
the user manually re-anchors, undermining the app's core "trust the calculated rank"
value proposition.

## In-Scope / Out-of-Scope

**In scope:**
- `src/core/rank/engine.ts` — `applyMatch`: preserve the true (negative) carry while
  `protected` is true, and only clear protection once the running total is actually
  `> 0`, for **both** the Loss and Win/Draw branches.
- `src/core/rank/types.ts` — update the `RankPosition.progressPct` / `RankState.protected`
  doc comments to describe the negative-during-protection carry (no shape change:
  `progressPct` is already `number`).
- `src/shared/contract/accounts.ts` (`RankSummary.protected` doc) and
  `src/shared/contract/matchDetail.ts` (`competitive.progressPct` doc) — comment-only
  updates to match; both fields are already typed as plain `number`/`number?`, so no
  contract shape change.
- `test/rank.test.ts` — update the two existing tests that currently assert the buggy
  behavior, and add tests reproducing the exact reported scenario and its edge cases
  (see Acceptance Criteria).

**Out of scope:**
- Any renderer change. `statBar` (`renderer/src/components/primitives/stats.ts:39`)
  already clamps its fill fraction to `[0,1]`, so a negative `progressPct` renders an
  empty bar with no code change; the existing `${Math.round(progressPct)}%` labels
  (Overview, Settings, Match detail, shell header) will simply start showing the
  accurate negative number, matching the in-game display.
- The Settings manual rank-anchor editor's prefill while protected — pre-existing,
  unrelated edge case; not part of the reported defect.
- `applyGain` / `demoteOne` (promotion/demotion carry math) and `stateFromAnchor`'s
  0–100 clamp on a *manually entered* anchor — anchors are a one-time real-rank
  snapshot the user types in, never a mid-protection computed value, so they stay
  clamped.
- `src/core/progression.ts` (the separate winrate-heuristic "estimate" fallback used
  before an anchor exists) — unrelated system.
- Accuracy of the `srDelta` the GEP feed reports — assumed correct (Guardrail 1: GEP
  only, no alternate data source).

## Constraints

- `src/core/` stays pure/Electron-free (Guardrail 3) — the entire fix and its tests
  live there.
- No IPC contract shape changes — doc comments only.
- Definition of Done per `CLAUDE.md`: `npm test` and `npm run typecheck` clean; the
  changed pure logic ships with unit tests.

## Acceptance Criteria

- **Given** an unprotected position at `10%` in a division, **when** a loss with
  `srDelta -20` arrives (would go below `0%`), **then** the resulting state has
  `progressPct -10` (the true negative carry, not `0`), `protected: true`,
  `needsReanchor: false`.
- **Given** a protected position holding a negative carry of `-19%`, **when** the next
  match is a win with `srDelta +26`, **then** the resulting `progressPct` is `7`
  (`-19 + 26`), not `26`, and `protected` clears to `false` (the total is now positive).
- **Given** a protected position holding a negative carry of `-10%`, **when** the next
  match is a win with `srDelta +6` (not enough to clear the debt: total `-4`), **then**
  the state remains `protected: true` with `progressPct -4` — it does not fabricate a
  positive climb or falsely clear protection.
- **Given** a protected position holding a negative carry, **when** the next match is a
  **draw** with `srDelta 0` (or any delta that leaves the total `<= 0`), **then**
  protection is **not** falsely cleared — a draw is treated the same as a win for
  paying down the carry (add the delta, then check the sign), rather than
  unconditionally clearing protection regardless of the resulting sign.
- **Given** a protected position holding any negative carry, **when** a further loss
  keeps the running total `<= 0`, **then** the division demotes exactly as today (one
  division down, `needsReanchor: true`, `protected: false`) — the demotion trigger and
  the promotion/demotion clamp math are unaffected by this fix.
- **Given** an unprotected position, **when** any win, loss, or draw is applied, **then**
  behavior is unchanged from today — `progressPct` only goes negative while `protected`
  is (or becomes) true.
- **Given** a computed rank state with a negative `progressPct` (protected), **when** it
  reaches the Overview KPI, Settings account list, shell header, or Match-detail
  competitive card, **then** each shows the true negative percentage (e.g.
  `-19% in division`) and the division progress bar renders as empty, with no runtime
  error — verified without changing those renderer files.

## Resolved Questions

*(Answered autonomously per this task's "follow SDD autonomously" instruction — no
interactive clarification round. Flagged below for veto at review.)*

1. **Root cause?** Confirmed by reading `src/core/rank/engine.ts`'s `applyMatch`: the
   first protected loss clamps `progressPct` to `0` (discarding the negative carry:
   `src/core/rank/engine.ts:76`), and the Win/Draw branch always calls
   `applyGain(state, state.progressPct + delta)` with `protected: false` unconditionally
   (`engine.ts:80`), so it both loses the carry and force-clears protection regardless of
   the resulting sign. Fix: keep the true negative value in `progressPct` while
   protected, and only clear `protected` once the running total is `> 0`.
2. **Should a draw that doesn't fully offset the carry keep `protected: true`?** Decided
   yes — a draw's near-zero delta cannot logically erase a nonzero negative carry, and
   the current "a draw clears protection" test (`test/rank.test.ts:73-77`) only passes
   today because of the same bug (it summed to the same clamped `0` the buggy Loss
   branch already produced). Treating Win and Draw identically (apply delta, then check
   sign) is the direct symptom fix, not a scope add — but it changes that test's
   asserted outcome, so it's called out for veto: if unwanted, Draw can instead keep a
   force-clear special case while only Win pays down the carry.
3. **Show the negative percentage as-is, or floor the display at 0%?** Decided: show as
   returned (e.g. `-19%`), matching what the user says the real client shows, and
   requiring no renderer changes — `statBar`'s fill already clamps to `[0,1]`
   (`renderer/src/components/primitives/stats.ts:39`) so a negative `frac` safely
   renders an empty bar today.
4. **Does this affect anchor bounds (`stateFromAnchor`'s 0–100 clamp)?** No — a rank
   anchor is the user's one-time "this is my rank right now" reading entered in
   Settings, never a mid-protection computed value, so it stays clamped to `[0, 100]`.
   Only the *computed* `RankState.progressPct` produced while replaying logged matches
   can go negative, and only while `protected` is true.

## Open Questions

- None blocking. The exact in-game magnitude rules for a *second* consecutive protected
  loss (does the demotion trigger depend on the debt's size, or purely on "still `<= 0`
  while already protected"?) aren't re-litigated here — this fix leaves the existing
  "second loss while protected demotes" rule untouched, which already matches the user's
  description and isn't part of the reported defect.
