/**
 * Match drill-down DTOs of the IPC contract: scoreboard rows, prior-encounter
 * history and the full match-detail payload. Electron-free so main, preload
 * and the renderer bundle can all share it.
 */
import type { Role, Result, HeroStat } from '../../core/model';
import type { MatchMental } from '../../core/analytics';

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
  durationMinutes?: number;
  /** Round score, e.g. "2–1" (v2 capture); absent on older records. */
  finalScore?: string;
  heroes: string[];
  /** Local player's per-hero lines; [] when GEP gave no per-hero data. */
  perHero: HeroStat[];
  mental?: MatchMental;
  /** Grouped by `team` in the renderer; absent → local-row-only fallback. */
  scoreboard?: ScoreboardEntry[];
  /**
   * Competitive progress. 'estimate' = the winrate heuristic (the feed does
   * not report rank today); 'reported' is reserved for a future GEP upgrade.
   */
  competitive?: { note: 'estimate' | 'reported'; sr?: number; tier?: string; division?: number; delta?: number };
  /** Players seen in prior matches; [] when no roster data exists. */
  playerHistory: PlayerEncounter[];
  /** vantage-media:// URLs of end-of-match captures; [] when none. */
  screenshots: string[];
}
