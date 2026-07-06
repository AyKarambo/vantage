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

/** Encode a `DashboardFilters['days']` value as the `<select>`'s string value. */
function daysToValue(days: DashboardData['filters']['days']): string {
  if (days === 'all') return 'all';
  if (typeof days === 'object') return `season:${days.season}`;
  return String(days);
}

/** Decode the `<select>`'s string value back into a `DashboardFilters['days']`. */
function valueToDays(v: string): DashboardData['filters']['days'] {
  if (v === 'all') return 'all';
  if (v.startsWith('season:')) return { season: v.slice('season:'.length) };
  return Number(v);
}

/**
 * Role · Season filter bar. No Account field (the switcher owns account) and no
 * Mode field (Vantage is competitive-only) — see spec D1/D3.
 */
export function filterBar(
  d: DashboardData,
  setFilter: (patch: Partial<DashboardFilters>) => void,
): HTMLElement {
  const changed = activeFilterCount(d.filters);
  const presets = prefs.get('filterPresets') ?? [];

  return h('div', { class: 'filter-bar' },
    filterField('Role', d.filters.role,
      [{ value: 'all', label: 'All roles' }, ...d.options.roles.map((r) => ({ value: r, label: roleLabel(r) }))],
      (v) => setFilter({ role: v })),
    filterField('Season', daysToValue(d.filters.days),
      [
        { value: '7', label: 'Last 7 days' },
        { value: '30', label: 'Last 30 days' },
        ...d.options.seasons.map((s) => ({ value: `season:${s.id}`, label: s.label })),
        { value: 'all', label: 'All time' },
      ],
      (v) => setFilter({ days: valueToDays(v) })),
    changed
      ? h('button', {
          class: 'filter-reset',
          title: 'Back to the default filters',
          // Account is switcher-driven — reset restores role+days only and
          // leaves the active account untouched (spec D4).
          on: { click: () => setFilter({ role: FILTER_DEFAULTS.role, days: FILTER_DEFAULTS.days }) },
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

// Account is switcher-driven (not part of the filter bar) so it's excluded from
// reset/preset equality/summaries below — only role+days are "the filters" now.
// `days` is compared via `daysToValue`'s canonical string key, not `String()` —
// every `{ season }` object stringifies to the same `'[object Object]'`, which
// would make different seasons compare equal.
function activeFilterCount(f: Required<DashboardFilters>): number {
  let n = 0;
  if (f.role !== FILTER_DEFAULTS.role) n++;
  if (daysToValue(f.days) !== daysToValue(FILTER_DEFAULTS.days)) n++;
  return n;
}

function sameFilters(a: Required<DashboardFilters>, b: Required<DashboardFilters>): boolean {
  return a.role === b.role && daysToValue(a.days) === daysToValue(b.days);
}

function summarizeFilters(f: Required<DashboardFilters>): string {
  const parts: string[] = [];
  if (f.role !== 'all') parts.push(roleLabel(f.role));
  parts.push(f.days === 'all' ? 'all time' : typeof f.days === 'object' ? 'season' : `${f.days}d`);
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
