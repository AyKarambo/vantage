/**
 * The presentational component library. Every factory is a pure function of its
 * options that returns a detached element — views compose them by nesting. This
 * is where "use composition" lives: small, single-purpose pieces the views wire
 * together, rather than bespoke markup per screen.
 */
import { h, applyStyle, type Props } from '../dom';
import type { CalendarDay } from '../../../src/shared/contract';
import { pct } from '../format';
import { PALETTE, wrColor } from '../theme';

type Child = Node | string | number | null | undefined | false;

export interface CardOpts {
  title?: string | Node;
  sub?: string;
  actions?: Child | Child[];
  variant?: 'plain' | 'raised' | 'glow';
  class?: string;
  style?: Props['style'];
}

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

export interface KpiOpts {
  label: string;
  value: string;
  delta?: { text: string; dir?: 'up' | 'down' };
  accent?: boolean;
}

export function kpiCard(o: KpiOpts): HTMLElement {
  return h('div', { class: `kpi${o.accent ? ' kpi--accent' : ''}` },
    h('div', { class: 'kpi-label' }, o.label),
    h('div', { class: 'kpi-value' }, o.value),
    o.delta && h('div', { class: `kpi-delta${o.delta.dir ? ' is-' + o.delta.dir : ''}` }, o.delta.text),
  );
}

export interface BtnOpts {
  variant?: 'primary' | 'soft' | 'ghost' | 'default';
  onClick?: () => void;
  disabled?: boolean;
  class?: string;
  title?: string;
}

export function button(label: Child, o: BtnOpts = {}): HTMLButtonElement {
  const variant = o.variant && o.variant !== 'default' ? ` btn--${o.variant}` : '';
  return h('button', {
    class: `btn${variant}${o.class ? ' ' + o.class : ''}`,
    disabled: o.disabled,
    title: o.title,
    on: o.onClick ? { click: o.onClick } : undefined,
  }, label);
}

export type PillState = 'win' | 'loss' | 'draw' | 'accent';

export function pill(text: Child, state?: PillState, opts: { mono?: boolean } = {}): HTMLElement {
  return h('span', { class: `pill${state ? ' is-' + state : ''}${opts.mono ? ' is-mono' : ''}` }, text);
}

export function badge(text: Child, kind: 'demo' | 'auto' | 'manual' = 'demo'): HTMLElement {
  return h('span', { class: `badge badge--${kind}` }, text);
}

export function chip(label: string, on: boolean, onClick?: () => void): HTMLElement {
  return h('button', { class: `chip${on ? ' is-on' : ''}`, on: onClick ? { click: onClick } : undefined }, label);
}

export interface SegOption<T> {
  value: T;
  label: string;
}

export function segmented<T extends string>(o: {
  options: Array<SegOption<T>>;
  value: T;
  onChange: (value: T) => void;
  fill?: boolean;
}): HTMLElement {
  let currentValue = o.value;
  const buttons = o.options.map((opt) =>
    h('button', { class: `segmented-opt${opt.value === o.value ? ' is-active' : ''}` }, opt.label),
  );
  // Self-manage active state so callers don't have to re-render the control.
  o.options.forEach((opt, i) => {
    buttons[i].addEventListener('click', () => {
      if (opt.value === currentValue) return;
      currentValue = opt.value;
      for (const b of buttons) b.classList.remove('is-active');
      buttons[i].classList.add('is-active');
      o.onChange(opt.value);
    });
  });
  return h('div', { class: `segmented${o.fill ? ' segmented--fill' : ''}` }, ...buttons);
}

export function statBar(o: {
  label: string;
  frac: number;
  color?: string;
  valueText: string;
  slim?: boolean;
}): HTMLElement {
  const fill = h('div', { class: 'track-fill' });
  applyStyle(fill, { width: `${Math.round(Math.max(0, Math.min(1, o.frac)) * 100)}%`, background: o.color ?? PALETTE.accent });
  return h('div', { class: 'statbar' },
    h('span', { class: 'statbar-label' }, o.label),
    h('div', { class: `track${o.slim ? ' track--slim' : ''}` }, fill),
    h('span', { class: 'statbar-value', style: o.color ? { color: o.color } : undefined }, o.valueText),
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

/** A styled native <select>. */
export function select(options: SelectOption[], value: string, onChange: (value: string) => void): HTMLSelectElement {
  const sel = h('select', { class: 'vt-select', on: { change: (e) => onChange((e.target as HTMLSelectElement).value) } }) as HTMLSelectElement;
  for (const o of options) {
    const opt = h('option', { value: o.value }, o.label) as HTMLOptionElement;
    if (o.value === value) opt.selected = true;
    sel.append(opt);
  }
  return sel;
}

export function statBox(value: Child, label: string): HTMLElement {
  return h('div', { class: 'stat-box' },
    h('div', { class: 'stat-box-value' }, value),
    h('div', { class: 'stat-box-label' }, label),
  );
}

export function emptyState(text: string, good = false): HTMLElement {
  return h('div', { class: `empty${good ? ' empty--good' : ''}` }, text);
}

/**
 * GitHub-style activity heatmap: small fixed-size cells laid out as columns of
 * weeks × rows of weekdays. Colour encodes winrate, opacity the game count.
 */
export function calendarHeatmap(days: CalendarDay[]): HTMLElement {
  const grid = h('div', { class: 'heatmap' });
  days.forEach((d, i) => {
    const cell = h('div', {
      class: 'heatmap-cell',
      title: d.games ? `${d.date}: ${d.games}g · ${pct(d.winrate ?? 0)}` : `${d.date}: no games`,
      style: {
        background: d.games ? wrColor(d.winrate ?? 0) : 'var(--surface-3)',
        opacity: d.games ? String(0.4 + Math.min(d.games, 6) / 6 * 0.6) : '1',
      },
    });
    // Align the first cell to its weekday row; the rest flow down each column.
    if (i === 0) cell.style.gridRowStart = String(new Date(d.date).getDay() + 1);
    grid.append(cell);
  });

  const legend = h('div', { class: 'heatmap-legend' },
    heatSwatch(PALETTE.loss, 'Losing'),
    heatSwatch(PALETTE.mid, 'Even'),
    heatSwatch(PALETTE.win, 'Winning'),
  );
  return h('div', { class: 'heatmap-wrap' }, grid, legend);
}

function heatSwatch(color: string, label: string): HTMLElement {
  return h('span', { class: 'legend-item' },
    h('span', { class: 'legend-dot', style: { background: color, borderRadius: '2px' } }), label);
}

const toArray = <T>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);
