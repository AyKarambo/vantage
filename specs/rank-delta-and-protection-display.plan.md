---
slug: rank-delta-and-protection-display
status: plan
updated: 2026-07-07
---

# Technical Plan: Rank delta & protection display

**Spec:** `specs/rank-delta-and-protection-display.spec.md` (Approved 2026-07-07)
**Grounded by:** 5 parallel `Explore`-class research agents (engine, contract, renderer, tests,
reference sweep) + two local probe validations (ladder round-trip math; anchor-store back-compat).

This plan resolves the spec's two Open Questions:
- **`needsReanchor` → REMOVE it entirely** (from `RankState` and all three contract DTOs), not
  keep-always-false. Reason: these DTOs are computed fresh every IPC call and shipped as one
  bundled app — there is no external/older consumer to preserve. Removing the field turns every
  stale "set your new rank" dead-end read into a **compile error**, so `npm run typecheck` becomes
  the guarantee that Area B5 caught every surface (keep-always-false would let the dead-end
  branches silently keep compiling as dead code — the exact thing the spec wants gone).
- **Area A delta display format:** the KPI keeps rendering the current in-division % (parity with
  the heuristic branch) and gains a real **▴ / ▾ / neutral** direction driven by the new
  `primaryRank.delta` sign. Surfacing the numeric magnitude is an optional nicety, not required.

---

## 1. Architecture & Approach

### 1a. One continuous "ladder points" scale (the core idea)

Introduce a monotonic scalar for any ladder position and its inverse, both living in
`src/core/rank/engine.ts` next to the `TIERS` array they must never drift from:

```
MAX_POINTS = 4000                       // Champion 1 / 100%  (7*500 + (5-1)*100 + 100)

ladderPoints(pos)          = tierIdx(pos.tier)*500 + (5 - pos.division)*100 + pos.progressPct
positionFromPoints(pts):
  p = clamp(pts, 0, MAX_POINTS)
  if (p >= MAX_POINTS) return { Champion, 1, 100 }   // ceiling
  ti        = floor(p / 500)                          // 0..7
  within    = p - ti*500                              // 0..499
  divOffset = floor(within / 100)                     // 0..4
  return { TIERS[ti], division: 5 - divOffset, progressPct: within - divOffset*100 }
```

`ladderPoints` accepts a **negative** `progressPct` (a protection buffer), so a position 18%
below the Gold 3 floor is simply `ladderPoints(Gold,3,-18) = 1182`, which
`positionFromPoints` decodes back to **Gold 4 · 82%**. This single round-trip is the whole of
Area B's carry: **promotion and demotion are the same expression**
`positionFromPoints(ladderPoints({...state, progressPct: next}))`, so they can never drift (B4).

Validated locally against every spec number: Gold 4·82%, Gold 4·76%, Gold 2·22%, the Champion 1·100%
cap, the Bronze 5·0% floor, and a 3-division cascade across a tier boundary (Gold 5 buffer −255 →
Silver 3·45%). The existing promotion tests (`rank.test.ts:43-56`) reproduce identically.

### 1b. `applyMatch` rewrite (Area B — `src/core/rank/engine.ts:64-94`)

Delete the freeze (`engine.ts:67`) and the `demoteOne` call; keep the first-dip hold and the
pay-down branch verbatim. The **only** behavioral change is the second dip and the removal of the
freeze:

```ts
export function applyMatch(state: RankState, match: RankMatchInput): RankState {
  const delta = match.srDelta ?? 0;
  const next = state.progressPct + delta;

  if (match.result === 'Loss') {
    // next>0 → normal within-division / climb; protected → SECOND dip carries down. Same carry.
    if (next > 0 || state.protected) {
      return { ...positionFromPoints(ladderPoints({ tier: state.tier, division: state.division, progressPct: next })), protected: false };
    }
    // FIRST dip: hold the division, keep the true negative buffer. (B1 — unchanged.)
    return { tier: state.tier, division: state.division, progressPct: next, protected: true };
  }

  // Win / Draw
  if (next > 0) {
    return { ...positionFromPoints(ladderPoints({ tier: state.tier, division: state.division, progressPct: next })), protected: false }; // pay down, then climb
  }
  if (state.protected) {
    return { tier: state.tier, division: state.division, progressPct: next, protected: true }; // buffer not cleared, stays protected
  }
  return { tier: state.tier, division: state.division, progressPct: 0, protected: false }; // floor, DO NOT demote
}
```

**Critical subtlety (do not regress):** the final Win/Draw branch must keep flooring an
unprotected non-positive result to the current division at 0% — it must **not** route through the
shared carry, or a win/draw with a negative delta would wrongly demote. This preserves the
"a position only demotes by passing through protection first" invariant.

`applyGain` (`engine.ts:23-42`) and `demoteOne` (`engine.ts:45-56`) are deleted — both are
module-private (not in `index.ts`'s exports), so removal is internal-only and safe.
`stateFromAnchor` (`103-112`) and `computeRank` (`119-123`) keep their logic; they only lose the
`needsReanchor` field.

### 1c. The anchor→now delta (Area A)

Export `ladderPoints` from `src/core/rank/index.ts`. In `primaryRankOf`
(`src/core/dashboardData.ts:248-269`), which already has both operands in scope:

```ts
const anchor = anchors[rankKey(account, role)];
const rank   = currentRank(all, anchors, account, role);   // computed over the UNFILTERED `all`
if (!rank || !anchor) return undefined;
const delta  = ladderPoints(rank) - ladderPoints(anchor);
return { account, role, tier: rank.tier, division: rank.division,
         progressPct: rank.progressPct, protected: rank.protected, delta };
```

- **Filter independence (A2)** falls out for free: `primaryRankOf` is called with `all` (the
  unfiltered competitive history, `dashboardData.ts:54,62`); `currentRank` internally scopes to
  (account, role, after `anchor.setAt`). The active date filter never enters this path.
- **Neutral (A3) needs no special-casing:** with zero matches after the anchor,
  `currentRank → stateFromAnchor(anchor)`, so `ladderPoints(rank) === ladderPoints(anchor)` →
  `delta === 0`. `delta === 0` is the single neutral signal the renderer keys on.
- Unit: %-points of a division (100 = one division), identical to `Progression.delta`, so the
  Overview KPI reads `.delta` uniformly across both branches.

### 1d. Renderer + edges (Area B5)

Removing `needsReanchor` from the contract forces each dead-end read to be updated (compile error):

- **Overview KPI** (`renderer/src/views/overview.ts:107-131`): drop the `r.needsReanchor` ternary
  arm (`:114-115`); replace the hard-coded `dir: 'up'` (`:119`) with
  `dir: r.delta === 0 ? undefined : r.delta > 0 ? 'up' : 'down'` and prefix the text with the
  matching `▴ / ▾ / –` glyph (mirroring the heuristic branch at `:127`). `value` already renders
  `rankLabel(r.tier, r.division)` unconditionally, so the demoted division shows automatically.
- **Sidebar chip** (`renderer/src/app/shell.ts:598-607`): delete the `needsReanchor` early-return
  (`:601`); it falls through to the existing normal-rank line. **No delta here** (Area A is
  Overview-only, spec Out-of-Scope + Resolved Q7).
- **Accounts pills** (`renderer/src/views/settings/accounts.ts:70-79`): collapse the `:72` ternary
  to the plain `rankLabel · %  🛡` form; simplify the `openSetRank` prefill (`:112`) to
  `String(Math.round(ex.progressPct))`. The "Set rank" modal stays (manual affordance, not a
  forced dead-end).
- **Match detail** (`renderer/src/views/matchDetail.ts:208-249`): delete the `c.needsReanchor`
  dead-end arm (`:224-226`). Once `competitiveOf` stops nulling `progressPct` (below), the existing
  `statBar` branch renders the demoted rank as a normal progress bar — no new UI.
- **Log-match** (`renderer/src/app/log-match.ts:366`) — *not in the spec's B5 list but a real
  consumer*: simplify the `r.needsReanchor ? '' : …` anchor prefill to
  `String(Math.round(r.progressPct))`. Cleaned in the same change for consistency.

Core producer edits these depend on:
- `src/core/matchDetail.ts:120` → `progressPct: rank.progressPct` (drop the `needsReanchor ?
  undefined :` mask); remove `:122`'s `needsReanchor` copy.
- `src/core/dashboardData.ts:267` → drop `needsReanchor`, add `delta`.
- `src/main/dataProvider.ts:415` (`rankSummaries`) → drop `needsReanchor`.
- `renderer/preview/preview.ts:125` (`previewRanks`) → drop `needsReanchor`. (Everything else in
  the preview harness delegates to the real core — `getDashboard`/`matchDetail` mocks update
  automatically.)

`rankSummaries` (`dataProvider.ts:403-418`) and `previewRanks` (`preview.ts:116-128`) are genuine
parallel implementations and must be edited in lockstep.

---

## 2. Affected Files / Modules

**Core (pure, unit-tested):**
- `src/core/rank/engine.ts` — ADD `ladderPoints`, `positionFromPoints`, `MAX_POINTS`; REWRITE
  `applyMatch`; REMOVE `applyGain`, `demoteOne`; drop `needsReanchor` from every returned literal.
- `src/core/rank/types.ts` — REMOVE `RankState.needsReanchor` (`:47`); refresh the `progressPct` /
  `protected` doc comments (a demotion now yields a concrete tracked position, no "unknown %").
- `src/core/rank/index.ts` — export `ladderPoints` (and optionally a `rankDelta(from,to)` helper).
- `src/core/dashboardData.ts` — `primaryRankOf`: compute `delta`, drop `needsReanchor` (`:267`).
- `src/core/matchDetail.ts` — `competitiveOf`: `progressPct` unconditional (`:120`), drop
  `needsReanchor` (`:122`).
- `src/core/rank/timeline.ts` — no logic change (bridge only).

**Contract (typed IPC):**
- `src/shared/contract/dashboard.ts` — `primaryRank`: ADD `delta: number`; REMOVE `needsReanchor`
  (`:103`).
- `src/shared/contract/accounts.ts` — `RankSummary`: REMOVE `needsReanchor` (`:46`); fix the
  `progressPct` doc (`:38`).
- `src/shared/contract/matchDetail.ts` — `competitive`: REMOVE `needsReanchor` (`:90`); update
  prose (`:81`). (Its pre-existing `delta?` is the *estimate*-path field — left as-is.)

**Main process:**
- `src/main/dataProvider.ts` — `rankSummaries` (`:403-418`): drop `needsReanchor` (`:415`).
- `src/main/dashboard/provider.ts` / `ipcHandlers.ts` — no shape edit; typecheck against the new
  DTOs (IPC boundary control point).

**Renderer:**
- `renderer/src/views/overview.ts` (rankKpi), `renderer/src/app/shell.ts` (rankLine),
  `renderer/src/views/settings/accounts.ts` (ranksLine + openSetRank prefill),
  `renderer/src/views/matchDetail.ts` (competitiveSection), `renderer/src/app/log-match.ts`
  (anchor prefill) — as detailed in §1d.
- `renderer/preview/preview.ts` — `previewRanks` (`:125`).

**Not touched (confirmed by the sweep):** `src/store/rankAnchors.ts` (persists only the anchor
shape — no `needsReanchor`/`RankState` on disk → no migration), `src/core/dataMigration.ts`
(opaque filename only), `src/store/history.ts`, `src/store/manualLog.ts`, and all of
`src/notion/` (rank has **no** Notion path).

---

## 3. Data Model / Interfaces

**New (core):**
```ts
// src/core/rank/engine.ts — exported via index.ts
export function ladderPoints(pos: RankPosition): number;          // monotonic 0..4000
function positionFromPoints(points: number): RankPosition;         // inverse, clamped [Bronze5/0, Champion1/100]
```

**`RankState` (types.ts):** loses `needsReanchor`; becomes
`RankPosition & { protected: boolean }`. `progressPct` may still be negative while `protected`
(first-dip buffer); after any demotion it is a concrete non-negative division %.

**`primaryRank` (dashboard.ts):**
```ts
primaryRank?: {
  account: string; role: Role; tier: string; division: number;
  progressPct: number; protected: boolean;
  /** Signed ladder movement anchor→now, in %-points of a division (100 = one division);
      >0 climbed, <0 dropped, 0 neutral. Full history, filter-independent. */
  delta: number;
};
```

**`RankSummary` (accounts.ts)** and **`MatchDetail['competitive']` (matchDetail.ts):** both lose
`needsReanchor`. `competitive.progressPct` is now always defined on the `'calculated'` path.

**Persisted shape:** `rankAnchors.json` / `RankAnchor` / `AnchorRecord` — **unchanged**. Old files
recompute cleanly (the removed field was never stored).

---

## 4. Test Strategy

All engine/delta logic is pure → vitest-covered (DoD §3). No renderer test files exist by project
convention; B5's string removals are verified via `npm run preview` + typecheck.

**Update (`test/rank.test.ts`) — the demotion/freeze tests that assert the old behavior:**
- `:98-104` second-dip demote → now `{division:4, progressPct:72, protected:false}` (buffer
  −28 → 72%); rename off "flags a re-anchor".
- `:106-111`, `:113-118` → add `progressPct===60`, drop `needsReanchor`.
- `:120-124` "cannot demote below Bronze 5" → strengthen with `progressPct===0`, `protected===false`.
- `:126-131` "later matches are frozen" → **replace**: the two trailing wins now DO apply
  (Gold 4·72 → +30 → Gold 3·2 → +30 → Gold 3·32); assert tracking continues.
- `:172-176` protected anchor (Gold 3·−19) + loss(−5) → `{division:4, progressPct:76,
  protected:false}`.
- Invariant to grep after: **zero** `needsReanchor).toBe(true)` remain in `test/`.
- Confirm still-green (B4 no-drift): promotion tests `:43-56`, first-dip/pay-down `:60-96`,
  `stateFromAnchor` primitives `:145-181` (minus the two updated rows).

**New — Area B (`test/rank.test.ts`):** carry landings (Gold 3 buffer −18 → Gold 4·82;
Gold 3·−19 anchor + loss → Gold 4·76); promotion out of protection (Gold 3·−8 + win130 →
Gold 2·22); **multi-division cascade** (buffer > 100 crossing two boundaries); large-overshoot
**floor** (Bronze 5·−5 + loss(−500) → Bronze 5·0); a **symmetry/round-trip** test (loss X then win
X returns to start) proving B4.

**New — Area A:**
- A dedicated `ladderPoints` describe in `test/rank.test.ts`: two positions in → signed %-points
  out; same-position → 0; cross-tier magnitude > 100.
- `test/vantageCore.test.ts` (existing `primaryRank` block ~`:178-231`, local-factory-per-`it`
  convention, `toMatchObject` so added fields don't break existing cases): anchor + climbing games
  → `delta > 0`; losing games → `delta < 0`; no post-anchor games → `delta === 0` with `progressPct`
  still the anchor's; **same `delta` across `filters.days` 7 / 30 / 'all'** (A2); multi-tier climb
  → `delta > 100`.

**New — close the match-detail `'calculated'` gap (`test/matchDetail.test.ts`):** the file today
only exercises the `'estimate'` fallback. Add, via an `anchors` map through the public
`matchDetail(games, id, ctx, anchors)`: a plain calculated case (`protected:false`); a first-dip
protected case (defined negative `progressPct`); a post-demotion case asserting `progressPct` is a
**defined non-negative number** (proves `:120` no longer yields `undefined`).

---

## 5. Risks & Alternatives

1. **Floating-point boundaries.** `srDelta` is typed `number`; a fractional accumulation landing at
   e.g. `199.9999` could misplace a division via `floor(within/100)`. Today's `applyGain`
   `while (p>=100)` carries the same risk. Mitigation: deltas are integer %-points in practice;
   `positionFromPoints(ladderPoints(x)) === x` is exact for integer input; optionally snap `within`
   with a tiny epsilon. Display already `Math.round`s everywhere.
2. **The non-demoting Win/Draw floor.** Called out in §1b — the last branch must stay an explicit
   `progressPct: 0` return, never the shared carry. A dedicated test guards it.
3. **`needsReanchor` removal blast radius (~19 sites).** Mitigated by design: the typechecker flags
   every one. Verified against a full-tree grep (contract ×3, core ×4, main ×1, renderer ×5,
   preview ×1, tests). *Alternative considered:* keep-always-false — smaller diff but leaves the
   dead-end branches compiling as dead code, defeating B5. Rejected.
4. **Delta field name.** Chosen `delta` for uniformity with `Progression.delta` / `competitive.delta`
   (lets the KPI read `.delta` across both branches). Semantics differ (anchor→now absolute vs
   winrate recent-form), disambiguated by the doc comment. *Alternative:* `deltaSinceAnchor` /
   `movementPct` if reviewers prefer explicitness — trivial rename, no logic impact.
5. **`log-match.ts` scope creep.** It reads `needsReanchor` (`:366`) though the spec's B5 list omits
   it; removing the field forces a one-line prefill simplification. Included deliberately —
   leaving it would be a compile error otherwise.
6. **Behavior-change surface.** `competitive.progressPct` becomes always-defined on the calculated
   path and demotions now report a real % instead of `0`/`undefined`; any downstream snapshot
   expecting the old values changes. Enumerated in §2/§4 — no consumer outside the listed set.

*Alternative architecture rejected:* patching `applyGain` and `demoteOne` separately to each carry
their direction. It works but lets the two directions drift independently; the single
`ladderPoints`/`positionFromPoints` pair makes symmetric carry (B4) a structural guarantee, not a
convention, and gives Area A its delta scalar for free from the same helper.
