/**
 * Overlays — a centered modal and a right-hand drawer. Both share dismissal
 * behaviour (backdrop click + Escape) via {@link mountOverlay}, so the Log Match
 * modal and the hero drawer stay consistent.
 */
import { h } from '../dom';

export interface OverlayHandle {
  close: () => void;
}

/**
 * Whether an overlay is currently mounted. Both {@link openModal} and
 * {@link openDrawer} append a `.overlay` to `document.body` and remove it on
 * close, so this is the honest answer for "is the user already looking at
 * something modal?".
 *
 * Used by prompts that can be raised by several independent triggers (the
 * placement offer fires from the log form, a live match landing, and a Review
 * save) to stay out of the way rather than stacking a second card on top of the
 * first — the offer is re-raised on the next match anyway.
 */
export function overlayOpen(): boolean {
  return document.querySelector('.overlay') !== null;
}

export interface OverlayOpts {
  /** Adds a modifier class to the panel (e.g. `modal-card--wide`). */
  panelClass?: string;
  /**
   * Runs when the USER dismisses the overlay — Escape or a backdrop click —
   * after it has closed. Not called for a programmatic `close()` (a Save or
   * Cancel button), so a dialog that chains into another one can decide what
   * "just walked away" should return to, without double-firing on its own
   * buttons.
   */
  onDismiss?: () => void;
}

function mountOverlay(overlay: HTMLElement, panel: HTMLElement, opts: Pick<OverlayOpts, 'onDismiss'> = {}): OverlayHandle {
  const close = () => {
    window.removeEventListener('keydown', onKey);
    overlay.remove();
  };
  const dismiss = () => {
    close();
    opts.onDismiss?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') dismiss();
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) dismiss();
  });
  // Clicks inside the panel must not bubble to the backdrop handler.
  panel.addEventListener('click', (e) => e.stopPropagation());
  window.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  return { close };
}

/** Open a centered modal. `body(close)` builds the card contents. */
export function openModal(
  build: (close: () => void) => Node,
  opts?: OverlayOpts,
): OverlayHandle {
  const panel = h('div', { class: `modal-card${opts?.panelClass ? ' ' + opts.panelClass : ''}` });
  const overlay = h('div', { class: 'overlay overlay--center' }, panel);
  const handle = mountOverlay(overlay, panel, { onDismiss: opts?.onDismiss });
  panel.append(build(handle.close));
  return handle;
}

/** Open a right-hand drawer with a built-in close button. `panelClass` adds a
 *  modifier (e.g. `drawer-panel--wide`) for surfaces that need more room. */
export function openDrawer(
  build: (close: () => void) => Node,
  opts?: { panelClass?: string },
): OverlayHandle {
  const panel = h('div', { class: `drawer-panel${opts?.panelClass ? ' ' + opts.panelClass : ''}` });
  const overlay = h('div', { class: 'overlay overlay--right' }, panel);
  const handle = mountOverlay(overlay, panel);
  const closeBtn = h('button', { class: 'overlay-close', title: 'Close', 'aria-label': 'Close', style: { position: 'absolute', top: '12px', right: '14px' } }, '✕');
  closeBtn.addEventListener('click', handle.close);
  panel.append(closeBtn, build(handle.close));
  return handle;
}
