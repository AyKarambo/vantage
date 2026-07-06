# Techplan: Rank-protection SR carryover

**Slug:** `rank-protection-carryover` — see `specs/rank-protection-carryover.spec.md`.

## Architecture & Approach

All the logic lives in one pure function: `applyMatch` in `src/core/rank/engine.ts:59-81`.
Today it's two independent branches (`Loss` vs. `Win`/`Draw`) that each recompute
`state.progressPct + delta` from scratch and hard-code `protected` to a fixed value —
that's exactly why the negative carry gets lost between them (the Loss branch clamps it
away; the Win/Draw branch never looks at whether `protected` was already true).

The fix computes `next = state.progressPct + delta` **once**, up front, and keys every
outcome off its sign, for both branches symmetrically:

```ts
export function applyMatch(state: RankState, match: RankMatchInput): RankState {
  // Once a protected loss has demoted, the rank is frozen until it's re-anchored
  // (the new intra-division % is unknown and must not be guessed).
  if (state.needsReanchor) return state;

  const delta = match.srDelta ?? 0;
  const next = state.progressPct + delta;

  if (match.result === 'Loss') {
    if (next > 0) {
      return { ...applyGain(state, next), protected: false, needsReanchor: false };
    }
    if (state.protected) {
      // Second consecutive dip into the buffer → demote one division, % now unknown.
      return { ...demoteOne(state), protected: false, needsReanchor: true };
    }
    // First loss into the buffer: hold the division, keep the true (negative) carry —
    // mirrors the in-game display. The next match's delta is added on top of it.
    return { tier: state.tier, division: state.division, progressPct: next, protected: true, needsReanchor: false };
  }

  // Win or Draw: pay down any outstanding carry before climbing.
  if (next > 0) {
    return { ...applyGain(state, next), protected: false, needsReanchor: false };
  }
  if (state.protected) {
    // Didn't fully clear the buffer — stays protected at the smaller negative carry.
    return { tier: state.tier, division: state.division, progressPct: next, protected: true, needsReanchor: false };
  }
  return { ...applyGain(state, next), protected: false, needsReanchor: false };
}
```

Key properties, traced against every existing test (verified by hand against
`test/rank.test.ts` before writing tasks — see "Risks & Alternatives" for the full trace):
- Normal (unprotected) play is untouched: whenever `next > 0`, behavior is identical to
  today (`applyGain` on the same operand it received before).
- The **second consecutive loss into the buffer still demotes** — the demotion branch
  only depends on `state.protected` being true and `next <= 0`, unchanged from today;
  `demoteOne` doesn't read `progressPct` so a negative input is harmless.
- `needsReanchor` freezing is untouched (it's the first line, unconditional).
- `applyGain` itself needs **no change** — it's only ever called with `next > 0`, same as
  today; its existing `if (p < 0) p = 0` line becomes dead for this path but harmless
  (kept as-is, no reason to touch working carry/promotion math per the spec's
  out-of-scope note).

No new fields are needed on `RankState`/`RankPosition` — `progressPct` was always a plain
`number`, so storing a negative value while `protected` is true is not a shape change,
just a semantics one. Doc comments are updated to say so.

## Affected Files/Modules

- `src/core/rank/engine.ts` — `applyMatch` rewritten as above. (~20 lines changed.)
- `src/core/rank/types.ts` — doc comments:
  - `RankPosition.progressPct`: note it can be negative while a computed `RankState` is
    `protected` (mirrors the in-game rank-protection buffer); anchors themselves stay
    `0..100` (unaffected, see below).
  - `RankState.protected`: replace "Sitting at 0% after a loss" with wording that
    reflects the negative carry.
- `src/shared/contract/accounts.ts` — `RankSummary.protected` doc comment, same wording
  update (no shape change, `progressPct: number` already allows any value).
- `src/shared/contract/matchDetail.ts` — `competitive.progressPct` doc comment (line
  ~76), same update.
- `test/rank.test.ts` — see Test Strategy.
- No changes to: `src/main/dataProvider.ts` (already just forwards `computeRank`'s
  output, `rankSummaries()` at line 309), `src/core/matchDetail.ts` (already forwards
  `rank.progressPct` as-is at line 118), or any renderer file — confirmed below.

## Data Model / Interfaces

No interface shape changes. `RankPosition.progressPct: number` and
`RankState.protected: boolean` already permit exactly what's needed; only their doc
comments change to describe the (already-legal) negative value.

`stateFromAnchor` (`engine.ts:84-92`) is untouched: it clamps a **manually entered**
anchor to `[0, 100]`, which is correct and orthogonal — an anchor is the user's one-time
"this is my rank right now" reading from Settings, never a mid-protection computed
value, so it can never itself be "in protection."

## Test Strategy

All changes are covered by `test/rank.test.ts` (vitest), per CLAUDE.md's requirement
that changed `src/core/` logic ships with unit tests. Two existing tests currently
assert the buggy values and must be corrected; new tests cover the reported scenario and
its immediate edge cases:

1. **Update** `'a loss that would drop below 0% holds the division at 0% and protects
   it'` (line 60-65): anchor `Gold 3 / 10%`, `loss(-20)` → today expects `progressPct: 0`;
   fixed expectation is `progressPct: -10` (the true carry). Rename to reflect that the
   division holds but the carry is kept, not zeroed.
2. **Update** `'a win while protected clears protection and climbs from 0%'` (line
   67-71): same anchor, `[loss(-20), win(25)]` → today expects `progressPct: 25`; fixed
   expectation is `progressPct: 15` (`-10 + 25`). Rename off "from 0%".
3. **Update** `'a draw counts as "not losing" — it keeps the rank and clears protection'`
   (line 73-77): `[loss(-20), draw(0)]` → today expects `protected: false`; fixed
   expectation is `protected: true` (a `0`-delta draw cannot pay down a `-10` carry) with
   `progressPct: -10` unchanged. Rename to describe "does not fabricate a climb."
4. **Add** a regression test using the reporter's exact numbers: anchor `Gold 3 / 1%`,
   `[loss(-20), win(26)]` → after the loss, `progressPct === -19` (matches the "-19%"
   the user saw in-game) and `protected === true`; after the win,
   `progressPct === 7` (`-19 + 26`), `protected === false`. This is the literal repro
   from the bug report.
5. **Add** a "win insufficient to clear the debt" test: anchor `Gold 3 / 10%`,
   `[loss(-20), win(6)]` → stays `protected: true`, `progressPct: -4`.
6. Full existing suite re-verified by hand-tracing every current rank-protection/
   promotion/demotion test against the new code (see plan body above) — no other test
   changes expected; running `npm test` after the change confirms it.
7. `npm run typecheck` (no type changes, but part of Definition of Done).
8. Renderer spot-check (no code change expected): confirm `statBar`
   (`renderer/src/components/primitives/stats.ts:39`) clamps a negative `frac` to `0`
   width — already true by inspection (`Math.max(0, Math.min(1, o.frac))`) — and that the
   percentage labels (Overview `renderer/src/views/overview.ts:114`, shell header
   `renderer/src/app/shell.ts:489`, Settings `renderer/src/views/settings.ts:238`, Match
   detail `renderer/src/views/matchDetail.ts:213`) are plain `Math.round(progressPct)`
   interpolations that already print a negative number correctly with no special-casing
   needed. Verified via the browser preview harness (`npm run preview`) using a
   simulated protected/negative anchor, screenshotted for the PR.

## Risks & Alternatives

- **Alternative considered:** add a separate `bufferDebt`/`carry` field instead of
  letting `progressPct` itself go negative. Rejected — it's a bigger surface change
  (new contract field, more call sites to update) for no behavioral gain, and the user's
  own description ("in game it shows as -19%") confirms the real client already treats
  the negative percentage as the canonical displayed value, so reusing `progressPct`
  is the smaller, more faithful change.
- **Alternative considered:** special-case `Draw` to always force-clear `protected`
  (preserve today's draw test as-is) instead of unifying it with `Win`. Rejected as the
  primary approach because it reintroduces the same "discard the carry" bug for draws;
  documented as the fallback if this corollary is vetoed at spec review (flagged in the
  spec's Resolved Questions #2).
- **Risk:** a save file / persisted `RankAnchorMap` on disk never stores a computed
  `RankState`, only user-entered anchors (already clamped `0..100`), so there's no
  migration concern for existing user data.
- **Risk:** downstream consumers assuming `progressPct >= 0` — searched all read sites
  (`dataProvider.ts`, `matchDetail.ts`, all renderer views); none clamp or assert
  non-negativity except `statBar`'s fill width, which already clamps safely.
