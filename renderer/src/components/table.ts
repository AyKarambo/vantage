/** A self-contained sortable table. Owns its sort state and re-renders in place. */
import { h, render } from '../dom';
import { prefs, type HeroSortPref } from '../prefs';

export interface Column<T> {
  key: string;
  /** A plain string, or a Node (e.g. a label paired with an {@link ../infoTip}). */
  label: string | Node;
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
  /**
   * Shown as one full-width row spanning every column when `rows` is empty,
   * instead of a bare header over an empty tbody (K9) — e.g. Heroes choosing
   * 10+ on a short range used to leave just the header with no explanation
   * or way back.
   */
  empty?: Node | string;
  /** Persist the sort choice under this prefs key (survives re-renders + restarts). */
  persistSortAs?: 'heroSort';
  /**
   * Take over sorting. When supplied, a header click reports the new key and
   * direction instead of re-ordering `rows`, and the table does NOT redraw — the
   * caller fetches an ordered page and re-renders, so the header arrow and the
   * rows always change together.
   *
   * Required whenever `rows` is a CAPPED page: sorting a page locally would
   * quietly mean "the top N by the previous key, re-ordered" while the header
   * claims the page is sorted by the new one.
   */
  onSort?: (sort: { key: string; dir: 1 | -1 }) => void;
}

export function dataTable<T>(opts: TableOpts<T>): HTMLElement {
  let sort: HeroSortPref = restoreSort(opts) ?? opts.initialSort ?? { key: opts.columns[0].key, dir: -1 };
  const wrap = h('div', { class: 'table-wrap' });

  const colOf = (key: string) => opts.columns.find((c) => c.key === key)!;

  function draw(): void {
    // With `onSort`, the caller owns the order — `rows` arrives already sorted
    // (and possibly capped), so re-sorting here would reorder only the page.
    const rows = opts.onSort ? [...opts.rows]
      : [...opts.rows].sort((a, b) => compareCells(colOf(sort.key).get(a), colOf(sort.key).get(b), sort.dir));

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
            // Deliberately no local redraw here: the caller re-renders with the
            // newly-ordered page, so the arrow can never move without the rows.
            if (opts.onSort) opts.onSort(sort);
            else draw();
          });
        } else {
          th.style.cursor = 'default';
        }
        return th;
      })),
    );

    const tbody = rows.length
      ? h('tbody', null, ...rows.map((row) => {
          const tr = h('tr', { class: opts.onRowClick ? 'is-clickable' : undefined },
            ...opts.columns.map((c) => h('td', null, c.render ? c.render(row) : cellText(c.get(row)))),
          );
          if (opts.onRowClick) tr.addEventListener('click', () => opts.onRowClick!(row));
          return tr;
        }))
      : opts.empty
        ? h('tbody', null, h('tr', null, h('td', { colspan: String(opts.columns.length) }, opts.empty)))
        : h('tbody', null);

    render(wrap, h('table', { class: 'data' }, thead, tbody));
  }

  draw();
  return wrap;
}

/**
 * The comparator dataTable's local sort uses — a named export so it is
 * directly unit-testable without a DOM (K1's dataTable-ordering test).
 *
 * `dir: 1` is ascending, `dir: -1` is descending (matching the header's '↓'
 * for -1, components.css:537-545) — `va < vb` under dir -1 must put the
 * SMALLER value LATER, i.e. return a positive (a-after-b) result, so the
 * comparison is `-dir`/`dir`, not the other way around: a version that
 * returned `dir`/`-dir` here sorted every dir -1 column ascending under a
 * descending arrow, and vice versa. A null/undefined value always sorts
 * last regardless of direction — it is "nothing to compare", not "the
 * smallest value" — so it's handled before the two branches ever see it.
 * Strings compare case-insensitively; numbers compare as numbers even when
 * mixed with strings elsewhere in the column (defensive — columns are
 * expected to be one type).
 */
export function compareCells(
  va: string | number | null | undefined,
  vb: string | number | null | undefined,
  dir: 1 | -1,
): number {
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  const na = typeof va === 'number' ? va : String(va).toLowerCase();
  const nb = typeof vb === 'number' ? vb : String(vb).toLowerCase();
  if (na < nb) return -dir;
  if (na > nb) return dir;
  return 0;
}

/**
 * The default cell display for a column with no `render` — verbatim, not
 * rounded: a caller whose raw `get` value carries real decimals (a per-10
 * rate, an average rating) supplies its own `render` for that, same as a
 * percent or a signed number already does. Rounding here silently corrupted
 * any numeric column that forgot to add one (K1).
 */
function cellText(v: string | number | null | undefined): string {
  if (v == null) return '–';
  return String(v);
}

/** A persisted sort is only used if its column still exists. */
function restoreSort<T>(opts: TableOpts<T>): HeroSortPref | undefined {
  if (!opts.persistSortAs) return undefined;
  const saved = prefs.get(opts.persistSortAs);
  return saved && opts.columns.some((c) => c.key === saved.key) ? saved : undefined;
}
