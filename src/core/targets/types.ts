/**
 * Shared shapes for the Improvement Targets system: the user-authored target
 * definition and the scored summary shown on the dashboard, plus the small
 * clamp helper both the sample and scoring paths need.
 */

export type TargetMode = 'self' | 'measured';

/** A target the player authored in the builder and saved to their library. */
export interface AuthoredTarget {
  id: string;
  name: string;
  mode: TargetMode;
  /** Legacy field kept for old manual.json files; new writes are always 'season'. */
  scope?: 'match' | 'season';
  rule: string;
  createdAt: number;
  /** Active targets are the ones graded on the Review screen. */
  isActive: boolean;
  /** When the target last became active — drives the staleness cue. Absent on
   *  legacy rows written before rotation; readers fall back to `createdAt`. */
  activatedAt?: number;
  /** Set = hidden from the library and the active set, restorable. */
  archivedAt?: number;
}

export interface TargetSummary {
  id: string;
  name: string;
  mode: TargetMode;
  rule: string;
  hitRate: number; // 0..1
  hits: number;
  attempts: number;
  winWhenHit: number; // 0..1
  winWhenMissed: number; // 0..1
  spark: number[];
  isActive: boolean;
  archivedAt?: number;
  /** When the target last became active (active, non-archived targets only). */
  activatedAt?: number;
  /** Matches played since activation, over unfiltered history (active only) — the staleness match count. */
  matchesSinceActive?: number;
}

/** Clamp a ratio into the valid 0..1 winrate/hitrate range. */
export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
