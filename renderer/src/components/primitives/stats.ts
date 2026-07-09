/**
 * Numeric/statistical display primitives — KPI tiles, progress bars, plain
 * stat boxes, and the activity heatmap. All pure functions of their data.
 */
import { h, applyStyle } from '../../dom';
import type { CalendarDay } from '../../../../src/shared/contract';
import { pct } from '../../format';
import { PALETTE, wrColor } from '../../theme';
import { tooltipLayer } from '../../charts/tooltip';

type Child = Node | string | number | null | undefined | false;

/** Options for {@link kpiCard}; `accent` highlights a headline metric. */
export interface KpiOpts {
  label: string;
  value: string;
  delta?: { text: string; dir?: 'up' | 'down' };
  accent?: boolean;
}

/** Headline metric tile with an optional up/down delta. */
export function kpiCard(o: KpiOpts): HTMLElement {
  return h('div', { class: `kpi${o.accent ? ' kpi--accent' : ''}` },
    h('div', { class: 'kpi-label' }, o.label),
    h('div', { class: 'kpi-value' }, o.value),
    o.delta && h('div', { class: `kpi-delta${o.delta.dir ? ' is-' + o.delta.dir : ''}` }, o.delta.text),
  );
}

/** Labelled horizontal progress bar; `frac` is 0..1, clamped, `color` overrides the fill/value colour. */
export function statBar(o: {
  label: string;
  frac: number;
  color?: string;
  valueText: string;
  slim?: boolean;
  /** Widen the value column past the default 34px when the value is more than a
   *  short number (e.g. a "rate · count" pair) that would otherwise wrap. */
  valueWidth?: number;
}): HTMLElement {
  const fill = h('div', { class: 'track-fill' });
  applyStyle(fill, { width: `${Math.round(Math.max(0, Math.min(1, o.frac)) * 100)}%`, background: o.color ?? PALETTE.accent });
  const valueStyle: Record<string, string> = {};
  if (o.color) valueStyle.color = o.color;
  if (o.valueWidth) valueStyle.width = `${o.valueWidth}px`;
  return h('div', { class: 'statbar' },
    h('span', { class: 'statbar-label' }, o.label),
    h('div', { class: `track${o.slim ? ' track--slim' : ''}` }, fill),
    h('span', { class: 'statbar-value', style: Object.keys(valueStyle).length ? valueStyle : undefined }, o.valueText),
  );
}

/** Plain value/label stack for a single stat, no chrome. */
export function statBox(value: Child, label: string): HTMLElement {
  return h('div', { class: 'stat-box' },
    h('div', { class: 'stat-box-value' }, value),
    h('div', { class: 'stat-box-label' }, label),
  );
}

/**
 * GitHub-style activity heatmap: small fixed-size cells laid out as columns of
 * weeks × rows of weekdays. Colour encodes winrate, opacity the game count.
 * `onPick` (optional) makes cells with `games > 0` clickable — cells with no
 * games stay inert either way.
 */
export function calendarHeatmap(days: CalendarDay[], onPick?: (date: string) => void): HTMLElement {
  const wrap = h('div', { class: 'heatmap-wrap' });
  const tips = tooltipLayer(wrap);
  const grid = h('div', { class: 'heatmap' });
  days.forEach((d, i) => {
    const clickable = Boolean(onPick && d.games);
    const cell = h('div', {
      class: 'heatmap-cell',
      style: {
        background: d.games ? wrColor(d.winrate ?? 0) : 'var(--surface-3)',
        opacity: d.games ? String(0.4 + Math.min(d.games, 6) / 6 * 0.6) : '1',
        ...(clickable ? { cursor: 'pointer' } : {}),
      },
      ...(clickable ? { role: 'button', on: { click: () => onPick!(d.date) } } : {}),
    });
    tips.attach(cell, d.games ? `${d.date} · ${d.games}g · ${pct(d.winrate ?? 0)}` : `${d.date} · no games`);
    // Align the first cell to its weekday row; the rest flow down each column.
    if (i === 0) cell.style.gridRowStart = String(new Date(d.date).getDay() + 1);
    grid.append(cell);
  });

  const legend = h('div', { class: 'heatmap-legend' },
    heatSwatch(PALETTE.loss, 'Losing'),
    heatSwatch(PALETTE.mid, 'Even'),
    heatSwatch(PALETTE.win, 'Winning'),
  );
  wrap.append(grid, legend, tips.tip);
  return wrap;
}

function heatSwatch(color: string, label: string): HTMLElement {
  return h('span', { class: 'legend-item' },
    h('span', { class: 'legend-dot', style: { background: color, borderRadius: '2px' } }), label);
}
