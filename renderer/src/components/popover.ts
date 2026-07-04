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
  const p = panel.getBoundingClientRect();
  const below = a.top < window.innerHeight / 2;
  const top = below ? a.bottom + 8 : a.top - p.height - 8;
  const left = Math.max(8, Math.min(a.left, window.innerWidth - p.width - 8));
  panel.style.top = `${Math.max(8, top)}px`;
  panel.style.left = `${left}px`;

  return { close };
}
