import type { Role } from '../model';
import type { GameRecord } from '../analytics';
import { classifyGameType } from '../matchFilter';
import { currentRank } from './timeline';
import { enteringRankAt } from './entering';
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
  suppressed?: ReadonlySet<string>,
): number {
  return games
    .filter(
      (g) =>
        g.account === account &&
        g.role === role &&
        classifyGameType(g.gameType) === 'competitive' &&
        inRange(g.timestamp),
    )
    // A suppressed match contributes 0, exactly as it does walking FORWARD
    // (see ../rank/timeline competitiveComps): a delta that never moved the
    // ladder must not be subtracted back out of it either.
    .reduce((sum, g) => sum + (suppressed?.has(g.matchId) ? 0 : g.srDelta ?? 0), 0);
}

/**
 * The rank held **immediately after** the match at `matchTs` for one (account,
 * role), or null without an anchor. Matches at/after the anchor replay forward
 * (protection-aware, unchanged); matches before it reconstruct backward in
 * scalar space (protection flattened, always unprotected).
 *
 * `resetBefore`, when given, is the instant of a competitive rank reset (epoch
 * ms). A match strictly before it returns null instead of reconstructing:
 * the backward walk works by subtracting ladder points from the current
 * anchor, but a rank reset makes the ladder discontinuous, so walking
 * backward across that boundary would report ranks the player never actually
 * held. Returning null lets the caller say "before the rank reset" instead of
 * inventing a number.
 *
 * `suppressed` threads through to the same read-time mask every other rank
 * surface applies (see {@link ../placements/engine suppressedMatchIds}): a match
 * inside an OPEN placement run has no settled rank to move yet. Without it this
 * would report a per-match rank built from ±% the rest of the app is
 * deliberately holding back — the same number disagreeing with itself.
 */
export function rankAfterMatch(
  games: GameRecord[],
  anchors: RankAnchorMap,
  account: string,
  role: Role,
  matchTs: number,
  resetBefore?: number,
  suppressed?: ReadonlySet<string>,
): RankState | null {
  if (resetBefore !== undefined && matchTs < resetBefore) return null;
  const anchor = anchors[rankKey(account, role)];
  if (!anchor) return null;
  // Forward: at/after the anchor instant, the engine's replay is authoritative.
  if (matchTs >= anchor.setAt) return currentRank(games, anchors, account, role, matchTs, suppressed);
  // Backward: subtract every comp match strictly after the target, up to the
  // anchor reading, from the anchor's scalar.
  const points = rankToPoints(anchor)
    - sumSr(games, account, role, (ts) => ts > matchTs && ts <= anchor.setAt, suppressed);
  return { ...pointsToRank(points), protected: false };
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
  suppressed?: ReadonlySet<string>,
): number {
  // Deliberately NOT given a resetBefore: "what ±% produces this rank" is a
  // within-era question, and blanking it across a reset would break the editor's
  // back-compute rather than make it honest.
  const cell = enteringRankAt(games, anchors, account, role, matchTs, { suppressed });
  if (!cell.position) return 0;
  return Math.round(rankToPoints(enteredAfter) - rankToPoints(cell.position));
}

/**
 * The rank the player was sitting at going INTO the match at `matchTs` — i.e.
 * where they stood after the previous competitive match on that track.
 *
 * Exported so the store can take a SNAPSHOT of it at the moment a match's ±% is
 * recorded. That snapshot is the point: everything else here is derived fresh on
 * every read, which is right for "what is my rank now" but wrong for "what did I
 * see when I queued into this game" — a later correction to an older match would
 * silently rewrite history that already happened. A stored value keeps saying
 * what it said.
 *
 * `null` when the track has no anchor at all: with no reading to reconstruct
 * from there is no rank to report, and a fabricated Bronze 5 would be worse than
 * an honest blank.
 *
 * Best-effort by the same terms as {@link rankAfterMatch}: matches with no
 * logged ±% contribute 0, and rank protection can't be reversed walking
 * backward. Forward of the anchor the engine's own replay is authoritative.
 *
 * `resetBefore`, when given, is this track's ladder-reset instant (see
 * `../placements/engine` resetBoundaries). A match strictly before it returns
 * null rather than a value reconstructed ACROSS the discontinuity — the same
 * guard {@link rankAfterMatch} already takes, and which this function was
 * missing: it used to walk straight through a reset and hand back a rank the
 * player never held, which `syncRankAtStart` then persisted permanently.
 *
 * One boundary changed with the move onto {@link enteringRankAt}: a match
 * sitting EXACTLY on `anchor.setAt` with nothing earlier on the track used to
 * return the anchor verbatim, and now returns `anchor − its own ±%`. That is the
 * honest reading — `../timeline competitiveComps` excludes a match at `setAt`
 * with a strict `>`, so the anchor is a reading taken AFTER it — and it is
 * reachable, because completing a placement run stamps `setAt` at the last match
 * in the window. Pinned by `test/rankEntering.test.ts`.
 */
export function rankEnteringMatch(
  games: GameRecord[],
  anchors: RankAnchorMap,
  account: string,
  role: Role,
  matchTs: number,
  suppressed?: ReadonlySet<string>,
  resetBefore?: number,
): RankState | null {
  const cell = enteringRankAt(games, anchors, account, role, matchTs, { suppressed, resetBefore });
  if (!cell.position) return null;
  return { ...cell.position, protected: cell.protected ?? false };
}
