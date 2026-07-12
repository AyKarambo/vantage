import type { Role } from '../model';
import type { GameRecord } from '../analytics';
import { classifyGameType } from '../matchFilter';
import { stateFromAnchor } from './engine';
import { currentRank } from './timeline';
import { rankKey, type RankAnchorMap, type RankPosition, type RankState } from './types';
import { rankToPoints, pointsToRank } from './scalar';

/**
 * Historical rank helpers on top of the forward engine. The engine only replays
 * SR deltas *forward* from a single anchor, so a match older than the latest
 * anchor otherwise just echoes the anchor position. These reconstruct the rank
 * **as of a specific match** by walking backward from the anchor in scalar space
 * (see {@link ./scalar}) — best-effort: a match with no logged SR contributes 0,
 * and rank protection is flattened (it cannot be reversed). Pure/I-O-free.
 */

/** Sum of logged SR (0 when absent) over the (account, role) comp matches whose timestamp passes `inRange`. */
function sumSr(
  games: GameRecord[],
  account: string,
  role: Role,
  inRange: (ts: number) => boolean,
): number {
  return games
    .filter(
      (g) =>
        g.account === account &&
        g.role === role &&
        classifyGameType(g.gameType) === 'competitive' &&
        inRange(g.timestamp),
    )
    .reduce((sum, g) => sum + (g.srDelta ?? 0), 0);
}

/** The latest (account, role) competitive match strictly before `beforeTs`, if any. */
function prevCompTs(games: GameRecord[], account: string, role: Role, beforeTs: number): number | undefined {
  let best: number | undefined;
  for (const g of games) {
    if (
      g.account === account &&
      g.role === role &&
      classifyGameType(g.gameType) === 'competitive' &&
      g.timestamp < beforeTs &&
      (best === undefined || g.timestamp > best)
    ) {
      best = g.timestamp;
    }
  }
  return best;
}

/**
 * The rank held **immediately after** the match at `matchTs` for one (account,
 * role), or null without an anchor. Matches at/after the anchor replay forward
 * (protection-aware, unchanged); matches before it reconstruct backward in
 * scalar space (protection flattened, always unprotected).
 */
export function rankAfterMatch(
  games: GameRecord[],
  anchors: RankAnchorMap,
  account: string,
  role: Role,
  matchTs: number,
): RankState | null {
  const anchor = anchors[rankKey(account, role)];
  if (!anchor) return null;
  // Forward: at/after the anchor instant, the engine's replay is authoritative.
  if (matchTs >= anchor.setAt) return currentRank(games, anchors, account, role, matchTs);
  // Backward: subtract every comp match strictly after the target, up to the
  // anchor reading, from the anchor's scalar.
  const points = rankToPoints(anchor) - sumSr(games, account, role, (ts) => ts > matchTs && ts <= anchor.setAt);
  return { ...pointsToRank(points), protected: false };
}

/** The reconstructed rank **immediately before** the match at `matchTs` (i.e. after the previous comp match). */
function rankBeforeMatch(
  games: GameRecord[],
  anchors: RankAnchorMap,
  account: string,
  role: Role,
  matchTs: number,
): RankPosition {
  const anchor = anchors[rankKey(account, role)];
  const prev = prevCompTs(games, account, role, matchTs);
  if (prev !== undefined) return rankAfterMatch(games, anchors, account, role, prev)!;
  // No earlier comp match on this track.
  if (matchTs >= anchor.setAt) return stateFromAnchor(anchor); // target is the first after the anchor
  // Target predates the anchor with nothing before it: reconstruct to just
  // before the target by subtracting the target itself and everything up to the
  // anchor from the anchor's scalar.
  const points = rankToPoints(anchor) - sumSr(games, account, role, (ts) => ts >= matchTs && ts <= anchor.setAt);
  return pointsToRank(points);
}

/**
 * The SR % this match must have produced to land on `enteredAfter`, given the
 * reconstructed rank immediately before it — the editor's "Set current rank"
 * back-compute. The caller guarantees an anchor exists (the no-anchor case
 * bootstraps a fresh anchor instead of deriving a delta).
 *
 * Best-effort by the same token as the reconstruction it builds on. For a
 * backward ('reconstructed') match the display is scalar too, so `enteredAfter`
 * round-trips exactly. For a forward ('calculated') match the live display is
 * protection-aware ({@link ./engine applyMatch}): if the derived delta would
 * drive the running % to ≤ 0 the engine shows a held/negative protection buffer
 * rather than the entered division, so an entered *demotion* won't reproduce
 * exactly — the anchor is deliberately left in place (a re-anchor would move the
 * live rank), so this stays a best-effort estimate, not a re-anchor.
 */
export function srDeltaForSetRank(
  games: GameRecord[],
  anchors: RankAnchorMap,
  account: string,
  role: Role,
  matchTs: number,
  enteredAfter: RankPosition,
): number {
  if (!anchors[rankKey(account, role)]) return 0;
  const before = rankBeforeMatch(games, anchors, account, role, matchTs);
  return Math.round(rankToPoints(enteredAfter) - rankToPoints(before));
}
