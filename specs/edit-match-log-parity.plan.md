---
slug: edit-match-log-parity
status: done
created: 2026-07-07
updated: 2026-07-07
---

# Techplan: Edit-match ↔ Log-match parity (and per-match rank history)

> Codebase research was done inline against the actual files (rank engine + timeline,
> `matchDetail` core + renderer, `log-match.ts`, `reviewControls.ts`, `review.ts`,
> `dataProvider.editMatch`, `rankAnchors` store, the contract inputs/DTOs, and
> `components.css`). Signatures below are quoted from those files.

## Architecture & Approach

Four independent tracks, ordered so pure core lands first (fully testable), then the main
edge, then the renderer parity work, then display polish.

### A. Pure core — rank scalar + backward reconstruction (`src/core/rank/`)

The rank engine only replays **forward** from a single `RankAnchor` (`setAt`), so any match
older than the latest anchor resolves to the anchor position itself. We add a **monotonic
scalar** representation of a ladder position and use it to reconstruct backward.

- **`src/core/rank/scalar.ts` (new)**
  - `rankToPoints(pos: RankPosition): number` — `tierIdx*500 + (5 − division)*100 +
    progressPct`. 100 pts/division, 500 pts/tier; Bronze 5 0% = 0 … Champion 1 100% = 4000.
    `progressPct` may be negative (protection carry) and simply lowers the scalar.
  - `pointsToRank(points): RankPosition` — inverse, clamped to `[0, 4000]`, with the
    ceiling (`≥4000`) special-cased to Champion 1 / 100%. Mixed-radix decode:
    `divIndexGlobal = floor(p/100)`, `tierIdx = floor(divIndexGlobal/5)`,
    `division = 5 − (divIndexGlobal % 5)`, `progressPct = p − divIndexGlobal*100`.
  - **Agreement invariant (tested):** for non-protection climbs, `pointsToRank(rankToPoints(x)
    + Σδ)` equals the forward engine's `applyGain` result (verified against the existing
    promotion cases: Gold 3 80 +30 → Gold 2 10; Gold 1 90 +20 → Plat 5 10).

- **`src/core/rank/reconstruct.ts` (new)**
  - `rankAfterMatch(games, anchors, account, role, matchTs): RankState | null` — the rank
    held **after** the match at `matchTs`:
    - `matchTs >= anchor.setAt` → forward: delegate to `currentRank(games, anchors, …,
      matchTs)` (protection-aware, unchanged behaviour).
    - `matchTs < anchor.setAt` → backward: `pointsToRank(rankToPoints(anchor) − Σδ)` where
      `Σδ` sums `srDelta ?? 0` over comp matches for the (account, role) with
      `matchTs < ts <= setAt`. Returns `{…, protected:false, needsReanchor:false}`
      (protection flattened — documented best-effort).
    - no anchor → `null`.
  - `srDeltaForSetRank(games, anchors, account, role, matchTs, enteredAfter: RankPosition):
    number` — `round(rankToPoints(enteredAfter) − rankToPoints(rankBefore))`, where
    `rankBefore` = `rankAfterMatch` at the **previous** comp match's timestamp (or, when the
    target is the first comp match: `stateFromAnchor(anchor)` for the forward case, or the
    scalar reconstruction to just-before-target for the backward case). Pure; the caller
    guarantees an anchor exists (the no-anchor path bootstraps instead — see B).
  - A small internal `sumSrDelta(games, account, role, {afterTs?, fromTs?, untilTs})` filter
    helper keeps the boundary semantics explicit and testable.

- **`src/core/rank/index.ts`** — export `rankToPoints`, `pointsToRank`, `rankAfterMatch`,
  `srDeltaForSetRank`.

### B. Main edge — back-compute on save (`src/main/dataProvider.ts`, contract)

- **Contract:** add to `MatchEditInput` (`src/shared/contract/inputs.ts`):
  ```ts
  /** Absolute rank held AFTER this match; main back-computes srDelta from it
   *  (editor "Set current rank" mode). Ignored for non-competitive matches. */
  setRank?: { tier: string; division: number; progressPct: number };
  ```
- **`dataProvider.editMatch`:** after building `patch`, when `input.setRank` is present and
  the match is competitive (`isCompetitive(game.gameType)`):
  - anchor exists (`deps.rankAnchors.get(account, role)`) → `patch.srDelta =
    srDeltaForSetRank(deps.history.all(), deps.rankAnchors.map(), account, role,
    game.timestamp, input.setRank)`.
  - no anchor → **bootstrap**: `deps.rankAnchors.set({ account, role, …setRank,
    setAt: game.timestamp })`; do **not** set `patch.srDelta` (nothing to diff against).
  - `input.setRank` takes precedence over a raw `input.srDelta` (the renderer sends one or
    the other). `deps.rankAnchors` already exposes `get`/`map`/`set` in `DataProviderDeps`.
- No change to `provider.editMatch`'s `void` return or the IPC channel.

### C. Renderer parity (`renderer/src/`)

- **Shared wheel helper:** add `attachWheelNudge(el, get, set)` (the ±1, no-min-clamp SR
  variant, copied verbatim from `log-match.ts`) to `renderer/src/app/wheelStepper.ts`
  (already the home of `attachStepper`). `log-match.ts` imports it and drops its local copy;
  the editor imports it. (`attachStepper`, the targets step-based variant, is left as-is —
  different semantics, out of scope to merge.)
- **Shared result chooser:** new `renderer/src/components/resultChooser.ts` exporting the
  colour-coded `.choice` W/L/D control (lifted from `log-match.ts`'s local `choiceRow`, keys
  optional). `log-match.ts` uses it (with W/L/D key hints); the editor uses it (no keys) in
  place of the grey `segmented(RESULT_OPTS)`.
- **Shared comms switch:** new `renderer/src/components/commsSwitch.ts` exporting
  `commsSwitch({ get: () => CommsTone | null, set: (t: CommsTone | null) => void })`,
  rendering the exact `segmented segmented--fill comms-switch` markup + `comms-opt--{pos,
  banter,abusive}` classes the CSS already styles. Clicking the active option clears it.
  - `log-match.ts`: `commsSwitch({ get: () => state.comms, set: (t) => { state.comms = t } })`
    (drops its inline `commsSwitch`/`COMMS_OPTIONS`).
  - `reviewControls.ts` `mentalFlagsRow(flags)`: keep the binary flag chips, **replace**
    `goodCommsChip` with the shared switch: `get: () => commsTone(flags) ?? null`,
    `set: (t) => { if (t) flags.comms = t; else delete flags.comms; delete
    flags.positiveComms; }`. Because `mentalFlagsRow` is shared, both the **editor** and the
    **Review** card gain the three-state switch (spec answer 3). Render the chips row and the
    switch stacked (small "Comms" label), so the wrap layout stays clean.
- **Editor SR block (`matchDetail.ts` `openMatchEditor`):** replace the single `srInput`
  with a Change↔Set-current toggle mirroring `log-match`:
  - local editor state: `srMode: 'change' | 'set-current'`, `srDelta`, and
    `anchorTier/anchorDivision/anchorPct` seeded from `d.competitive` (tier/division/
    progressPct) or Gold/3/'' when absent.
  - Change mode → the existing `srInput` + `attachWheelNudge`.
  - Set-current mode → `select(TIERS…)` + `select(DIVISIONS…)` + `numInput(pct)` +
    `attachWheelNudge`, a `segmented` toggle above (reuse the `segmented` primitive already
    imported), and a hint line.
  - `save()`: `srMode === 'set-current' && isComp` → send `setRank: { tier, division,
    progressPct: Number(anchorPct)||0 }` (omit `srDelta`); else send `srDelta: srDelta ??
    null` exactly as today.

### D. Display polish (`matchDetail.ts` renderer + core `matchDetail.ts` + contract)

- **Per-match rank history:** `competitiveOf` (core `matchDetail.ts`) calls the new
  `rankAfterMatch(all, anchors, account, role, game.timestamp)` instead of
  `currentRank(…, game.timestamp)`. When the match predates the anchor (backward branch),
  tag `note: 'reconstructed'`; forward stays `'calculated'`; no-anchor stays `'estimate'`.
- **Contract:** widen the `competitive.note` union to add `'reconstructed'`
  (`src/shared/contract/matchDetail.ts`).
- **Renderer `competitiveSection`:**
  - `NOTE_LABEL`/`NOTE_SUB` gain a `reconstructed` entry ("Reconstructed" / "reconstructed
    backward from your rank anchor — best-effort").
  - **Always show a logged SR %:** change the delta line so `srDelta != null` shows
    "±N% this match" **regardless of note**; only fall back to `c.delta` ("over the range")
    when there is no per-match `srDelta`.

## Affected Files/Modules

**Created**
- `src/core/rank/scalar.ts`, `src/core/rank/reconstruct.ts`
- `renderer/src/components/resultChooser.ts`, `renderer/src/components/commsSwitch.ts`
- `test/rankScalar.test.ts`, `test/rankReconstruct.test.ts` (+ cases into `test/matchDetail.test.ts`, `test/comms.test.ts` as needed)

**Changed**
- `src/core/rank/index.ts` (exports)
- `src/core/matchDetail.ts` (`competitiveOf` → `rankAfterMatch`, note tagging)
- `src/shared/contract/inputs.ts` (`MatchEditInput.setRank`), `src/shared/contract/matchDetail.ts` (note union)
- `src/main/dataProvider.ts` (`editMatch` back-compute / bootstrap)
- `renderer/src/app/wheelStepper.ts` (add `attachWheelNudge`)
- `renderer/src/app/log-match.ts` (use shared wheel/result/comms; drop local copies)
- `renderer/src/components/reviewControls.ts` (`mentalFlagsRow` → shared comms switch)
- `renderer/src/views/matchDetail.ts` (editor SR toggle + result chooser + comms via shared row; `competitiveSection` display)
- `README.md` (editor: Set-current rank, comms, per-match rank note)

**Untouched:** `wheelStepper.ts`'s `attachStepper`; the forward rank engine (`engine.ts`);
`review.ts` (inherits the comms switch through `mentalFlagsRow`, no edit needed); SQLite.

## Data Model / Interfaces

- `MatchEditInput.setRank?: { tier; division; progressPct }` — new, optional; competitive-only.
- `MatchDetail.competitive.note` — `'estimate' | 'reported' | 'calculated' | 'reconstructed'`.
- New pure exports: `rankToPoints`, `pointsToRank`, `rankAfterMatch`, `srDeltaForSetRank`.
- No `GameRecord`/SQLite change; back-compute writes the existing `srDelta`; comms writes
  `mental.comms`.

## Test Strategy

- **`rankScalar.test.ts`:** `rankToPoints`/`pointsToRank` round-trip; boundaries (Bronze 5
  0%, Bronze 1 0%, Silver 5 0%, Champion 1 100% ceiling); agreement with `applyGain` climbs.
- **`rankReconstruct.test.ts`:**
  - `rankAfterMatch` forward equals `currentRank(…, untilTs)` (unchanged path).
  - Backward: anchor Gold 3 40 @ setAt=100 with later wins; a match before setAt shows the
    reconstructed *then*-rank, not the anchor rank. Missing-`srDelta` intervening match →
    treated as 0 (drift, no throw). No anchor → `null`.
  - `srDeltaForSetRank`: forward case (target after anchor) derives the exact delta from
    two ranks; backward case derives from reconstruction; first-comp-match base case.
- **`matchDetail.test.ts`:** a pre-anchor comp match yields `note:'reconstructed'` with the
  reconstructed position; a post-anchor match stays `'calculated'`; no-anchor `'estimate'`.
- **`comms.test.ts`:** the shared switch's get/set maps legacy `positiveComms`/`comms`
  correctly and clears on re-click (pure get/set logic tested directly).
- **Manual/preview:** drive the browser harness — open a match, confirm wheel nudge, the
  Set-current toggle prefill + back-computed SR %, the comms switch (banter/abusive persist),
  colour-coded W/L/D, and the reconstructed rank + always-visible SR % on the card.

## Risks & Alternatives

- **Backward reconstruction is lossy for protection/`needsReanchor`.** By design (single
  anchor). Mitigation: scalar flattening + explicit "reconstructed / best-effort" label;
  spec answer 2 accepted this.
- **Set-current round-trip for a pre-anchor match** is pinned by the anchor + downstream
  deltas, so the displayed after-rank may differ from the entered value (the delta lands on
  *rank-before*, which is what we store). Documented best-effort; the common case (editing a
  recent/at-anchor match) is exact. Alternative (multi-anchor timeline) is explicitly
  out-of-scope.
- **`mentalFlagsRow` now affects Review too.** Intended (spec answer 3). Risk is only visual
  (a switch inside the feel section) — verified in preview.
- **Shared-component extraction touches `log-match.ts`.** Kept behaviour-identical (same
  markup/classes/keys); the regression AC + existing behaviour guard against drift.
- **Alternative for back-compute location:** compute the delta in the renderer and send the
  existing `srDelta`. Rejected — the renderer lacks the anchor map + full history; main is
  authoritative and keeps the reconstruction pure-core-tested in one place.
