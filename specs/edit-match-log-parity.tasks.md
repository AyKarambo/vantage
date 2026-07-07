---
slug: edit-match-log-parity
status: done
created: 2026-07-07
updated: 2026-07-07
---

# Tasks: Edit-match ↔ Log-match parity (and per-match rank history)

Ordered dependencies-first: pure core → main edge → shared renderer pieces → editor wiring
→ display polish → docs. Each is individually reviewable.

- [x] **1. Rank scalar (`rankToPoints`/`pointsToRank`).**
  - **Goal:** a monotonic scalar for a ladder position and its clamped inverse.
  - **Files:** `src/core/rank/scalar.ts` (new), `src/core/rank/index.ts`, `test/rankScalar.test.ts` (new).
  - **Check:** round-trip + boundary tests pass; scalar climbs agree with `applyGain` on the existing promotion cases.
  - **Size:** S

- [x] **2. Backward reconstruction + back-compute (`rankAfterMatch`, `srDeltaForSetRank`).**
  - **Goal:** rank held after any match (forward replay at/after the anchor, scalar backward before it) and the SR % derived from an entered absolute rank.
  - **Files:** `src/core/rank/reconstruct.ts` (new), `src/core/rank/index.ts`, `test/rankReconstruct.test.ts` (new).
  - **Check:** forward equals `currentRank(…,untilTs)`; a pre-anchor match reconstructs its then-rank; missing srDelta → 0 (no throw); no anchor → null; `srDeltaForSetRank` derives the exact delta forward and via reconstruction backward.
  - **Size:** M

- [x] **3. `MatchEditInput.setRank` + main back-compute/bootstrap.**
  - **Goal:** editor can send an absolute "rank after this match"; main derives & stores `srDelta`, or bootstraps the anchor when none exists.
  - **Files:** `src/shared/contract/inputs.ts`, `src/main/dataProvider.ts`.
  - **Check:** typecheck clean; `setRank` on an anchored comp match writes a derived `srDelta` and leaves the anchor; on an un-anchored one creates the anchor at the match timestamp with no srDelta; non-comp ignores it. (Covered by a `dataProvider` unit test if one exists for editMatch, else exercised in preview.)
  - **Size:** M

- [x] **4. Shared wheel-nudge helper.**
  - **Goal:** one `attachWheelNudge` used by both surfaces.
  - **Files:** `renderer/src/app/wheelStepper.ts`, `renderer/src/app/log-match.ts` (drop local copy, import shared).
  - **Check:** typecheck clean; log-match wheel behaviour unchanged in preview.
  - **Size:** S

- [x] **5. Shared result chooser (colour-coded W/L/D).**
  - **Goal:** extract `log-match`'s `.choice` W/L/D control into a shared component.
  - **Files:** `renderer/src/components/resultChooser.ts` (new), `renderer/src/app/log-match.ts` (use it, keys retained).
  - **Check:** typecheck clean; log-match result row visually identical in preview.
  - **Size:** S

- [x] **6. Shared three-state comms switch.**
  - **Goal:** one `commsSwitch({get,set})` component; used by log-match and (via `mentalFlagsRow`) the editor + Review.
  - **Files:** `renderer/src/components/commsSwitch.ts` (new), `renderer/src/app/log-match.ts` (use it, drop inline), `renderer/src/components/reviewControls.ts` (`mentalFlagsRow` swaps the binary chip for the switch).
  - **Check:** typecheck clean; Positive/Banter/Abusive selectable and clearable in log-match, editor, and Review in preview; legacy `positiveComms` shows Positive; comms round-trip test passes.
  - **Size:** M

- [x] **7. Editor SR block — Change ↔ Set-current toggle.**
  - **Goal:** the editor gains the toggle, wheel-nudged fields, prefill from `d.competitive`, and sends `setRank` in set-current mode.
  - **Files:** `renderer/src/views/matchDetail.ts`.
  - **Check:** typecheck clean; in preview, set-current prefills the current reconstructed rank, back-computes SR % on save, and change-mode still sends `srDelta`; both fields wheel-nudge.
  - **Size:** M

- [x] **8. Editor result control → shared chooser; comms via shared row.**
  - **Goal:** replace the grey segmented result with the colour-coded chooser (editable matches) and route comms through the updated `mentalFlagsRow`.
  - **Files:** `renderer/src/views/matchDetail.ts`.
  - **Check:** typecheck clean; preview shows colour-coded W/L/D for manual matches (locked matches unchanged) and the comms switch inside the feel section.
  - **Size:** S

- [x] **9. Per-match rank history + `reconstructed` note.**
  - **Goal:** `competitiveOf` shows the rank after each specific match (backward when pre-anchor) with a `reconstructed` note.
  - **Files:** `src/core/matchDetail.ts`, `src/shared/contract/matchDetail.ts`, `test/matchDetail.test.ts`.
  - **Check:** pre-anchor comp match → `note:'reconstructed'` + reconstructed position; post-anchor → `'calculated'`; no-anchor → `'estimate'`; tests pass.
  - **Size:** M

- [x] **10. Always-visible SR % + note label in the card.**
  - **Goal:** the Competitive-progress card shows a per-match `srDelta` regardless of note and labels the `reconstructed` note.
  - **Files:** `renderer/src/views/matchDetail.ts` (`competitiveSection`, `NOTE_LABEL`/`NOTE_SUB`).
  - **Check:** typecheck clean; preview shows "±N% this match" for a match with a set SR % even without an anchor, and a "Reconstructed" pill on pre-anchor matches.
  - **Size:** S

- [x] **11. Docs.**
  - **Goal:** README reflects the editor's Set-current rank, three-state comms, and per-match rank note.
  - **Files:** `README.md`.
  - **Check:** README mentions the new editor capabilities; DoD doc item satisfied.
  - **Size:** S

- [x] **12. Verify — full suite + typecheck + preview walkthrough.**
  - **Goal:** DoD green end-to-end.
  - **Files:** —
  - **Check:** `npm test` + `npm run typecheck` clean; preview walkthrough of every AC; adversarial review pass applied.
  - **Size:** S

## Consistency check (spec AC → task)

| Spec AC group | Task(s) |
|---|---|
| Wheel-nudge parity (SR + Set-current %) | 4, 7 |
| Set-current rank → back-computed SR % (+ prefill, +bootstrap, +toggle back) | 2, 3, 7 |
| Comms three-state switch (editor + Review, clear, legacy, persist banter/abusive) | 6, 8 |
| Win/Loss/Draw styling (editable colour-coded; locked read-only) | 5, 8 |
| Competitive progress — per-match rank history (backward, forward, no-anchor, missing-δ) | 2, 9 |
| SR % always visible (+ estimate fallback) | 10 |
| Regression (`npm test`/typecheck; log-match unchanged) | 1–12 |

- **No orphan ACs:** every acceptance-criterion group maps to ≥1 task.
- **No scope creep:** every task traces to an AC group (task 11 docs + task 12 verify are DoD
  items from the spec's Definition of Done / Constraints).
- **Notes:** `review.ts` needs no task — it inherits the comms switch through `mentalFlagsRow`
  (task 6). `attachStepper` (targets) is deliberately not merged (different semantics).
