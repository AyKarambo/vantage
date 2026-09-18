/**
 * Props for a row that opens something on click — keyboard-reachable (Enter
 * or Space, like a native control) and, unlike a bare click handler, one that
 * doesn't hijack a drag-select: dragging across a cell's text to select it
 * ends with a mouseup inside the row, which a plain 'click' listener can't
 * tell apart from a deliberate click (issue #197). Spread the result into an
 * `h()` props object: `h('tr', { class: '…', ...clickableRow(open) }, …)`.
 */
import type { Props } from '../dom';

/** True when the mouseup that just fired ended a drag-select rather than a click. */
export function endedADragSelect(): boolean {
  const sel = window.getSelection();
  return !!sel && !sel.isCollapsed;
}

export function clickableRow(onOpen: () => void): Pick<Props, 'role' | 'tabindex' | 'on'> {
  return {
    role: 'button',
    tabindex: '0',
    on: {
      click: () => { if (!endedADragSelect()) onOpen(); },
      keydown: (e) => {
        const key = (e as KeyboardEvent).key;
        if (key === 'Enter' || key === ' ') { e.preventDefault(); onOpen(); }
      },
    },
  };
}
