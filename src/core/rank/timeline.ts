import type { Role } from '../model';
import type { GameRecord } from '../analytics';
import { classifyGameType } from '../matchFilter';
import { computeRank } from './engine';
import { rankKey, type RankAnchor, type RankAnchorMap, type RankMatchInput, type RankState } from './types';

/**
 * Bridges stored {@link GameRecord}s to the pure rank engine: pulls the
 * competitive timeline for one (account, role) and computes the live rank from
 * an anchor. Pure and I/O-free.
 */

/**
 * The ordered competitive matches for one (account, role) that move the rank —
 * competitive only, after the anchor instant, up to `untilTs` (inclusive) when
 * given, in ascending time order.
 */
export function competitiveComps(
  games: GameRecord[],
  account: string,
  role: Role,
  sinceTs: number,
  untilTs?: number,
): RankMatchInput[] {
  return games
    .filter(
      (g) =>
        g.account === account &&
        g.role === role &&
        classifyGameType(g.gameType) === 'competitive' &&
        g.timestamp > sinceTs &&
        (untilTs === undefined || g.timestamp <= untilTs),
    )
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((g) => ({ result: g.result, srDelta: g.srDelta }));
}

/**
 * The live rank for one (account, role), or null when no anchor is set. When
 * `untilTs` is given the rank is computed as of that instant (for a single
 * match's drill-down).
 */
export function currentRank(
  games: GameRecord[],
  anchors: RankAnchorMap,
  account: string,
  role: Role,
  untilTs?: number,
): RankState | null {
  const anchor = anchors[rankKey(account, role)];
  if (!anchor) return null;
  return computeRank(anchor, competitiveComps(games, account, role, anchor.setAt, untilTs));
}

export type { RankAnchor };
