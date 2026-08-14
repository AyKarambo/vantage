/**
 * Placement-run DTOs of the IPC contract: the per (account, role) tracker for
 * Overwatch's post-reset 10-match placement run, so the UI can render
 * `Placements N/10` and a predicted rank instead of a rank the player does
 * not have yet. `PredictedRank` is re-exported from the pure core module —
 * same pattern as `masterData.ts` — so a core type change flows to the
 * renderer with no separate DTO. Electron-free so main, preload and the
 * renderer bundle can all share it.
 */
import type { Role } from '../../core/model';
import type { PredictedRank } from '../../core/placements';

// Re-exported so the renderer reads its predicted-rank vocabulary from the contract too.
export type { PredictedRank };

/** One in-progress or completed placement-run track, for the tracker card/list. */
export interface PlacementRunSummary {
  account: string;
  role: Role;
  /** Matches counted so far. */
  counted: number;
  /** Track length; currently always {@link PLACEMENT_RUN_LENGTH}. */
  target: number;
  latestPrediction?: PredictedRank;
  completed: boolean;
  /** History changed under a completed run — the counted set no longer matches the completion snapshot. */
  drifted: boolean;
  /** Full length counted but the revealed rank hasn't been confirmed yet — waiting on the player, not more matches. */
  awaitingRank: boolean;
  /**
   * The matches this run counts, in order. Lets a consumer ask the PER-MATCH
   * question ("is this one of the ten?") rather than only the per-run one —
   * needed once a run reaches its target while the player keeps logging, since
   * match eleven is an ordinary game but matches one to ten stay placement
   * matches. Derived, never stored.
   */
  countedMatchIds: string[];
}

/**
 * Start a placement run for an (account, role). `fromMatchId` is the
 * BACKDATING hook: when given, the run starts at that already-logged match's
 * timestamp instead of now, for the "I started the run too late" case.
 */
export interface PlacementStartInput {
  account: string;
  role: Role;
  fromMatchId?: string;
}

/** Set (or clear, with `null`) the predicted rank shown after one placement match. */
export interface PlacementPredictionInput {
  account: string;
  role: Role;
  matchId: string;
  prediction: PredictedRank | null;
}

/**
 * Confirm the real rank Overwatch revealed at the end of a placement run.
 * `progressPct` is optional because straight out of placements it is usually
 * 0 and the game does not show one.
 */
export interface PlacementCompleteInput {
  account: string;
  role: Role;
  tier: string;
  division: number;
  progressPct?: number;
}

/** Target an (account, role) placement run for reset, cancel or recount. */
export interface PlacementTrackInput {
  account: string;
  role: Role;
}

/**
 * A standing invitation to place a track, raised after a ladder-reset season
 * began. Computed in main rather than derived in the renderer: the decision
 * needs the anchor's `setAt`, the effective season table and the per-track
 * record of past declines, none of which the renderer has — and shipping the
 * decline bookkeeping across IPC just to re-derive the answer would be worse.
 */
export interface PlacementOffer {
  account: string;
  role: Role;
  /** Start instant of the reset season that raised this offer. */
  seasonStart: number;
  /** That season's label, for the prompt copy (e.g. `2026 Season 4`). */
  seasonLabel: string;
}

/** Decline the offer for a track and season, so it is not raised again that season. */
export interface PlacementDeclineInput {
  account: string;
  role: Role;
  seasonStart: number;
}
