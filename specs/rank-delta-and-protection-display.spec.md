---
slug: rank-delta-and-protection-display
status: planned
updated: 2026-07-07
---

# Spec: Rank delta & protection display

**Slug:** `rank-delta-and-protection-display`
**Status:** Approved 2026-07-07
**Reported by:** user, 2026-07-07

## Intent (WHAT & WHY)

Two problems in how the app surfaces the user's **anchored** (directly-set) competitive rank:

1. **The rank-movement indicator disappears the moment you set your rank.** The Overview
   Rank KPI shows a ▴/▾ trend arrow *only* on the winrate-heuristic fallback
   (`renderer/src/views/overview.ts:123-130`). Once a real rank anchor exists, the KPI
   switches to the `primaryRank` branch (`renderer/src/views/overview.ts:109-122`), which
   carries **no delta** — so it just reads `X% in division` with a hard-coded upward arrow,
   and the user can no longer see at a glance whether their real rank is climbing or
   dropping. `Progression` has a `delta` field (`src/core/progression.ts:15-22`);
   `primaryRank` (`src/shared/contract/dashboard.ts:96-104`) does not.

2. **Crossing a division/tier boundary out of rank protection dead-ends instead of updating
   the rank.** Entering protection (the *first* dip below the division floor) is displayed
   correctly and stays: the division is held, the 🛡 shield shows, and the negative buffer %
   renders (delivered by the completed `rank-protection-carryover` spec). But the *second*
   dip — the one that actually demotes — currently freezes the track: the engine sets
   `needsReanchor` (`src/core/rank/engine.ts:76-80`), which halts all further matches
   (`src/core/rank/engine.ts:67`), and every surface then shows a "Demoted — set your new
   rank to resume tracking" dead-end (`renderer/src/views/matchDetail.ts:224-226`,
   `renderer/src/app/shell.ts:601`, `renderer/src/views/settings/accounts.ts:72`,
   `renderer/src/views/overview.ts:115-116`). The user expects the second dip to simply
   **update to the new, demoted rank** (e.g. Gold 3 protection → lose again → **Gold 4**)
   and keep tracking — and, symmetrically, **upranking** (promotions across divisions/tiers)
   must keep working and be reflected everywhere.

**Relationship to existing work.** The completed `rank-protection-carryover` spec fixed the
negative-buffer carry (`-19% + 26% = 7%`) but *explicitly left the promotion/demotion carry
math untouched* (its Out-of-Scope names `applyGain` / `demoteOne`; its Open Questions defer
the second-dip rule). This spec picks up exactly that deferred territory. No overlap.

Areas below are labeled **A–B** and map 1:1 onto the GitHub issues to be created after
approval.

---

## Area A — Overview Rank delta, always visible (even with a set rank)

### Problem
When a rank anchor is set, `rankKpi` (`renderer/src/views/overview.ts:107-131`) renders the
`primaryRank` branch, which has no movement data, so the delta line degrades to a static
`${progressPct}% in division` with `dir: 'up'`. The user wants the rank-movement indicator
present in **both** the heuristic and the anchored case.

### Requirements
- **A1. `primaryRank` carries a signed movement value.** `computeDashboard` / `primaryRankOf`
  (`src/core/dashboardData.ts:248-269`) computes a net rank movement from the **anchor
  position** to the **current calculated position**, in %-points across the ladder
  (positive = climbed, negative = dropped). The contract's `primaryRank`
  (`src/shared/contract/dashboard.ts:96-104`) gains this field. Pure, in `src/core`,
  unit-tested.
- **A2. Basis = since the anchor was set.** The movement is measured anchor → now, over the
  **full** competitive history for that (account, role) — matching how the anchored rank
  itself is computed (full history, not the filtered set). It is therefore **independent of
  the active date filter**.
- **A3. The Overview Rank KPI always shows a direction.** For an anchored rank, the KPI shows
  ▴ when the current rank is above the anchor, ▾ when below, and a neutral state when
  unchanged (net zero / no matches since the anchor). It continues to show the current
  in-division %/protection state alongside. The non-anchored (heuristic) KPI is unchanged.

### Acceptance criteria
- **Given** an anchor of Gold 3 · 40% and logged matches that net the current rank to
  Gold 2 · 10% (above the anchor), **when** the Overview renders, **then** the Rank KPI shows
  an upward (▴) movement indicator.
- **Given** the same anchor but matches netting to Gold 4 · 20% (below the anchor),
  **when** the Overview renders, **then** the Rank KPI shows a downward (▾) indicator.
- **Given** an anchor with no competitive matches logged after it, **when** the Overview
  renders, **then** the Rank KPI shows a neutral/flat state (no false ▴) and still shows the
  current in-division %.
- **Given** an anchored rank, **when** the user changes the date filter (7 days / 30 days /
  a season / all time), **then** the movement indicator does not change (it measures
  anchor → now).
- **Given** an anchor of Gold 3 and matches that climb the current rank to Platinum 5,
  **when** the Overview renders, **then** the Rank KPI shows a ▴ up indicator (the delta spans
  the multi-division/tier climb).
- **Given** no anchor is set, **when** the Overview renders, **then** the winrate-heuristic
  rank shows its existing delta arrow, unchanged.

---

## Area B — Rank transitions across boundaries: both directions update the rank and keep tracking

### Problem
The engine's protection model (`src/core/rank/engine.ts:64-94`) treats the second
consecutive dip as a demotion that sets `needsReanchor` (`src/core/rank/types.ts:42-47`),
which freezes every later match (`src/core/rank/engine.ts:67`) and forces the user back to
Settings › Accounts to re-set their rank. Reproduced (anchor Gold 3 · 10%): a Win +22 →
32%; a Loss −40 → **held Gold 3, −8% buffer, 🛡** (correct); a further Loss → **Gold 4,
`needsReanchor`** → the match detail shows "Demoted — set your new rank to resume tracking"
and tracking stops. The user wants the second dip to land on the demoted rank (Gold 4) and
keep going — and promotions to remain correct and symmetric.

### Requirements
- **B1. First dip unchanged.** A loss that drops below the division floor for the first time
  keeps holding the division with the negative buffer % and the 🛡 shield — confirmed
  correct, no change (`src/core/rank/engine.ts:80-82`,
  `renderer/src/views/matchDetail.ts:227-231`).
- **B2. Second dip demotes and continues.** A further loss while protected lands on the
  demoted division as a **normal, tracked** position (concrete tier/division + progress %),
  clears the shield (a fresh division is unprotected again), and does **not** set a
  "needs re-anchor" freeze. Subsequent matches move the rank from the demoted position.
- **B3. Demotion carries the buffer into the lower division.** Dropping `X`% below the
  division floor lands at `(100 − X)`% of the next-lower division (e.g. an accumulated
  −18% buffer → **Gold 4 · 82%**). If the buffer exceeds one division it **cascades**
  (mirrors the existing upward cascade in `applyGain`), and it **floors at Bronze 5 · 0%**.
  The landing % is arithmetic on the user's logged SR deltas — no hidden game data
  (Guardrail 1).
- **B4. Promotions update symmetrically.** Crossing 100% promotes to the next division — and
  across a tier boundary at division 1 (Gold 1 → Platinum 5) — carrying the remainder, as a
  normal tracked rank. Includes climbing **out of protection**: a win first pays down the
  negative buffer, then promotes if the total clears 100%. **Caps at Champion 1 · 100%.**
  Promotion and demotion **share one symmetric carry** in the engine so the two directions
  cannot drift apart.
- **B5. Every surface drops the dead-end, consistently.** The "Demoted — set your new rank /
  set %" messaging is removed from the match-detail competitive section
  (`renderer/src/views/matchDetail.ts:224-226`), the Overview Rank KPI
  (`renderer/src/views/overview.ts:115-116`), the sidebar rank chip
  (`renderer/src/app/shell.ts:601`), and the Accounts rank pills
  (`renderer/src/views/settings/accounts.ts:72`) — all now show the demoted division as a
  live rank. The manual "Set rank" affordance (`renderer/src/views/settings/accounts.ts:102-145`)
  stays available; it is simply no longer *forced*.

### Acceptance criteria
- **Given** an anchored rank at Gold 3 · 32%, **when** a logged −40 loss sends the player into
  rank protection, **then** that match's detail shows Gold 3 held, the 🛡 shield, and the
  negative buffer % (unchanged).
- **Given** the player is already in rank protection at Gold 3 with an accumulated −18% buffer
  below the floor, **when** a further loss triggers the second dip, **then** the demoted rank
  is **Gold 4 · 82%**, shown as a normal tracked rank with a progress bar — **not** a
  "Demoted — set your new rank to resume tracking" message.
- **Given** a match that demoted the player to Gold 4, **when** a later competitive match is
  won, **then** the rank moves upward from Gold 4 (later matches are no longer frozen).
- **Given** a rank set directly to a protected value (Gold 3 · −19%) followed by a loss,
  **when** the match detail renders, **then** it shows the demoted division as a tracked rank,
  with no dead-end.
- **Given** Gold 3 · 92%, **when** a Win of +20 is logged, **then** that match's detail shows
  Gold 2 (promoted within the tier), and a later loss moves down from Gold 2.
- **Given** Gold 1 · 90%, **when** a Win of +20 is logged, **then** the detail shows
  Platinum 5 (promoted across the tier boundary).
- **Given** the player is in protection at Gold 3 · −8%, **when** a Win of +130 is logged,
  **then** the buffer clears and the rank promotes to Gold 2 · ~22% (not stuck in protection).
- **Given** a champion at Champion 1 · 90%, **when** a large win is logged, **then** the rank
  caps at Champion 1 · 100%; **given** Bronze 5 · 0% and a demoting loss, **then** it floors
  at Bronze 5 · 0%.
- **Given** a demoted rank, **when** the Overview KPI, the sidebar chip, and the Accounts pill
  render, **then** all three show the same demoted division with no "set %"/"set your new
  rank" wording.

---

## In-Scope / Out-of-Scope

**In scope:** the rank-delta computation (`src/core/rank`, `src/core/dashboardData.ts`); the
symmetric promotion/demotion carry rework in the rank engine (`src/core/rank/engine.ts` —
`applyMatch`, `applyGain`/`demoteOne` or their replacement, retiring the `needsReanchor`
freeze; `src/core/rank/types.ts`); IPC-contract updates (`primaryRank` delta; the protection
state on `competitive` / `RankSummary`); the four renderer surfaces (Overview KPI, sidebar
chip, Accounts pills, match-detail competitive section); the preview harness mock where it
mirrors these (`renderer/preview/preview.ts`); unit tests for all changed core logic; and
README/spec doc updates.

**Out of scope:**
- Adding the movement indicator to the **sidebar** rank chip — Area A targets the Overview
  KPI only, as requested. (Open for a later follow-up.)
- Changing the **first-dip** protection model or the negative-buffer display — confirmed
  correct and owned by the completed `rank-protection-carryover` spec.
- Any new source of rank truth — rank stays computed from the user-set anchor + logged SR
  deltas (Guardrail 1). GEP/live rank reading remains out.
- The winrate-heuristic `progression` fallback (`src/core/progression.ts`) — unrelated
  system, unchanged.
- Reworking the "Set rank" modal beyond removing the *forced* re-anchor (it stays a manual,
  optional action).

## Constraints
- All five CLAUDE.md guardrails hold. `src/core/` stays pure & Electron-free — the delta and
  the symmetric carry logic live there with vitest coverage.
- Rank numbers are derived only from the user's anchor and logged SR deltas; the demotion
  landing % is computed arithmetic, never fabricated hidden info (Guardrail 1).
- The IPC contract stays typed end-to-end; all shape changes go through `src/shared/contract/`.
- Backwards compatibility: existing anchors + histories recompute cleanly; any persisted/JSON
  state that referenced the old `needsReanchor` freeze degrades without error.
- Definition of Done per CLAUDE.md: `npm test` + `npm run typecheck` clean; changed pure
  logic ships with unit tests; README/docs updated for user-visible behavior changes.

## Resolved Questions
1. **What does the Overview "rank delta" measure when a rank is set directly?** Net movement
   since the anchor was set (anchor → now), independent of the date filter (A2).
2. **Is the first-dip protection display (held division, negative %, shield) wrong?** No —
   confirmed correct; unchanged (B1).
3. **What's actually wrong on the protection path?** The *second* dip (demotion) dead-ends
   into "needs re-anchor / set your new rank"; it should update to the new demoted rank
   (e.g. Gold 4) and keep tracking (B2).
4. **Where does the demoted rank land?** Carry the buffer into the lower division —
   `(100 − X)`% (e.g. −18% → Gold 4 · 82%), cascading across divisions and flooring at
   Bronze 5 (B3).
5. **Must upranking keep working?** Yes — promotions are handled symmetrically to demotions
   via one shared carry, including promotion out of a protected buffer (B4).
6. **How wide is the fix?** Everywhere the demoted/re-anchor state appears — match detail,
   Overview KPI, sidebar chip, Accounts pills — for consistency (B5).
7. **Sidebar movement indicator?** Overview KPI only for now; the sidebar chip stays a
   compact label (Out-of-Scope).

## Open Questions
- **`needsReanchor` field:** with the carry making every demotion land on a concrete tracked
  rank, the field becomes always-false. Remove it from the contract entirely, or retain it
  always-false? Techplan decision (no surface shows the dead-end either way).
- **Area A display format:** show the movement as divisions climbed/dropped, as %-points, or
  as direction-only — a techplan/UX detail (direction is the hard requirement).

## GitHub issues to create after approval
1. `rank` — Overview Rank KPI: always show the rank-movement delta, including for anchored
   ranks (Area A).
2. `rank` — Rank transitions: demotion carries the buffer into the lower division and keeps
   tracking (no forced re-anchor); promotions symmetric (Area B).
