import type { RankAnchor, RankMatchInput, RankPosition, RankState } from './types';

/**
 * The pure ladder engine: apply logged skill-rating deltas to an anchor and get
 * the live rank, including Overwatch-style rank protection. No I/O, no dates, no
 * randomness — fully unit-tested.
 */

export const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster', 'Champion'];
const TOP = TIERS.length - 1;

/** Champion 1, 100% — the top of the ladder in {@link ladderPoints} units. */
const MAX_POINTS = TOP * 500 + 400 + 100;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const tierIdx = (tier: string) => {
  const i = TIERS.indexOf(tier);
  return i < 0 ? 0 : i;
};

/**
 * Project a ladder position onto a single monotonic scale: 0 = Bronze 5 / 0%,
 * 4000 = Champion 1 / 100%, each tier worth 500 and each division 100 (divisions
 * run 5 lowest → 1 highest). A negative `progressPct` — a rank-protection buffer —
 * yields a value below the division floor, which is exactly what lets one carry
 * handle both promotion and demotion.
 */
export function ladderPoints(pos: RankPosition): number {
  return tierIdx(pos.tier) * 500 + (5 - pos.division) * 100 + pos.progressPct;
}

/**
 * Inverse of {@link ladderPoints}: decode a (possibly out-of-range) point value
 * back to a real position, clamped to Bronze 5 / 0% at the bottom and Champion 1 /
 * 100% at the top.
 */
function positionFromPoints(points: number): RankPosition {
  const p = clamp(points, 0, MAX_POINTS);
  if (p >= MAX_POINTS) return { tier: 'Champion', division: 1, progressPct: 100 };
  const ti = Math.floor(p / 500);
  const within = p - ti * 500;
  const divOffset = Math.floor(within / 100);
  return { tier: TIERS[ti], division: 5 - divOffset, progressPct: within - divOffset * 100 };
}

/**
 * Carry a running total `next` (relative to `state`'s current division floor) to a
 * real position on the ladder scale. One shared path for both directions: a positive
 * overflow promotes across divisions/tiers (capping at Champion 1), a negative buffer
 * demotes across them (flooring at Bronze 5) — so promotion and demotion cannot drift.
 */
function carry(state: RankState, next: number): RankPosition {
  return positionFromPoints(ladderPoints({ tier: state.tier, division: state.division, progressPct: next }));
}

/**
 * Advance one competitive match. Protection keys on the running total's sign, not the
 * delta sign or the result type — a protected loss keeps its true negative carry (the
 * in-game rank-protection buffer, e.g. "-19%"), and the following win or draw pays that
 * carry down before it can climb, exactly as the live client does. A second dip while
 * protected demotes by carrying the buffer into the lower division and keeps tracking —
 * no freeze, no re-anchor dead-end.
 */
export function applyMatch(state: RankState, match: RankMatchInput): RankState {
  const delta = match.srDelta ?? 0;
  const next = state.progressPct + delta;

  if (match.result === 'Loss') {
    // A loss that stays positive is a normal within-division subtraction; a loss while
    // already protected is the second dip → carry the buffer down into a real, tracked
    // position. Both resolve through the shared carry and clear protection.
    if (next > 0 || state.protected) {
      return { ...carry(state, next), protected: false };
    }
    // First loss into the buffer: hold the division, keep the true (negative) carry —
    // the next match's delta is added on top of it, not on top of a phantom 0.
    return { tier: state.tier, division: state.division, progressPct: next, protected: true };
  }

  // Win or Draw: pay down any outstanding carry, then climb through the shared carry.
  if (next > 0) {
    return { ...carry(state, next), protected: false };
  }
  if (state.protected) {
    // Didn't fully clear the buffer — stays protected at the smaller negative carry.
    return { tier: state.tier, division: state.division, progressPct: next, protected: true };
  }
  // A non-protected win/draw that lands <= 0 (a negative delta) floors at the division's
  // 0% — it must NOT demote (demotion only ever happens by passing through protection).
  return { tier: state.tier, division: state.division, progressPct: 0, protected: false };
}

/**
 * Start a fresh live state from an anchor position. A negative `progressPct` is
 * a rank-protection carry (the buffer Overwatch shows as e.g. "-19%") — it is kept as
 * the true negative value and marks the state `protected`, so the next match's
 * delta pays it down exactly as a live protected loss does. Non-negative values
 * clamp into `[0,100]` and stay unprotected, as before.
 */
export function stateFromAnchor(anchor: RankAnchor): RankState {
  const p = clamp(anchor.progressPct, -100, 100);
  return {
    tier: anchor.tier,
    division: clamp(anchor.division, 1, 5),
    progressPct: p,
    protected: p < 0,
  };
}

/**
 * Replay an ordered list of competitive matches from an anchor to the live rank.
 * `comps` must already be filtered to the anchor's (account, role) and to
 * matches after `anchor.setAt`, in ascending time order.
 */
export function computeRank(anchor: RankAnchor, comps: RankMatchInput[]): RankState {
  let state = stateFromAnchor(anchor);
  for (const m of comps) state = applyMatch(state, m);
  return state;
}
