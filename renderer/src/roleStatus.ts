/**
 * The one-line status for a single (account, role) track — whichever of "no
 * rank yet", "ranked", or "in placements" applies. Shared by Settings →
 * Accounts (one row per role, with action buttons) and the account-switcher
 * popover (a compact per-role listing, read-only) so the "which state wins"
 * branching lives in exactly one place instead of being copied per surface.
 */
import type { PlacementRunSummary, RankSummary } from '../../src/shared/contract';
import { placementParts, rankParts } from '../../src/core/rankDisplay';

export type RoleStatusTone = 'rank' | 'placed' | 'placement' | 'empty';

export interface RoleStatus {
  text: string;
  /**
   * 'rank' — an ordinary calculated rank. 'placed' — same, but this track's
   * anchor came from a COMPLETED placement run (callers may want to note that
   * without hiding the rank itself, unlike the old static "Placements complete"
   * text). 'placement' — an OPEN run, counting or awaiting. 'empty' — neither.
   */
  tone: RoleStatusTone;
}

/**
 * `run` is only ever passed OPEN (`!run.completed`) — a completed run's story is
 * already told by `rank` (the anchor it wrote), so the caller filters it out
 * before calling this, exactly as the old `ranksLine`/`placementRow` split did.
 */
export function roleStatus(
  rank: Pick<RankSummary, 'tier' | 'division' | 'progressPct' | 'protected'> | undefined,
  openRun: Pick<PlacementRunSummary, 'counted' | 'target' | 'latestPrediction' | 'awaitingRank'> | undefined,
  wasPlaced = false,
): RoleStatus {
  if (openRun) {
    const pp = placementParts(openRun.counted, openRun.target, openRun.latestPrediction, openRun.awaitingRank);
    const suffix = pp.predictionLabel ?? pp.awaitingLabel;
    return { text: suffix ? `${pp.counter} · ${suffix}` : pp.counter, tone: 'placement' };
  }
  if (rank) {
    const p = rankParts(rank);
    return { text: `${p.rankLabel} · ${p.bufferPctText}${p.shield ? ' 🛡' : ''}`, tone: wasPlaced ? 'placed' : 'rank' };
  }
  return { text: 'No rank yet', tone: 'empty' };
}
