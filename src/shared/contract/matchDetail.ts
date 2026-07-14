/**
 * Match drill-down DTOs of the IPC contract: scoreboard rows, prior-encounter
 * history and the full match-detail payload. Electron-free so main, preload
 * and the renderer bundle can all share it.
 */
import type { Role, Result, HeroStat } from '../../core/model';
import type { MatchMental, MatchReview } from '../../core/analytics';

/**
 * One scoreboard row of the match detail page. Only end-of-match-screen data
 * the GEP roster actually reported — every stat is optional because feed
 * coverage varies (guardrail #1: never fabricate hidden info).
 */
export interface ScoreboardEntry {
  /** BattleTag or display name, exactly as GEP reported it. */
  name: string;
  hero?: string;
  role?: Role;
  /** GEP-reported team index; absent when the feed doesn't report teams. */
  team?: number;
  /** The tracked player's row(s) — tinted in the scoreboard. */
  isLocal: boolean;
  eliminations?: number;
  deaths?: number;
  assists?: number;
  damage?: number;
  healing?: number;
  mitigation?: number;
  /** Not exposed by GEP today — the column is hidden when absent everywhere. */
  perks?: string[];
}

/** A player from this match the user has encountered before (local index). */
export interface PlayerEncounter {
  name: string;
  /** Prior shared matches, excluding this one. */
  encounters: number;
  /** ms epoch of the most recent prior encounter. */
  lastSeen: number;
  /** The tracked player's results across those shared matches. */
  results?: { wins: number; losses: number };
}

/** One stored match the tracked player shared with a specific other player. */
export interface PlayerSharedMatch {
  matchId: string;
  timestamp: number;
  map: string;
  mapType: string;
  /** The tracked player's result that match. */
  result: Result;
  /** true = they were on your team; false = enemy; absent = teams unreported. */
  sameTeam?: boolean;
  /** The hero they played (their roster `heroName`), when reported. */
  hero?: string;
  /** Which of your accounts played it. */
  account: string;
}

/**
 * Every stored match the tracked player shared with one other player, plus a W/L
 * summary. Local, GEP-only, never exported (guardrail #5) — derived at query time
 * from the rosters stored on match history, keyed by normalized name.
 */
export interface PlayerMatchHistory {
  /** Best display name (prefers the #-tagged battleTag). */
  name: string;
  /** Number of shared matches. */
  encounters: number;
  /** ms epoch of the most recent shared match. */
  lastSeen: number;
  /** The tracked player's decided W/L across all shared matches. */
  results: { wins: number; losses: number };
  /** W/L split for matches where they were on your team (team relation known). */
  sameTeam: { wins: number; losses: number };
  /** W/L split for matches where they were on the enemy team (team relation known). */
  enemyTeam: { wins: number; losses: number };
  /** The shared matches, newest first. */
  matches: PlayerSharedMatch[];
}

/** Full match drill-down payload. Optional sections degrade per data tier. */
export interface MatchDetail {
  matchId: string;
  timestamp: number;
  account: string;
  role: Role;
  map: string;
  mapType: string;
  result: Result;
  gameType: string;
  /** 'manual' = hand-logged (fully editable); 'gep' = auto-tracked (facts locked). */
  source: 'manual' | 'gep';
  /** Logged skill-rating change for this competitive match, in %-points. */
  srDelta?: number;
  durationMinutes?: number;
  /** Self-rated performance for this match, 0-100, if the player rated it. */
  performance?: number;
  /** Round score, e.g. "2–1" (v2 capture); absent on older records. */
  finalScore?: string;
  heroes: string[];
  /** Local player's per-hero lines; [] when GEP gave no per-hero data. */
  perHero: HeroStat[];
  mental?: MatchMental;
  /**
   * The saved Review-screen data (target grades + mental flags) for this match,
   * if it has been graded — lets the match-detail editor pre-fill and re-save.
   */
  review?: MatchReview;
  /** Grouped by `team` in the renderer; absent → local-row-only fallback. */
  scoreboard?: ScoreboardEntry[];
  /**
   * Competitive progress. 'calculated' = forward-replayed from the user's rank
   * anchor + logged SR deltas for a match at/after the anchor; 'reconstructed' =
   * the same anchor walked backward for a match older than it (best-effort);
   * 'estimate' = the winrate heuristic fallback when no anchor exists; 'reported'
   * is reserved for a future GEP upgrade.
   * `progressPct` is 0–100 within the division, except it can go negative while
   * `protected` is true — the rank-protection buffer's carry (calculated), matching the
   * live client's own negative display. `delta` is signed %-points.
   * `protected` describes the rank-protection state (calculated).
   */
  competitive?: {
    note: 'estimate' | 'reported' | 'calculated' | 'reconstructed';
    tier?: string;
    division?: number;
    progressPct?: number;
    delta?: number;
    protected?: boolean;
  };
  /** Players seen in prior matches; [] when no roster data exists. */
  playerHistory: PlayerEncounter[];
}
