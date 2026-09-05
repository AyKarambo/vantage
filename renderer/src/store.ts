/**
 * The renderer's single source of truth. Holds the active filters, the current
 * view, and the last-loaded dashboard payload; loads data through the bridge;
 * and notifies subscribers on change. Views render from a snapshot and never
 * fetch or persist directly.
 */
import type { DashboardData, DashboardFilters, MatchFlagKey } from '../../src/shared/contract';
import { migrateLegacySeasonDays } from '../../src/core/season';
import { bridge } from './bridge';
import { relTime } from './format';
import { prefs } from './prefs';
import {
  back, entryLabel, pushEntry, resolveEntry, routeParams, sameParams,
  type BackEntry, type BackStack, type ResolveContext, type Resolver,
} from './backStack';

export type ViewId =
  | 'overview'
  | 'live'
  | 'review'
  | 'matches'
  | 'matchDetail'
  | 'playerHistory'
  | 'targetDetail'
  | 'maps'
  | 'heroes'
  | 'focus'
  | 'mental'
  | 'trends'
  | 'readiness'
  | 'targets'
  | 'notion'
  | 'logs'
  | 'settings'
  | 'about'
  | 'faq';

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
  /** playerHistory: the player whose shared-match history to show (a name/battleTag). */
  playerName?: string;
  /** targetDetail: the improvement target to drill into. */
  targetId?: string;
  /** Targets: open the builder pre-filled to edit this target (a detail page's Edit). */
  editTargetId?: string;
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
export const FILTER_DEFAULTS: Required<DashboardFilters> = { account: 'all', role: 'all', days: 30 };
const STORAGE_KEY = 'vantageFilters';

/** Parameterized drill-downs persist their parent list for relaunch restore. */
const DETAIL_PARENT: Partial<Record<ViewId, ViewId>> = {
  matchDetail: 'matches',
  playerHistory: 'matches',
  targetDetail: 'targets',
};

/** The last visited top-level view, restored on launch (never a detail page). */
function initialView(): ViewId {
  const saved = prefs.get('view');
  const valid: ViewId[] = ['overview', 'live', 'review', 'matches', 'maps', 'heroes', 'focus', 'mental', 'trends', 'readiness', 'targets', 'notion', 'logs', 'settings', 'about', 'faq'];
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
  /** Monotonic id of the newest in-flight {@link refresh}; older ones can't commit. */
  private fetchSeq = 0;
  /** Session-only, never persisted: a relaunch starts at {@link initialView}
   *  (always a top-level view) with an empty stack, and therefore no ←. */
  private backStack: BackStack = [];
  /** Ids this session has POSITIVE evidence are deleted — see `resolveEntry`. */
  private readonly deletedMatchIds = new Set<string>();

  get(): AppState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setView(view: ViewId, params: ViewParams = {}): void {
    // Unchanged, and deliberately BEFORE the push: re-navigating to where you
    // already stand still records nothing.
    if (view === this.state.view && sameParams(params, this.state.params)) return;
    this.backStack = pushEntry(this.backStack, this.currentEntry());
    this.commitView(view, params);
  }

  /**
   * The ONLY legal way to change `view`/`params`. Shared by {@link setView} and
   * {@link goBack} — Back is a real navigation, so it must write the relaunch
   * preference exactly like a forward one. Keep this the sole commit point: a
   * future surface that writes `state.view` another way would silently stop the
   * back stack recording.
   */
  private commitView(view: ViewId, params: ViewParams): void {
    // Detail pages restore to their parent list on relaunch.
    prefs.set('view', DETAIL_PARENT[view] ?? view);
    this.patch({ view, params });
  }

  private currentEntry(): BackEntry {
    return { view: this.state.view, params: routeParams(this.state.params) };
  }

  private resolver(): Resolver {
    const ctx: ResolveContext = {
      targets: this.state.data?.targets ?? null,
      deletedMatchIds: this.deletedMatchIds,
    };
    return (e) => resolveEntry(e, ctx);
  }

  /** Navigate to the previous resolvable screen; false when there is none. */
  goBack(): boolean {
    const r = back(this.backStack, this.currentEntry(), this.resolver());
    // A miss leaves the stack intact — a match's 12s Undo can revive entries.
    if (!r.entry) return false;
    this.backStack = r.stack;
    // A FRESH params object. The stored entry is owned solely by the stack and
    // never handed to a view, so nothing keyed on params identity (targets'
    // `consumedEditParams` WeakSet) can ever be shown a resurrected reference.
    this.commitView(r.entry.view, { ...r.entry.params });
    return true;
  }

  /** Where a Back press would land, or null when nowhere — one call answers
   *  both "render the ←?" and "what does its tooltip say?". */
  backLabel(): string | null {
    const { entry } = back(this.backStack, this.currentEntry(), this.resolver());
    return entry ? entryLabel(entry) : null;
  }

  /**
   * Positive evidence a match is gone. Idempotent, and capped so a mass-delete
   * session can't grow it without bound — evicting a tombstone costs at worst
   * one extra Back press onto the honest "no longer in your history" card.
   */
  noteMatchDeleted(id: string): void {
    this.deletedMatchIds.add(id);
    if (this.deletedMatchIds.size > 500) {
      const oldest = this.deletedMatchIds.values().next();
      if (!oldest.done) this.deletedMatchIds.delete(oldest.value);
    }
  }

  /** The 12-second Undo put it back. */
  noteMatchRestored(id: string): void {
    this.deletedMatchIds.delete(id);
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
   *
   * Concurrent refreshes are real and routine — a write's own `refresh()` races
   * the `onGameLogged` push, and a filter change races either — so every fetch
   * carries a sequence number and only the NEWEST may commit. Without that, a
   * slower earlier read can resolve last and repaint the snapshot it superseded,
   * which looks exactly like the staleness this refetch exists to prevent. The
   * `seq` idiom mirrors `components/srControls.ts`.
   */
  async refresh(): Promise<void> {
    const mine = ++this.fetchSeq;
    const cold = !this.state.data;
    this.patch(cold ? { loading: true } : { refreshing: true });
    try {
      let data = await bridge.getDashboard(this.state.filters);
      if (mine !== this.fetchSeq) return;
      // First payload only: an unlistable persisted season id falls back to the
      // default window now that `options.seasons` is finally known (spec D2).
      // A background refresh never re-runs this — the user could be actively
      // sitting on a season that briefly has no visible data.
      if (cold) {
        const reconciled = reconcileSeasonFilter(this.state.filters, data);
        if (reconciled !== this.state.filters) {
          this.state.filters = reconciled;
          persistFilters(reconciled);
          // The snapshot just fetched was scoped to the stale (unlistable)
          // season filter — refetch under the reconciled filters so the
          // rendered data actually matches `state.filters`.
          data = await bridge.getDashboard(this.state.filters);
          if (mine !== this.fetchSeq) return;
        }
      }
      this.patch({ data, loading: false, refreshing: false, stale: false, error: null, status: statusText(data) });
    } catch (err) {
      // A superseded fetch's failure is not this snapshot's problem — the newer
      // one owns the outcome, so don't flag `stale` on its behalf.
      if (mine !== this.fetchSeq) return;
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

/**
 * Cold-load migration (spec D1/D2): drop the retired `mode` key and translate
 * the legacy current-season sentinel (`days: 'season'`) into an addressable
 * `{ season: id }`. Reconciling an *unlistable* `{ season: id }` (a persisted
 * id no longer offered) needs `options.seasons` from the first dashboard
 * payload, so that step happens in `refresh()`, not here.
 */
function loadFilters(): Partial<DashboardFilters> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<DashboardFilters> & { mode?: unknown };
    const { mode: _mode, ...rest } = raw;
    if ((rest.days as unknown) === 'season') {
      rest.days = migrateLegacySeasonDays(Date.now());
    }
    return rest;
  } catch {
    return {};
  }
}

/**
 * Once the first payload arrives, fall back a persisted `{ season: id }` that
 * isn't in the freshly-computed options list to the default 30-day window
 * (spec D2: "falls back to the default without crashing"). Cheap/idempotent —
 * a no-op once the filters already match an offered season (or aren't a
 * season filter at all).
 */
function reconcileSeasonFilter(filters: Required<DashboardFilters>, data: DashboardData): Required<DashboardFilters> {
  const days = filters.days;
  if (typeof days !== 'object') return filters;
  const known = data.options.seasons.some((s) => s.id === days.season);
  return known ? filters : { ...filters, days: FILTER_DEFAULTS.days };
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
