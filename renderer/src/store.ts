/**
 * The renderer's single source of truth. Holds the active filters, the current
 * view, and the last-loaded dashboard payload; loads data through the bridge;
 * and notifies subscribers on change. Views render from a snapshot and never
 * fetch or persist directly.
 */
import type { DashboardData, DashboardFilters, MatchFlagKey } from '../../src/shared/contract';
import { bridge } from './bridge';
import { relTime } from './format';
import { prefs } from './prefs';

export type ViewId =
  | 'overview'
  | 'review'
  | 'matches'
  | 'matchDetail'
  | 'maps'
  | 'heroes'
  | 'focus'
  | 'mental'
  | 'trends'
  | 'readiness'
  | 'targets'
  | 'notion'
  | 'logs'
  | 'settings';

/** Parameters for parameterized views (the match detail drill-down). */
export interface ViewParams {
  matchId?: string;
  /** Entry to scroll to and flash after navigating (e.g. a map on Maps). */
  highlight?: string;
  /** Scope Matches to one day (a `dayKey`, `YYYY-MM-DD` UTC — same bucketing as the heatmap). */
  day?: string;
  /** Scope Matches to games carrying this mental flag. */
  flag?: MatchFlagKey;
  /** Targets: prefill the builder with this name (self-rated) on open — the
   *  Focus screen's per-map "＋ target" quick-create. */
  prefillName?: string;
}

/** Every `ViewParams` key, kept in sync by the compiler: adding a key here
 *  without adding it to this array is a type error, so `sameParams` can never
 *  silently drop a new param from the dedupe/re-render checks. */
const VIEW_PARAM_KEYS: Required<{ [K in keyof ViewParams]: true }> = {
  matchId: true,
  highlight: true,
  day: true,
  flag: true,
  prefillName: true,
};

/** Structural equality over every `ViewParams` key — used by `setView`'s
 *  navigation dedupe so a future param can't be forgotten from the check. */
function sameParams(a: ViewParams, b: ViewParams): boolean {
  return (Object.keys(VIEW_PARAM_KEYS) as Array<keyof ViewParams>).every((k) => a[k] === b[k]);
}

export interface AppState {
  filters: Required<DashboardFilters>;
  view: ViewId;
  /** Params of the active view; reset on every navigation. */
  params: ViewParams;
  data: DashboardData | null;
  /** Cold start only — no snapshot yet. Background refetches set `refreshing`. */
  loading: boolean;
  /** A refetch is in flight while the previous snapshot stays on screen. */
  refreshing: boolean;
  /** The last refetch failed — the visible snapshot is older than it looks. */
  stale: boolean;
  status: string;
  error: string | null;
  /** Bumped by rerender() so the shell re-renders content without a new snapshot. */
  renderEpoch: number;
}

type Listener = (state: AppState) => void;

/** The neutral filter set — exported so the filter bar can offer "Reset". */
export const FILTER_DEFAULTS: Required<DashboardFilters> = { account: 'all', role: 'all', mode: 'all', days: 30 };
const STORAGE_KEY = 'vantageFilters';

/** The last visited top-level view, restored on launch (never a detail page). */
function initialView(): ViewId {
  const saved = prefs.get('view');
  const valid: ViewId[] = ['overview', 'review', 'matches', 'maps', 'heroes', 'focus', 'mental', 'trends', 'readiness', 'targets', 'notion', 'logs', 'settings'];
  return valid.includes(saved as ViewId) ? (saved as ViewId) : 'overview';
}

class Store {
  private state: AppState = {
    filters: { ...FILTER_DEFAULTS, ...loadFilters() },
    view: initialView(),
    params: {},
    data: null,
    loading: true,
    refreshing: false,
    stale: false,
    status: 'Loading…',
    error: null,
    renderEpoch: 0,
  };
  private readonly listeners = new Set<Listener>();

  get(): AppState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setView(view: ViewId, params: ViewParams = {}): void {
    if (view === this.state.view && sameParams(params, this.state.params)) return;
    // Detail pages restore to their parent list on relaunch.
    prefs.set('view', view === 'matchDetail' ? 'matches' : view);
    this.patch({ view, params });
  }

  /** Re-notify subscribers without refetching — for local (client-side) state
   *  changes like saving a review, so the current data snapshot stays stable. */
  rerender(): void {
    this.patch({ renderEpoch: this.state.renderEpoch + 1 });
  }

  setFilters(next: Partial<DashboardFilters>): void {
    this.state.filters = { ...this.state.filters, ...next };
    persistFilters(this.state.filters);
    void this.refresh();
  }

  /**
   * Fetch a fresh snapshot. Cold start (no data yet) shows the loading state;
   * afterwards the previous snapshot stays rendered while `refreshing` — a
   * failed background refresh keeps it and only marks it `stale`.
   */
  async refresh(): Promise<void> {
    const cold = !this.state.data;
    this.patch(cold ? { loading: true } : { refreshing: true });
    try {
      const data = await bridge.getDashboard(this.state.filters);
      this.patch({ data, loading: false, refreshing: false, stale: false, error: null, status: statusText(data) });
    } catch (err) {
      if (this.state.data) {
        this.patch({ refreshing: false, stale: true, status: 'Refresh failed — showing last data' });
      } else {
        this.patch({ loading: false, refreshing: false, error: String(err), status: `Failed to load — ${err}` });
      }
    }
  }

  private patch(next: Partial<AppState>): void {
    this.state = { ...this.state, ...next };
    for (const fn of this.listeners) fn(this.state);
  }
}

/** The status-bar line — exported so the shell can re-derive it as time passes. */
export function statusText(d: DashboardData): string {
  const demo = d.isSample ? ' · demo data (play games to populate)' : '';
  return `${d.overall.games} games${demo} · updated ${relTime(d.generatedAt)}`;
}

function loadFilters(): Partial<DashboardFilters> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function persistFilters(filters: DashboardFilters): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    /* storage unavailable — filters just won't persist */
  }
}

/**
 * Decision record: deliberately a module singleton today. `ViewContext` is the
 * seam where constructor injection would go if renderer unit tests arrive —
 * don't re-litigate this without that payoff.
 */
export const store = new Store();
