import type { GameRecord, MatchReview } from '../analytics';
import type { SessionCheckIn } from '../checkIn';
import type { CoachingSettings, FocusStickiness } from '../coachingSettings';
import { NOTION_IMPROVEMENT_TARGET_ID } from '../targets/notionBookkeeping';
import { matchInTargetScope, type TargetScope } from '../targets/scope';
import { checkInForSitting, PRACTICE_SITTING_GAP_MINUTES, sittingsOf } from './sittings';

/**
 * Focus targets (issue #321): which self-rated targets the player worked on in
 * a game. Review and Log Match ask "What did you work on this game?" and only
 * the chosen targets get graded, so an unchosen target is neither an attempt
 * nor a miss — and it doesn't go stale while it's parked.
 */

/**
 * The targets a review says the player worked on: the explicitly chosen set
 * united with every target that carries a grade. Older reviews have no
 * `focusTargetIds`, so their focus is simply their graded targets; the union
 * also keeps a later match-detail grade edit counted. The hidden Notion
 * bookkeeping id never counts.
 */
export function focusOf(review: MatchReview | undefined): string[] {
  if (!review) return [];
  const ids = new Set([...(review.focusTargetIds ?? []), ...Object.keys(review.grades ?? {})]);
  ids.delete(NOTION_IMPROVEMENT_TARGET_ID);
  return [...ids];
}

/** Whether a review records a focus choice at all — a "no-read" review (empty grades, no choice) doesn't. */
export function hasFocusChoice(review: MatchReview | undefined): boolean {
  // focusOf, not the raw grade keys: a Notion import whose only grade is the
  // hidden bookkeeping id is not a choice the player made.
  return !!review && (review.focusTargetIds !== undefined || focusOf(review).length > 0);
}

/**
 * Whether Mental and Review lead with practice (target execution) instead of
 * win/loss: `on`/`off` force it; `auto` follows whether any SELF-RATED target
 * is active and not archived — measured targets grade every game by
 * themselves, so they give the player nothing to choose or practise here.
 */
export function practiceFocusOn(
  settings: Pick<CoachingSettings, 'practiceFocus'>,
  targets: ReadonlyArray<{ isActive: boolean; archivedAt?: number; mode?: string }>,
): boolean {
  if (settings.practiceFocus === 'on') return true;
  if (settings.practiceFocus === 'off') return false;
  return targets.some((t) => t.isActive && !t.archivedAt && t.mode !== 'measured');
}

/**
 * Which targets Review / Log Match pre-select for `game`, by the player's
 * stickiness choice:
 * - `game` — nothing carries over from another game;
 * - `sitting` — the choice made on the nearest-in-time reviewed game of the same sitting;
 * - `sticky` — the most recently SAVED choice, across sittings.
 * When that gives nothing, the "today's focus" of the check-in that preceded
 * this game's sitting applies — for that sitting only. The result is narrowed
 * to `selectable` (the active self-rated targets the chooser can show). With
 * `scopes`, a choice made on a game where some of this game's targets were out
 * of scope only counts when no game offering all of them is found.
 */
export function focusPreselection(
  all: readonly GameRecord[],
  game: GameRecord,
  stickiness: FocusStickiness,
  checkIns: readonly SessionCheckIn[],
  selectable: ReadonlySet<string>,
  gapMinutes = PRACTICE_SITTING_GAP_MINUTES,
  scopes?: ReadonlyMap<string, TargetScope>,
): string[] {
  return focusPreselector(all, stickiness, checkIns, selectable, gapMinutes, scopes)(game);
}

/**
 * {@link focusPreselection} for many games at once: sittings, the saved
 * choices and the sorted check-ins are prepared once, so the Review inbox
 * (up to 150 rows over thousands of games) doesn't re-walk the history per row.
 */
export function focusPreselector(
  all: readonly GameRecord[],
  stickiness: FocusStickiness,
  checkIns: readonly SessionCheckIn[],
  selectable: ReadonlySet<string>,
  gapMinutes = PRACTICE_SITTING_GAP_MINUTES,
  scopes?: ReadonlyMap<string, TargetScope>,
): (game: GameRecord) => string[] {
  const narrow = (ids: readonly string[]): string[] => ids.filter((id) => selectable.has(id));
  const sittingOf = new Map<string, GameRecord[]>();
  for (const s of sittingsOf(all, gapMinutes)) for (const g of s) sittingOf.set(g.matchId, s);
  // Newest saved choice first — only needed for 'sticky'.
  const chosen = stickiness === 'sticky'
    ? all.filter((g) => hasFocusChoice(g.review)).sort((a, b) => b.review!.at - a.review!.at)
    : [];
  const sorted = [...checkIns].sort((a, b) => a.at - b.at);
  const inScope = (g: GameRecord, id: string): boolean => {
    const scope = scopes?.get(id);
    return !scope || matchInTargetScope(g, scope);
  };
  // Prefer a choice made with every target this game offers on offer there
  // too: a Genji-only target is missing from a Sojourn game's chooser, so what
  // was picked there says nothing about it, and the next Genji game should take
  // the choice from the last game where it could have been picked.
  const pick = (candidates: readonly GameRecord[], game: GameRecord): GameRecord | undefined => {
    if (!scopes) return candidates[0];
    const offered = [...selectable].filter((id) => inScope(game, id));
    return candidates.find((c) => offered.every((id) => inScope(c, id))) ?? candidates[0];
  };
  return (game) => {
    const sitting = sittingOf.get(game.matchId) ?? [game];
    if (stickiness === 'sitting') {
      const nearest = pick(sitting
        .filter((g) => g.matchId !== game.matchId && hasFocusChoice(g.review))
        .sort((a, b) => Math.abs(a.timestamp - game.timestamp) - Math.abs(b.timestamp - game.timestamp)), game);
      if (nearest) return narrow(focusOf(nearest.review));
    } else if (stickiness === 'sticky') {
      const latest = pick(chosen.filter((g) => g.matchId !== game.matchId), game);
      if (latest) return narrow(focusOf(latest.review));
    }
    return narrow(checkInForSitting(sitting[0], sorted, gapMinutes)?.focusTargetIds ?? []);
  };
}

/**
 * How many games since `since` the player actually worked on `targetId` —
 * the staleness match count for a self-rated target. A parked target doesn't
 * age while you practise another one.
 */
export function focusGamesSince(all: readonly GameRecord[], targetId: string, since: number): number {
  return all.reduce((n, g) => (g.timestamp >= since && focusOf(g.review).includes(targetId) ? n + 1 : n), 0);
}
