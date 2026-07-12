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
import { isUpwardAction, nextScrollTop, resolveScroller, type ScrollAction } from '../scrollNav';
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
import { readiness } from '../views/readiness';
import { targets } from '../views/targets';
import { notion } from '../views/notion';
import { review } from '../views/review';
import { logViewer, pauseFollow } from '../views/logViewer';
import { settings } from '../views/settings';
import { about } from '../views/about';
import { filterBar, type ViewContext, type ViewRender } from '../views/view';
import { gradedThisSession, migrateLegacyReviews } from '../reviews';
import { openLogMatch } from './log-match';
import { openPalette } from './palette';
import { openOnboarding, shouldOnboard } from './onboarding';
import { openFirstRunPrompt } from './firstRunPrompt';
import { openDataLocationPrompt } from './dataLocationPrompt';

// matchDetail is a parameterized view: registered here (routable) but not in
// NAV — the sidebar keeps Matches highlighted while it is active.
const VIEWS: Record<ViewId, ViewRender> = { overview, review, matches, matchDetail, maps, heroes, focus, mental, trends, readiness, targets, notion, logs: logViewer, settings, about };

/** Views that suppress the global filter bar — their data is account-agnostic
 *  (readiness tracks the player, not a per-account selection) or otherwise
 *  unaffected by it, so showing the bar would imply a control that does nothing. */
const FILTERLESS_VIEWS: ReadonlySet<ViewId> = new Set(['readiness', 'about']);

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
      { id: 'readiness', label: 'Readiness', icon: '◆' },
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
      { id: 'about', label: 'About', icon: 'ⓘ' },
    ],
  },
];

export class App {
  private readonly sidebarHost = h('aside', { class: 'sidebar' });
  // Persistent sidebar nodes. The sidebar is built once and then mutated in
  // place, so a background refresh (notably the window-focus refetch, which
  // patches `refreshing` synchronously) can never tear down a nav button
  // between its mousedown and mouseup. A rebuilt button mid-click swallows the
  // click — that was the "have to click a screen twice to switch it" bug.
  private readonly avatarEl = h('div', { class: 'avatar' });
  private readonly accountNameEl = h('div', { class: 'account-name' });
  private readonly accountSubEl = h('div', { class: 'account-sub' });
  private readonly accountChip = h('div', {
    class: 'sidebar-account',
    role: 'button',
    tabindex: '0',
    title: 'Switch account · manage accounts',
    on: {
      click: (e: Event) => { const d = store.get().data; if (d) this.openAccountSwitcher(e.currentTarget as HTMLElement, d); },
      keydown: (e: Event) => {
        const key = (e as KeyboardEvent).key;
        const d = store.get().data;
        if ((key === 'Enter' || key === ' ') && d) { e.preventDefault(); this.openAccountSwitcher(e.currentTarget as HTMLElement, d); }
      },
    },
  },
    this.avatarEl,
    h('div', { class: 'row-main' }, this.accountNameEl, this.accountSubEl),
    h('span', { class: 'u-dim', style: { fontSize: '11px' } }, '▾'),
  );
  private readonly navButtons = new Map<ViewId, HTMLButtonElement>();
  private readonly sessionBody = h('div');
  private readonly sessionCardEl = h('div', { class: 'sidebar-session' },
    h('div', { class: 'nav-group' }, 'Current session'),
    this.sessionBody,
  );
  private sidebarBuilt = false;
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
  private readonly devBadge = h('span', {
    class: 'badge badge--dev hidden',
    title: 'Running in ow-electron Dev Mode — live GEP data via your Overwolf dev key',
  }, 'Dev mode');
  private readonly gepDot = h('span', { class: 'status-dot' });
  private readonly gepLabel = h('span', { class: 'gep-label' }, '');
  /** What the content host currently shows — re-render only when this changes. */
  private lastRendered: { data: DashboardData; view: ViewId; matchId?: string; highlight?: string; day?: string; flag?: string; prefillName?: string; epoch: number } | null = null;
  /** The snapshot the filter bar was last built for. Background refreshes patch
   *  `refreshing`/`status` without changing `data`, so re-rendering the bar then
   *  would tear down its live controls mid-click and swallow the click — the
   *  same class of bug as the sidebar rebuild. Only rebuild on a new snapshot. */
  private lastFilterData: DashboardData | null = null;
  /** True while a pointer is held down inside the content host. A same-route
   *  data refresh that lands mid-press is deferred (see {@link renderContent})
   *  rather than tearing the pressed element out from under its click — the same
   *  class of bug as the sidebar/filter-bar rebuilds, but async and rarer. */
  private contentPressed = false;
  /** A content refresh held back during a press; flushed once the press ends. */
  private pendingContentRender = false;
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
    // The "Dev Mode" badge reflects a build-constant (unpackaged + dev creds in
    // the env at start), so fetch it once rather than subscribing to live status.
    void bridge.getAppInfo().then((info) => this.devBadge.classList.toggle('hidden', !info.devMode));
    // Live logging: a just-tracked match refetches the open dashboard (composes
    // with the focus-refresh below for pushes dropped while the window was closed).
    bridge.onGameLogged(() => void store.refresh());
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
        this.statusLabel, this.busySpin, this.staleLink, this.demoBadge, this.devBadge,
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

  /**
   * Once, after the first real snapshot: ask where to keep data (only on a
   * fresh install — `needsFirstRunChoice`), then the demo question (if never
   * asked), then the tour. The data-location step runs first because it must
   * complete before meaningful data is written (spec C1/C4).
   */
  private maybeFirstRun(state: AppState): void {
    if (this.firstRunHandled || !state.data) return;
    this.firstRunHandled = true;
    const openTour = (): void => {
      if (shouldOnboard()) openOnboarding(store.get().data?.isSample ?? false);
    };
    const openDemoPrompt = (): void => {
      if (state.data!.demoPreference === 'unset') openFirstRunPrompt(openTour);
      else openTour();
    };
    void bridge.getDataLocation().then((loc) => {
      if (loc.needsFirstRunChoice) openDataLocationPrompt(openDemoPrompt);
      else openDemoPrompt();
    });
  }

  /** The one global filter bar — persistent above every screen, unified look,
   *  except views in {@link FILTERLESS_VIEWS} whose data isn't scoped by it. */
  private renderFilters(state: AppState): void {
    const hidden = !state.data || FILTERLESS_VIEWS.has(state.view);
    this.filterHost.classList.toggle('hidden', hidden);
    if (!state.data || hidden) return;
    // Hidden views keep their built bar in the DOM (just CSS-hidden), so a
    // return to the same snapshot reuses it rather than rebuilding.
    if (this.lastFilterData === state.data) return;
    render(this.filterHost, filterBar(state.data, (patch) => store.setFilters(patch)));
    this.lastFilterData = state.data;
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
      day: state.params.day,
      flag: state.params.flag,
      prefillName: state.params.prefillName,
      epoch: state.renderEpoch,
    };
    const last = this.lastRendered;
    if (last && last.data === key.data && last.view === key.view
      && last.matchId === key.matchId && last.highlight === key.highlight
      && last.day === key.day && last.flag === key.flag && last.prefillName === key.prefillName
      && last.epoch === key.epoch) return;
    // Having passed the equality check with every non-`data` field equal means
    // only the snapshot changed — a background refresh. If the user is pressing
    // inside the content host, defer it: replacing the pressed element mid-click
    // makes the browser drop the click (down/up must share a target), which is
    // how an in-content navigation click gets swallowed. Flushed on release
    // (see bindGlobals). Route/epoch changes fall through and render at once.
    if (this.contentPressed && last && last.view === key.view && last.matchId === key.matchId
      && last.highlight === key.highlight && last.day === key.day && last.flag === key.flag
      && last.prefillName === key.prefillName && last.epoch === key.epoch) {
      this.pendingContentRender = true;
      return;
    }
    // Remember where the outgoing route was scrolled; restore it when a
    // navigation (not a data refresh on the same route) returns here.
    if (last) this.scrollMemory.set(routeKey(last.view, last.matchId), this.contentHost.scrollTop);
    const navigated = !last || last.view !== key.view || last.matchId !== key.matchId;
    // A same-route re-render (e.g. a master-data edit round-tripping through
    // store.refresh()) replaces the DOM. That resets scrollTop to 0 and, because
    // a brand-new `.view` is mounted, replays the `rise-in` entry animation —
    // the page visibly slides/fades back in as if freshly entered. Capture the
    // scroll first, then restore it and cancel the entry animation so an in-place
    // refresh is seamless. Real navigation keeps both the animation and the
    // per-route scroll memory.
    const priorScroll = this.contentHost.scrollTop;
    render(this.contentHost, VIEWS[state.view](this.context()));
    this.lastRendered = key;
    if (navigated) {
      this.contentHost.scrollTop = this.scrollMemory.get(routeKey(key.view, key.matchId)) ?? 0;
    } else {
      const view = this.contentHost.firstElementChild as HTMLElement | null;
      if (view) view.style.animation = 'none';
      this.contentHost.scrollTop = priorScroll;
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
    if (!this.sidebarBuilt) this.buildSidebar();
    const d = state.data;
    // The chip doubles as the account switcher: it shows the active account
    // filter's name, or "All accounts" literally when that's the active scope
    // (never silently substituting the most-played account) — and its rank.
    const displayName = d ? (d.filters.account !== 'all' ? d.filters.account : 'All accounts') : 'Vantage';
    this.avatarEl.textContent = displayName.charAt(0).toUpperCase();
    this.accountNameEl.textContent = displayName;
    this.accountSubEl.textContent = d ? rankLine(d) : '—';

    // Saving a review doesn't refetch, so subtract the games graded since the
    // last snapshot (only those the snapshot still counts as pending).
    const gradedOverlap = d ? d.reviewInbox.filter((m) => gradedThisSession.has(m.matchId)).length : 0;
    const pendingReviews = d ? Math.max(0, d.pendingReviews - gradedOverlap) : 0;
    // Parameterized views highlight their parent list in the sidebar.
    const activeNav: ViewId = state.view === 'matchDetail' ? 'matches' : state.view;
    for (const [id, btn] of this.navButtons) btn.classList.toggle('is-active', id === activeNav);
    this.updateReviewBadge(pendingReviews);

    render(this.sessionBody, this.sessionSummary(state));
  }

  /**
   * Build the sidebar skeleton once — account chip, nav buttons, session card —
   * as stable DOM nodes. Everything that changes per snapshot is mutated in
   * place afterwards; the nodes themselves are never recreated, so a background
   * refresh can't destroy a nav button under an in-progress click.
   */
  private buildSidebar(): void {
    const children: Array<Node> = [this.accountChip];
    for (const section of NAV) {
      children.push(h('div', { class: 'nav-group' }, section.group));
      for (const item of section.items) {
        const btn = h('button', {
          class: 'nav-item',
          on: { click: () => store.setView(item.id) },
        },
          h('span', { class: 'nav-icon' }, item.icon),
          item.label,
        );
        this.navButtons.set(item.id, btn);
        children.push(btn);
      }
    }
    children.push(this.sessionCardEl);
    render(this.sidebarHost, ...children);
    this.sidebarBuilt = true;
  }

  /** Reflect the pending-review count on the Review nav item in place, so the
   *  button (a live click target) is never rebuilt. */
  private updateReviewBadge(pending: number): void {
    const btn = this.navButtons.get('review');
    if (!btn) return;
    const existing = btn.querySelector('.nav-badge');
    if (pending > 0) {
      if (existing) existing.textContent = String(pending);
      else btn.append(h('span', { class: 'nav-badge' }, String(pending)));
    } else {
      existing?.remove();
    }
  }

  /** The top-left chip's account switcher: scope the dashboard to an account (or all), or jump to account management. */
  private openAccountSwitcher(anchor: HTMLElement, d: DashboardData): void {
    const current = d.filters.account;
    openPopover(anchor, (close) => {
      const item = (label: string, active: boolean, run: () => void): HTMLElement =>
        h('button', { class: `acct-menu-item${active ? ' is-active' : ''}`, on: { click: () => { run(); close(); } } },
          h('span', null, label),
          active ? h('span', { class: 'acct-menu-check' }, '✓') : null,
        );
      return h('div', { class: 'acct-menu' },
        item('All accounts', current === 'all', () => store.setFilters({ account: 'all' })),
        ...d.options.accounts.map((a) => item(a, current === a, () => store.setFilters({ account: a }))),
        h('div', { class: 'acct-menu-sep' }),
        item('Manage accounts →', false, () => store.setView('settings')),
      );
    });
  }

  /** The "Current session" body, re-rendered into the persistent session card. */
  private sessionSummary(state: AppState): HTMLElement {
    const s = state.data?.session;
    return s && s.games
      ? h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '5px' } },
          h('span', { class: 'mono', style: { fontSize: '17px', fontWeight: '600' } }, `${s.wins}–${s.losses}`),
          h('span', { style: { fontSize: '11px', color: 'var(--win-text)' } }, `${signed(s.wins - s.losses)} net`),
          h('span', { class: 'u-muted', style: { fontSize: '11px' } }, `· ${pct(s.winrate)}`),
        )
      : h('div', { class: 'u-muted', style: { fontSize: '11.5px', marginTop: '4px' } }, 'No current session yet');
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
          h('div', null,
            h('div', { class: 'nav-group' }, g.group),
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

  /**
   * Ctrl+Home/End & PageUp/Down — jump/page the ACTIVE view's real scroller.
   * Resolved per keypress (Heroes' `.table-wrap` and Logs' `.log-lines` own
   * their scrolling; everything else scrolls the content host) and assigned
   * directly — the same idiom as renderContent's scroll restore, so per-route
   * scroll memory keeps reading truthful positions.
   *
   * An upward jump on the Logs tail pauses live-follow first — otherwise the
   * next streamed entry immediately re-pins `.log-lines` to the bottom,
   * silently undoing the Ctrl+Home/PageUp the user just pressed.
   */
  private scrollContent(action: ScrollAction): void {
    const el = resolveScroller(this.contentHost);
    if (isUpwardAction(action) && el.classList.contains('log-lines')) pauseFollow();
    el.scrollTop = nextScrollTop(action, el);
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
    // List/scroll navigation (#72). No allowInInput, so the dispatcher's
    // isTyping/overlayOpen guards keep caret Home/End and open modals intact.
    // Plain Home/End stay unbound on purpose — only the ctrl variants + paging.
    registerShortcut({
      combo: 'ctrl+home', description: 'Jump to the top of the current view', group: 'Navigate',
      run: () => this.scrollContent('top'),
    });
    registerShortcut({
      combo: 'ctrl+end', description: 'Jump to the bottom of the current view', group: 'Navigate',
      run: () => this.scrollContent('bottom'),
    });
    registerShortcut({
      combo: 'pageup', description: 'Scroll up one page', group: 'Navigate',
      run: () => this.scrollContent('page-up'),
    });
    registerShortcut({
      combo: 'pagedown', description: 'Scroll down one page', group: 'Navigate',
      run: () => this.scrollContent('page-down'),
    });
    // Window focus re-pulls newly tracked games (stale-while-revalidate).
    window.addEventListener('focus', () => void store.refresh());
    // Track a press inside the content host so renderContent can hold back a
    // refresh that would otherwise tear the pressed element out mid-click. All
    // three use the capture phase so a child's stopPropagation can't leave the
    // flag stuck. Release is on window (the pointer may lift outside content).
    this.contentHost.addEventListener('pointerdown', () => { this.contentPressed = true; }, true);
    const releasePress = (): void => {
      if (!this.contentPressed) return;
      this.contentPressed = false;
      if (!this.pendingContentRender) return;
      this.pendingContentRender = false;
      // A macrotask runs after the native click that follows pointerup, so this
      // never removes the element the click still needs. renderContent re-reads
      // current state — a navigation click that already re-rendered dedupes it.
      setTimeout(() => this.renderContent(store.get()), 0);
    };
    window.addEventListener('pointerup', releasePress, true);
    window.addEventListener('pointercancel', releasePress, true);
    // Safety net: if the window loses focus mid-press (app switch, focus theft),
    // a pointerup might never reach us. Clearing the flag on blur guarantees a
    // same-route refresh can never be held back indefinitely — and the focus
    // handler above refetches on return anyway.
    window.addEventListener('blur', releasePress);
  }
}

function routeKey(view: ViewId, matchId?: string): string {
  return matchId ? `${view}:${matchId}` : view;
}

/**
 * The sidebar rank line: the user's real anchored rank when they've set one,
 * otherwise the winrate-derived heuristic estimate. Showing the heuristic while
 * an anchor exists was the "says Platinum 1 even though I set my rank" bug.
 */
function rankLine(d: DashboardData): string {
  const r = d.primaryRank;
  if (r) {
    if (r.needsReanchor) return `${rankLabel(r.tier, r.division)} · set %`;
    // A protected rank carries a negative %; the shield keeps that from reading as broken.
    const shield = r.protected ? ' 🛡' : '';
    return `${rankLabel(r.tier, r.division)} · ${Math.round(r.progressPct)}%${shield}`;
  }
  return `${rankLabel(d.progression.tier, d.progression.division)} · ${Math.round(d.progression.progressPct)}%`;
}

/** Keys whose cheatsheet label needs more than first-letter capitalization. */
const KEY_LABELS: Record<string, string> = { pageup: 'PageUp', pagedown: 'PageDown' };

function comboLabel(combo: string): string {
  return combo.split('+').map((part) =>
    part === 'ctrl' ? 'Ctrl'
      : KEY_LABELS[part] ?? (part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)),
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
