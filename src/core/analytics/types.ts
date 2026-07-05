/**
 * Shared vocabulary of the analytics layer, which turns a list of completed
 * games into the aggregates the dashboard charts and the "what to focus on"
 * insights are built from. Pure and I/O-free so it is fully unit-testable and
 * reusable in the renderer.
 */
import type { Result, Role, HeroStat, RosterPlayer } from '../model';

export type { HeroStat } from '../model';

/**
 * Manual (◎) after-game self-report — the "mental" signals the game never
 * reports. All optional; absent means the player didn't flag anything.
 */
export interface MatchMental {
  tilt?: boolean;
  toxicMates?: boolean;
  /**
   * Legacy single "someone left" flag. Newer records use the team-specific
   * flags below; readers treat a legacy `leaver: true` as a my-team leaver
   * (see {@link ../leaver leaverFlags}).
   */
  leaver?: boolean;
  /** A player left on the tracked player's team. */
  leaverMyTeam?: boolean;
  /** A player left on the enemy team. */
  leaverEnemyTeam?: boolean;
  positiveComms?: boolean;
}

/** How the player graded one improvement target for one game. */
export type TargetGrade = 'hit' | 'partial' | 'missed';

/** The manual (◎) read attached to a tracked game on the Review screen. */
export interface MatchReview {
  /** When the review was saved. */
  at: number;
  /** targetId → grade; grades for deleted targets stay inert. */
  grades: Record<string, TargetGrade>;
  /** Feel flags — same shape as the quick-log self-report. */
  flags: MatchMental;
}

/** One finished game, already resolved to display values. */
export interface GameRecord {
  matchId: string;
  timestamp: number; // ms epoch (match end)
  account: string;
  role: Role;
  map: string;
  result: Result;
  gameType: string;
  /**
   * Where the record came from. Absent on older records — inferred from the
   * matchId prefix by {@link ../source sourceOf} (manual ids start with
   * `manual`). Auto-tracked (GEP) records lock their game-derived facts in the
   * match editor.
   */
  source?: 'manual' | 'gep';
  /**
   * Signed skill-rating change for this competitive match, in percentage points
   * of a division (e.g. +22, -19) — the exact number the game showed. Manual,
   * competitive-only; feeds the calculated-rank engine ({@link ../rank}).
   */
  srDelta?: number;
  durationMinutes?: number;
  heroes: string[];
  /** Per-hero breakdown for the local player (from GEP roster), if available. */
  perHero?: HeroStat[];
  /** Round score, e.g. "2–1", when the feed reported one. */
  finalScore?: string;
  /** Latest roster snapshot per slot — whatever teams GEP reported (may be
   *  local team only). Absent on older records and manual logs. */
  roster?: RosterPlayer[];
  /** End-of-match capture files, relative to the screenshots root. */
  screenshots?: string[];
  /** Manual self-report captured in the Log Match card, if the player added one. */
  mental?: MatchMental;
  /** The saved Review-screen read (target grades + feel flags), if graded. */
  review?: MatchReview;
}

/** Win/loss tally over a set of games — the unit every chart aggregates. */
export interface WinLoss {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** Wins / decided games (draws excluded), 0..1. */
  winrate: number;
}

/** A WinLoss bucket labeled by its grouping key (map, role, hero, …). */
export interface Group extends WinLoss {
  key: string;
}

/** Net losses = losses − wins. Positive ⇒ a weakness worth focusing on. */
export interface FocusItem extends WinLoss {
  key: string;
  net: number;
}

/** Per-hero rollup: winrate plus exact stat totals and per-10-minute averages. */
export interface HeroSummary extends WinLoss {
  hero: string;
  role?: Role;
  totals: Omit<HeroStat, 'hero' | 'role'>;
  /** Per-10-minute averages (null when no duration data). */
  per10: Pick<HeroStat, 'eliminations' | 'deaths' | 'assists' | 'damage' | 'healing' | 'mitigation'> | null;
  kda: number; // (elims + assists) / max(deaths, 1)
}

/** Streak of the most recent decided games. */
export interface Streak {
  type: 'W' | 'L' | 'none';
  count: number;
}
