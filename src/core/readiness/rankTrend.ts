/**
 * Rank-trend evidence for the undertraining nudge (spec §7b, owner revision 2026-07-08).
 *
 * The nudge may only fire on PROVEN stagnation: at least one (account, role) rank track
 * must carry enough real movement data across the stagnation window, and none may be
 * climbing. The rank engine moves by `srDelta ?? 0`, so a window full of comps WITHOUT
 * logged deltas reads flat — that is *unlogged*, not *stagnant*, and must count as no
 * evidence (`unknown` ⇒ the nudge stays silent; the app never encourages volume on zero
 * evidence). Pure — reuses the same `computeRank` engine the Matches screen trusts.
 */

import type { GameRecord } from '../analytics';
import { classifyGameType } from '../matchFilter';
import { computeRank } from '../rank/engine';
import { rankToPoints } from '../rank/scalar';
import type { RankAnchorMap, RankMatchInput } from '../rank/types';
import { READINESS_TUNING as T } from './constants';
import { dayOrdinal } from './day';

/** What the rank evidence says over the stagnation window ending at the reference day. */
export type RankTrend = 'climbing' | 'stagnant' | 'unknown';

/** The rank-moving competitive inputs for one track, from the anchor instant up to a day ordinal. */
function comps(games: GameRecord[], account: string, role: string, sinceTs: number, maxOrdinal: number): RankMatchInput[] {
  return games
    .filter(
      (g) =>
        g.account === account &&
        g.role === role &&
        classifyGameType(g.gameType) === 'competitive' &&
        g.timestamp > sinceTs &&
        dayOrdinal(g.timestamp) <= maxOrdinal,
    )
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((g) => ({ result: g.result, srDelta: g.srDelta }));
}

/**
 * Evaluate the rank trend as-of `refOrdinal`. `games` must already be cleaned/ascending
 * (the caller passes the same slice the rest of the state evaluation uses). Anchor map
 * keys follow `rankKey` (`account::role`); the role is the segment after the last `::`.
 */
export function rankTrendFor(games: GameRecord[], refOrdinal: number, anchors: RankAnchorMap | undefined): RankTrend {
  if (!anchors) return 'unknown';
  const windowStart = refOrdinal - T.rankStagnationWindowDays + 1;

  let evidenced = false;
  let climbing = false;
  for (const [key, anchor] of Object.entries(anchors)) {
    const sep = key.lastIndexOf('::');
    if (sep <= 0) continue;
    const account = key.slice(0, sep);
    const role = key.slice(sep + 2);

    const anchorOrdinal = dayOrdinal(anchor.setAt);
    if (anchorOrdinal > refOrdinal) continue; // anchor from the future of this trend day
    // The measurable sub-window starts where the anchor's ground truth begins.
    const measurableStart = Math.max(windowStart, anchorOrdinal);

    // Evidence: the engine moves by srDelta, so stagnation needs logged deltas inside the
    // measurable sub-window — a delta-free window is unlogged, not flat.
    const measurableDeltas = games.filter(
      (g) =>
        g.account === account &&
        g.role === role &&
        classifyGameType(g.gameType) === 'competitive' &&
        g.timestamp > anchor.setAt &&
        typeof g.srDelta === 'number' &&
        dayOrdinal(g.timestamp) >= measurableStart &&
        dayOrdinal(g.timestamp) <= refOrdinal,
    ).length;
    if (measurableDeltas === 0) continue; // nothing measurable on this track at all

    const start = computeRank(anchor, comps(games, account, role, anchor.setAt, measurableStart - 1));
    const end = computeRank(anchor, comps(games, account, role, anchor.setAt, refOrdinal));

    // ASYMMETRIC bars (err toward silence): CLIMBING silences on any net-positive movement,
    // however thin the sample — nagging a provably-climbing player is the one outcome the
    // owner vetoed outright. STAGNANT (the only state that lets the nudge fire) requires the
    // full evidence bar: enough span AND enough logged deltas.
    if (rankToPoints(end) - rankToPoints(start) >= T.rankClimbMinPoints) climbing = true;
    if (
      refOrdinal - measurableStart + 1 >= T.rankEvidenceMinDays &&
      measurableDeltas >= T.rankEvidenceMinDeltas
    ) {
      evidenced = true;
    }
  }

  if (climbing) return 'climbing';
  return evidenced ? 'stagnant' : 'unknown';
}
