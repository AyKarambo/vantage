/**
 * Overlays — a centered modal and a right-hand drawer. Both share dismissal
 * behaviour (backdrop click + Escape) via {@link mountOverlay}, so the Log Match
 * modal and the hero drawer stay consistent.
 */
import { h } from '../dom';

export interface OverlayHandle {
  close: () => void;
}

function mountOverlay(overlay: HTMLElement, panel: HTMLElement, onClose?: () => void): OverlayHandle {
  const close = () => {
    window.removeEventListener('keydown', onKey);
    overlay.remove();
    onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
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
  opts?: { panelClass?: string },
): OverlayHandle {
  const panel = h('div', { class: `modal-card${opts?.panelClass ? ' ' + opts.panelClass : ''}` });
  const overlay = h('div', { class: 'overlay overlay--center' }, panel);
  const handle = mountOverlay(overlay, panel);
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
