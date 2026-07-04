/**
 * The renderer's single source of truth. Holds the active filters, the current
 * view, and the last-loaded dashboard payload; loads data through the bridge;
 * and notifies subscribers on change. Views render from a snapshot and never
 * fetch or persist directly.
 */
import type { DashboardData, DashboardFilters } from '../../src/shared/contract';
import { bridge } from './bridge';
import { time } from './format';

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
  | 'targets'
  | 'notion'
  | 'logs';

/** Parameters for parameterized views (the match detail drill-down). */
export interface ViewParams {
  matchId?: string;
}

export interface AppState {
  filters: Required<DashboardFilters>;
  view: ViewId;
  /** Params of the active view; reset on every navigation. */
  params: ViewParams;
  data: DashboardData | null;
  loading: boolean;
  status: string;
  error: string | null;
}

type Listener = (state: AppState) => void;

const DEFAULTS: Required<DashboardFilters> = { account: 'all', role: 'all', mode: 'all', days: 30 };
const STORAGE_KEY = 'vantageFilters';

class Store {
  private state: AppState = {
    filters: { ...DEFAULTS, ...loadFilters() },
    view: 'overview',
    params: {},
    data: null,
    loading: true,
    status: 'Loading…',
    error: null,
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
    if (view === this.state.view && params.matchId === this.state.params.matchId) return;
    this.patch({ view, params });
  }

  /** Re-notify subscribers without refetching — for local (client-side) state
   *  changes like saving a review, so the current data snapshot stays stable. */
  rerender(): void {
    this.patch({});
  }

  setFilters(next: Partial<DashboardFilters>): void {
    this.state.filters = { ...this.state.filters, ...next };
    persistFilters(this.state.filters);
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.patch({ loading: true });
    try {
      const data = await bridge.getDashboard(this.state.filters);
      this.patch({ data, loading: false, error: null, status: statusText(data) });
    } catch (err) {
      this.patch({ loading: false, error: String(err), status: `Failed to load — ${err}` });
    }
  }

  private patch(next: Partial<AppState>): void {
    this.state = { ...this.state, ...next };
    for (const fn of this.listeners) fn(this.state);
  }
}

function statusText(d: DashboardData): string {
  const demo = d.isSample ? ' · demo data (play games to populate)' : '';
  return `${d.overall.games} games${demo} · updated ${time(d.generatedAt)}`;
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
