/** Shared contract for views. The shell renders a view for the current data. */
import { h } from '../dom';
import type { DashboardData, DashboardFilters } from '../../../src/shared/contract';
import type { ViewId, ViewParams } from '../store';
import { roleLabel } from '../format';
import { select, type SelectOption } from '../components/primitives';

export interface ViewContext {
  data: DashboardData;
  /** Params of the active view (e.g. the match detail's matchId). */
  params: ViewParams;
  navigate: (view: ViewId, params?: ViewParams) => void;
  openLogMatch: () => void;
  setFilter: (patch: Partial<DashboardFilters>) => void;
  refresh: () => void;
}

export type ViewRender = (ctx: ViewContext) => HTMLElement;

/**
 * Account · Role · Season filter bar. The store filters are global, so this
 * re-scopes every view — it just happens to live wherever it is rendered.
 */
export function filterBar(
  d: DashboardData,
  setFilter: (patch: Partial<DashboardFilters>) => void,
): HTMLElement {
  return h('div', { class: 'filter-bar' },
    filterField('Account', d.filters.account,
      [{ value: 'all', label: 'All accounts' }, ...d.options.accounts.map((a) => ({ value: a, label: a }))],
      (v) => setFilter({ account: v })),
    filterField('Role', d.filters.role,
      [{ value: 'all', label: 'All roles' }, ...d.options.roles.map((r) => ({ value: r, label: roleLabel(r) }))],
      (v) => setFilter({ role: v })),
    filterField('Mode', d.filters.mode,
      [{ value: 'all', label: 'All modes' }, ...d.options.modes.map((m) => ({ value: m, label: m }))],
      (v) => setFilter({ mode: v })),
    filterField('Season', String(d.filters.days),
      [
        { value: '7', label: 'Last 7 days' },
        { value: '30', label: 'Last 30 days' },
        { value: '90', label: 'This season' },
        { value: 'all', label: 'All time' },
      ],
      (v) => setFilter({ days: v === 'all' ? 'all' : Number(v) })),
  );
}

function filterField(label: string, value: string, options: SelectOption[], onChange: (v: string) => void): HTMLElement {
  return h('label', { class: 'filter-field' },
    h('span', { class: 'filter-label' }, label),
    select(options, value, onChange),
  );
}

/** Standard view header: title, subtitle, and optional right-aligned actions. */
export function viewHead(title: string, sub: string, actions?: Node | Node[]): HTMLElement {
  return h('div', { class: 'view-head' },
    h('div', null,
      h('h1', { class: 'view-title' }, title),
      h('div', { class: 'view-sub' }, sub),
    ),
    actions ? h('div', { class: 'view-actions' }, ...(Array.isArray(actions) ? actions : [actions])) : null,
  );
}

/** Trim a long map name for compact chips/labels. */
export function shorten(name: string): string {
  const SHORT: Record<string, string> = {
    'Watchpoint: Gibraltar': 'Watchpoint',
    'Antarctic Peninsula': 'Antarctic',
    'Shambali Monastery': 'Shambali',
    'New Queen Street': 'NQ Street',
    'New Junk City': 'NJ City',
    'Blizzard World': 'Blizz World',
    'Lijiang Tower': 'Lijiang',
    'Circuit Royal': 'Circuit',
  };
  return SHORT[name] ?? name;
}
