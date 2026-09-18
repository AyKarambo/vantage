/**
 * A card wrapping a chart with a "view as table" toggle — the text alternative
 * for SVG-only data (accessibility + copy-friendly numbers).
 */
import { h, render } from '../dom';
import { button, card, type CardOpts } from './primitives';
import { dataTable, type Column } from './table';

export interface ChartTableColumn {
  key: string;
  label: string;
  /**
   * Formats the raw cell value for display (percent, signed, compact-number,
   * …). Rows should carry the RAW sortable value (a 0..1 winrate, a signed
   * number, a plain rating) — a caller that pre-formats into a display string
   * instead (`pct(m.winrate)`, `signed(...)`) gets string-order sorting on a
   * number column ('100%' < '25%'), which is the bug this option exists to
   * let callers stop working around.
   */
  render?: (v: string | number | null | undefined) => Node | string;
}

export type ChartTableRow = Record<string, string | number | null | undefined>;

export function chartCard(
  opts: CardOpts & {
    title: string;
    columns: ChartTableColumn[];
    rows: ChartTableRow[];
    /** Defaults to dataTable's own default (first column, descending) when omitted. */
    initialSort?: { key: string; dir: 1 | -1 };
    /** Makes the Table view's rows clickable too (C7) — the same destination the chart's own point click opens, so switching Chart/Table never changes what a click does. */
    onRowClick?: (row: ChartTableRow) => void;
    /** Extra controls rendered beside the Chart/Table toggle in the header (H4 — Maps' mode/min-games filter chips). */
    extraActions?: Node;
  },
  chart: Node,
): HTMLElement {
  let asTable = false;
  const body = h('div');
  const toggleHost = h('span');

  const columns: Array<Column<ChartTableRow>> = opts.columns.map((c) => ({
    key: c.key,
    label: c.label,
    get: (r) => r[c.key],
    ...(c.render ? { render: (r: ChartTableRow) => c.render!(r[c.key]) } : {}),
  }));

  const paint = (): void => {
    render(body, asTable
      ? dataTable({
          columns, rows: opts.rows,
          ...(opts.initialSort ? { initialSort: opts.initialSort } : {}),
          ...(opts.onRowClick ? { onRowClick: opts.onRowClick } : {}),
        })
      : chart);
    render(toggleHost, button(asTable ? 'Chart' : 'Table', {
      variant: 'ghost',
      title: asTable ? 'Back to the chart' : 'View this data as a table',
      onClick: () => {
        asTable = !asTable;
        paint();
      },
    }));
  };
  paint();

  const { columns: _c, rows: _r, initialSort: _s, onRowClick: _rc, extraActions, ...cardOpts } = opts;
  const actions = extraActions
    ? h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, extraActions, toggleHost)
    : toggleHost;
  return card({ ...cardOpts, actions }, body);
}
