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
 *
 * `suppressed` is the set of matchIds whose delta should be ignored (read as
 * `srDelta: undefined`, so {@link ../engine applyMatch}'s `match.srDelta ?? 0`
 * moves the ladder by 0) while still being emitted as a real competitive
 * match. This is for an open placement run: Overwatch shows no ±% at all
 * while placements are in progress, so a match inside such a run must not
 * move the ladder. The value is suppressed here, at read time, rather than
 * erased from the stored record — which is what makes cancelling a run fully
 * reversible.
 */
export function competitiveComps(
  games: GameRecord[],
  account: string,
  role: Role,
  sinceTs: number,
  untilTs?: number,
  suppressed?: ReadonlySet<string>,
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
    .map((g) => ({ result: g.result, srDelta: suppressed?.has(g.matchId) ? undefined : g.srDelta }));
}

/**
 * The live rank for one (account, role), or null when no anchor is set. When
 * `untilTs` is given the rank is computed as of that instant (for a single
 * match's drill-down). `suppressed` threads through to {@link competitiveComps}
 * — see its doc for why a match's delta can be ignored without erasing it.
 */
export function currentRank(
  games: GameRecord[],
  anchors: RankAnchorMap,
  account: string,
  role: Role,
  untilTs?: number,
  suppressed?: ReadonlySet<string>,
): RankState | null {
  const anchor = anchors[rankKey(account, role)];
  if (!anchor) return null;
  return computeRank(anchor, competitiveComps(games, account, role, anchor.setAt, untilTs, suppressed));
}

export type { RankAnchor };
