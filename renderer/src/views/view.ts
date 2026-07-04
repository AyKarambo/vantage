/** Shared contract for views. The shell renders a view for the current data. */
import { h } from '../dom';
import type { DashboardData, DashboardFilters } from '../../../src/shared/contract';
import type { ViewId, ViewParams } from '../store';
import { FILTER_DEFAULTS } from '../store';
import { prefs, type FilterPresetPref } from '../prefs';
import { roleLabel } from '../format';
import { chip, select, type SelectOption } from '../components/primitives';

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
  const changed = activeFilterCount(d.filters);
  const presets = prefs.get('filterPresets') ?? [];

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
    changed
      ? h('button', {
          class: 'filter-reset',
          title: 'Back to the default filters',
          on: { click: () => setFilter({ ...FILTER_DEFAULTS }) },
        }, `Reset (${changed})`)
      : null,
    h('span', { class: 'filter-presets' },
      ...presets.map((p) => presetChip(p, d.filters, setFilter)),
      changed && presets.length < 2 && !presets.some((p) => sameFilters(p.filters, d.filters))
        ? h('button', {
            class: 'filter-preset-save',
            title: 'Save the current filter combination as a one-click preset',
            on: {
              click: (e) => {
                const next = [...presets, { name: summarizeFilters(d.filters), filters: { ...d.filters } }];
                prefs.set('filterPresets', next);
                (e.currentTarget as HTMLElement).closest('.filter-bar')?.replaceWith(filterBar(d, setFilter));
              },
            },
          }, '+ save preset')
        : null,
    ),
  );
}

function presetChip(
  p: FilterPresetPref,
  current: Required<DashboardFilters>,
  setFilter: (patch: Partial<DashboardFilters>) => void,
): HTMLElement {
  const el = chip(p.name, sameFilters(p.filters, current), () => setFilter({ ...p.filters }));
  el.title = 'Apply this preset · right-click to remove';
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    prefs.set('filterPresets', (prefs.get('filterPresets') ?? []).filter((x) => x.name !== p.name));
    el.remove();
  });
  return el;
}

function activeFilterCount(f: Required<DashboardFilters>): number {
  return (['account', 'role', 'mode', 'days'] as const)
    .filter((k) => String(f[k]) !== String(FILTER_DEFAULTS[k])).length;
}

function sameFilters(a: Required<DashboardFilters>, b: Required<DashboardFilters>): boolean {
  return a.account === b.account && a.role === b.role && a.mode === b.mode && String(a.days) === String(b.days);
}

function summarizeFilters(f: Required<DashboardFilters>): string {
  const parts: string[] = [];
  if (f.mode !== 'all') parts.push(f.mode);
  if (f.role !== 'all') parts.push(roleLabel(f.role));
  if (f.account !== 'all') parts.push(f.account);
  parts.push(f.days === 'all' ? 'all time' : `${f.days}d`);
  return parts.join(' · ');
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
