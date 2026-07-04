# Screen spec: Targets (`targets`)

**Source:** `renderer/src/views/targets.ts`, `renderer/src/views/targets/library.ts`, `src/core/targets.ts` · reverse-engineered 2026-07-04 · updated 2026-07-04 after gap implementation · updated 2026-07-04 after the ui-qol batch (PR #8)
**Provenance tags:** [explicit] stated in code/comments · [inferred] reconstructed from behavior · [confirmed] user decision (2026-07-04 spec review) · [implemented 2026-07-04] shipped in the gap-closing pass · [qol 2026-07-04] shipped in the ui-qol batch (intent: `ui-qol.spec.md`)

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`.

## Intent (WHAT & WHY)

[explicit] The flexible improvement-target system: define a personal focus in the player's own words, self-rated (◎ you grade it after the game) by default or bound to a stat and auto-graded (⚡ measured) — then track whether hitting it actually moves the winrate ("does it move your winrate?"). It works for players who never look at stats and for those who want hard numbers.

## In-Scope

- **Builder** card: free-text name · self/measured segmented control · self block (Hit/Partial/Missed grading preview) · measured block (rule = stat {Deaths, Eliminations, Assists, Damage, Healing, Mitigation, KDA} · operator {≤, ≥, =} · numeric threshold; manual entry fallback when the game doesn't expose end-of-match stats) · **Save to library** with a "✓ Saved to your library" confirmation state that reverts to unsaved on any edit. New targets are always season-scoped — there is no per-match scope option (see Constraints).
- [implemented 2026-07-04] The builder doubles as the **edit surface**: clicking Edit on a library row loads that target's name, mode, and rule into the builder (card title becomes "Edit target", sub-copy "stats keep accruing across edits"), scrolls it into view, and the footer button becomes "Save changes" — which updates the existing target in place (`updateTarget`) instead of creating a new one.
- **Library** card: per target — name, mode badge (Self-rated/Measured), rule string, sparkline, hit-rate (or "New" at 0 attempts), hits/attempts, win-when-hit vs. win-when-missed split bars, and — [implemented 2026-07-04] — a lifecycle action row: an **Active** chip ("◎ Active on Review" / "Inactive") toggling whether the target is graded on the Review screen, **Edit**, **Archive**, and **Delete**.
- [implemented 2026-07-04] An **Archived** section below the live rows (when any exist): shown as `Archived (N)`, each row with its name, rule, a **Restore** button, and a **Delete** button.
- [implemented 2026-07-04] **Delete** (live or archived row) opens a confirmation modal ("Delete "<name>"?") warning that the removal is permanent, that stats stop counting, that grades already saved on match reviews stay stored but inert, and suggesting Archive instead; confirming calls `deleteTarget`.
- [implemented 2026-07-04] The measured-block preview badge renders the **live rule** as the user edits it, e.g. "Hit when Deaths ≤ 4" — it updates on every stat/operator/value change, not a static placeholder.

## Out-of-Scope

- Grading targets (done on the Review screen — see `screen-review.spec.md`).
- Auto-grading a measured target directly from GEP stats without a human read on Review (still a future step — see Known gaps).
- Editing or deleting rows in the demo sample library (see Constraints).

## Constraints

- [explicit] Measured rules serialize as `"<stat> <op> <value>"`; self-rated as `"You grade it"`.
- [explicit] With **no** authored targets (archived ones included in that check), the library shows a **synthetic sample**: 4 seeded targets whose hit-rates/sparklines are generated deterministically around the player's real baseline winrate — "so it feels real rather than hand-typed" (demo mode). Archiving every authored target must not resurrect the sample library while archived targets still exist; the sample only reappears once the authored library (live + archived) is truly empty (e.g. after deleting the rest).
- [explicit] A freshly authored target starts at 0 attempts with both win-splits at the player's baseline; [implemented 2026-07-04] once Review grades exist for it, hit-rate, hits/attempts, the sparkline, and both win-splits are computed from those grades (see Acceptance Criteria).
- [explicit] Authored targets sort newest-first and fully replace the sample library once any exist.
- [implemented 2026-07-04] **No "This match" scope.** The former scope segmented control (This match / Season focus) is gone — every target authored today is season-scoped. `AuthoredTarget.scope` is kept only as a legacy field for old `manual.json` files written before this change; new writes never set it to `'match'`.
- [implemented 2026-07-04] **No Cancel button** in the builder — removed along with the scope control (it had no handler).
- [implemented 2026-07-04] **Active-target selection is explicit and user-owned**, shared with `screen-review.spec.md`: a target's `isActive` flag (default `true` on creation) determines whether it appears in the Review grading strip. The former "first 3 library rows" placeholder is gone entirely.
- [implemented 2026-07-04] **Edit accrues, it doesn't reset.** Editing a target's name/mode/rule keeps its accrued Review grades (hits/attempts, win-splits, sparkline) — editing does not clear history. Accepted trade-off: after a rule change (e.g. Deaths ≤4 → ≤2) the historical hit-rate mixes old- and new-rule attempts, since a grade is just tagged to the target id, not to the rule text at grading time.
- [implemented 2026-07-04] **Archive is the primary removal action**: an archived target disappears from the live library and from the Review active set (even if it was active), but its history is retained and it is restorable via Restore. **Permanent delete** is a secondary, confirmation-gated action; grades already stored inside saved match reviews are untouched but become inert (they no longer contribute to any target's stats since the target itself is gone).
- [qol 2026-07-04] **Archive is undoable, not confirmed.** Per the ui-qol undo-vs-confirm contract (`ui-qol.spec.md` #7): archiving executes immediately — no confirmation — and shows an `Archived "<name>"` toast with an **Undo** action (~6s, hover pauses) that restores the target in place. Only permanent Delete keeps its confirmation modal.
- [confirmed] **Lifecycle actions no-op on sample-library rows.** The Active/Edit/Archive/Delete row only appears for authored targets; the sample library (demo mode) has no lifecycle affordances — there is nothing to persist against.

## Acceptance Criteria (current behavior)

- Given a target is saved, then it appears at the top of the library and the sample library disappears (unless archived authored targets still exist, in which case the sample stays hidden and the new target is simply the newest live row).
- Given mode = measured with stat/op/value chosen, then the saved rule is `"<stat> <op> <value>"`; given self, `"You grade it"`.
- Given any edit after saving, then the "✓ Saved to your library" pill reverts to the Save state.
- Given no authored targets (live or archived), then the 4-item sample library renders with deterministic hit-rates/sparklines seeded from the real baseline winrate.
- Given an authored target with 0 Review-graded attempts, then its rate shows "New" and both win-splits sit at baseline.
- Given a target has been graded on Review one or more times, then its hit-rate = hits/attempts (partial counts as an attempt but not a hit), hits/attempts render as counts, the sparkline shows the last 8 attempts (hit=1, partial=0.5, missed=0, left-padded with 0 when fewer than 8), and win-when-hit / win-when-missed reflect the winrate of the games graded hit vs. not-hit for that target (falling back to baseline on a side with zero games).
- Given a click on Edit for a library row, then the builder loads that target's name/mode/rule, retitles to "Edit target", and Save persists an update (`updateTarget`) rather than a new target; the row's accrued stats are unaffected by the edit.
- Given a click on the Active chip, then the target's `isActive` flips and the Review grading strip immediately reflects the new active set on next refresh.
- Given a click on Archive, then the target moves out of the live list into the Archived section immediately (no confirmation), is dropped from the Review active set, and its history remains intact; an "Archived" toast with Undo shows for ~6s, and Undo (or the Archived section's Restore) moves it back to the live list.
- Given a click on Delete (live or archived) and confirmation, then the target is permanently removed from the library; grades already stored on past match reviews remain in the review record but no longer count toward any displayed target.
- Given the measured builder, then the preview badge always reads "Hit when `<stat>` `<op>` `<value>`" for the currently selected stat/operator/value.

## Known gaps (intent ≠ code)

None identified — behavior matches intent. One deliberate, documented limitation remains:

- [confirmed] **Measured targets are still graded manually on Review.** A "measured" (⚡) target's rule is descriptive today — the app does not read the live stat and auto-grade it; the human still picks Hit/Partial/Missed on the Review screen for every target, self-rated or measured alike. Auto-grading measured targets directly from GEP/manual stats is a future step, not part of this pass.

## Open Questions

None — all 2026-07-04 gaps (edit, archive/delete, active-target selection, scope removal, Cancel removal, grading pipeline, live preview badge) are now implemented.
