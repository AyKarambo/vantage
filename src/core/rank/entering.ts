import type { GameRecord } from '../analytics';
import type { Role } from '../model';
import { classifyGameType } from '../matchFilter';
import { applyMatch, stateFromAnchor } from './engine';
import { pointsToRank, rankToPoints } from './scalar';
import { rankKey, type RankAnchorMap, type RankPosition } from './types';

/**
 * "What rank was I entering this match" — for a whole history in ONE grouped
 * pass ({@link enteringRanks}) and for a single match over the same two formulas
 * ({@link enteringRankAt}, which {@link ./reconstruct rankEnteringMatch} — and
 * therefore the `rankAtStart` WRITE path — is built on, so a table cell and a
 * stored snapshot can never disagree about the arithmetic).
 *
 * This module deliberately owns the whole cell decision, masks included, rather
 * than only the numbers: the read surfaces and the write path must agree on WHY
 * a cell is blank, not merely on the value when there is one. Pure and
 * Electron-free (guardrail 3) — it takes the placement mask and the reset map as
 * plain data, so it never imports `../placements` (which imports this package).
 *
 * A note on vocabulary: `../matchDetail competitiveOf` uses the same words
 * 'calculated' and 'reconstructed' for the rank AFTER a match. Here they
 * describe the rank ENTERING it. Same anchor-relative meaning, different
 * instant — do not "unify" the two by swapping `rankAfterMatch` back in, which
 * differs by exactly that match's own ±%.
 */

/** Where an entering rank came from, or why there isn't one. */
export type EnteringRankNote =
  /** The match's own `GameRecord.rankAtStart` snapshot — what the player saw. */
  | 'stored'
  /** Forward-replayed from the anchor with {@link applyMatch} (protection-aware). */
  | 'calculated'
  /** Backward scalar walk from the anchor (protection flattened, best-effort). */
  | 'reconstructed'
  /** Inside an OPEN placement run — the game shows no rank either. Blank. */
  | 'placements'
  /** Older than this track's completed placement run. Blank. */
  | 'pre-reset'
  /** The track has no rank anchor at all. Blank. */
  | 'no-anchor'
  /** The track's anchor predates its own reset boundary — nothing to fold from. Blank. */
  | 'stale-anchor';

/**
 * One match's entering rank. `position` is ABSENT for every blank note, and
 * there is deliberately no winrate fallback below the blanks (unlike
 * `../matchDetail competitiveOf`): a guess in a rank column is worse than a blank.
 */
export interface EnteringRank {
  note: EnteringRankNote;
  position?: RankPosition;
  /**
   * Rank protection. Set ONLY on 'calculated'. Absent means NOT KNOWABLE — the
   * backward walk cannot invert {@link applyMatch} — and must never be read as
   * `false`.
   */
  protected?: boolean;
}

export interface EnteringRanksOptions {
  /** Open-placement-run mask; see `../placements/engine` suppressedMatchIds. */
  suppressed?: ReadonlySet<string>;
  /** Ladder-reset instant per {@link rankKey}; see `../placements/engine` resetBoundaries. */
  resetBefore?: ReadonlyMap<string, number>;
}

/** A match's contribution walking BACKWARD: 0 when suppressed or when no ±% was logged. */
function pointDelta(g: GameRecord, suppressed?: ReadonlySet<string>): number {
  return suppressed?.has(g.matchId) ? 0 : g.srDelta ?? 0;
}

/** The same value as a `RankMatchInput.srDelta` walking FORWARD (undefined ⇒ applyMatch moves 0). */
function srInput(g: GameRecord, suppressed?: ReadonlySet<string>): number | undefined {
  return suppressed?.has(g.matchId) ? undefined : g.srDelta;
}

const PRE_RESET: EnteringRank = { note: 'pre-reset' };
const STALE_ANCHOR: EnteringRank = { note: 'stale-anchor' };
const NO_ANCHOR: EnteringRank = { note: 'no-anchor' };
const PLACEMENTS: EnteringRank = { note: 'placements' };

/**
 * The rank the player was sitting at going INTO every competitive match, in ONE
 * grouped pass. Keyed by matchId; a NON-COMPETITIVE row gets no entry at all —
 * absence means "not a ranked game", which is not the same as a blank cell.
 *
 * `O(n log n)` once for the whole history, then `O(1)` per row. The single-match
 * helpers each cost a full history scan (and, forward, a sort), so asking them
 * per row is quadratic; this exists so a list never does that.
 */
export function enteringRanks(
  games: readonly GameRecord[],
  anchors: RankAnchorMap,
  opts: EnteringRanksOptions = {},
): Map<string, EnteringRank> {
  const { suppressed, resetBefore } = opts;
  const out = new Map<string, EnteringRank>();

  // (1) ONE pass to bucket by track. Non-competitive rows drop out here.
  const tracks = new Map<string, GameRecord[]>();
  for (const g of games) {
    if (classifyGameType(g.gameType) !== 'competitive') continue;
    const key = rankKey(g.account, g.role);
    const bucket = tracks.get(key);
    if (bucket) bucket.push(g);
    else tracks.set(key, [g]);
  }

  for (const [key, track] of tracks) {
    // (2) Sorted ONCE per track, with exactly the comparator `competitiveComps`
    // uses, over a bucket built in `games` order. Array.prototype.sort is stable,
    // so duplicate timestamps keep the order `currentRank` replays them in. Do
    // NOT add a matchId tiebreak — it would silently reorder duplicate-timestamp
    // imports for the live rank too.
    track.sort((a, b) => a.timestamp - b.timestamp);

    const anchor = anchors[key];
    const reset = resetBefore?.get(key);
    // Defensive: a completed run's boundary is always <= the anchor that run
    // wrote, so this is unreachable through the app's own flows — but if a data
    // edit ever broke it, folding from a pre-reset anchor would report ranks
    // across the discontinuity. Blank instead.
    const staleAnchor = anchor !== undefined && reset !== undefined && anchor.setAt < reset;

    /** The ladder-era guard, applied to every derived cell. */
    const guard = (g: GameRecord, derived: EnteringRank): EnteringRank =>
      reset !== undefined && g.timestamp < reset ? PRE_RESET
        : staleAnchor ? STALE_ANCHOR
          : derived;

    /**
     * The one presentation precedence. Suppression beats the stored snapshot for
     * exactly the reason `../dashboardData` masks it: the snapshot only ever
     * exists alongside a ±% that is itself masked. Nothing else beats it — a
     * snapshot is what the player actually saw, and a genuine pre-reset capture
     * must survive a later reset.
     */
    const emit = (g: GameRecord, derived: EnteringRank): void => {
      if (suppressed?.has(g.matchId)) out.set(g.matchId, PLACEMENTS);
      else if (g.rankAtStart) out.set(g.matchId, { note: 'stored', position: g.rankAtStart });
      else out.set(g.matchId, derived);
    };

    if (!anchor) {
      for (const g of track) emit(g, guard(g, NO_ANCHOR));
      continue;
    }

    // The anchor splits the track. `competitiveComps` moves the rank forward on
    // matches STRICTLY after setAt, so the same strict boundary splits here.
    let split = track.length;
    for (let i = 0; i < track.length; i++) {
      if (track[i].timestamp > anchor.setAt) { split = i; break; }
    }

    // (3) FORWARD from the anchor: the state BEFORE a match is what it entered
    // on. Tied timestamps form ONE group sharing one entering value, because
    // `rankEnteringMatch` resolves through a STRICTLY-earlier previous match.
    let state = stateFromAnchor(anchor);
    for (let i = split; i < track.length; i++) {
      let j = i;
      while (j < track.length && track[j].timestamp === track[i].timestamp) j++;
      const cell: EnteringRank = {
        note: 'calculated',
        position: { tier: state.tier, division: state.division, progressPct: state.progressPct },
        protected: state.protected,
      };
      for (let k = i; k < j; k++) emit(track[k], guard(track[k], cell));
      for (let k = i; k < j; k++) {
        state = applyMatch(state, { result: track[k].result, srDelta: srInput(track[k], suppressed) });
      }
      i = j - 1;
    }

    // (4) BACKWARD from the anchor: ONE scalar suffix sum, no per-match rescan.
    //   entering(m) = anchorPoints − Σ{ track matches with m.ts <= ts <= setAt }
    // The match's OWN delta is inside the window — it hadn't moved yet. Tied
    // matches share the window, for the same strict-`<` reason as (3).
    const anchorPoints = rankToPoints(anchor);
    let suffix = 0;
    for (let i = split - 1; i >= 0; i--) {
      let j = i;
      let group = 0;
      while (j >= 0 && track[j].timestamp === track[i].timestamp) {
        group += pointDelta(track[j], suppressed);
        j--;
      }
      const cell: EnteringRank = {
        note: 'reconstructed',
        position: pointsToRank(anchorPoints - suffix - group),
      };
      for (let k = j + 1; k <= i; k++) emit(track[k], guard(track[k], cell));
      suffix += group;
      i = j + 1; // the loop's own i-- lands on j
    }
  }
  return out;
}

/**
 * The same two formulas as {@link enteringRanks}, for ONE (account, role) at one
 * instant — including instants no stored match sits on (the editor's "set
 * current rank" preview). This is what the `rankAtStart` write path uses.
 */
export function enteringRankAt(
  games: readonly GameRecord[],
  anchors: RankAnchorMap,
  account: string,
  role: Role,
  matchTs: number,
  opts: { suppressed?: ReadonlySet<string>; resetBefore?: number } = {},
): EnteringRank {
  const { suppressed, resetBefore } = opts;
  if (resetBefore !== undefined && matchTs < resetBefore) return PRE_RESET;
  const anchor = anchors[rankKey(account, role)];
  if (!anchor) return NO_ANCHOR;
  if (resetBefore !== undefined && anchor.setAt < resetBefore) return STALE_ANCHOR;

  const track: GameRecord[] = [];
  for (const g of games) {
    if (g.account !== account || g.role !== role) continue;
    if (classifyGameType(g.gameType) !== 'competitive') continue;
    track.push(g);
  }
  track.sort((a, b) => a.timestamp - b.timestamp);

  if (matchTs > anchor.setAt) {
    // Forward: replay every comp match strictly between the anchor and the
    // target — identical to currentRank(untilTs = the latest match before it).
    let state = stateFromAnchor(anchor);
    for (const g of track) {
      if (g.timestamp <= anchor.setAt || g.timestamp >= matchTs) continue;
      state = applyMatch(state, { result: g.result, srDelta: srInput(g, suppressed) });
    }
    return {
      note: 'calculated',
      position: { tier: state.tier, division: state.division, progressPct: state.progressPct },
      protected: state.protected,
    };
  }
  // Backward: subtract the closed window [matchTs, anchor.setAt].
  let sum = 0;
  for (const g of track) {
    if (g.timestamp >= matchTs && g.timestamp <= anchor.setAt) sum += pointDelta(g, suppressed);
  }
  return { note: 'reconstructed', position: pointsToRank(rankToPoints(anchor) - sum) };
}
