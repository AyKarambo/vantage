import { h } from '../../../dom';

/** A titled sub-group inside the master-data card. */
export function mdGroup(title: string, hint: string, rows: Node[], addForm: Node): HTMLElement {
  return h('div', null,
    h('div', { style: { fontSize: '13px', fontWeight: '600', marginBottom: '2px' } }, title),
    h('div', { class: 'hint', style: { marginBottom: '8px' } }, hint),
    h('div', { class: 'stack', style: { gap: '6px' } }, ...rows, addForm),
  );
}

/** A one-line editor row (label/controls left, actions right). `muted` dims inactive maps. */
export function mdRow(muted: boolean, ...children: Node[]): HTMLElement {
  return h('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
      padding: '4px 0', ...(muted ? { opacity: '0.55' } : {}),
    },
  }, ...children);
}

export function textInput(value: string, placeholder: string): HTMLInputElement {
  return h('input', { class: 'vt-input', type: 'text', value, placeholder }) as HTMLInputElement;
}
