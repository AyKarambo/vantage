/**
 * The large colour-coded Win / Loss / Draw chooser — shared by the quick-log
 * card and the match-detail editor so the two match-entry surfaces render the
 * result control identically (styled by the `.choice--*` classes in
 * components.css). Each button carries `data-value` so a keyboard handler can
 * drive it (the log card binds W/L/D).
 */
import { h } from '../dom';
import type { Result } from '../../../src/shared/contract';

const RESULT_STATE: Record<Result, 'win' | 'loss' | 'draw'> = { Win: 'win', Loss: 'loss', Draw: 'draw' };
const RESULT_KEYS: Record<Result, string> = { Win: 'W', Loss: 'L', Draw: 'D' };

export interface ResultChooserOpts {
  value: Result;
  onChange: (value: Result) => void;
  /** Show the single-key hint (W/L/D) — the caller must bind those keys itself. */
  keys?: boolean;
}

export function resultChooser(opts: ResultChooserOpts): HTMLElement {
  const options: Result[] = ['Win', 'Loss', 'Draw'];
  const row = h('div', { style: { display: 'flex', gap: '8px' } });
  const buttons = options.map((opt) => {
    const btn = h('button',
      { class: `choice choice--${RESULT_STATE[opt]}${opt === opts.value ? ' is-active' : ''}` },
      opt,
      opts.keys
        ? h('span', { class: 'kbd', style: { marginLeft: '7px', fontSize: '9.5px', opacity: '0.7' } }, RESULT_KEYS[opt])
        : null,
    );
    btn.dataset.value = opt;
    btn.addEventListener('click', () => {
      for (const b of buttons) b.classList.remove('is-active');
      btn.classList.add('is-active');
      opts.onChange(opt);
    });
    return btn;
  });
  row.append(...buttons);
  return row;
}
