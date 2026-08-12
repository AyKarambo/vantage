import type { Role } from '../model';
import type { RankAnchor } from '../rank';

/**
 * Types for the placement-run tracker: Overwatch resets protection (and often
 * moves you) at the start of a new competitive season and makes you play a
 * fresh 10-match placement run per (account, role) before it shows a real,
 * unprotected rank again. This module tracks that run against the same match
 * history the rank engine already reads, so the UI can show placement
 * progress and predicted rank without any extra data entry.
 */

/** Ten placement matches per (account, role) track, mirroring the live client. */
export const PLACEMENT_RUN_LENGTH = 10;

/** What Overwatch shows after a placement match: a rank with no % and no protection. */
export interface PredictedRank { tier: string; division: number }

/**
 * One in-progress or completed placement run for one (account, role) track,
 * starting at a season reset (or a manual re-anchor). Persisted as-is; every
 * read (progress, completion, drift) is derived fresh from `games` rather than
 * cached, so edits to match history stay honest.
 */
export interface PlacementRun {
  account: string;
  role: Role;
  /** Counted matches are competitive, this track, timestamp >= startedAt. */
  startedAt: number;
  /** Anchor as it stood before the run; null when the track had none. Restored on reset/cancel. */
  preRunAnchor: RankAnchor | null;
  /** Sparse, keyed by matchId. */
  predictions: Record<string, PredictedRank>;
  completedAt?: number;
  /** Snapshot taken at completion; drift detection compares against this. */
  completedMatchIds?: string[];
  /** The reset season start that prompted the run, for decline bookkeeping. */
  seasonStart?: number;
}
