/**
 * Match drill-down DTOs of the IPC contract: scoreboard rows, prior-encounter
 * history and the full match-detail payload. Electron-free so main, preload
 * and the renderer bundle can all share it.
 */
import type { Role, Result, HeroStat } from '../../core/model';
import type { MatchMental, MatchReview, TargetGrade } from '../../core/analytics';

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
  /**
   * Auto-graded measured (⚡) targets for this match — the calculated grade +
   * per-10/ratio value, or `'no-stat'` when the match can't measure it. Only the
   * currently-active measured targets; keyed by target id. Lets the Grades card
   * show calculated grades (mode-aware) next to the stored self-ratings.
   */
  measuredGrades?: Record<string, { grade: TargetGrade; value: number } | 'no-stat'>;
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
