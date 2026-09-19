import type { GameRecord } from '../analytics';
import type { Role } from '../model';
import { classifyGameType } from '../matchFilter';
import { enteringRanks, type EnteringRanksOptions } from './entering';
import { rankToPoints } from './scalar';
import type { RankAnchorMap } from './types';

/** One plotted point on the rank-over-time chart (C1). */
export interface RankSeriesPoint {
  matchId: string;
  timestamp: number;
  /** The linear ladder scalar ({@link rankToPoints}) — what the chart's y-axis plots. */
  points: number;
  tier: string;
  division: number;
  progressPct: number;
  /**
   * Backward-walked from the anchor rather than a stored snapshot or a
   * forward replay from it — best-effort, drawn as a hollow/dashed point on
   * the chart. Mirrors `playerIndex.ts`'s 'calculated'/'reconstructed' →
   * 'derived' collapse: the reader can't act on which kind of not-stored a
   * point is, only on whether it's stored at all.
   */
  estimated: boolean;
}

/**
 * The rank trajectory for ONE (account, role) track, oldest first — every
 * competitive match that HAS an entering rank (stored, calculated or
 * reconstructed), built on {@link enteringRanks} so a chart point and the
 * Matches "Rank at start" column can never disagree about a match's rank.
 * Placement-run / pre-reset / no-anchor / stale-anchor matches are simply
 * absent, exactly as that column blanks them — the chart draws a gap, never
 * an interpolated guess across one.
 *
 * Takes the FULL (unfiltered) history for this track: a rank position
 * depends on every prior match, so a date-range filter must narrow the
 * PLOTTED points afterward, never the walk that produces them.
 */
export function rankSeries(
  games: readonly GameRecord[],
  anchors: RankAnchorMap,
  account: string,
  role: Role,
  opts: EnteringRanksOptions = {},
): RankSeriesPoint[] {
  const track = games
    .filter((g) => g.account === account && g.role === role && classifyGameType(g.gameType) === 'competitive')
    .sort((a, b) => a.timestamp - b.timestamp);
  const entering = enteringRanks(track, anchors, opts);
  const out: RankSeriesPoint[] = [];
  for (const g of track) {
    const cell = entering.get(g.matchId);
    if (!cell?.position) continue;
    out.push({
      matchId: g.matchId,
      timestamp: g.timestamp,
      points: rankToPoints(cell.position),
      tier: cell.position.tier,
      division: cell.position.division,
      progressPct: cell.position.progressPct,
      estimated: cell.note !== 'stored',
    });
  }
  return out;
}
