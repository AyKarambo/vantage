/**
 * Overlays — a centered modal and a right-hand drawer. Both share dismissal
 * behaviour (backdrop click + Escape) via {@link mountOverlay}, so the Log Match
 * modal and the hero drawer stay consistent.
 */
import { h } from '../dom';
import { firstFocusable } from './focusable';

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
   * `false` suppresses backdrop-click dismissal (default `true`) — for a
   * choice with no safe "just walked away" default (F5, e.g. the first-run
   * data-location prompt, which must complete before meaningful data is
   * written).
   */
  dismissOnBackdrop?: boolean;
  /**
   * `false` additionally suppresses Escape (default `true`). Pair with
   * `dismissOnBackdrop: false` for a genuinely mandatory choice; leave at the
   * default when Escape has a sensible fallback meaning (skipping the intro
   * tour, say) even without `onDismiss` doing anything special.
   */
  dismissOnEscape?: boolean;
  /**
   * Runs when the USER dismisses the overlay — Escape or a backdrop click —
   * after it has closed. Not called for a programmatic `close()` (a Save or
   * Cancel button), so a dialog that chains into another one can decide what
   * "just walked away" should return to, without double-firing on its own
   * buttons.
   */
  onDismiss?: () => void;
}

function mountOverlay(
  overlay: HTMLElement,
  panel: HTMLElement,
  opts: Pick<OverlayOpts, 'onDismiss' | 'dismissOnBackdrop' | 'dismissOnEscape'> = {},
): OverlayHandle {
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  // #app sits outside `overlay` (a sibling under <body>) — `inert` there blocks
  // focus and pointer interaction with the whole app underneath while this is
  // open, standing in for a hand-rolled Tab trap: focus can still move freely
  // within `overlay` (never marked inert), and just can't escape it.
  const appRoot = document.getElementById('app');
  const opener = document.activeElement as HTMLElement | null;

  const close = () => {
    window.removeEventListener('keydown', onKey);
    overlay.remove();
    if (appRoot) appRoot.inert = false;
    // Only reclaim focus if it's still where we left it — a caller that moved
    // focus itself as part of closing (e.g. into a freshly opened dialog of
    // its own) should keep it.
    if (opener && document.activeElement === document.body) opener.focus();
  };
  const dismiss = () => {
    close();
    opts.onDismiss?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && opts.dismissOnEscape !== false) dismiss();
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay && opts.dismissOnBackdrop !== false) dismiss();
  });
  // Clicks inside the panel must not bubble to the backdrop handler.
  panel.addEventListener('click', (e) => e.stopPropagation());
  window.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  if (appRoot) appRoot.inert = true;
  // `build(close)` (openModal/openDrawer) appends the panel's real content
  // right after this function returns, still in the same synchronous tick —
  // queue the focus move for the microtask right after, so it lands on
  // content that actually exists instead of the still-empty panel.
  queueMicrotask(() => {
    const target = firstFocusable(panel);
    if (target) target.focus();
    // Falls back to the panel itself (tabindex -1, not in the normal tab
    // order) only if the overlay is still open and truly has nothing focusable.
    else if (overlay.isConnected) { panel.tabIndex = -1; panel.focus(); }
  });
  return { close };
}

/** Open a centered modal. `body(close)` builds the card contents. */
export function openModal(
  build: (close: () => void) => Node,
  opts?: OverlayOpts,
): OverlayHandle {
  const panel = h('div', { class: `modal-card${opts?.panelClass ? ' ' + opts.panelClass : ''}` });
  const overlay = h('div', { class: 'overlay overlay--center' }, panel);
  const handle = mountOverlay(overlay, panel, {
    onDismiss: opts?.onDismiss,
    dismissOnBackdrop: opts?.dismissOnBackdrop,
    dismissOnEscape: opts?.dismissOnEscape,
  });
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
