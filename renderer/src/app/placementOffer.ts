/**
 * The "new season — place your rank?" prompt.
 *
 * Raised lazily: main decides (see `placementOffer` on the contract) and the
 * renderer only asks *after a competitive match is logged*, for the track that
 * was just played. That is deliberate — a ladder reset touches every anchored
 * role, but interrupting app start with a dialog per role would ask about roles
 * the player may not touch all season. Asking at the moment a track is actually
 * played means the question always arrives in context.
 *
 * Nothing is inferred: no run starts without the player choosing it (guardrail
 * 1 — Vantage never reads rank from the game).
 */
import { h } from '../dom';
import { openModal, overlayOpen } from '../components/overlay';
import { button } from '../components/primitives';
import { bridge } from '../bridge';
import { roleLabel } from '../format';
import type { PlacementOffer } from '../../../src/shared/contract';

/**
 * Show the offer. `onDone` fires only when something was actually decided, so
 * the caller can refresh.
 *
 * Dismissing (Escape / backdrop) records NOTHING and the offer is raised again
 * after the next match on this track. Only the explicit "Not now" persists a
 * decline for the season — a stray Escape should not silently switch a feature
 * off for two months.
 */
export function openPlacementOffer(offer: PlacementOffer, onDone: () => void): void {
  openModal((close) => {
    const track = `${roleLabel(offer.role)} on ${offer.account}`;
    // The two rules ask genuinely different questions, so they get different
    // copy. Asserting "no rank yet" on a season-reset track would be false —
    // that track has a rank, it just predates the reset.
    const title = offer.reason === 'new-track'
      ? `No rank tracked for ${track}`
      : `${offer.seasonLabel} resets the ladder`;
    const lead = offer.reason === 'new-track'
      ? `Vantage has no rank for ${track} yet. If you're placing, it can count the 10 placement matches — `
        + 'otherwise set your current rank in Settings and it will track from there.'
      : `Your rank for ${track} was set before this season started. Track the 10 placement matches here?`;
    // Never a surprise: say what accepting would claim. `backdatedCount` is 0
    // when there is nothing to backdate to (or too much — past ten claimable
    // matches a run can't honestly cover them all), in which case it starts now.
    const claim = offer.backdatedCount > 0
      ? `This run would start at your ${offer.backdatedCount === 1 ? 'match' : `first of ${offer.backdatedCount} matches`} `
        + `already played this season on ${track}, so ${offer.backdatedCount === 1 ? 'it counts' : 'they count'} toward the 10.`
      : 'This run would start now — matches you have already played stay as they are.';
    return h('div', { class: 'stack', style: { gap: '14px', padding: '18px', width: '440px', maxWidth: '92vw' } },
      h('div', { style: { fontSize: '15px', fontWeight: '600' } }, title),
      h('div', { class: 'hint' }, lead),
      h('div', { class: 'hint' }, claim),
      h('div', { class: 'hint' },
        'While a run is open Vantage shows Placements N/10 instead of a rank, and takes the predicted rank the game '
        + 'shows after each match rather than a ±%. You can reset or cancel a run at any time — your current rank comes back.'),
      h('div', { style: { display: 'flex', gap: '10px', marginTop: '4px' } },
        button('Start placements', {
          variant: 'primary',
          // `fromMatchId` is the whole fix for the reported 3/10: without it the
          // run stamps `Date.now()` and `countedMatches`' `>=` puts the very
          // match that raised this prompt outside its own run.
          onClick: () => void bridge.startPlacementRun({
            account: offer.account, role: offer.role,
            ...(offer.fromMatchId ? { fromMatchId: offer.fromMatchId } : {}),
          }).then(() => { close(); onDone(); }),
        }),
        button('Not now', {
          variant: 'ghost',
          onClick: () => void bridge.declinePlacementRun({
            account: offer.account, role: offer.role, seasonStart: offer.seasonStart,
          }).then(() => { close(); onDone(); }),
        }),
      ),
    );
  });
}

/**
 * Ask main whether this track should be offered a run, and show the prompt if
 * so. Resolves to whether a prompt was actually shown, so a caller that wants
 * to do something else afterwards can tell "nothing to ask" from "asked" without
 * inspecting the DOM.
 */
export async function maybeOfferPlacements(
  account: string,
  role: PlacementOffer['role'],
  onDone: () => void,
): Promise<boolean> {
  // Three independent triggers can reach here for the same match — the log
  // form, a live match landing (shell.onGameLogged), and a Review save — and
  // they can overlap. Stacking a second card over an open one is worse than
  // waiting: main re-offers on the next match, and the offer is backdated, so
  // nothing is lost by deferring.
  if (overlayOpen()) return false;
  const offer = await bridge.placementOffer({ account, role });
  if (!offer) return false;
  // Re-checked after the await: the round trip is long enough for the player to
  // have opened something in the meantime.
  if (overlayOpen()) return false;
  openPlacementOffer(offer, onDone);
  return true;
}
