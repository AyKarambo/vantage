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

/** An emptyState with a recovery action — `run` does the thing `label` promises (e.g. widen a filter). */
export interface EmptyStateAction {
  label: string;
  run: () => void;
}

/** The richer {@link emptyState} shape — title/body/action, for an empty state that can DO something about itself. */
export interface EmptyStateOpts {
  title?: string;
  body: string;
  action?: EmptyStateAction;
  /** A second, secondary action (e.g. 'Show 1+' AND 'Show all time'). */
  secondaryAction?: EmptyStateAction;
  good?: boolean;
}

/**
 * Placeholder panel content for a view with no data yet. The plain string
 * form (`good` swaps in a positive tone) is unchanged and still the right
 * call for prose with nothing to DO about it; the options-object form adds a
 * title and up to two recovery actions (K9) — several callers used to tell
 * the player to "clear the scope above" or "build one above" with no button
 * that actually does it.
 */
export function emptyState(text: string, good?: boolean): HTMLElement;
export function emptyState(opts: EmptyStateOpts): HTMLElement;
export function emptyState(arg: string | EmptyStateOpts, good = false): HTMLElement {
  if (typeof arg === 'string') {
    return h('div', { class: `empty${good ? ' empty--good' : ''}` }, arg);
  }
  const { title, body, action, secondaryAction, good: g } = arg;
  return h('div', { class: `empty empty--rich${g ? ' empty--good' : ''}` },
    title ? h('div', { class: 'empty-title' }, title) : null,
    h('div', { class: 'empty-body' }, body),
    (action || secondaryAction)
      ? h('div', { class: 'empty-actions' },
          action ? h('button', { class: 'btn btn--soft', on: { click: action.run } }, action.label) : null,
          secondaryAction ? h('button', { class: 'btn btn--ghost', on: { click: secondaryAction.run } }, secondaryAction.label) : null,
        )
      : null,
  );
}

const toArray = <T>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);
