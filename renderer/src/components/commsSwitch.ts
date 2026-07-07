/**
 * The three-state comms-tone switch (Positive / Banter / Abusive) — a single
 * colour switch shared by the quick-log card, the match-detail editor, and the
 * Review grading card (via `mentalFlagsRow`). Clicking the active option again
 * clears it, so comms stays optional. Styled by `.comms-switch .comms-opt--*`
 * in components.css. Operates through a caller-owned get/set so each surface can
 * back it with whatever it stores the tone in.
 */
import { h } from '../dom';
import type { CommsTone } from '../../../src/shared/contract';

const COMMS_OPTIONS: Array<{ value: CommsTone; label: string; cls: string }> = [
  { value: 'positive', label: 'Positive', cls: 'pos' },
  { value: 'banter', label: 'Banter', cls: 'banter' },
  { value: 'abusive', label: 'Abusive', cls: 'abusive' },
];

export interface CommsSwitchOpts {
  /** The currently-selected tone, or null when unset. */
  get: () => CommsTone | null;
  /** Called with the new tone, or null when the active option is cleared. */
  set: (tone: CommsTone | null) => void;
}

export function commsSwitch(opts: CommsSwitchOpts): HTMLElement {
  const wrap = h('div', { class: 'segmented segmented--fill comms-switch' });
  const buttons = COMMS_OPTIONS.map((o) => {
    const btn = h('button',
      { class: `segmented-opt comms-opt comms-opt--${o.cls}${opts.get() === o.value ? ' is-on' : ''}` }, o.label);
    btn.addEventListener('click', () => {
      const next = opts.get() === o.value ? null : o.value;
      opts.set(next);
      for (const b of buttons) b.classList.remove('is-on');
      if (next) btn.classList.add('is-on');
    });
    return btn;
  });
  wrap.append(...buttons);
  return wrap;
}
