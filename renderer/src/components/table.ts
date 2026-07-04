/** A self-contained sortable table. Owns its sort state and re-renders in place. */
import { h, render } from '../dom';
import { prefs, type HeroSortPref } from '../prefs';

export interface Column<T> {
  key: string;
  label: string;
  /** Value used for sorting (and default rendering). */
  get: (row: T) => string | number | null | undefined;
  /** Optional custom cell renderer. */
  render?: (row: T) => Node | string;
  sortable?: boolean;
}

export interface TableOpts<T> {
  columns: Array<Column<T>>;
  rows: T[];
  initialSort?: { key: string; dir: 1 | -1 };
  onRowClick?: (row: T) => void;
  /** Persist the sort choice under this prefs key (survives re-renders + restarts). */
  persistSortAs?: 'heroSort';
}

export function dataTable<T>(opts: TableOpts<T>): HTMLElement {
  let sort: HeroSortPref = restoreSort(opts) ?? opts.initialSort ?? { key: opts.columns[0].key, dir: -1 };
  const wrap = h('div', { class: 'table-wrap' });

  const colOf = (key: string) => opts.columns.find((c) => c.key === key)!;
  const sortVal = (row: T, key: string) => {
    const v = colOf(key).get(row);
    return typeof v === 'number' ? v : v == null ? -Infinity : String(v).toLowerCase();
  };

  function draw(): void {
    const rows = [...opts.rows].sort((a, b) => {
      const va = sortVal(a, sort.key), vb = sortVal(b, sort.key);
      if (va < vb) return sort.dir;
      if (va > vb) return -sort.dir;
      return 0;
    });

    const thead = h('thead', null,
      h('tr', null, ...opts.columns.map((c) => {
        const sorted = c.key === sort.key;
        const th = h('th', {
          class: `${sorted ? 'is-sorted' : ''}${sorted && sort.dir === 1 ? ' is-asc' : ''}`,
        }, c.label);
        if (c.sortable !== false) {
          th.addEventListener('click', () => {
            sort = { key: c.key, dir: sort.key === c.key ? (-sort.dir as 1 | -1) : -1 };
            if (opts.persistSortAs) prefs.set(opts.persistSortAs, sort);
            draw();
          });
        } else {
          th.style.cursor = 'default';
        }
        return th;
      })),
    );

    const tbody = h('tbody', null, ...rows.map((row) => {
      const tr = h('tr', { class: opts.onRowClick ? 'is-clickable' : undefined },
        ...opts.columns.map((c) => h('td', null, c.render ? c.render(row) : cellText(c.get(row)))),
      );
      if (opts.onRowClick) tr.addEventListener('click', () => opts.onRowClick!(row));
      return tr;
    }));

    render(wrap, h('table', { class: 'data' }, thead, tbody));
  }

  draw();
  return wrap;
}

function cellText(v: string | number | null | undefined): string {
  if (v == null) return '–';
  return typeof v === 'number' ? String(Math.round(v)) : v;
}

/** A persisted sort is only used if its column still exists. */
function restoreSort<T>(opts: TableOpts<T>): HeroSortPref | undefined {
  if (!opts.persistSortAs) return undefined;
  const saved = prefs.get(opts.persistSortAs);
  return saved && opts.columns.some((c) => c.key === saved.key) ? saved : undefined;
}
