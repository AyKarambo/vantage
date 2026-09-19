/**
 * A small anchored popover (vs. the centered modal / right drawer in
 * overlay.ts): opens next to its anchor element, closes on Escape, backdrop
 * click, or via the handle. Used by the status-bar connection indicator.
 */
import { h } from '../dom';
import { firstFocusable } from './focusable';

export interface PopoverHandle {
  close(): void;
}

/**
 * Open a popover anchored above/below `anchor` (auto side by viewport half).
 * `panelClass` adds a modifier class to the panel (e.g. `popover-panel--wide`
 * for list-like content), mirroring overlay.ts.
 */
export function openPopover(
  anchor: HTMLElement,
  build: (close: () => void) => Node,
  opts: { onClose?: () => void; panelClass?: string } = {},
): PopoverHandle {
  const backdrop = h('div', { class: 'popover-backdrop' });
  const panel = h('div', {
    class: `popover-panel${opts.panelClass ? ' ' + opts.panelClass : ''}`,
    role: 'dialog',
  });
  panel.addEventListener('click', (e) => e.stopPropagation());

  // K3: `mountOverlay` (overlay.ts) already traps Tab this way; popovers had
  // the same dialog role but not the same trap, so Tab could walk out of an
  // open popover into the dimmed sidebar/filter bar underneath it.
  const appRoot = document.getElementById('app');
  const opener = document.activeElement as HTMLElement | null;
  const close = (): void => {
    backdrop.remove();
    window.removeEventListener('keydown', onKey);
    if (appRoot) appRoot.inert = false;
    if (opener && document.activeElement === document.body) opener.focus();
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };

  backdrop.addEventListener('click', close);
  window.addEventListener('keydown', onKey);

  panel.append(build(close));
  backdrop.append(panel);
  document.body.append(backdrop);
  if (appRoot) appRoot.inert = true;
  const target = firstFocusable(panel);
  if (target) target.focus();
  else { panel.tabIndex = -1; panel.focus(); }

  // Position after mount so the panel's size is known.
  const a = anchor.getBoundingClientRect();
  const margin = 8;
  const below = a.top < window.innerHeight / 2;
  // Clamp the panel to whichever side it opens on so it can never render
  // past the viewport edge; content beyond that scrolls within the panel.
  // Two margins: one gap between anchor and panel, one between panel and
  // the far viewport edge.
  const available = (below ? window.innerHeight - a.bottom : a.top) - margin * 2;
  panel.style.maxHeight = `${Math.max(120, available)}px`;
  panel.style.overflowY = 'auto';
  const p = panel.getBoundingClientRect();
  const top = below ? a.bottom + margin : a.top - p.height - margin;
  const left = Math.max(margin, Math.min(a.left, window.innerWidth - p.width - margin));
  panel.style.top = `${Math.max(margin, top)}px`;
  panel.style.left = `${left}px`;

  return { close };
}
