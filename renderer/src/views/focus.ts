/** Focus — the "work on these" list: net-losing maps ranked by deficit. */
import { h, applyStyle } from '../dom';
import type { FocusItem } from '../../../src/shared/contract';
import { pct, signed } from '../format';
import { PALETTE, wrColor } from '../theme';
import { button, card } from '../components/primitives';
import { viewHead, type ViewContext } from './view';

export function focus(ctx: ViewContext): HTMLElement {
  const losing = ctx.data.focusMaps.filter((f) => f.net > 0);
  const maxNet = losing[0]?.net ?? 1;

  return h('div', { class: 'view' },
    viewHead('Focus', 'Lose a lot and play a lot — these cost you the most points'),
    card({ title: 'Priority maps', sub: 'net = losses − wins' },
      losing.length
        ? h('div', { class: 'stack', style: { gap: '14px' } }, ...losing.map((m) => focusRow(m, maxNet)))
        : h('div', { class: 'empty empty--good' }, 'No net-losing maps right now — nice. 🎯'),
    ),
    card({ variant: 'glow', title: 'Build a focus routine' },
      h('p', { class: 'hint', style: { lineHeight: '1.6', margin: '0 0 12px' } },
        'Queue your bottom three in practice mode before ranked and review one replay each. Small, repeatable — that is how the deficit closes.'),
      button('Start a routine →', { variant: 'primary', onClick: () => ctx.navigate('targets') }),
    ),
  );
}

function focusRow(m: FocusItem, maxNet: number): HTMLElement {
  const fill = h('span', { style: { display: 'block', height: '100%', background: PALETTE.loss, borderRadius: 'inherit' } });
  applyStyle(fill, { width: `${Math.round((m.net / maxNet) * 100)}%` });
  return h('div', null,
    h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '6px' } },
      h('div', { class: 'row-name', style: { fontSize: '13.5px' } }, m.key),
      h('div', { style: { display: 'flex', gap: '12px', alignItems: 'baseline' } },
        h('span', { class: 'is-loss mono', style: { fontSize: '13px' } }, `${signed(-m.net)} net`),
        h('span', { class: 'mono', style: { color: wrColor(m.winrate) } }, pct(m.winrate)),
        h('span', { class: 'u-dim', style: { fontSize: '11px' } }, `${m.games}g`),
      ),
    ),
    h('div', { class: 'track track--slim' }, fill),
  );
}
