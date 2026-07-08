/**
 * Tiny shared render helpers for the wiki content modules — plain body prose,
 * sub-headings, and inline navigation links, so articles/personalized/scenario
 * views read consistently. Pure DOM composition over {@link h}.
 */
import { h } from '../../dom';

type Child = Node | string | number | null | undefined | false;

/** A readable body paragraph (not the muted `.hint` used for asides). */
export function wikiPara(...content: Array<Child | Child[]>): HTMLElement {
  return h('div', { style: { fontSize: '13px', lineHeight: '1.65', color: 'var(--text-2)', marginBottom: '10px' } }, ...content);
}

/** A small section sub-heading within an article tier. */
export function wikiHeading(text: string): HTMLElement {
  return h('div', { style: { fontSize: '12.5px', fontWeight: '600', margin: '16px 0 6px' } }, text);
}

/** An inline navigation link (e.g. "See the scenarios →"). */
export function wikiLink(label: string, onClick: () => void): HTMLElement {
  return h('button', { class: 'inline-link inline-link--strong', on: { click: onClick } }, label);
}
