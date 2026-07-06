import type { RankAnchor, RankMatchInput, RankPosition, RankState } from './types';

/**
 * The pure ladder engine: apply logged skill-rating deltas to an anchor and get
 * the live rank, including OW2-style rank protection. No I/O, no dates, no
 * randomness — fully unit-tested.
 */

export const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster', 'Champion'];
const TOP = TIERS.length - 1;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const tierIdx = (tier: string) => {
  const i = TIERS.indexOf(tier);
  return i < 0 ? 0 : i;
};

/**
 * Add progress and carry upward across divisions/tiers. Never demotes: a value
 * below 0 floors at the division's 0% (demotion only happens on a loss, and is
 * handled by the protection path). Caps at Champion 1, 100%.
 */
function applyGain(pos: RankPosition, nextPct: number): RankPosition {
  let ti = tierIdx(pos.tier);
  let div = pos.division;
  let p = nextPct;
  while (p >= 100) {
    if (div > 1) {
      div -= 1;
      p -= 100;
    } else if (ti < TOP) {
      ti += 1;
      div = 5;
      p -= 100;
    } else {
      p = 100; // ceiling: Champion 1, 100%
      break;
    }
  }
  if (p < 0) p = 0;
  return { tier: TIERS[ti], division: div, progressPct: p };
}

/** Drop exactly one division, flooring at Bronze 5. Lands at 0% (unknown). */
function demoteOne(pos: RankPosition): RankPosition {
  let ti = tierIdx(pos.tier);
  let div = pos.division;
  if (div < 5) div += 1;
  else if (ti > 0) {
    ti -= 1;
    div = 1;
  } else {
    div = 5; // floor: already Bronze 5
  }
  return { tier: TIERS[ti], division: div, progressPct: 0 };
}

/**
 * Advance one competitive match. Protection keys on the running total's sign, not the
 * delta sign or the result type — a protected loss keeps its true negative carry (the
 * in-game rank-protection buffer, e.g. "-19%"), and the following win or draw pays that
 * carry down before it can climb, exactly as the live client does.
 */
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
    // the next match's delta is added on top of it, not on top of a phantom 0.
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

/** Start a fresh live state from an anchor position. */
export function stateFromAnchor(anchor: RankAnchor): RankState {
  return {
    tier: anchor.tier,
    division: clamp(anchor.division, 1, 5),
    progressPct: clamp(anchor.progressPct, 0, 100),
    protected: false,
    needsReanchor: false,
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
