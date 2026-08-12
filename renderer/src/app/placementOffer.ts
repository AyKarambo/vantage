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
import { openModal } from '../components/overlay';
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
    return h('div', { class: 'stack', style: { gap: '14px', padding: '18px', width: '440px', maxWidth: '92vw' } },
      h('div', { style: { fontSize: '15px', fontWeight: '600' } }, `${offer.seasonLabel} resets the ladder`),
      h('div', { class: 'hint' },
        `Your rank for ${track} was set before this season started. Track the 10 placement matches here?`),
      h('div', { class: 'hint' },
        'While a run is open Vantage shows Placements N/10 instead of a rank, and takes the predicted rank the game '
        + 'shows after each match rather than a ±%. You can reset or cancel a run at any time — your current rank comes back.'),
      h('div', { style: { display: 'flex', gap: '10px', marginTop: '4px' } },
        button('Start placements', {
          variant: 'primary',
          onClick: () => void bridge.startPlacementRun({ account: offer.account, role: offer.role })
            .then(() => { close(); onDone(); }),
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
  const offer = await bridge.placementOffer({ account, role });
  if (!offer) return false;
  openPlacementOffer(offer, onDone);
  return true;
}
