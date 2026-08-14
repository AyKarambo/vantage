/**
 * Which rank-entry controls a match should get, given the placement run (if any)
 * on its track.
 *
 * This decision used to be hand-copied into three renderer files as `if (run)`,
 * where `run` meant "the track has a run that isn't confirmed yet". That
 * conflated two different questions and produced the bug in #184's follow-up:
 * once a run had counted its ten matches, Overwatch had already revealed the
 * rank and gone back to showing ±%, but Vantage kept offering the prediction
 * picker and wrote no ±% at all. Suppression in this design is a read-time mask
 * over a STORED value (see `../rank/timeline`), so a value never written has
 * nothing to unmask — those matches moved the ladder by zero forever.
 *
 * Keeping it here, pure and tested, is the point: the renderer has no test
 * harness, so a decision this consequential cannot live only in views.
 */
import { PLACEMENT_RUN_LENGTH } from './types';

/**
 * What a match's rank-entry block should offer:
 *  - `placement` — tier/division picker only, no ±%, and a prediction is recorded
 *    against the run. The game genuinely shows no ±% during placements.
 *  - `delta-only` — the plain ±% field, recorded for real, but NOT the
 *    "set current rank" aid. See {@link srEntryMode} for why that aid is unsafe
 *    while a run is open.
 *  - `full` — the normal block: ±% or "set current rank", the player's choice.
 */
export type SrEntryMode = 'placement' | 'delta-only' | 'full';

/** The run facts this decision needs — structural, so `src/core` needn't import the contract. */
export interface EntryModeRun {
  counted: number;
  target: number;
  completed: boolean;
  countedMatchIds: readonly string[];
}

/**
 * Decide the entry mode for a match on a track whose run is `run`.
 *
 * `matchId` distinguishes an EXISTING match (Review, the match editor) from a
 * brand-new one (the log form). It matters: after a run reaches its target, a
 * match already among its ten stays a placement match — its prediction must
 * remain editable, and it must never acquire a fabricated ±% — while a new match
 * is the eleventh and is an ordinary game.
 *
 * `delta-only` rather than `full` while a run is open is deliberate. The "set
 * current rank" aid converts an absolute rank into a ±% by measuring against the
 * track's LIVE anchor (`../rank/reconstruct` srDeltaForSetRank), which takes no
 * suppressed set. While a run is open that anchor is still the pre-run one, so a
 * player truthfully entering the rank the game just revealed would have the
 * whole season's reset gap stored as a single match's ±%. Offering only the ±%
 * field keeps that path shut until completion re-anchors the track.
 */
export function srEntryMode(run: EntryModeRun | undefined, matchId?: string): SrEntryMode {
  if (!run || run.completed) return 'full';
  if (matchId !== undefined) {
    // Per-match: one of the counted ten keeps the picker for good. Anything else
    // on the track — the eleventh, or a match the run was backdated over — is an
    // ordinary game that the game did show a ±% for.
    return run.countedMatchIds.includes(matchId) ? 'placement' : 'delta-only';
  }
  // A brand-new match joins the run only while it still has room.
  return run.counted < run.target ? 'placement' : 'delta-only';
}

/** True while `run` still has room for another counted placement match. */
export function isStillCounting(run: EntryModeRun | undefined): boolean {
  return run !== undefined && !run.completed && run.counted < (run.target || PLACEMENT_RUN_LENGTH);
}
