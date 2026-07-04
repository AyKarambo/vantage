# Screen spec: Targets (`targets`)

**Source:** `renderer/src/views/targets.ts`, `src/core/targets.ts` · reverse-engineered 2026-07-04
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior · [confirmed] user decision (2026-07-04 spec review)

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`.

## Intent (WHAT & WHY)

[explicit] The flexible improvement-target system: define a personal focus in the player's own words, self-rated (◎ you grade it after the game) by default or bound to a stat and auto-graded (⚡ measured) — then track whether hitting it actually moves the winrate ("does it move your winrate?"). It works for players who never look at stats and for those who want hard numbers.

## In-Scope

- **Builder** card: free-text name · self/measured segmented control · self block (Hit/Partial/Missed grading preview) · measured block (rule = stat {Deaths, Eliminations, Assists, Damage, Healing, Mitigation, KDA} · operator {≤, ≥, =} · numeric threshold; manual entry fallback when the game doesn't expose end-of-match stats) · **Save to library** with a "✓ Saved" confirmation state that reverts to unsaved on any edit.
- **Library** card: per target — name, mode badge (Self-rated/Measured), rule string, sparkline, hit-rate (or "New" at 0 attempts), hits/attempts, and win-when-hit vs. win-when-missed split bars.

## Out-of-Scope

- Grading targets (done on the Review screen).

## Constraints

- [explicit] Measured rules serialize as `"<stat> <op> <value>"`; self-rated as `"You grade it"`.
- [explicit] With **no** authored targets, the library shows a **synthetic sample**: 4 seeded targets whose hit-rates/sparklines are generated deterministically around the player's real baseline winrate — "so it feels real rather than hand-typed" (demo mode).
- [explicit] A freshly authored target starts at 0 attempts with both win-splits at the player's baseline, because per-game grade persistence does not exist yet (see pipeline gap).
- [explicit] Authored targets sort newest-first and fully replace the sample library once any exist.

## Acceptance Criteria (current behavior)

- Given a target is saved, then it appears at the top of the library and the sample library disappears.
- Given mode = measured with stat/op/value chosen, then the saved rule is `"<stat> <op> <value>"`; given self, `"You grade it"`.
- Given any edit after saving, then the "✓ Saved" pill reverts to the Save state.
- Given no authored targets, then the 4-item sample library renders with deterministic hit-rates/sparklines seeded from the real baseline winrate.
- Given an authored target with 0 attempts, then its rate shows "New" and both win-splits sit at baseline.

## Known gaps (intent ≠ code)

- [confirmed] **No edit or delete for saved targets.** There is no UI path to change or remove a target once saved. Intended end state (confirmed 2026-07-04):
  - **Edit** — name and rule are editable; accrued stats (hits/attempts, win-splits) are **kept across edits**. Accepted trade-off: after a rule change (e.g. Deaths ≤4 → ≤2) the historical hit-rate mixes old- and new-rule attempts.
  - **Remove** — **archive is the primary action**: the target disappears from the library and the active set but its history is retained and restorable. **Permanent delete** is also available, behind a confirmation; grades already stored inside saved match reviews remain untouched (inert) either way.
- [confirmed] **Drop the "This match" scope option.** The scope segmented control (This match / Season focus) saves a value that changes nothing downstream. Season tracking is the product; "This match" is leftover UI to be removed.
- [confirmed] **Remove the Cancel button.** It has no handler and nothing to cancel out of.
- [confirmed] **Active-target selection UI** (shared with `screen-review.spec.md`): targets need an explicit activate/deactivate mechanism to define which are graded on Review; the current "first 3 library rows" is a placeholder.
- [confirmed] **Grading pipeline** (shared with `screen-review.spec.md`): Review grades must persist to the main store and drive real hit-rates, hits/attempts, sparklines, and win-when-hit/missed splits for authored targets — replacing the current permanent "New · 0/0" state.
- [inferred] The measured-block preview badge always reads "auto-grade Hit" regardless of the rule — unfinished UI; once real grading exists it should reflect the actual rule/preview.

## Open Questions

None — all resolved 2026-07-04 (see Known gaps).
