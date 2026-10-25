import type { GameRecord, MatchReview } from './analytics';
import type { ManualMatchInput, MatchEditInput } from '../shared/contract';
import type { ManualPatch } from './manualPatch';
import { partyFromInput } from './party';
import { sourceOf } from './source';

/**
 * The focus / break marks of a read, as they arrive over untrusted IPC: keep
 * only a string array / a boolean, and never add a key that wasn't sent.
 */
export function reviewMarks(input: { focusTargetIds?: unknown; breakBefore?: unknown }): Pick<MatchReview, 'focusTargetIds' | 'breakBefore'> {
  return {
    ...(Array.isArray(input.focusTargetIds)
      ? { focusTargetIds: input.focusTargetIds.filter((id): id is string => typeof id === 'string') }
      : {}),
    ...(typeof input.breakBefore === 'boolean' ? { breakBefore: input.breakBefore } : {}),
  };
}

/** The record a hand-logged match is stored as. `now` stamps it; `account` is the fallback when the log names none. */
export function manualGameRecord(input: ManualMatchInput, ctx: { matchId: string; now: number; account: string }): GameRecord {
  const grades = input.grades && Object.keys(input.grades).length ? input.grades : undefined;
  const marks = reviewMarks(input);
  // A log with "Nothing specific" chosen (`focusTargetIds: []`) or a break
  // mark is still a deliberate read, so it makes a review even with no grades.
  const makeReview = !!grades || Object.keys(marks).length > 0;
  const party = partyFromInput(input.party);
  return {
    matchId: ctx.matchId,
    // Clamped to the past: a skewed clock can never produce future history.
    timestamp: input.playedAt != null ? Math.min(input.playedAt, ctx.now) : ctx.now,
    account: input.account || ctx.account,
    role: input.role,
    map: input.map,
    result: input.result,
    gameType: input.gameType,
    source: 'manual',
    heroes: input.heroes ?? (input.hero ? [input.hero] : []),
    mental: input.mental,
    ...(input.srDelta != null ? { srDelta: input.srDelta } : {}),
    ...(input.performance != null ? { performance: input.performance } : {}),
    ...(party ? { party } : {}),
    // Inline target grades captured while logging are stored as a review, the
    // same shape the Review screen writes — so they score identically.
    ...(makeReview ? { review: { at: ctx.now, grades: grades ?? {}, flags: input.mental ?? {}, ...marks } } : {}),
  };
}

/**
 * The manual-layer patch a match-editor save makes to `game`.
 *
 * Game facts (result, role, map, mode, heroes) are editable on every match — a
 * result the feed got wrong can be hand-corrected on an auto-tracked match too.
 * When such an edit actually changes a fact on an auto-tracked match, the patch
 * stamps `factsEditedAt` so the UI can mark it "edited" (the record keeps
 * source 'gep'). The party, mental flags, ±% and performance are the player's
 * own annotation layer and never count as facts.
 */
export function matchEditPatch(game: GameRecord, input: MatchEditInput, now: number): ManualPatch {
  const isManual = sourceOf(game) === 'manual';
  const patch: ManualPatch = {};
  // `heroes` (the multi-hero list) wins; the legacy single `hero` is coerced.
  // Both honour `[]` / '' as "clear".
  const nextHeroes =
    input.heroes !== undefined ? input.heroes
    : input.hero !== undefined ? (input.hero ? [input.hero] : [])
    : undefined;
  if (input.result !== undefined) patch.result = input.result;
  if (input.role !== undefined) patch.role = input.role;
  if (input.map !== undefined) patch.map = input.map;
  if (input.gameType !== undefined) patch.gameType = input.gameType;
  if (nextHeroes !== undefined) patch.heroes = nextHeroes;
  const factsChanged =
    (input.result !== undefined && input.result !== game.result) ||
    (input.role !== undefined && input.role !== game.role) ||
    (input.map !== undefined && input.map !== game.map) ||
    (input.gameType !== undefined && input.gameType !== game.gameType) ||
    (nextHeroes !== undefined && !sameHeroes(nextHeroes, game.heroes ?? []));
  if (!isManual && factsChanged) patch.factsEditedAt = now;
  if (input.mental !== undefined) patch.mental = input.mental;
  // Rank movement arrives as a plain ±%: "Set current rank" is resolved by the
  // renderer through `rankEntryPreview` before saving. `null` clears it.
  if (input.srDelta !== undefined) patch.srDelta = input.srDelta;
  if (input.performance !== undefined) patch.performance = input.performance;
  // A hand edit stores `source: 'manual'`, so the auto-labeller (new captures
  // only) can never overwrite it.
  const party = partyFromInput(input.party);
  if (party !== undefined) patch.party = party;
  // The played-at time is honoured for a hand-logged match only — a GEP
  // capture's timestamp is the instant the game itself ended.
  if (input.playedAt !== undefined && isManual) patch.timestamp = Math.min(input.playedAt, now);
  // Played-time correction (the per-10 divisor), on any match: a capture that
  // joined mid-match saw only part of it. `null` drops it; an implausible
  // length is ignored rather than stored.
  if (input.playedMinutes === null) patch.playedMinutesOverride = null;
  else if (isPlausibleMinutes(input.playedMinutes)) patch.playedMinutesOverride = input.playedMinutes;
  // Stamp a review when there are grades to save, or when the match is already
  // reviewed — then review.flags must move with `mental`, or an old flag would
  // resurface on read. An edit without grades never marks an unreviewed match.
  const hasGrades = !!(input.grades && Object.keys(input.grades).length);
  if (hasGrades || game.review) {
    patch.review = {
      // Keep the focus / break mark a prior Review or Log Match saved.
      ...game.review,
      at: now,
      grades: hasGrades ? input.grades! : game.review?.grades ?? {},
      flags: input.mental ?? game.mental ?? {},
    };
  }
  return patch;
}

/** Order-insensitive hero-list equality, so re-ordering alone never counts as a fact edit. */
function sameHeroes(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = [...b].sort();
  return [...a].sort().every((h, i) => h === sb[i]);
}

/** A hand-entered played time worth storing: positive and no longer than any real match. */
function isPlausibleMinutes(m: number | null | undefined): m is number {
  return typeof m === 'number' && Number.isFinite(m) && m > 0 && m <= 120;
}
