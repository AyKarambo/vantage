/**
 * The in-progress match, pushed to the renderer while one is running.
 * Electron-free so main, preload and the renderer bundle can all share it.
 *
 * Everything here is TAB-screen data the game itself displayed (guardrail #1) —
 * never memory, never hidden information.
 *
 * ## There is no live score
 *
 * Overwatch's GEP feed exposes no objective score: the documented `match_info`
 * info-updates are exactly `map`, `pseudo_match_id`, `match_outcome`,
 * `round_outcome` and `match_id`, and `round_outcome` is documented "Only works
 * for Stadium mode". So this payload carries an ELIMINATION tally derived from
 * the `kill_feed` event stream, named for what it is. The UI must never present
 * it as the match score.
 */
import type { ScoreboardEntry } from './matchDetail';

/** One entry from the live kill feed. */
export interface LiveKillEntry {
  /** ms epoch this was observed. */
  at: number;
  attacker?: string;
  victim?: string;
  attackerHero?: string;
  victimHero?: string;
  /** True when the attacker was on your team; absent when the feed didn't say. */
  attackerFriendly?: boolean;
  /** A revive rather than a kill — never counted as an elimination. */
  revive?: boolean;
  /**
   * The victim was a hero's DEPLOYABLE (turret, pylon, trap), not a player.
   * Overwatch reports destroying one as an ordinary kill event, so without this
   * the elimination tally is inflated in every match. Shown in the feed — it did
   * happen — but never counted.
   */
  deployable?: { hero: string; label: string };
}

export interface LiveMatchPayload {
  /** Whether a match is in progress right now. */
  live: boolean;
  /** ms epoch the current match started. */
  startedAt?: number;
  /** ms epoch the last match ended — the idle screen's "just finished" note. */
  endedAt?: number;
  /** Canonical map name, once the feed reports one. */
  map?: string;
  /** Raw GEP game type (e.g. 'competitive'), for the "not a ranked game" note. */
  gameType?: string;
  /** Scoreboard rows — the same shape the stored match detail renders. */
  roster: ScoreboardEntry[];
  /**
   * Eliminations tallied from the kill feed, by side. NOT the objective score —
   * Overwatch's feed reports none. `known` is false when the feed never said
   * which side an attacker was on, in which case the counts are meaningless and
   * the UI shows nothing rather than a zero.
   */
  kills: { yours: number; theirs: number; known: boolean };
  /**
   * Damage and healing summed per side — "who is out-damaging whom" at a glance.
   *
   * From the ROSTER, not the kill feed, so unlike {@link kills} these survive the
   * kill feed being switched off: they are TAB-screen numbers the game itself is
   * showing. `known` is false when the feed didn't report enough teams to have a
   * "your side" at all, in which case the UI shows nothing rather than a pair of
   * totals with nothing to compare them to.
   */
  totals: { yours: { damage: number; healing: number }; theirs: { damage: number; healing: number }; known: boolean };
  /** Recent kill-feed entries, newest first. Empty when the user turned it off. */
  feed: LiveKillEntry[];
  /**
   * Whether the feed reported team numbers. When false the roster can't be split
   * into your side and theirs, so "with"/"vs" is unknowable and the UI says so
   * instead of guessing.
   */
  teamsKnown: boolean;
}
