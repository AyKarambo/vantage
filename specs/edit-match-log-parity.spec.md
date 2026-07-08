---
slug: edit-match-log-parity
status: done
created: 2026-07-07
updated: 2026-07-07
---

# Spec: Edit-match ↔ Log-match parity (and per-match rank history)

**Surface:** `renderer/src/views/matchDetail.ts` (the `openMatchEditor` dialog + the
`competitiveSection` card), `renderer/src/app/log-match.ts`,
`renderer/src/components/reviewControls.ts`, `renderer/src/views/review.ts`,
a new/relocated shared comms-switch + result-chooser + wheel-nudge helper under
`renderer/src/components/`, and `src/core/rank/` (backward rank reconstruction +
rank↔scalar conversion, pure). No SQLite migration.

## Intent (WHAT & WHY)

Vantage has **two** manual match-entry surfaces that have drifted apart: the quick-log
card (`log-match.ts`) and the match-detail **editor** (`openMatchEditor`). They capture
the same manual layer (result, SR %, comms, flags, target grades, performance), so a
control that behaves one way when logging and another way when editing reads as broken.
Recent log-match work (`log-match-improvements-2`) never landed on the editor. Five gaps:

1. **No mouse-wheel nudge on the editor's SR field.** Log-match scrolls the SR/% inputs
   ±1 per tick; the editor's SR field doesn't, so drift-correction needs the keyboard.
2. **No "Set current rank" mode in the editor.** Log-match lets you either nudge the
   change (±%) or set an absolute rank; the editor only has the raw Change-±% field. When
   you *know* the rank you ended a match at, the SR % for that match should be
   **calculated from the rank you set**, not typed.
3. **Comms is effectively missing from the editor.** The full three-state comms switch
   (Positive / Banter / Abusive) exists only on the log card. The editor (and the Review
   grading card) expose only a binary "Good comms" chip via the shared `mentalFlagsRow`,
   which can't record Banter or Abusive at all.
4. **Win/Loss/Draw looks different.** Log-match uses large colour-coded W/L/D choices; the
   editor uses a plain grey segmented control.
5. **The logged SR % isn't shown, and the rank is wrong for old matches.** The
   Competitive-progress card hides a match's SR % unless a rank anchor exists (`note ===
   'calculated'`), so a delta you set can silently vanish. Worse, the rank shown is your
   *current* anchor rank for **every** past match: the engine only replays forward from a
   single anchor, so any match older than your latest anchor just echoes today's rank
   instead of the rank you actually held after that match.

**Benefit:** the editor and log card feel like one tool; entering an absolute rank derives
the SR %; comms is fully recordable everywhere; a logged SR % is always visible; and the
Competitive-progress card shows the rank you truly held after each specific match.

## In-Scope

- **Wheel-nudge parity.** The editor's SR field, and the new Set-current % field, get the
  same ±1-per-tick mouse-wheel nudge (Shift = coarse where log-match already does), with
  no modal scroll while the pointer is over them — via a **single shared** wheel helper
  (consolidate log-match's `attachWheelNudge` and `wheelStepper.ts` so they can't drift).
- **Change ↔ Set-current-rank toggle in the editor**, mirroring log-match's control.
  - **Change (±%)** — the existing raw SR-delta field, now with wheel nudge.
  - **Set current rank** — a tier/division/% picker (with wheel nudge, prefilled from the
    reconstructed rank as of this match). On save the app **back-computes this match's
    SR %** = `points(entered rank after this match) − points(reconstructed rank before this
    match)` and stores it as the match's `srDelta`. **The live rank anchor is not moved.**
    (See the no-anchor edge under Constraints.)
- **Three-state comms switch, shared.** Replace the binary "Good comms" chip with the full
  Positive / Banter / Abusive switch as a shared component used by log-match, the editor,
  **and** the Review grading card (`mentalFlagsRow` consumers). Clicking the active option
  again clears it (comms stays optional). Reading falls back through `commsTone` so legacy
  `positiveComms`/`comms:'positive'` records still show as Positive.
- **Colour-coded W/L/D result chooser in the editor** for editable (manual) matches,
  matching log-match's styling — extracted as a shared result chooser. Locked (GEP) matches
  keep result read-only, styled consistently.
- **Per-match rank history in Competitive progress.** The card shows the rank held **after
  the viewed match**, including matches **older than the latest anchor**, via new pure
  **backward reconstruction**: start at the anchor and subtract the SR of intervening comp
  matches to land on this match's then-rank. Forward matches (at/after the anchor) keep
  today's forward replay. Estimate fallback applies only when **no anchor at all** exists
  for the (account, role). The card labels reconstructed/estimated ranks so best-effort is
  never mistaken for certainty.
- **Always show a logged SR %.** When the viewed match has a per-match `srDelta` (typed or
  back-computed), the card shows "±N% this match" regardless of the note; the
  "over the range" estimate delta is shown only when there is no per-match srDelta.
- **New pure core logic + unit tests:** backward rank reconstruction (`currentRank` /
  a sibling handling `untilTs < anchor.setAt`), a rank↔scalar-points conversion, and the
  back-compute-delta-from-two-ranks derivation. Comms round-trip if the shared switch
  changes any pure transform.

## Out-of-Scope (non-goals)

- **Full two-column layout redesign of the editor modal.** This is *control-level* parity
  (wheel, set-rank toggle, comms switch, W/L/D styling), not the log card's wide grid.
- **A multi-anchor rank timeline.** There is still exactly one anchor per (account, role);
  reconstruction walks backward from that single anchor. It is best-effort by design.
- **Perfect reversal of rank-protection / `needsReanchor`.** Backward reconstruction may
  flatten the protection buffer for historical display (the state is lossy going backward).
- **Moving/creating the anchor from a normal editor save.** Set-current back-computes a
  delta; it does not re-anchor (except the no-anchor bootstrap edge).
- **Notion export/import** of any of this. **Readiness/analytics** surfacing of ranks or
  performance. **GEP game-fact editing** (result/map/heroes stay locked for auto matches).
- New keyboard shortcuts beyond what the shared components already provide.

## Constraints

- **Guardrails hold:** `src/core/` stays pure/Electron-free — backward reconstruction,
  rank↔scalar, and the delta derivation are pure core the renderer/main can both call.
  Renderer stays CSP-friendly (native inputs, no new dependency). IPC stays typed
  end-to-end (no `any`). Manual-only, local-first, GEP-only — unchanged.
- **No SQLite migration.** Back-compute writes the existing `GameRecord.srDelta`; comms
  writes the existing `mental.comms`. Nothing new on the record.
- **Best-effort is labelled, never silent.** Reconstructed/estimated ranks are visibly
  marked; a match with no logged SR contributes 0 to reconstruction (drift, not a crash).
- **No-anchor bootstrap edge:** if the (account, role) has **no** anchor yet, entering an
  absolute rank via the editor's Set-current mode establishes the anchor **at this match's
  timestamp** (there is no "before" to diff against, so no srDelta is back-computed for
  this match) — mirroring log-match's "no anchor → Set-current establishes the anchor".
- **Composition over markup:** the comms switch, the W/L/D chooser, and the wheel helper
  become shared components/utilities so the two surfaces can't diverge again.
- **DoD:** `npm test` green; `npm run typecheck` clean (main + renderer); new pure `core/`
  logic ships with vitest tests; README/docs updated for the user-visible editor changes.

## Acceptance Criteria

### Wheel-nudge parity
- **Given** the editor's SR (Change) field, **when** the pointer is over it and the user
  scrolls, **then** the value changes ±1 per tick and the modal does not scroll — identical
  to log-match.
- **Given** the editor's Set-current % field, **when** scrolled, **then** it nudges ±1 per
  tick with no modal scroll.

### Set-current rank → back-computed SR %
- **Given** an anchored (account, role) and a match with a reconstructable before-rank,
  **when** the user switches the editor to "Set current rank", enters the rank held after
  that match, and saves, **then** the match's SR % is stored as `points(entered) −
  points(before)` and the anchor is unchanged.
- **Given** Set-current mode is opened, **then** tier/division/% prefill from the
  reconstructed rank as of that match (not hardcoded defaults).
- **Given** an (account, role) with **no** anchor, **when** the user sets an absolute rank
  in the editor and saves, **then** an anchor is created at this match's timestamp and no
  srDelta is back-computed for this match.
- **Given** the toggle, **when** the user switches back to "Change (±%)", **then** the raw
  SR-delta field behaves exactly as today (plus wheel nudge).

### Comms three-state switch (shared)
- **Given** the editor **or** the Review grading card, **then** a Positive / Banter /
  Abusive switch is shown (not just a binary chip), seeded from the match's stored tone.
- **Given** the active comms option, **when** clicked again, **then** comms clears.
- **Given** a saved comms tone, **when** the match is edited, **then** the correct option
  is pre-selected; **and** saving persists Banter/Abusive (not just Positive).
- **Given** a legacy record with `comms:'positive'`/`positiveComms`, **then** it shows as
  Positive and is not silently downgraded by an unrelated edit.

### Win/Loss/Draw styling
- **Given** an editable (manual) match in the editor, **then** the result control renders
  as the colour-coded W/L/D chooser used by log-match; **and** picking a result updates the
  match on save as today.
- **Given** a locked (GEP) match, **then** the result stays read-only, styled consistently.

### Competitive progress — per-match rank history
- **Given** a competitive match **older** than the latest anchor, **when** its detail
  opens, **then** the card shows the reconstructed rank held **after that match** (not
  today's anchor rank), labelled as reconstructed/best-effort.
- **Given** a match **at/after** the anchor, **then** the card shows the forward-replayed
  rank as today.
- **Given** an (account, role) with **no** anchor, **then** the card falls back to the
  winrate estimate as today, labelled as an estimate.
- **Given** an intervening match with no logged SR %, **then** reconstruction treats it as
  0 movement (drifts) rather than failing.

### SR % always visible
- **Given** a match with a per-match `srDelta` (typed or back-computed), **then** the card
  shows "±N% this match" regardless of anchor/note.
- **Given** a match with no per-match srDelta but an estimate range delta, **then** the
  "over the range" value is shown as today.

### Regression
- **Given** the full change, **when** `npm test` and `npm run typecheck` run, **then** both
  pass, with new tests covering backward reconstruction, rank↔scalar conversion, back-
  computed delta from two ranks, and comms tone round-tripping through the shared switch.
- **Given** existing log-match behaviour, **then** it is unchanged except for shared-helper
  extraction.

## Resolved questions

1. **Set-current in the editor** → **back-compute this match's SR %** from the entered
   absolute rank (`points(after) − points(before)`) and store it as the match's srDelta;
   **do not move the anchor**. (No-anchor case bootstraps the anchor at this match — see
   Constraints.)
2. **Historical rank** → **reconstruct backward from the latest anchor** so every past
   match shows its true then-rank; best-effort, may drift on missing SR / flatten
   protection; labelled as reconstructed.
3. **Comms switch scope** → **shared across log-match, edit-match, AND Review** (one
   component; replaces the binary "Good comms" chip everywhere).
4. **SR % display** → always show a per-match srDelta when present, regardless of note.
5. **Parity depth** → control-level (wheel, set-rank, comms, W/L/D), not a full editor
   layout redesign.

## Open Questions

- Exact reconstruction math: a monotonic rank↔scalar-points model (simple, reversible) vs.
  a reverse of the forward engine (protection-aware but lossy). Techplan to settle with
  tests; spec only requires "rank after this match, best-effort, labelled".
- Where the back-compute runs: renderer computes the delta and sends the existing
  `srDelta` (no contract change), or a new "set resulting rank" field on `MatchEditInput`
  lets main derive it authoritatively. Techplan to choose.
- Precise note/sub wording distinguishing *reconstructed* (pre-anchor) from *calculated*
  (forward) from *estimate* (no anchor).

## Post-review notes (2026-07-07)

Adversarial multi-agent review of the implementation surfaced two items:

1. **Fixed — Set-current + role change keyed the wrong ladder.** When an editor save both
   changed a match's role *and* used Set-current, the back-computed SR % (and the no-anchor
   bootstrap) was derived against the *pre-edit* role's rank track while the match was stored
   under the *new* role. `editMatch` now keys the anchor lookup / back-compute / bootstrap on
   the effective post-edit role (`patch.role ?? game.role`), with regression tests.
2. **Known limitation (by design) — forward demotion entry.** For a *forward* (`calculated`)
   match, the derived delta reproduces the entered rank exactly **except** when it would drive
   the running % ≤ 0: Overwatch rank protection (the forward engine) then shows a held/negative
   buffer rather than the entered division, so an entered *demotion* won't reproduce exactly.
   Per resolved question 1 the anchor is deliberately **not** moved (a re-anchor would shift
   the live rank), so this stays a best-effort estimate. Documented in `srDeltaForSetRank`.
