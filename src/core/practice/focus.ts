import type { GameRecord, MatchReview } from '../analytics';
import type { SessionCheckIn } from '../checkIn';
import type { CoachingSettings, FocusStickiness } from '../coachingSettings';
import { NOTION_IMPROVEMENT_TARGET_ID } from '../targets/notionBookkeeping';
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
  return !!review && (review.focusTargetIds !== undefined || Object.keys(review.grades ?? {}).length > 0);
}

/**
 * Whether Mental and Review lead with practice (target execution) instead of
 * win/loss: `on`/`off` force it; `auto` follows whether any target is active
 * and not archived.
 */
export function practiceFocusOn(
  settings: Pick<CoachingSettings, 'practiceFocus'>,
  targets: ReadonlyArray<{ isActive: boolean; archivedAt?: number }>,
): boolean {
  if (settings.practiceFocus === 'on') return true;
  if (settings.practiceFocus === 'off') return false;
  return targets.some((t) => t.isActive && !t.archivedAt);
}

/**
 * Which targets Review / Log Match pre-select for `game`, by the player's
 * stickiness choice:
 * - `game` — nothing carries over from another game;
 * - `sitting` — the choice made on the nearest-in-time reviewed game of the same sitting;
 * - `sticky` — the most recently SAVED choice, across sittings.
 * When that gives nothing, the "today's focus" of the check-in that preceded
 * this game's sitting applies — for that sitting only. The result is narrowed
 * to `selectable` (the active self-rated targets the chooser can show).
 */
export function focusPreselection(
  all: readonly GameRecord[],
  game: GameRecord,
  stickiness: FocusStickiness,
  checkIns: readonly SessionCheckIn[],
  selectable: ReadonlySet<string>,
  gapMinutes = PRACTICE_SITTING_GAP_MINUTES,
): string[] {
  const narrow = (ids: readonly string[]): string[] => ids.filter((id) => selectable.has(id));
  const sitting = sittingsOf(all, gapMinutes).find((s) => s.some((g) => g.matchId === game.matchId)) ?? [game];
  if (stickiness === 'sitting') {
    const nearest = sitting
      .filter((g) => g.matchId !== game.matchId && hasFocusChoice(g.review))
      .sort((a, b) => Math.abs(a.timestamp - game.timestamp) - Math.abs(b.timestamp - game.timestamp))[0];
    if (nearest) return narrow(focusOf(nearest.review));
  } else if (stickiness === 'sticky') {
    const latest = all
      .filter((g) => g.matchId !== game.matchId && hasFocusChoice(g.review))
      .sort((a, b) => b.review!.at - a.review!.at)[0];
    if (latest) return narrow(focusOf(latest.review));
  }
  const sorted = [...checkIns].sort((a, b) => a.at - b.at);
  return narrow(checkInForSitting(sitting[0], sorted, gapMinutes)?.focusTargetIds ?? []);
}

/**
 * How many games since `since` the player actually worked on `targetId` —
 * the staleness match count for a self-rated target. A parked target doesn't
 * age while you practise another one.
 */
export function focusGamesSince(all: readonly GameRecord[], targetId: string, since: number): number {
  return all.reduce((n, g) => (g.timestamp >= since && focusOf(g.review).includes(targetId) ? n + 1 : n), 0);
}
