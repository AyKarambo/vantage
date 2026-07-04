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
}

export type ChartTableRow = Record<string, string | number | null | undefined>;

export function chartCard(
  opts: CardOpts & { title: string; columns: ChartTableColumn[]; rows: ChartTableRow[] },
  chart: Node,
): HTMLElement {
  let asTable = false;
  const body = h('div');
  const toggleHost = h('span');

  const columns: Array<Column<ChartTableRow>> = opts.columns.map((c) => ({
    key: c.key,
    label: c.label,
    get: (r) => r[c.key],
  }));

  const paint = (): void => {
    render(body, asTable
      ? dataTable({ columns, rows: opts.rows, initialSort: { key: columns[0].key, dir: 1 } })
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

  const { columns: _c, rows: _r, ...cardOpts } = opts;
  return card({ ...cardOpts, actions: toggleHost }, body);
}
