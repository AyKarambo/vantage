# Screen spec: Targets (`targets`)

**Source:** `renderer/src/views/targets.ts`, `renderer/src/views/targets/library.ts`, `renderer/src/views/targets/builder.ts`, `src/core/targets.ts`, `src/core/targets/measured.ts`, `src/core/targets/scoring.ts`.

**Shared context:** Renders from a `DashboardData` snapshot via `ViewContext`. The sidebar nav item uses a goal-flag icon (nav rendering owned by `screen-shell.spec.md`).

## Intent

The flexible improvement-target system: define a personal focus in the player's own words — self-rated (◎, you grade it after the game) by default, or bound to a stat and auto-graded (⚡ measured) — then track whether hitting it actually moves the winrate ("does it move your winrate?"). It works for players who never look at stats and for those who want hard numbers.

## Layout & behaviour

- **Active focus panel** (above the library): quick add/remove of active targets plus **Start a fresh focus**. Active targets past the staleness thresholds (default 14 days OR 30 matches, configurable in Settings → Coaching) show a rotate nudge. `AuthoredTarget.activatedAt` records when a target last became active.
- **Builder card:** free-text name · self/measured segmented control · self block (Hit/Partial/Missed grading preview) · measured block:
  - Rule = stat {Deaths, Eliminations, Assists, Damage, Healing, Mitigation, KDA} · operator {≤, ≥, =} · numeric threshold. A live preview badge reads "Hit when Deaths ≤ 4", updating on every stat/operator/value change. The threshold field is wide enough for 5 digits (per-10 damage); the scroll wheel adjusts by a per-stat step (counts ±1, KDA ±0.1, Damage/Healing/Mitigation ±250; Shift ×10), clamped at 0, with arrow-key/spinner parity.
  - **Scope (measured only):** a role selector ("Any role" plus the three queue roles) and a single-hero picker restrict auto-grading to a role and/or one hero. Switching the builder to self-rated **hides and clears** the scope (self-rated targets carry none).
  - **Save to library** with a "✓ Saved to your library" confirmation that reverts to unsaved on any edit. New targets are always season-scoped (no per-match scope).
- **Builder doubles as the edit surface:** clicking Edit on a library row loads that target's name, mode, rule, and (for measured) scope into the builder (title becomes "Edit target", sub-copy "stats keep accruing across edits"), and the footer becomes "Save changes" — updating the existing target in place (`updateTarget`), not creating a new one.
- **Library card:** per target — name, mode badge (Self-rated/Measured), rule string, sparkline, hit-rate (or "New" at 0 attempts), hits/attempts, win-when-hit vs. win-when-missed split bars, and a lifecycle action row: an **Active** chip ("◎ Active on Review" / "Inactive") toggling whether the target is graded on Review, **Edit**, **Archive**, and **Delete**.
- **Archived section** below the live rows (when any exist), `Archived (N)`, each row with its name, rule, a **Restore** button, and a **Delete** button.
- **Delete** (live or archived) opens a confirmation modal ("Delete "<name>"?") warning that removal is permanent, that stats stop counting, that grades already saved on match reviews stay stored but inert, and suggesting Archive instead; confirming calls `deleteTarget`.

## Grading

- **Measured (⚡) targets auto-grade from stats,** read-only — no human read. A measured target's grade is computed per match from its bound stat: Damage/Healing/Mitigation/Eliminations/Assists/Deaths as **per-10-minute** rates, KDA as the match ratio, against the rule's operator/threshold with a 10% partial band. Its **scope** (role and/or hero) restricts which matches it evaluates. Matches missing the stat are skipped (not attempts). Scoring lives in `src/core/targets/measured.ts` + `scoring.ts`; stored `review.grades` for a measured target are ignored (no double-count).
- **Self-rated (◎) targets are hand-graded on Review** (and optionally in the log-match modal); keyboard grading cycles the self-rated rows only. (See `screen-review.spec.md`.)

## Out-of-Scope

- Grading self-rated targets here (done on Review / in the log-match modal).
- Editing or deleting rows in the demo sample library.

## Constraints & edge cases

- Measured rules serialize as `"<stat> <op> <value>"`; self-rated as `"You grade it"`.
- With **no** authored targets (archived ones counted), the library shows a **synthetic sample**: 4 seeded targets whose hit-rates/sparklines are generated deterministically around the player's real baseline winrate. The sample only reappears once the authored library (live + archived) is truly empty.
- A freshly authored target starts at 0 attempts with both win-splits at the player's baseline; once grades exist (Review for self-rated, auto for measured) its hit-rate = hits/attempts (partial counts as an attempt but not a hit), the sparkline shows the last 8 attempts, and win-when-hit / win-when-missed reflect the winrate of the games graded hit vs. not-hit.
- Authored targets sort newest-first and fully replace the sample library once any exist.
- **Active-target selection is explicit and user-owned** (shared with `screen-review.spec.md`): a target's `isActive` flag (default `true` on creation) determines whether it appears in the Review grading strip.
- **Edit accrues, it doesn't reset:** editing name/mode/rule keeps accrued grades (a rule change mixes old- and new-rule attempts — a grade is tagged to the target id, not the rule text).
- **Archive is the primary removal action** and is **undoable** (immediate, no confirmation, `Archived "<name>"` toast with Undo ~6s): an archived target leaves the live library and the Review active set but retains its history and is restorable. **Permanent Delete** is confirmation-gated; grades stored in past reviews are untouched but become inert once the target is gone.
- Lifecycle actions no-op on sample-library rows (there is nothing to persist against).
- **Templates:** a 9-entry coaching-grounded flat list; the "Start from a template" row collapses behind a **Show templates** toggle once the player has ≥3 live authored targets.
