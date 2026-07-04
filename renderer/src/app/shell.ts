/**
 * The application shell: frameless title bar, sidebar navigation, the content
 * host, and the status bar. It owns the view registry and re-renders the active
 * view whenever the store changes. Views stay dumb — they receive a snapshot and
 * a small context of callbacks.
 */
import { h, render } from '../dom';
import type { AppState, ViewId } from '../store';
import type { DashboardData, GepStatusPayload } from '../../../src/shared/contract';
import { statusText, store } from '../store';
import { bridge } from '../bridge';
import { getGepStatus, initGepStatus, subscribeGepStatus } from '../gepStatus';
import { initShortcuts, registerShortcut, shortcutGroups } from '../shortcuts';
import { openPopover } from '../components/popover';
import { openModal } from '../components/overlay';
import { mountToastHost } from '../components/toast';
import { skeletonView } from '../components/skeleton';
import { button } from '../components/primitives';
import { pct, rankLabel, relTime, signed } from '../format';
import { overview } from '../views/overview';
import { matches } from '../views/matches';
import { matchDetail } from '../views/matchDetail';
import { maps } from '../views/maps';
import { heroes } from '../views/heroes';
import { focus } from '../views/focus';
import { mental } from '../views/mental';
import { trends } from '../views/trends';
import { targets } from '../views/targets';
import { notion } from '../views/notion';
import { review } from '../views/review';
import { logViewer } from '../views/logViewer';
import { settings } from '../views/settings';
import { filterBar, type ViewContext, type ViewRender } from '../views/view';
import { gradedThisSession, migrateLegacyReviews } from '../reviews';
import { openLogMatch } from './log-match';
import { openPalette } from './palette';
import { openOnboarding, shouldOnboard } from './onboarding';
import { openFirstRunPrompt } from './firstRunPrompt';

// matchDetail is a parameterized view: registered here (routable) but not in
// NAV — the sidebar keeps Matches highlighted while it is active.
const VIEWS: Record<ViewId, ViewRender> = { overview, review, matches, matchDetail, maps, heroes, focus, mental, trends, targets, notion, logs: logViewer, settings };

interface NavItem {
  id: ViewId;
  label: string;
  icon: string;
}
const NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: 'Workspace',
    items: [
      { id: 'overview', label: 'Overview', icon: '◈' },
      { id: 'review', label: 'Review', icon: '⚑' },
      { id: 'matches', label: 'Matches', icon: '▤' },
      { id: 'maps', label: 'Maps', icon: '◇' },
      { id: 'heroes', label: 'Heroes', icon: '◍' },
    ],
  },
  {
    group: 'Insights',
    items: [
      { id: 'focus', label: 'Focus', icon: '◎' },
      { id: 'mental', label: 'Mental', icon: '◐' },
      { id: 'trends', label: 'Trends', icon: '◔' },
      { id: 'targets', label: 'Targets', icon: '✦' },
    ],
  },
  {
    group: 'Data',
    items: [
      { id: 'notion', label: 'Notion sync', icon: '⟳' },
      { id: 'logs', label: 'Logs', icon: '≡' },
    ],
  },
  {
    group: 'App',
    items: [
      { id: 'settings', label: 'Settings', icon: '⚙' },
    ],
  },
];

export class App {
  private readonly sidebarHost = h('aside', { class: 'sidebar' });
  private readonly filterHost = h('div', { class: 'filterbar-wrap hidden' });
  private readonly contentHost = h('main', { class: 'content' });
  private readonly statusLabel = h('span', null, 'Loading…');
  private readonly busySpin = h('span', { class: 'busy-indicator hidden', title: 'Refreshing…' });
  private readonly staleLink = h('button', {
    class: 'stale-link hidden',
    title: 'The last refresh failed — click to retry',
    on: { click: () => void store.refresh() },
  }, '⚠ stale — retry');
  private readonly demoBadge = h('span', { class: 'badge badge--demo hidden' }, 'Demo data');
  private readonly gepDot = h('span', { class: 'status-dot' });
  private readonly gepLabel = h('span', { class: 'gep-label' }, '');
  /** What the content host currently shows — re-render only when this changes. */
  private lastRendered: { data: DashboardData; view: ViewId; matchId?: string; highlight?: string; epoch: number } | null = null;
  /** Per-route scroll positions, restored when navigating back (session only). */
  private readonly scrollMemory = new Map<string, number>();

  constructor(mount: HTMLElement) {
    render(mount, this.build());
    store.subscribe((state) => this.onState(state));
    this.bindGlobals();
    mountToastHost();
    initGepStatus();
    subscribeGepStatus(() => this.renderGepIndicator());
    this.renderGepIndicator();
    // Keep "updated Xm" honest while the app idles.
    setInterval(() => {
      const s = store.get();
      if (s.data && !s.stale && !s.error) this.statusLabel.textContent = statusText(s.data);
    }, 60_000);
    void store.refresh();
    // The first-run demo prompt + tour are driven from onState once real data
    // has loaded (so the persisted demo choice is known before we decide).
  }

  private build(): HTMLElement {
    return h('div', { class: 'app' },
      this.titlebar(),
      h('div', { class: 'body' },
        this.sidebarHost,
        h('div', { class: 'content-col' }, this.filterHost, this.contentHost),
      ),
      h('footer', { class: 'statusbar' },
        h('button', {
          class: 'gep-indicator',
          title: 'Connection status — click for details',
          on: { click: (e) => this.openGepPopover(e.currentTarget as HTMLElement) },
        }, this.gepDot, this.gepLabel),
        this.statusLabel, this.busySpin, this.staleLink, this.demoBadge,
        h('button', {
          class: 'statusbar-link',
          style: { marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-2)', cursor: 'pointer', font: 'inherit', fontSize: '11.5px' },
          title: 'Replay the intro tour',
          on: { click: () => openOnboarding(store.get().data?.isSample ?? false) },
        }, 'Help'),
      ),
    );
  }

  private titlebar(): HTMLElement {
    const control = (label: string, cls: string, fn: () => void) =>
      h('button', { class: `win-btn ${cls}`, on: { click: fn } }, label);
    return h('header', { class: 'titlebar' },
      h('div', { class: 'titlebar-brand' }, h('span', { class: 'brand-mark' }), 'Vantage'),
      h('div', { class: 'titlebar-center' },
        h('button', { class: 'titlebar-search', on: { click: () => this.openPalette() } },
          h('span', { class: 'kbd' }, 'Ctrl K'), 'Search or log a match'),
      ),
      h('div', { class: 'titlebar-controls' },
        control('—', 'win-btn--min', () => bridge.window.minimize()),
        control('▢', 'win-btn--max', () => bridge.window.toggleMaximize()),
        control('✕', 'win-btn--close', () => bridge.window.close()),
      ),
    );
  }

  private context(): ViewContext {
    const data = store.get().data!;
    return {
      data,
      params: store.get().params,
      navigate: (view, params) => store.setView(view, params),
      openLogMatch: () => openLogMatch(this.context()),
      setFilter: (patch) => store.setFilters(patch),
      refresh: () => void store.refresh(),
    };
  }

  private migrated = false;
  private firstRunHandled = false;

  private onState(state: AppState): void {
    this.renderSidebar(state);
    this.renderFilters(state);
    this.renderContent(state);
    this.statusLabel.textContent = state.status;
    this.busySpin.classList.toggle('hidden', !state.refreshing);
    this.staleLink.classList.toggle('hidden', !state.stale);
    this.demoBadge.classList.toggle('hidden', !state.data?.isSample);
    this.maybeFirstRun(state);
    // One-time legacy-review migration, only when real tracked history exists
    // (importing against the demo season's ids would drop data). Gated on
    // hasRealHistory, not isSample — a fresh-start user has neither.
    if (!this.migrated && state.data?.hasRealHistory) {
      this.migrated = true;
      void migrateLegacyReviews().then((imported) => {
        if (imported) void store.refresh();
      });
    }
  }

  /** Once, after the first real snapshot: ask the demo question (if never asked), then the tour. */
  private maybeFirstRun(state: AppState): void {
    if (this.firstRunHandled || !state.data) return;
    this.firstRunHandled = true;
    const openTour = (): void => {
      if (shouldOnboard()) openOnboarding(store.get().data?.isSample ?? false);
    };
    if (state.data.demoPreference === 'unset') openFirstRunPrompt(openTour);
    else openTour();
  }

  /** The one global filter bar — persistent above every screen, unified look. */
  private renderFilters(state: AppState): void {
    this.filterHost.classList.toggle('hidden', !state.data);
    if (!state.data) return;
    render(this.filterHost, filterBar(state.data, (patch) => store.setFilters(patch)));
  }

  private renderContent(state: AppState): void {
    if (!state.data) {
      this.lastRendered = null;
      render(this.contentHost, state.error ? this.errorCard(state.error) : skeletonView());
      return;
    }
    // Background refreshes and status-only patches keep the current DOM (and
    // scroll position); re-render only for a new snapshot, route, or an
    // explicit rerender() epoch bump.
    const key = {
      data: state.data,
      view: state.view,
      matchId: state.params.matchId,
      highlight: state.params.highlight,
      epoch: state.renderEpoch,
    };
    const last = this.lastRendered;
    if (last && last.data === key.data && last.view === key.view
      && last.matchId === key.matchId && last.highlight === key.highlight && last.epoch === key.epoch) return;
    // Remember where the outgoing route was scrolled; restore it when a
    // navigation (not a data refresh on the same route) returns here.
    if (last) this.scrollMemory.set(routeKey(last.view, last.matchId), this.contentHost.scrollTop);
    const navigated = !last || last.view !== key.view || last.matchId !== key.matchId;
    render(this.contentHost, VIEWS[state.view](this.context()));
    this.lastRendered = key;
    if (navigated) {
      this.contentHost.scrollTop = this.scrollMemory.get(routeKey(key.view, key.matchId)) ?? 0;
    }
  }

  /** Cold-start failure: nothing to show — offer an explicit retry. */
  private errorCard(error: string): HTMLElement {
    return h('div', { class: 'view' },
      h('div', { class: 'card', style: { maxWidth: '460px', margin: '60px auto', textAlign: 'center' } },
        h('div', { style: { fontSize: '15px', fontWeight: '600', marginBottom: '6px' } }, 'Couldn’t load the dashboard'),
        h('div', { class: 'u-muted', style: { fontSize: '12px', marginBottom: '14px' } }, error),
        button('Retry', { variant: 'primary', onClick: () => void store.refresh() }),
      ),
    );
  }

  private renderSidebar(state: AppState): void {
    const d = state.data;
    const account = h('div', { class: 'sidebar-account' },
      h('div', { class: 'avatar' }, (d?.greetingName ?? 'V').charAt(0).toUpperCase()),
      h('div', { class: 'row-main' },
        h('div', { class: 'account-name' }, d?.greetingName ?? 'Vantage'),
        h('div', { class: 'account-sub' },
          d ? `${rankLabel(d.progression.tier, d.progression.division)} · ${Math.round(d.progression.progressPct)}%` : '—'),
      ),
      h('span', { class: 'u-dim', style: { fontSize: '11px' } }, '▾'),
    );

    // Saving a review doesn't refetch, so subtract the games graded since the
    // last snapshot (only those the snapshot still counts as pending).
    const gradedOverlap = d ? d.reviewInbox.filter((m) => gradedThisSession.has(m.matchId)).length : 0;
    const pendingReviews = d ? Math.max(0, d.pendingReviews - gradedOverlap) : 0;
    // Parameterized views highlight their parent list in the sidebar.
    const activeNav: ViewId = state.view === 'matchDetail' ? 'matches' : state.view;
    const nav = NAV.flatMap((section) => [
      h('div', { class: 'nav-group' }, section.group),
      ...section.items.map((item) =>
        h('button', {
          class: `nav-item${item.id === activeNav ? ' is-active' : ''}`,
          on: { click: () => store.setView(item.id) },
        },
          h('span', { class: 'nav-icon' }, item.icon),
          item.label,
          item.id === 'review' && pendingReviews > 0 ? h('span', { class: 'nav-badge' }, String(pendingReviews)) : null,
        ),
      ),
    ]);

    render(this.sidebarHost, account, ...nav, this.sessionCard(state));
  }

  private sessionCard(state: AppState): HTMLElement {
    const s = state.data?.session;
    const body = s && s.games
      ? h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '5px' } },
          h('span', { class: 'mono', style: { fontSize: '17px', fontWeight: '600' } }, `${s.wins}–${s.losses}`),
          h('span', { style: { fontSize: '11px', color: 'var(--win-text)' } }, `${signed(s.wins - s.losses)} net`),
          h('span', { class: 'u-muted', style: { fontSize: '11px' } }, `· ${pct(s.winrate)}`),
        )
      : h('div', { class: 'u-muted', style: { fontSize: '11.5px', marginTop: '4px' } }, 'No games today yet');
    return h('div', { class: 'sidebar-session' }, h('div', { class: 'nav-group' }, "Today's session"), body);
  }

  /** The status-bar connection indicator: dot color + short truthful label. */
  private renderGepIndicator(): void {
    const s = getGepStatus();
    const state = s && s.sensor === 'gep' ? s.state : 'no-game';
    this.gepDot.className = `status-dot is-${state}`;
    this.gepLabel.textContent = gepLabelText(s);
  }

  /** Click-for-details: live-updating popover with the feed's vitals. */
  private openGepPopover(anchor: HTMLElement): void {
    const body = h('div', { class: 'gep-popover' });
    const paint = (): void => {
      const s = getGepStatus();
      const rows: Array<[string, string]> = s
        ? [
            ['State', gepLabelText(s)],
            ['Last event', s.lastEventAt ? relTime(s.lastEventAt) : '—'],
            ['Events this session', String(s.eventsThisSession)],
            ['Match in progress', s.matchInProgress ? 'Yes' : 'No'],
            ['Feed attached', s.attachedAt ? relTime(s.attachedAt) : 'Not attached'],
            ...(s.lastError ? [['Last error', s.lastError] as [string, string]] : []),
          ]
        : [['State', 'Unknown — no status received yet']];
      render(body,
        h('div', { class: 'gep-popover-title' }, 'Game feed'),
        ...rows.map(([k, v]) =>
          h('div', { class: 'gep-popover-row' },
            h('span', { class: 'u-muted' }, k),
            h('span', { class: 'mono' }, v),
          ),
        ),
      );
    };
    paint();
    const unsub = subscribeGepStatus(paint);
    const tick = setInterval(paint, 10_000); // keep relative times honest
    openPopover(anchor, () => body, {
      onClose: () => {
        unsub();
        clearInterval(tick);
      },
    });
  }

  /** Ctrl+K — palette (guarded against double-open via the mounted panel). */
  private openPalette(): void {
    if (!store.get().data || document.querySelector('.palette')) return;
    const ctx = this.context();
    openPalette(ctx, {
      nav: NAV.flatMap((g) => g.items.map((i) => ({ id: i.id, label: i.label }))),
      actions: [
        { label: 'Log match', hint: 'record a game manually', run: () => openLogMatch(ctx) },
        { label: 'Keyboard shortcuts', hint: '?', run: () => this.openCheatsheet() },
        { label: 'Replay the intro tour', run: () => openOnboarding(store.get().data?.isSample ?? false) },
      ],
    });
  }

  private openCheatsheet(): void {
    openModal(() =>
      h('div', { class: 'cheatsheet' },
        h('h3', { style: { fontSize: '15px', marginBottom: '12px' } }, 'Keyboard shortcuts'),
        ...shortcutGroups().map((g) =>
          h('div', { style: { marginBottom: '12px' } },
            h('div', { class: 'nav-group', style: { padding: '0 0 4px' } }, g.group),
            ...g.items.map((s) =>
              h('div', { class: 'cheatsheet-row' },
                h('span', { class: 'kbd' }, comboLabel(s.combo)),
                h('span', { class: 'u-muted', style: { fontSize: '12px' } }, s.description),
              ),
            ),
          ),
        ),
      ),
    );
  }

  /** Step through the filtered match list from a detail page (←older / →newer). */
  private stepMatch(direction: 1 | -1): void {
    const state = store.get();
    const matches = state.data?.matches ?? [];
    const idx = matches.findIndex((m) => m.matchId === state.params.matchId);
    const next = matches[idx + direction];
    if (idx >= 0 && next) store.setView('matchDetail', { matchId: next.matchId });
  }

  private bindGlobals(): void {
    initShortcuts();
    registerShortcut({
      combo: 'ctrl+k', description: 'Command palette — search, actions, log a match', group: 'Global',
      allowInInput: true, run: () => this.openPalette(),
    });
    registerShortcut({ combo: '?', description: 'This cheatsheet', group: 'Global', run: () => this.openCheatsheet() });
    NAV.flatMap((g) => g.items).forEach((item, i) => {
      if (i >= 9) return;
      registerShortcut({
        combo: `ctrl+${i + 1}`, description: `Go to ${item.label}`, group: 'Navigate',
        run: () => store.setView(item.id),
      });
    });
    registerShortcut({
      combo: 'escape', description: 'Back to Matches (from a match detail)', group: 'Navigate',
      when: () => store.get().view === 'matchDetail', run: () => store.setView('matches'),
    });
    registerShortcut({
      combo: 'arrowleft', description: 'Older match (on a match detail)', group: 'Navigate',
      when: () => store.get().view === 'matchDetail', run: () => this.stepMatch(1),
    });
    registerShortcut({
      combo: 'arrowright', description: 'Newer match (on a match detail)', group: 'Navigate',
      when: () => store.get().view === 'matchDetail', run: () => this.stepMatch(-1),
    });
    // Window focus re-pulls newly tracked games (stale-while-revalidate).
    window.addEventListener('focus', () => void store.refresh());
  }
}

function routeKey(view: ViewId, matchId?: string): string {
  return matchId ? `${view}:${matchId}` : view;
}

function comboLabel(combo: string): string {
  return combo.split('+').map((part) =>
    part === 'ctrl' ? 'Ctrl' : part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1),
  ).join(' ');
}

/** The short, never-lying label next to the status dot. */
function gepLabelText(s: GepStatusPayload | null): string {
  if (!s) return 'Feed status unknown';
  if (s.sensor !== 'gep') return 'No live feed';
  switch (s.state) {
    case 'no-game': return 'No game';
    case 'connected': return 'Connected — waiting for events';
    case 'live': return 'Receiving data';
    case 'stale': {
      const secs = s.lastEventAt ? Math.round((Date.now() - s.lastEventAt) / 1000) : 0;
      return `⚠ No data for ${secs}s`;
    }
  }
}
