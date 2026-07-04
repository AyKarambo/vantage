/**
 * The card shell — the base container every dashboard panel is built from.
 * Composition-first: callers nest arbitrary children rather than the card
 * knowing about their content.
 */
import { h, type Props } from '../../dom';

type Child = Node | string | number | null | undefined | false;

/** Options for the {@link card} shell; title/actions form an optional header row. */
export interface CardOpts {
  title?: string | Node;
  sub?: string;
  actions?: Child | Child[];
  variant?: 'plain' | 'raised' | 'glow';
  class?: string;
  style?: Props['style'];
}

/** The base panel container every screen composes; `variant` picks the visual weight. */
export function card(opts: CardOpts, ...children: Array<Child | Child[]>): HTMLElement {
  const variant = opts.variant && opts.variant !== 'plain' ? ` card--${opts.variant}` : '';
  const el = h('div', { class: `card${variant}${opts.class ? ' ' + opts.class : ''}`, style: opts.style });
  if (opts.title != null || opts.actions) {
    el.append(
      h('div', { class: 'card-head' },
        h('div', { class: 'card-title' }, opts.title ?? '', opts.sub && h('span', { class: 'card-sub' }, opts.sub)),
        opts.actions ? h('div', { class: 'card-actions' }, ...toArray(opts.actions)) : null,
      ),
    );
  }
  for (const child of toArray(children).flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

/** Placeholder panel content for a view with no data yet; `good` swaps in a positive tone. */
export function emptyState(text: string, good = false): HTMLElement {
  return h('div', { class: `empty${good ? ' empty--good' : ''}` }, text);
}

const toArray = <T>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);
