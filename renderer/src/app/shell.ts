/**
 * The application shell: frameless title bar, sidebar navigation, the content
 * host, and the status bar. It owns the view registry and re-renders the active
 * view whenever the store changes. Views stay dumb — they receive a snapshot and
 * a small context of callbacks.
 */
import { h, render } from '../dom';
import type { AppState, ViewId } from '../store';
import type { GepStatusPayload } from '../../../src/shared/contract';
import { store } from '../store';
import { bridge } from '../bridge';
import { getGepStatus, initGepStatus, subscribeGepStatus } from '../gepStatus';
import { openPopover } from '../components/popover';
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
import { filterBar, type ViewContext, type ViewRender } from '../views/view';
import { gradedThisSession, migrateLegacyReviews } from '../reviews';
import { openLogMatch } from './log-match';
import { openOnboarding, shouldOnboard } from './onboarding';

// matchDetail is a parameterized view: registered here (routable) but not in
// NAV — the sidebar keeps Matches highlighted while it is active.
const VIEWS: Record<ViewId, ViewRender> = { overview, review, matches, matchDetail, maps, heroes, focus, mental, trends, targets, notion, logs: logViewer };

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
];

export class App {
  private readonly sidebarHost = h('aside', { class: 'sidebar' });
  private readonly filterHost = h('div', { class: 'filterbar-wrap hidden' });
  private readonly contentHost = h('main', { class: 'content' });
  private readonly statusText = h('span', null, 'Loading…');
  private readonly demoBadge = h('span', { class: 'badge badge--demo hidden' }, 'Demo data');
  private readonly gepDot = h('span', { class: 'status-dot' });
  private readonly gepLabel = h('span', { class: 'gep-label' }, '');

  constructor(mount: HTMLElement) {
    render(mount, this.build());
    store.subscribe((state) => this.onState(state));
    this.bindGlobals();
    initGepStatus();
    subscribeGepStatus(() => this.renderGepIndicator());
    this.renderGepIndicator();
    void store.refresh();
    if (shouldOnboard()) openOnboarding();
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
        this.statusText, this.demoBadge,
        h('button', {
          class: 'statusbar-link',
          style: { marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-2)', cursor: 'pointer', font: 'inherit', fontSize: '11.5px' },
          title: 'Replay the intro tour',
          on: { click: () => openOnboarding() },
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
        h('button', { class: 'titlebar-search', on: { click: () => openLogMatch(this.context()) } },
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

  private onState(state: AppState): void {
    this.renderSidebar(state);
    this.renderFilters(state);
    this.renderContent(state);
    this.statusText.textContent = state.status;
    this.demoBadge.classList.toggle('hidden', !state.data?.isSample);
    // One-time legacy-review migration, only against real history (demo-mode
    // match ids don't exist in the store, so importing there would drop data).
    if (!this.migrated && state.data && !state.data.isSample) {
      this.migrated = true;
      void migrateLegacyReviews().then((imported) => {
        if (imported) void store.refresh();
      });
    }
  }

  /** The one global filter bar — persistent above every screen, unified look. */
  private renderFilters(state: AppState): void {
    this.filterHost.classList.toggle('hidden', !state.data);
    if (!state.data) return;
    render(this.filterHost, filterBar(state.data, (patch) => store.setFilters(patch)));
  }

  private renderContent(state: AppState): void {
    if (!state.data) {
      render(this.contentHost, h('div', { class: 'view' }, h('div', { class: 'card' }, h('div', { class: 'hint' }, 'Loading dashboard…'))));
      return;
    }
    render(this.contentHost, VIEWS[state.view](this.context()));
  }

  private renderSidebar(state: AppState): void {
    const d = state.data;
    const account = h('div', { class: 'sidebar-account' },
      h('div', { class: 'avatar' }, (d?.greetingName ?? 'V').charAt(0).toUpperCase()),
      h('div', { class: 'row-main' },
        h('div', { class: 'account-name' }, d?.greetingName ?? 'Vantage'),
        h('div', { class: 'account-sub' }, d ? rankLabel(d.progression.tier, d.progression.division) : '—'),
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

  private bindGlobals(): void {
    // Ctrl+K opens quick log (Windows-only app). Window focus re-pulls newly tracked games.
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (store.get().data) openLogMatch(this.context());
      }
    });
    window.addEventListener('focus', () => void store.refresh());
  }
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
