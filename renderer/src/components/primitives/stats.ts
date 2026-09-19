/**
 * Numeric/statistical display primitives — KPI tiles, progress bars, plain
 * stat boxes, and the activity heatmap. All pure functions of their data.
 */
import { h, applyStyle } from '../../dom';
import type { CalendarDay } from '../../../../src/shared/contract';
import { pct } from '../../format';
import { PALETTE, wrColor } from '../../theme';
import { tooltipLayer } from '../../charts/tooltip';
import { button } from './controls';

type Child = Node | string | number | null | undefined | false;

/** Options for {@link kpiCard}; `accent` highlights a headline metric. */
export interface KpiOpts {
  label: string;
  value: string;
  delta?: { text: string; dir?: 'up' | 'down' };
  accent?: boolean;
  /** Call-to-action button (e.g. "Confirm rank") — mirrors {@link ToastOpts.action}
   *  in `components/toast.ts`. Renders below the delta; omitted, the card's
   *  layout is unchanged. */
  action?: { label: string; run: () => void };
  /** Whole-card hover tooltip — for context that doesn't fit the single delta line (e.g. the Streak KPI's best/worst-day read, C7). */
  title?: string;
  /** A second, unaccented line below `delta` — e.g. "vs 2026 Season 3: +12 games" (C3), a period-over-period read that doesn't need the smoothed delta's up/down styling. */
  sub?: string;
  /**
   * Makes the whole tile a drill-down button (O4) — the Overview KPI row's
   * tiles used to be dead ends. Never combine with {@link action}: `action`
   * already renders its own `<button>`, and nesting one inside the whole-card
   * button this produces would be invalid HTML and double-fire on click.
   */
  onClick?: () => void;
}

/** Headline metric tile with an optional up/down delta and an optional CTA. */
export function kpiCard(o: KpiOpts): HTMLElement {
  const tag = o.onClick ? 'button' : 'div';
  return h(tag, {
    class: `kpi${o.accent ? ' kpi--accent' : ''}${o.onClick ? ' kpi--clickable' : ''}`,
    title: o.title,
    ...(o.onClick ? { on: { click: o.onClick } } : {}),
  },
    h('div', { class: 'kpi-label' }, o.label),
    // `.kpi-value` is nowrap + ellipsis so one long value can't push its card
    // taller than the other three in the row. A KPI value has no other home for
    // its text, so the full string always stays reachable as the tooltip —
    // truncation must never be the only thing left (e.g. "Placements 10/10" at
    // the 1040px minimum window).
    h('div', { class: 'kpi-value', title: o.value }, o.value),
    o.delta && h('div', { class: `kpi-delta${o.delta.dir ? ' is-' + o.delta.dir : ''}` }, o.delta.text),
    o.sub && h('div', { class: 'kpi-sub' }, o.sub),
    o.action && button(o.action.label, { variant: 'soft', class: 'kpi-action', onClick: o.action.run }),
  );
}

/** Labelled horizontal progress bar; `frac` is 0..1, clamped, `color` overrides the fill/value colour. */
export function statBar(o: {
  label: string;
  frac: number;
  color?: string;
  /** Right-hand value — a plain string, or a node for a multi-column value that
   *  needs its own internal alignment (see the Mental "Session" rows). */
  valueText: string | Node;
  slim?: boolean;
  /** Widen the value column past the default 34px when the value is more than a
   *  short number (e.g. a "rate · count" pair) that would otherwise wrap. */
  valueWidth?: number;
  /** Explains what this specific bar means (e.g. Mental's Calm/Tilted formulas). */
  title?: string;
}): HTMLElement {
  const fill = h('div', { class: 'track-fill' });
  applyStyle(fill, { width: `${Math.round(Math.max(0, Math.min(1, o.frac)) * 100)}%`, background: o.color ?? PALETTE.accent });
  const valueStyle: Record<string, string> = {};
  if (o.color) valueStyle.color = o.color;
  if (o.valueWidth) valueStyle.width = `${o.valueWidth}px`;
  return h('div', { class: 'statbar', title: o.title },
    h('span', { class: 'statbar-label' }, o.label),
    h('div', { class: `track${o.slim ? ' track--slim' : ''}` }, fill),
    h('span', { class: 'statbar-value', style: Object.keys(valueStyle).length ? valueStyle : undefined }, o.valueText),
  );
}

/** Plain value/label stack for a single stat, no chrome. */
export function statBox(value: Child, label: string, title?: string): HTMLElement {
  return h('div', { class: 'stat-box', title },
    h('div', { class: 'stat-box-value' }, value),
    h('div', { class: 'stat-box-label' }, label),
  );
}

/**
 * `dayKey`'s "YYYY-MM-DD" is a UTC calendar day (see `core/analytics`'s own
 * doc comment); parsing it back through `new Date(string)` reads it as UTC
 * MIDNIGHT and then `.getDay()`/`.getMonth()` report the LOCAL weekday/month
 * at that instant — a day off for anyone west of UTC (O5). Parsing the y/m/d
 * digits into a plain `new Date(y, m-1, d)` instead treats them as calendar
 * facts, not an instant to reinterpret through the viewer's own offset.
 */
function localDateFromKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Every other row (Mon/Wed/Fri) — labelling all seven would be denser than the 13px cells can read. */
const WEEKDAY_ROW_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

/**
 * GitHub-style activity heatmap: small fixed-size cells laid out as columns of
 * weeks × rows of weekdays. Colour encodes winrate, opacity the game count.
 * `onPick` (optional) makes cells with `games > 0` clickable — cells with no
 * games stay inert either way. A weekday column (O5) and a month label above
 * the first column of each new month orient a grid that can now span up to
 * 13 weeks (see `activityWindowDays`), not just a fixed 5.
 */
export function calendarHeatmap(days: CalendarDay[], onPick?: (date: string) => void): HTMLElement {
  const wrap = h('div', { class: 'heatmap-wrap' });
  const tips = tooltipLayer(wrap);

  const firstWeekday = days.length ? localDateFromKey(days[0].date).getDay() : 0;
  // Column 0 runs from index 0 to the first Saturday (a partial week when the
  // range doesn't start on a Sunday); every column after that is a full 7.
  const colStart = (col: number): number => (col === 0 ? 0 : (7 - firstWeekday) + (col - 1) * 7);
  const columns = days.length ? Math.ceil((firstWeekday + days.length) / 7) : 0;

  const monthsRow = h('div', { class: 'heatmap-months' });
  let prevMonth = -1;
  for (let col = 0; col < columns; col++) {
    const day = days[colStart(col)];
    const month = day ? localDateFromKey(day.date).getMonth() : prevMonth;
    const isNewMonth = day !== undefined && month !== prevMonth;
    if (day) prevMonth = month;
    monthsRow.append(h('div', { class: 'heatmap-month-label' },
      isNewMonth ? localDateFromKey(day!.date).toLocaleDateString(undefined, { month: 'short' }) : ''));
  }

  const weekdaysCol = h('div', { class: 'heatmap-weekdays' },
    ...WEEKDAY_ROW_LABELS.map((label) => h('div', { class: 'heatmap-weekday-label' }, label)));

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
    if (i === 0) cell.style.gridRowStart = String(firstWeekday + 1);
    grid.append(cell);
  });

  const legend = h('div', { class: 'heatmap-legend' },
    heatSwatch(PALETTE.loss, 'Losing'),
    heatSwatch(PALETTE.mid, 'Even'),
    heatSwatch(PALETTE.win, 'Winning'),
    // Colour is winrate; opacity is volume (O5) — without this the legend
    // never said what the faint-vs-solid cells actually meant.
    h('span', { class: 'legend-item u-dim', style: { fontSize: '10px' } }, '1 · 3 · 6+ games (opacity)'),
  );
  wrap.append(
    h('div', { class: 'heatmap-main' }, monthsRow, h('div', { class: 'heatmap-body' }, weekdaysCol, grid)),
    legend,
    tips.tip,
  );
  return wrap;
}

function heatSwatch(color: string, label: string): HTMLElement {
  return h('span', { class: 'legend-item' },
    h('span', { class: 'legend-dot', style: { background: color, borderRadius: '2px' } }), label);
}
