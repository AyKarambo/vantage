import type { Role } from '../model';

/**
 * Types for the calculated-rank engine. Overwatch 2 comp rank is a tier
 * (Bronze→Champion) × division (5 lowest … 1 highest) plus a 0–100% progress
 * within the division; wins add %, losses subtract %. Rank is tracked per
 * (account × role, Open Queue included), so each role/account pair carries its
 * own anchor and running position.
 */

/** A tier/division/percent position on the ladder. */
export interface RankPosition {
  tier: string;
  /** 1..5 (5 = lowest band of the tier, 1 = highest). */
  division: number;
  /** 0..100 within the division. */
  progressPct: number;
}

/**
 * The one-time "this is my rank right now" reading for an (account, role).
 * Competitive matches with `timestamp > setAt` move the rank forward from here.
 */
export interface RankAnchor extends RankPosition {
  /** Epoch ms; the anchor reflects the rank as of this instant. */
  setAt: number;
}

/** The computed live position for an (account, role), plus its protection state. */
export interface RankState extends RankPosition {
  /**
   * Sitting at 0% after a loss, holding the division: the next loss demotes, a
   * win or draw climbs back out. Mirrors OW2's rank-protection buffer.
   */
  protected: boolean;
  /**
   * A protected loss demoted the division and the new intra-division % is
   * unknown — the app does not fabricate it. `progressPct` is meaningless while
   * this is true; the next logged match (or a manual re-anchor) sets the %.
   */
  needsReanchor: boolean;
}

/** One competitive match's contribution to the ladder. */
export interface RankMatchInput {
  result: 'Win' | 'Loss' | 'Draw';
  /** Signed %-points the game showed (e.g. +22, -19). Missing → no movement. */
  srDelta?: number;
}

/** anchors keyed by {@link rankKey}. */
export type RankAnchorMap = Record<string, RankAnchor>;

/** The stable key for an (account, role) rank track. */
export function rankKey(account: string, role: Role): string {
  return `${account}::${role}`;
}
