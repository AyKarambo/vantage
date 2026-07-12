import type { Result } from '../model';

/**
 * Estimated skill-rating step a competitive result moves your rank, in points of
 * a division — Overwatch shifts rank by roughly ±25% of a division per game.
 *
 * The sanctioned GEP feed does NOT report rank or SR (see the competitive note in
 * `matchDetail`), so a live-captured game carries no true delta and would advance
 * the calculated rank by 0. We estimate it from the result instead — the same
 * preset the manual quick-log applies (`renderer/src/app/log-match.ts`), so an
 * auto-logged game and a hand-logged one move the ladder identically. Always
 * user-editable via the match editor's SR% field.
 */
export const PRESET_SR_STEP = 25;

/** The estimated SR delta for a competitive result: Win → +step, Loss → −step, Draw → 0. */
export function presetSrDelta(result: Result): number {
  return result === 'Win' ? PRESET_SR_STEP : result === 'Loss' ? -PRESET_SR_STEP : 0;
}
