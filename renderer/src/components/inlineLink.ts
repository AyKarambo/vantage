/**
 * A text link inside a row, paragraph or table cell — a `<span role="link">`
 * rather than a `<button>`. Chromium refuses to start a text-selection drag
 * on a `<button>`, so every hero/map/player name that used one was a dead
 * zone for copy-selecting text through it (issue #197); a span carries no
 * such restriction and stays keyboard-reachable via `tabindex` + Enter/Space.
 */
import { h, type Props } from '../dom';

export interface InlineLinkOpts {
  /** Adds `.inline-link--strong` (inherits the surrounding weight instead of reducing it). */
  strong?: boolean;
  /** Extra class(es) alongside `.inline-link`, e.g. a layout hook like `row-main`. */
  class?: string;
  style?: Props['style'];
  title?: string;
  onClick: (e: Event) => void;
}

export function inlineLink(content: string | Node, opts: InlineLinkOpts): HTMLElement {
  return h('span', {
    class: `inline-link${opts.strong ? ' inline-link--strong' : ''}${opts.class ? ` ${opts.class}` : ''}`,
    style: opts.style,
    role: 'link',
    tabindex: '0',
    title: opts.title,
    on: {
      click: opts.onClick,
      keydown: (e) => {
        const key = (e as KeyboardEvent).key;
        if (key === 'Enter' || key === ' ') { e.preventDefault(); opts.onClick(e); }
      },
    },
  }, content);
}
