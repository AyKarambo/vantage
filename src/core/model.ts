/**
 * Domain types for the Overwatch → Notion Gametracker sync.
 *
 * These are intentionally free of any Electron / Overwolf / Notion imports so the
 * whole `core/` layer stays pure and unit-testable.
 */

/** Notion `Role` select options. */
export type Role = 'damage' | 'tank' | 'support' | 'openQ';

/** Notion `Result` select options. */
export type Result = 'Win' | 'Loss' | 'Draw';

/** Which matches we persist. Mirrors the user's decision (Competitive only by default). */
export type LogFilter = 'Competitive' | 'CompetitiveAndQuickPlay' | 'Everything';

/**
 * A single normalized GEP message. Both `new-info-update` and `new-game-event`
 * arrive from Overwolf as `{ gameId, feature, category?, key, value }`
 * (see @overwolf/ow-electron-packages-types modules/gep.d.ts).
 */
export interface GepMessage {
  /** 'info' = persistent state update, 'event' = discrete occurrence. */
  kind: 'info' | 'event';
  /** The GEP feature, e.g. 'game_info', 'match_info', 'roster', 'kill'. */
  feature: string;
  /** Info-update category (events have none). */
  category?: string;
  /** The info/event key, e.g. 'map', 'match_outcome', 'match_start'. */
  key: string;
  /** Raw value — may be a primitive or an already-parsed object. */
  value: unknown;
}

/** A roster entry for one player as reported by GEP (local team only). */
export interface RosterPlayer {
  battleTag?: string;
  heroName?: string;
  /** Raw role string from GEP: 'tank' | 'damage'/'offense' | 'support'. */
  heroRole?: string;
  kills?: number;
  deaths?: number;
  assists?: number;
  damage?: number;
  healing?: number;
  mitigation?: number;
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
  groupSize?: number;
  finalScore?: string;
  startedAt?: number;
  endedAt?: number;
  durationMinutes?: number;
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

/** Create an empty, mutable record with a given match id. */
export function emptyMatch(matchId: string): MatchRecord {
  return { matchId, heroes: [] };
}
