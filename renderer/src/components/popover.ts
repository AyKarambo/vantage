/**
 * A small anchored popover (vs. the centered modal / right drawer in
 * overlay.ts): opens next to its anchor element, closes on Escape, backdrop
 * click, or via the handle. Used by the status-bar connection indicator.
 */
import { h } from '../dom';

export interface PopoverHandle {
  close(): void;
}

/** Open a popover anchored above/below `anchor` (auto side by viewport half). */
export function openPopover(
  anchor: HTMLElement,
  build: (close: () => void) => Node,
  opts: { onClose?: () => void } = {},
): PopoverHandle {
  const backdrop = h('div', { class: 'popover-backdrop' });
  const panel = h('div', { class: 'popover-panel' });
  panel.addEventListener('click', (e) => e.stopPropagation());

  const close = (): void => {
    backdrop.remove();
    window.removeEventListener('keydown', onKey);
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
