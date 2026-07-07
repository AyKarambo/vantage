# Spec: `targets-rework`

## Intent (WHAT & WHY)

The Improvement Targets screen is well-liked but has four rough edges plus one broken expectation:

1. **The threshold field clips real numbers.** `.vt-num` is 64px — it can't legibly show 4 digits, let alone the 5 a damage-per-10-min target needs (`9000`, `12500`). The one field where thousands-scale numbers live is the one that can't display them.
2. **Setting a threshold is fiddly.** Every digit is typed; there's no scroll-to-adjust, and even native wheel would step by 1 — useless for a stat in the thousands.
3. **Targets go stale.** Improvement works by focusing on *one thing at a time* and rotating it once it's internalized (every OW framework, Spilo included, stresses this). Today the active set is sticky and there's no lightweight way to swap it.
4. **The starter templates don't teach.** The current six are an arbitrary mix that don't reflect how coaches actually prioritize (positioning → cooldown economy → ult tracking → target selection → patience).
5. **Measured targets don't actually measure.** A "⚡ Measured" target is graded *by hand* on Review today — the rule string is descriptive text only, nothing reads the stat. Players reasonably expect a measured target to grade itself. This rework makes it so.

## In-Scope

### A. Threshold field sizing
- Widen the measured-target numeric field so a 5-digit value (up to `99999`) is fully legible **including its stepper**, with no clipping and no horizontal scroll inside the field.
- Damage / Healing / Mitigation are framed as **per-10-min** rates (the metric already in `heroStats.per10`); field + hint copy make the unit explicit so the 5-digit range reads as intentional.

### B. Scroll-wheel + stepper adjust
- Wheel over the focused/hovered field increments/decrements by a **per-stat base step**:
  - Deaths / Eliminations / Assists → **±1** · KDA → **±0.1** · Damage / Healing / Mitigation → **±250**
- **Shift** = **×10 coarse** (counts ±10, KDA ±1.0, big stats ±2500).
- Stepper arrows and Up/Down arrow keys use the same per-stat step (parity).
- Value clamps at **min 0**; wheel-over-field **prevents page scroll**; the live preview badge updates on every step.

### C. Active-set rotation (Simple rotation)
- A compact, always-visible **active-set control** on the Targets screen: lists the current active targets (graded/tracked focus) with one-tap **remove**, and a quick **add** to activate any inactive library target — swapping focus in/out without scrolling the library or opening rows.
- One-click **"Start a fresh focus"** deactivates the whole active set at once (history retained), so rotating to a new focus is one click + re-pick.
- **Staleness cue**: each active target shows how long it's been active; it's flagged stale once it has been active **≥ 14 days OR ≥ 30 matches (whichever first)**. Both thresholds are **user-configurable in Settings** (defaults 14 / 30). Requires an additive `activatedAt` stamp on the target, (re)set whenever it becomes active.
- Archive/Restore/Delete lifecycle unchanged.

### D. Coaching-grounded templates (flat, collapsible)
- Replace `TARGET_TEMPLATES` with a **9-entry** flat list mixing self-rated *process* fundamentals and measured *stat-floor* targets (role tagged in the name), each with a coaching blurb:

  | # | Name | Mode | Rule | Blurb (chip tooltip) |
  |---|---|---|---|---|
  | 1 | Wait for the fifth | self | You grade it | Don't open fights 4v5 — staggered entries lose won fights. |
  | 2 | Improve cover usage | self | You grade it | Use cover between engagements and before you commit — don't fight in the open. |
  | 3 | Track one enemy ult | self | You grade it | Each fight, know one key enemy ult — ult economy wins "unwinnable" fights. |
  | 4 | Value every cooldown | self | You grade it | Spend big cooldowns for a clear payoff, not on reflex. |
  | 5 | Target the right one | self | You grade it | Commit to the highest-value reachable target, not the closest. |
  | 6 | Cut the feeding | measured | Deaths ≤ 3 | A death floor (per 10) — uptime, not frags, drives ult charge. |
  | 7 | DPS: 9k damage floor | measured | Damage ≥ 9000 | Keep pressure up on a rough night — ~9k/10 is a solid DPS floor at most ranks. |
  | 8 | Support: healing floor | measured | Healing ≥ 8000 | A healing baseline so you're contributing, not just self-pocketing. |
  | 9 | Tank: mitigation floor | measured | Mitigation ≥ 7000 | Eat the damage your team would've taken — mitigation is your scoreboard. |

  (Removed: "Warm up before ranked", "Review one loss", "Callouts only", "Hold ult until first pick", "Trade before you die", "9k damage per 10" original.)
- **Collapsible templates**: the "Start from a template" section shows expanded while the player is still building a set, and **auto-collapses to a subtle "Show templates" toggle** once they have their own set (default: **≥ 3 live authored targets**). The toggle re-expands it any time. New/empty libraries always see templates expanded.

### E. Fully-automatic measured-target grading
- A **measured** (⚡) target grades itself from each match's stats — **no manual step on Review**. **Self-rated** (◎) targets stay manual (Hit/Partial/Missed).
- **Evaluation unit per stat**: Damage / Healing / Mitigation / Eliminations / Assists / Deaths → **per-10-min** (`sum(perHero) × 10 / durationMinutes`); KDA → the match ratio `(elims+assists) / max(deaths,1)`.
- **Grade bands** from the rule's operator/threshold, margin **m = 10%**:
  - `≥`: Hit if value ≥ threshold; Partial if ≥ threshold×0.9; else Missed.
  - `≤`: Hit if value ≤ threshold; Partial if ≤ threshold×1.1; else Missed.
  - `=`: Hit if within ±10%; Partial if within ±20%; else Missed.
- **Scoring** (`buildTargets`/`authoredSummary`): a measured target's hit-rate, hits/attempts, win-splits, and sparkline are computed by evaluating the rule against each of the player's matches **on/after its `createdAt` that expose the bound stat + duration** — no saved Review required. Matches missing the stat are **skipped** (not counted as attempts, no penalty).
- **Review screen**: measured targets render **read-only**, showing the auto-computed result and the underlying value for that match (e.g. "⚡ Hit — Damage/10 = 11,240"), or "— no stat this match" when unavailable. Only self-rated targets get the manual control; keyboard grading (H/P/M) cycles self-rated targets only.
- **Notion export consistency**: the exported `Improvement Target` aggregate for a match must reflect both stored self-rated grades **and** auto-computed measured grades, and the changed-since-last-export signature must stay correct when a rule edit changes a past match's measured grade (see Constraints — resolved in techplan, likely by folding derived measured grades into the aggregate/signature path).
- The old per-match **manual-entry fallback** ("type the number yourself") for measured targets is **removed** — missing data means skipped, not hand-entered.

## Out-of-Scope (non-goals)

- Named loadouts / reusable saved sets (rejected — simple rotation only, Resolved Q1).
- Per-role/per-hero template **filtering UI** (role conveyed in the name only).
- Renaming/migrating the `Damage`/`Healing`/`Mitigation` **stat tokens** in saved rules (would break round-trip parsing; per-10 conveyed in copy).
- Changing the rule-string serialization format or adding new measurable stats.
- Auto-grading **self-rated** targets (they remain a human read by definition).

## Constraints

- `src/core/` stays pure & Electron-free: the per-stat step map, the template list, the measured-grade evaluator (unit + bands), and the staleness predicate are all pure and unit-tested (DoD §3).
- The measured rule round-trip (`${stat} ${op} ${value}` ⇄ builder parse regex) must keep working; stat tokens stay stable so pre-existing saved targets still load, and all 9 template rules must parse.
- Renderer stays CSP-friendly (one esbuild bundle; wheel/toggle handlers bound in TS).
- `activatedAt` is additive/optional on `AuthoredTarget`; existing `manual.json` without it loads fine (treat missing as activated at `createdAt`).
- Auto-grade only runs when a match exposes `perHero` + `durationMinutes`; behavior is honest (skip) when it doesn't. GEP-only guardrail is untouched — this reads already-stored GEP stats, nothing new.
- Notion changed-detection: `matchExportSignature` hashes the derived grade; if measured grades are derived rather than stored in `review.grades`, the export/aggregate path must be extended so measured grades flow into both the aggregate and the signature.

## Acceptance Criteria (Given / When / Then)

**Field**
1. Given a measured target `Damage ≥ 12500`, when the builder/edit surface renders, then all five digits and the stepper are fully visible — no clipping or inner scroll.

**Scroll / stepper**
2. Given stat `Damage` at `9000`, when the wheel scrolls up once over the field, then value = `9250` and the preview reads "Hit when Damage ≥ 9,250"; scrolling down from `9000` gives `8750`.
3. Given stat `Deaths` at `3`, scrolling up once → `4`; given `KDA` at `3.0`, scrolling up once → `3.1`.
4. Given Shift held, scrolling up once applies ×10 (Damage `9000`→`11500`, Deaths `3`→`13`, KDA `3.0`→`4.0`).
5. Given the field at `0`, scrolling down keeps `0`; scrolling over the field never scrolls the page.
6. Given the stepper arrows or Up/Down keys, they move by the same per-stat step as the wheel.

**Rotation**
7. Given three active targets, removing one in the active-set panel flips it inactive, drops it from the Review focus on next refresh, and retains its history.
8. Given active + inactive targets, the active-set panel's quick-add activates a chosen inactive target without scrolling to its row.
9. Given a current active set, "Start a fresh focus" deactivates all of them in one action (history kept), leaving the active set empty.
10. Given a target active ≥ its staleness threshold (14 days or 30 matches, or the user's configured values), the panel shows a "getting stale" nudge; a freshly-activated target shows none.

**Templates**
11. Given the builder with < 3 authored targets, the 9 new template chips render expanded; each measured rule round-trips through the stat/op/value parse; picking one prefills name/mode/rule and always creates on save.
12. Given ≥ 3 live authored targets, the template section is collapsed behind a "Show templates" toggle that re-expands it on click.

**Auto-grading**
13. Given a measured target `Damage ≥ 9000` and a match with `perHero` damage summing to 11,240 over 10 min, then the target auto-grades that match `Hit`, with no Review interaction, and it counts toward hits/attempts.
14. Given `Deaths ≤ 3` and a match at 3.2 deaths/10, then it auto-grades `Partial` (≤ 3.3 band); at 4 deaths/10 → `Missed`.
15. Given a match lacking `perHero` or `durationMinutes`, then a measured target records **no attempt** for it (skipped, not missed).
16. Given the Review screen, then measured targets appear read-only with their auto result + value (or "no stat this match"), and only self-rated targets are hand-graded (incl. H/P/M keys).
17. Given a Notion export, then a match's exported `Improvement Target` grade reflects both self-rated and auto-computed measured grades, and re-export detects a change if a rule edit alters a past match's measured grade.
18. DoD: `npm test` + `npm run typecheck` green; new pure logic (step map, templates, measured-grade evaluator, staleness predicate) ships with unit tests; README + `specs/screen-targets.spec.md` updated for auto-grading, rotation, and templates.

## Resolved questions

- **Q1 — "Set of targets you switch in and out"** → **Simple rotation**: lightweight active-set control (quick add/remove + "start a fresh focus") + staleness cue + existing archive. No named/saved sets.
- **Q2 — Scroll step sizes** → per-stat base (counts ±1, KDA ±0.1, big stats ±250) + **Shift ×10**, min-clamp 0.
- **Q3 — Template direction** → **flat curated list**, now trimmed to **9** with two removals; templates **collapse to "Show templates"** once the player has their own set (≥3).
- **Q4 — Auto-grade measured targets?** → **Yes, fully automatic**: measured targets grade themselves from match stats with no Review step; self-rated stay manual. (Verified: not implemented today — `renderer/src/views/review.ts` grades every target by hand.)
- **Q5 — Staleness threshold** → **14 days OR 30 matches**, whichever first, **configurable** in Settings.

## Open Questions

1. **Notion architecture for derived measured grades** — store computed measured grades into `review.grades` at review-save/export time, or derive them on the fly in the export path (keeps rule-edits retroactive but complicates the changed-since-last-export signature)? Deferred to `/techplan`; flagged here as the main integration risk.
2. **Template auto-collapse threshold** — defaulting to ≥3 live authored targets; confirm that's the right "they have their own set now" line (vs ≥1 or ≥5).
