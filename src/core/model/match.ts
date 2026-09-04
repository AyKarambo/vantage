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
  /**
   * True for the tracked (local) player — parsed from the GEP `is_local` flag,
   * and confirmed by the aggregator on the local entry (BattleTag match fallback).
   */
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
  /**
   * Time on this hero, in fractional minutes, when the aggregator could time
   * the hero swaps. On records that carry {@link MatchRecord.rounds} this is
   * PLAYED time — the swap segment clipped to the rounds' play windows (setup
   * phases, the pre-round hero select and the post-match scoreboard removed).
   * Older captures timed swaps by wall clock instead (first hero from match
   * start, last hero to match end); {@link ../playedTime} scales those down at
   * read time. Absent on manual logs — consumers fall back to an equal split
   * of the played time (see {@link ../perHero}).
   */
  minutes?: number;
}

/**
 * One GEP round (`round_start` → `round_end`), absolute epoch ms. Real captures
 * show the between-round setup phase lives INSIDE the next round (round_end →
 * round_start is ~1 s), so a round's span still includes its own setup lock;
 * {@link ../playedTime} subtracts that per game mode.
 */
export interface RoundSpan {
  startedAt: number;
  endedAt: number;
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
  /** Wall-clock `match_start` → `match_end`, rounded to whole minutes — the displayed match length. */
  durationMinutes?: number;
  /** Every GEP round observed, in order. Absent when the feed sent no round events. */
  rounds?: RoundSpan[];
  /**
   * Minutes the player could actually fight: the rounds' play windows summed
   * (each round minus its mode's setup lock; the pre-round hero select and the
   * post-match scoreboard fall outside every round). Fractional, unrounded.
   * Absent without round events — {@link ../playedTime} then estimates it.
   */
  playedMinutes?: number;
  /** Signed competitive SR change for this match (percentage points of a division). */
  srDelta?: number;
}

/** Create an empty, mutable record with a given match id. */
export function emptyMatch(matchId: string): MatchRecord {
  return { matchId, heroes: [] };
}
