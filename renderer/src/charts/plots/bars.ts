/** Horizontal winrate bar list (e.g. maps ranked best to worst). */
import { h } from '../../dom';
import { wrColor } from '../../theme';
import { pct } from '../../format';
import type { WrPoint } from './shared';

/** Responsive horizontal winrate bars (maps best → worst) — HTML, not SVG, so
 *  rows keep a fixed height regardless of container width. */
export function horizontalBars(data: WrPoint[], opts: { compact?: boolean } = {}): HTMLElement {
  if (!data.length) return h('div', { class: 'empty' }, 'Not enough data yet.');
  return h('div', { class: `hbars${opts.compact ? ' hbars--compact' : ''}` },
    ...data.map((d) => {
      const fill = h('div', { class: 'hbar-fill', style: { width: `${Math.max(3, Math.round(d.winrate * 100))}%`, background: wrColor(d.winrate) } });
      return h('div', { class: 'hbar-row' },
        h('div', { class: 'hbar-label', title: d.label }, d.label),
        h('div', { class: 'hbar-track' }, fill),
        h('div', { class: 'hbar-value' }, `${pct(d.winrate)}  ${d.games}g`),
      );
    }),
  );
}
