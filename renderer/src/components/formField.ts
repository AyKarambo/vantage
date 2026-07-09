/**
 * The labelled form-field builders shared by the quick-log card and the
 * match-detail editor — one label convention (`.field-label`, with an optional
 * dimmed "— …" suffix) so the two match-entry surfaces can't drift apart in
 * wording or styling.
 */
import { h } from '../dom';

/** A labelled field: the label (string or prebuilt node) above the control. */
export function field(label: Node | string, control: Node): HTMLElement {
  return h('div', null, typeof label === 'string' ? h('div', { class: 'field-label' }, label) : label, control);
}

/** A field label with a dimmed "— optional / …" suffix. */
export function optionalLabel(label: string, suffix = '— optional'): HTMLElement {
  return h('span', null,
    h('span', { class: 'field-label', style: { display: 'inline', margin: '0' } }, label),
    h('span', { class: 'u-dim', style: { fontSize: '11px', marginLeft: '6px' } }, suffix),
  );
}
