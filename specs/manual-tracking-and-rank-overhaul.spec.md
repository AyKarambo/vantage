# Spec — manual-tracking-and-rank-overhaul

## Intent (WHAT & WHY)
Manual tracking today is a thin capture form: you can't say *which account* you played
on, you can't grade your improvement targets while the match is fresh, "leaver" is a
single ambiguous flag, and rank is a fuzzy winrate estimate with no way to log the real
competitive numbers the game shows you. This makes hand-logged data less trustworthy and
less useful than it should be — the opposite of the product's promise. This spec turns
manual tracking into a first-class, editable, per-account, per-role record that mirrors
how Overwatch actually ranks you, and makes **every** match (hand-logged *or* Overwolf-tracked)
editable after the fact.

## In-Scope
1. **Accounts as first-class entities** — create / edit / delete accounts in-app
   (Settings) and choose the **active account** when logging a match (defaults to
   last-used). Accounts stay a `battleTag → label` mapping (label doubles as the display
   name and the Notion `Account` select value); no schema migration of history.
2. **Targets in the log-match view** — active improvement targets appear in the log-match
   modal with the same 3-way grading (Hit / Partial / Missed) used on Review; grading is
   optional and still available later.
3. **Team-distinguished leaver** — replace the single boolean with two independent flags:
   *leaver — my team* and *leaver — enemy team* (both can be set). Purely a label; **no**
   effect on winrate/rank. Legacy `leaver: true` reads as *leaver — my team*.
4. **Skill-rating % + real rank** — per **(account × role, incl. Open Queue)**:
   - A **one-time anchor rank** (tier + division + %) set the first time you log a
     competitive match for that account+role; editable anytime.
   - Each competitive match logs the **exact +/- %** the game shows (e.g. `+22`, `-19`).
   - Vantage **calculates** current rank from anchor + accumulated deltas, and this
     **replaces** the winrate-based estimate wherever an anchor exists.
   - Anchor and every logged % are **always editable**; edits recompute the rank forward.
5. **Rank-protection mode** — when you're at 0% of a division and a further loss would
   demote: only a **Loss** demotes; a **Win or Draw keeps** you. Vantage shows a "Rank
   protected" state and holds the division. On the demoting loss it lowers the division by
   one and does **not** fabricate the new intra-division % — it flags a re-anchor and the
   next logged match (or a manual edit) sets it.
6. **Edit any match from the Matches screen** — clicking a match opens an editor for the
   **manual layer** (result/role/map/hero for hand-logged; mental flags, leaver team,
   SR %, target grades for all). On **Overwolf-tracked** matches, GEP-derived facts
   (result, map, hero, scoreboard, roster) stay **locked**; only the manual layer is
   editable.

## Out-of-Scope
- Notion import/export changes (→ `notion-import.spec.md`).
- Settings toasts, run-at-login, chart sizing (→ `ui-fixes-toasts-autolaunch-charts.spec.md`).
- Any non-GEP live data source; automatic rank detection from the game (account-safety
  guardrail — SR % stays user-entered).
- Cross-account rank aggregation / "combined MMR".
- Separating the account **display name** from its **Notion value** (they remain one label).

## Constraints
- `src/core/` stays pure & Electron-free — new rank math (anchor + deltas,
  promotion/demotion, protection) is pure and unit-tested.
- IPC contract stays typed end-to-end; new fields flow through `shared/contract` — no `any`.
- Renderer stays CSP-friendly and composes existing `components/`.
- Backward compatibility: existing `GameRecord`s (no `source`, single `leaver` boolean, no
  SR %) must keep loading. Matches with no anchor fall back to the winrate estimate.

## Acceptance Criteria
**Accounts**
- Given the Settings screen, When I open Accounts, Then I can add an account (battleTag +
  label), edit an existing one, and delete one, and changes persist to local config.
- Given the log-match modal, When it opens, Then an account picker is shown defaulting to
  the last-used account, and the logged match records the chosen account.
- Given only config-file accounts existed before, When the app loads, Then they appear as
  editable in-app accounts (no data loss).

**Targets in log-match**
- Given ≥1 active target, When I open the log-match modal, Then each active target is
  listed with Hit/Partial/Missed controls, and grading is optional.
- Given I grade targets while logging, When I save, Then the grades persist on that match
  exactly as if graded on Review.

**Leaver**
- Given the log-match or match-edit UI, When I set leaver, Then I can independently mark
  "my team" and/or "enemy team".
- Given a leaver-flagged match, When winrate/rank are computed, Then they are unchanged by
  the leaver flags (label only).
- Given a legacy match with the old `leaver: true`, When displayed, Then it counts as
  "leaver — my team".

**SR % + rank**
- Given no anchor for an account+role, When I log my first Competitive match for it, Then
  I'm prompted to set my current rank (tier + division + %).
- Given an anchor exists, When I log a Competitive match, Then I can enter the exact +/-
  %, and the calculated rank updates and is shown instead of the winrate estimate.
- Given a QP/Arcade match, When logging, Then no SR % field is shown.
- Given I edit a past match's % or the anchor, When I save, Then the current rank
  recomputes from that point forward.
- Given cumulative progress crosses 100%, When recomputed, Then the division/tier promotes
  and carries the remainder.

**Rank protection**
- Given I'm at 0% of a division, When I log a Loss, Then I do not demote immediately; the
  app shows "Rank protected" and holds the division.
- Given I'm protected, When I log a Win or Draw, Then protection clears and the rank moves
  normally.
- Given I'm protected, When I log another Loss, Then the division drops by one and the new
  intra-division % is flagged for re-anchor rather than guessed.

**Edit any match**
- Given any match on the Matches screen, When I click it, Then I can edit its manual layer
  (mental, leaver team, target grades, SR %) and save.
- Given a hand-logged match, When I edit it, Then result/role/map/hero are also editable.
- Given an Overwolf-tracked match, When I edit it, Then GEP-derived facts (result, map,
  hero, scoreboard, roster) are read-only while the manual layer is editable.

## Resolved questions
- **Spec structure** → three specs; this is the core.
- **Accounts** → full in-app management + picker; rank & history per-account; account =
  `battleTag → label` (display == Notion value) to avoid a history migration.
- **Rank granularity** → per role (incl. Open Queue) per account.
- **Leaver** → distinguish team only (two independent booleans), no stats effect; legacy
  `leaver` → my team.
- **SR %** → type the exact number the game shows; calculated rank replaces the winrate
  estimate once an anchor exists.
- **Rank protection** → only Loss demotes; Win/Draw keeps; on demotion the app flags a
  re-anchor instead of fabricating the landing %.
- **Edit scope** → manual layer only on auto-tracked matches; GEP facts locked.
- **Targets-in-log** → inline 3-way grading, optional, mirrors Review.

## Open Questions
- Whether to also surface calculated per-role rank on the Overview KPI (today it shows the
  winrate estimate). v1 shows calculated rank on match detail + a Settings ranks panel;
  Overview may follow.
