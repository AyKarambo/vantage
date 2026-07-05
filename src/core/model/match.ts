import type { Role } from './enums';

/**
 * The mutually referential match-record trio: a match holds a roster of
 * players and a per-hero breakdown, so they're defined together with the
 * record's constructor to avoid a circular split.
 */

/**
 * A roster entry for one player as reported by GEP. The feed may deliver the
 * local team only; only TAB-screen data is ever stored (guardrail #1).
 */
export interface RosterPlayer {
  battleTag?: string;
  heroName?: string;
  /** Raw role string from GEP: 'tank' | 'damage'/'offense' | 'support'. */
  heroRole?: string;
  /** GEP-reported team index, when the feed includes one. */
  team?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
  damage?: number;
  healing?: number;
  mitigation?: number;
  /** Set by the aggregator on the tracked player's entry (BattleTag match). */
  isLocal?: boolean;
}

/** Per-hero totals for the local player (one entry per hero used in a match). */
export interface HeroStat {
  hero: string;
  role?: Role;
  eliminations: number;
  deaths: number;
  assists: number;
  damage: number;
  healing: number;
  mitigation: number;
}

/**
 * One completed match, assembled by {@link MatchAggregator}. Fields are optional
 * because GEP availability varies; the writer only sets Notion properties that
 * are present.
 */
export interface MatchRecord {
  /** pseudo_match_id — the dedupe key. Falls back to a synthetic id if absent. */
  matchId: string;
  battleTag?: string;
  /** Raw GEP map name (resolved to a Maps relation later). */
  mapName?: string;
  /** Raw GEP outcome string (resolved to Win/Loss/Draw later). */
  outcome?: string;
  /** Raw GEP queue type, e.g. 'role' | 'open'. */
  queueType?: string;
  /** Raw GEP hero role for the local player (last hero). */
  heroRole?: string;
  /** Raw GEP game type, e.g. 'competitive' | 'quickplay' | 'arcade'. */
  gameType?: string;
  /** Distinct heroes the local player used this match, in order first seen. */
  heroes: string[];
  eliminations?: number;
  deaths?: number;
  assists?: number;
  damage?: number;
  healing?: number;
  mitigation?: number;
  /** Per-hero breakdown for the local player (one entry per hero used). */
  perHero?: HeroStat[];
  /** Latest roster snapshot per slot — whatever teams the feed reported. */
  roster?: RosterPlayer[];
  groupSize?: number;
  finalScore?: string;
  startedAt?: number;
  endedAt?: number;
  durationMinutes?: number;
  /** Signed competitive SR change for this match (percentage points of a division). */
  srDelta?: number;
}

/** Create an empty, mutable record with a given match id. */
export function emptyMatch(matchId: string): MatchRecord {
  return { matchId, heroes: [] };
}
