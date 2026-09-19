/** Horizontal winrate bar list (e.g. maps ranked best to worst). */
import { h } from '../../dom';
import { wrColor } from '../../theme';
import { pct } from '../../format';
import { tooltipLayer } from '../tooltip';
import type { WrPoint } from './shared';

/** Responsive horizontal winrate bars (maps best → worst) — HTML, not SVG, so
 *  rows keep a fixed height regardless of container width. */
export function horizontalBars(data: WrPoint[], opts: { compact?: boolean; minGames?: number; marker?: number } = {}): HTMLElement {
  if (!data.length) return h('div', { class: 'empty' }, 'Not enough data yet.');
  const wrap = h('div', { class: `hbars${opts.compact ? ' hbars--compact' : ''}` });
  const tips = tooltipLayer(wrap);
  wrap.append(
    ...data.map((d) => {
      // F6: a caller-set `dimmed` (Maps' own floor logic) always wins; below
      // `opts.minGames` dims automatically for callers that don't track it
      // themselves (the Trends breakdowns).
      const dimmed = d.dimmed || (opts.minGames !== undefined && d.games < opts.minGames);
      const fill = h('div', {
        class: 'hbar-fill',
        style: { width: `${Math.max(3, Math.round(d.winrate * 100))}%`, background: dimmed ? 'var(--muted)' : wrColor(d.winrate) },
      });
      // F6: a 1px tick at the caller's own overall winrate — "am I better or
      // worse than average here" at a glance, without hunting for the number.
      const marker = opts.marker !== undefined
        ? h('div', {
            class: 'hbar-marker',
            style: { left: `${Math.round(Math.max(0, Math.min(1, opts.marker)) * 100)}%` },
            title: 'Your average',
          })
        : null;
      const row = h('div', { class: `hbar-row${dimmed ? ' hbar-row--dim' : ''}`, tabindex: '0' }, // K8: Tab-reachable, shows the tooltip on focus
        h('div', { class: 'hbar-label', title: d.label }, d.label),
        h('div', { class: 'hbar-track' }, fill, marker),
        h('div', { class: 'hbar-value' }, `${pct(d.winrate)}  ${d.games}g`),
        d.meta?.length ? h('div', { class: 'hbar-meta' }, ...d.meta) : null,
      );
      tips.attach(row, dimmed
        ? `${d.label} · ${d.games} games (small sample)`
        : `${d.label} · ${pct(d.winrate)} · ${d.games} games`);
      return row;
    }),
    tips.tip,
  );
  return wrap;
}
