import type { GameRecord } from '../analytics';
import type { Role } from '../model';
import type { RankAnchor } from '../rank';
import { classifyGameType } from '../matchFilter';
import { PLACEMENT_RUN_LENGTH, type PlacementRun, type PredictedRank } from './types';

/**
 * The pure placement-run engine: derives progress, completion and drift from a
 * run's bookkeeping fields (`startedAt`, `predictions`, `completedMatchIds`)
 * against the live match history. No I/O, no dates beyond what's passed in —
 * fully unit-tested, like {@link ../rank/engine}.
 */

/**
 * The ordered matches that count toward `run`: competitive, matching the
 * run's (account, role), from `run.startedAt` onward, ascending time order,
 * capped at {@link PLACEMENT_RUN_LENGTH}.
 *
 * Deliberately `>=`, not the strict `>` that {@link ../rank/timeline
 * competitiveComps} uses for a rank anchor's `setAt`: a rank anchor is a
 * reading taken *between* matches, so the match that produced it must be
 * excluded from what moves the rank forward from there. A placement run's
 * `startedAt`, by contrast, is deliberately set to a match's own timestamp
 * (the first placement match, or the match that triggered the season-reset
 * prompt) — that match must count, or the run would perpetually read as one
 * short.
 */
export function countedMatches(games: GameRecord[], run: PlacementRun): GameRecord[] {
  return trackMatchesFrom(games, run).slice(0, PLACEMENT_RUN_LENGTH);
}

/**
 * Every competitive match on the run's track from `startedAt` onward, ascending —
 * the same selection as {@link countedMatches} but WITHOUT its
 * {@link PLACEMENT_RUN_LENGTH} cap.
 *
 * The cap is right for progress and drift (a run is ten matches, by definition),
 * but wrong for suppression: a player can keep queueing after the tenth match and
 * before confirming the revealed rank, and those extra matches belong to the same
 * "no settled rank yet" window. See {@link suppressedMatchIds}.
 */
export function trackMatchesFrom(games: GameRecord[], run: PlacementRun): GameRecord[] {
  return trackMatches(games, run.account, run.role, run.startedAt);
}

/**
 * The competitive matches on one (account, role) track from `since` onward,
 * ascending — {@link trackMatchesFrom} without needing a run to ask.
 *
 * Deliberately `>=`, for the same reason {@link countedMatches} is: a run's
 * `startedAt` is set to a match's OWN timestamp, and that match must count.
 * This is what lets an offer be backdated to the match that raised it.
 */
export function trackMatches(
  games: GameRecord[],
  account: string,
  role: Role,
  since = Number.NEGATIVE_INFINITY,
): GameRecord[] {
  return games
    .filter(
      (g) =>
        g.account === account &&
        g.role === role &&
        classifyGameType(g.gameType) === 'competitive' &&
        g.timestamp >= since,
    )
    .sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * How far `run` has progressed: how many matches count so far (out of
 * {@link PLACEMENT_RUN_LENGTH}) and the most recent predicted rank, if any.
 *
 * `latestPrediction` walks the counted matches from the newest backward and
 * returns the first one with a recorded prediction — not simply the last
 * counted match's prediction, because predictions are sparse (a match can be
 * logged before its predicted rank is entered, or without one at all) and the
 * UI wants the freshest real reading, not a blank.
 */
export function runProgress(
  games: GameRecord[],
  run: PlacementRun,
): {
  counted: number;
  target: number;
  latestPrediction?: PredictedRank;
  countedMatchIds: string[];
} {
  const counted = countedMatches(games, run);
  let latestPrediction: PredictedRank | undefined;
  for (let i = counted.length - 1; i >= 0; i--) {
    const prediction = run.predictions[counted[i].matchId];
    if (prediction) {
      latestPrediction = prediction;
      break;
    }
  }
  return {
    counted: counted.length,
    target: PLACEMENT_RUN_LENGTH,
    latestPrediction,
    // Carried so consumers can ask the PER-MATCH question ("is this particular
    // match one of the ten?") instead of only the per-run one. `counted` alone
    // can't answer it, and the difference matters the moment a run reaches its
    // target with the player still logging: match eleven is not a placement
    // match, but matches one through ten stay placement matches forever.
    countedMatchIds: counted.map((g) => g.matchId),
  };
}

/** True once `run` has counted its full {@link PLACEMENT_RUN_LENGTH} matches. */
export function isRunComplete(games: GameRecord[], run: PlacementRun): boolean {
  return countedMatches(games, run).length >= PLACEMENT_RUN_LENGTH;
}

/**
 * True when `run` has played out its full length but the rank Overwatch revealed
 * has not been confirmed yet — the run is waiting on the player, not on more
 * matches.
 *
 * This is the state the UI was missing: `counted === target` with
 * `completedAt === undefined` used to render exactly like a mid-run track, so a
 * finished run advertised `Placements 10/10 · Diamond 1 (predicted)` forever with
 * nothing indicating that the last step is a question only the player can answer.
 * Deliberately derived, never stored: it is a function of history and the run's
 * own bookkeeping, so it can never drift out of step with either.
 */
export function isAwaitingRank(games: GameRecord[], run: PlacementRun): boolean {
  return run.completedAt === undefined && isRunComplete(games, run);
}

/**
 * True when a completed run's counted matches no longer match the snapshot
 * taken at completion — i.e. match history was edited (a fact changed the
 * competitive/role/account classification, or a match was added/removed/
 * retimed) in a way that would change which matches placement counted.
 *
 * Only meaningful for completed runs: `run.completedAt` and
 * `run.completedMatchIds` must both be set, otherwise there is nothing to
 * compare against and drift is definitionally false. The comparison is
 * order-sensitive (a reorder is itself a drift worth surfacing, since it
 * usually means a timestamp edit) rather than a set comparison.
 */
export function hasDrifted(games: GameRecord[], run: PlacementRun): boolean {
  if (run.completedAt === undefined || run.completedMatchIds === undefined) return false;
  const currentIds = countedMatches(games, run).map((g) => g.matchId);
  const snapshot = run.completedMatchIds;
  if (currentIds.length !== snapshot.length) return true;
  return currentIds.some((id, i) => id !== snapshot[i]);
}

/**
 * The matchIds that placement tracking claims across all of `runs`, for one
 * account/role scope's callers to hide from other rank/history math that
 * shouldn't double-count them.
 *
 * Only OPEN runs (`completedAt === undefined`) contribute: once a run
 * completes, its counted matches have already been folded into the rank
 * anchor set at completion (the "post-placement" anchor), so continuing to
 * suppress them would hide real history from every other view for no reason.
 * An open run's matches, by contrast, don't have a settled rank yet — the
 * live client shows no rank at all until placement finishes — so they stay
 * suppressed from rank math until the run completes or is cancelled.
 *
 * Uses {@link trackMatchesFrom}, NOT {@link countedMatches}: suppression follows
 * the "no settled rank yet" window, which is not capped at ten. A player who keeps
 * queueing after the tenth match but before confirming the revealed rank would
 * otherwise have those extra matches apply their ±% to the PRE-run anchor — a rank
 * the track no longer has. Completion then re-admits them at once, since it anchors
 * at the tenth counted match and the rank timeline filters strictly after that
 * instant.
 */
export function suppressedMatchIds(
  games: GameRecord[],
  runs: PlacementRun[],
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const run of runs) {
    if (run.completedAt !== undefined) continue;
    for (const g of trackMatchesFrom(games, run)) ids.add(g.matchId);
  }
  return ids;
}

/**
 * Whether to prompt the player to start a new placement run for a track,
 * evaluated once per season reset. All of the following must hold:
 *  - `isResetSeason`: the caller has already determined `seasonStart` is a
 *    season boundary the player has just crossed (not just "any season").
 *  - no `existingRun` for the track yet — don't re-prompt mid-run.
 *  - `seasonStart` isn't in `declinedSeasonStarts` — respect a past "not now".
 *  - the track has an anchor at all (`anchor !== null`) — this rule is about a
 *    reset moving a rank the track ALREADY has. A track with no anchor is not
 *    "nothing to place from", it is the other case entirely; see
 *    {@link shouldOfferNewTrackRun}.
 *  - `anchor.setAt < seasonStart` — the anchor predates the reset. An anchor
 *    set inside the new season already means the player has re-anchored
 *    (e.g. manually entered their placement result), so asking again would
 *    be redundant.
 */
export function shouldOfferRun(opts: {
  seasonStart: number;
  isResetSeason: boolean;
  anchor: RankAnchor | null;
  existingRun: PlacementRun | undefined;
  declinedSeasonStarts: readonly number[];
}): boolean {
  const { seasonStart, isResetSeason, anchor, existingRun, declinedSeasonStarts } = opts;
  if (!isResetSeason) return false;
  if (existingRun) return false;
  if (declinedSeasonStarts.includes(seasonStart)) return false;
  if (anchor === null) return false;
  return anchor.setAt < seasonStart;
}

/**
 * Whether to offer a placement run for a track Vantage has NO rank for — a
 * brand-new account, or a role never queued before. The second of the two
 * offer rules, alongside {@link shouldOfferRun}'s season-reset rule.
 *
 * This is the gap behind issue #200: `shouldOfferRun` requires both a ladder
 * reset AND an existing anchor, so a fresh (account, role) could never be
 * offered a run automatically — the player had to know to click "Start
 * placements" before their first ranked game, and every one they played first
 * was silently left out of the run.
 *
 * All of the following must hold:
 *  - `anchor === null` — Vantage has no rank for this track. This is the whole
 *    signal, and it is deliberately the ONLY thing consulted about rank state.
 *    An earlier design keyed on `anchor.setAt < firstMatchTs` ("anchored before
 *    you played" ⇒ not placing), which is unsound: both sides are independently
 *    mutable, so logging a backdated match, importing older matches from Notion,
 *    or deleting a track's oldest games all silently invert it and offer
 *    placements to an established track. `anchor === null` cannot be inverted by
 *    any edit — the anchor either exists or it does not.
 *  - no `existingRun` — don't re-offer mid-run, or after one finished.
 *  - `seasonStart` isn't in `declinedSeasonStarts` — respect a past "not now".
 *    Shared with the reset rule's ledger, so one decline quiets the track for
 *    the season either way; it re-raises next season, when the question is
 *    genuinely live again.
 *  - `trackMatchCount > 0` — only ever asked in response to a real match on the
 *    track, never speculatively.
 *
 * Note what is NOT here: a ceiling on how many matches the track has played.
 * Overwatch's own placement run is exactly ten matches, so any ceiling of ten
 * would fire only for a player whose eleventh game hadn't happened yet — the
 * reported user played their placements with Vantage in the background and
 * would have sailed past it. A track with no rank at all is worth asking about
 * whenever it is played; the decline ledger is what stops the asking.
 */
export function shouldOfferNewTrackRun(opts: {
  seasonStart: number;
  anchor: RankAnchor | null;
  existingRun: PlacementRun | undefined;
  declinedSeasonStarts: readonly number[];
  trackMatchCount: number;
}): boolean {
  const { seasonStart, anchor, existingRun, declinedSeasonStarts, trackMatchCount } = opts;
  if (anchor !== null) return false;
  if (existingRun) return false;
  if (declinedSeasonStarts.includes(seasonStart)) return false;
  return trackMatchCount > 0;
}
