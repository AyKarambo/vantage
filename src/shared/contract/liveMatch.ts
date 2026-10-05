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
 * for Stadium mode". So this payload carries DEATHS per team, summed off the
 * roster, named for what they are. The UI must never present them as the match
 * score.
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
  /** A revive rather than a kill — nobody died. */
  revive?: boolean;
  /**
   * The victim was a hero's DEPLOYABLE (turret, pylon, trap), not a player.
   * Overwatch reports destroying one as an ordinary kill event. Shown in the
   * feed — it did happen — but marked so it reads as a destroy, not a kill.
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
   * Damage, healing and deaths summed per side — "who is out-damaging whom" and
   * "who is losing more players" at a glance. NOT the objective score — Overwatch's
   * feed reports none.
   *
   * From the ROSTER, not the kill feed, so these survive the kill feed being
   * switched off: they are TAB-screen numbers the game itself is showing, and
   * `deaths` is by construction the sum of the D column. Only players have a
   * death count, so a destroyed deployable or a revive can never inflate it.
   * `known` is false when the feed didn't report enough teams to have a "your
   * side" at all, in which case the UI shows nothing rather than a pair of totals
   * with nothing to compare them to. `deathsKnown` additionally requires each side
   * to have reported at least one `deaths` value, so an unreported side is never
   * shown as a confident 0.
   */
  totals: {
    yours: { damage: number; healing: number; deaths: number };
    theirs: { damage: number; healing: number; deaths: number };
    known: boolean;
    deathsKnown: boolean;
  };
  /** Recent kill-feed entries, newest first. Empty when the user turned it off. */
  feed: LiveKillEntry[];
  /**
   * Whether the feed reported team numbers. When false the roster can't be split
   * into your side and theirs, so "with"/"vs" is unknowable and the UI says so
   * instead of guessing.
   */
  teamsKnown: boolean;
}
