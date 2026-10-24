/**
 * Who the player queued with. Lives in `model/` so both the analytics
 * `GameRecord` and the party helpers can import it without a cycle.
 */

/** The people the player queued with for one match. */
export interface MatchParty {
  /** Display names (full BattleTag when known). Empty = explicit Solo. */
  members: string[];
  /** `manual` = the player entered it; `auto` = labelled from remembered friends. */
  source: 'auto' | 'manual';
}
