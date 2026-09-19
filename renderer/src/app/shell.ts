/**
 * The application shell: frameless title bar, sidebar navigation, the content
 * host, and the status bar. It owns the view registry and re-renders the active
 * view whenever the store changes. Views stay dumb — they receive a snapshot and
 * a small context of callbacks.
 */
import { h, render } from '../dom';
import type { AppState, ViewId } from '../store';
import type { AppUiSettings, DashboardData, GameLoggedPayload, GepStatusPayload, LogLevel, Role } from '../../../src/shared/contract';
import type { BreakReminderSettings } from '../../../src/core/breakReminder';
import { shouldAutoSwitch } from '../../../src/core/accountsManage';
import { demoTransition } from '../../../src/core/demoPreference';
import { DETAIL_PARENT, statusText, store } from '../store';
import { bridge } from '../bridge';
import { getGepStatus, initGepStatus, subscribeGepStatus } from '../gepStatus';
import { getLiveMatch, initLiveMatch, subscribeLiveMatch } from '../liveMatch';
import { getDevModeAuthStatus, initDevModeAuthStatus, subscribeDevModeAuthStatus } from '../devModeAuthStatus';
import { classifyDevModeBadge } from '../../../src/core/devMode';
import { initShortcuts, overlayCapturing, registerShortcut, shortcutGroups } from '../shortcuts';
import { isUpwardAction, nextScrollTop, resolveScroller, type ScrollAction } from '../scrollNav';
import { openPopover } from '../components/popover';
import { openModal } from '../components/overlay';
import { mountToastHost, toast } from '../components/toast';
import { skeletonView } from '../components/skeleton';
import { button } from '../components/primitives';
import { clickableRow } from '../components/clickableRow';
import { matchClock, pct, relTime, roleLabel, signed, streakText } from '../format';
import { getWinrateScheme, setWinrateScheme } from '../theme';
import { WINRATE_SCHEME_OPTIONS } from '../winrateScheme';
import { accountPlacementNote, rankParts } from '../../../src/core/rankDisplay';
import { classifyGameType } from '../../../src/core/matchFilter';
import { RECENT_REVIEW_WINDOW_MS } from '../../../src/core/dashboardData';
import { maybeOfferPlacements } from './placementOffer';
import { roleStatus } from '../roleStatus';
import { sidebarChip } from '../sidebarChip';
import { overview } from '../views/overview';
import { live } from '../views/live';
import { matches } from '../views/matches';
import { matchDetail } from '../views/matchDetail';
import { players } from '../views/players';
import { playerHistory } from '../views/playerHistory';
import { maps } from '../views/maps';
import { heroes } from '../views/heroes';
import { focus } from '../views/focus';
import { mental } from '../views/mental';
import { trends } from '../views/trends';
import { readiness } from '../views/readiness';
import { targets } from '../views/targets';
import { targetDetail } from '../views/targets/detail';
import { notion } from '../views/notion';
import { review } from '../views/review';
import { ensureFeed as ensureLogFeed, logViewer, pauseFollow, subscribeLogStats, type LogStats } from '../views/logViewer';
import { settings } from '../views/settings';
import { about } from '../views/about';
import { faq } from '../views/faq';
import { filterBar, filterBarReason, type ViewContext, type ViewRender } from '../views/view';
import { gradedThisSession, migrateLegacyReviews } from '../reviews';
import { prefs } from '../prefs';
import { openLogMatch } from './log-match';
import { openPalette } from './palette';
import { openOnboarding, shouldOnboard } from './onboarding';
import { openFirstRunPrompt } from './firstRunPrompt';
import { openDataLocationPrompt } from './dataLocationPrompt';
import { openWhatsNewPrompt } from './whatsNewPrompt';
import { changelogSince, shouldShowWhatsNew } from '../../../src/core/whatsNew';
import { CHANGELOG } from '../generated/changelog';

// matchDetail, playerHistory and targetDetail are parameterized views: registered
// here (routable) but not in NAV — the sidebar keeps their parent list highlighted.
const VIEWS: Record<ViewId, ViewRender> = { overview, live, review, matches, matchDetail, players, playerHistory, targetDetail, maps, heroes, focus, mental, trends, readiness, targets, notion, logs: logViewer, settings, about, faq };

/** Views that suppress the global filter bar — their data is account-agnostic
 *  (readiness tracks the player, not a per-account selection) or otherwise
 *  unaffected by it, so showing the bar would imply a control that does nothing.
 *  playerHistory is a cross-history drill-down over the full local index — the
 *  all-time record under Players, whose own list IS filter-scoped. faq
 *  is static help copy, unaffected by any filter. */
const FILTERLESS_VIEWS: ReadonlySet<ViewId> = new Set(['readiness', 'about', 'playerHistory', 'faq', 'live']);

/** Why each {@link FILTERLESS_VIEWS} screen doesn't take the global filters —
 *  shown in the bar's own place (K5) instead of just hiding it, so the answer
 *  to "where did the filters go?" doesn't cost a trip to a different screen. */
const FILTERLESS_REASON: Partial<Record<ViewId, string>> = {
  readiness: 'Readiness reads your whole history, every account — the verdict would be wrong scoped to a slice of it.',
  about: 'Nothing here is match data.',
  playerHistory: "This is that player's complete all-time record — the filters never touch it.",
  faq: 'Nothing here is match data.',
  live: 'Live shows the match in progress, not a filtered range.',
};

/** Display order for the account switcher's per-role expansion. */
const SWITCHER_ROLES: Role[] = ['tank', 'damage', 'support', 'openQ'];

interface NavItem {
  id: ViewId;
  label: string;
  /** A text glyph (rendered as-is) or a prebuilt inline-SVG node (appended). */
  icon: string | Node;
  /**
   * The digit this screen answers to as `Ctrl+<key>` — a property OF the screen,
   * not of its position. Shortcuts used to be handed out by sidebar order and
   * capped at nine, so inserting an item renumbered everything below it and
   * silently pushed the tenth off the end entirely. Omit it and the screen has
   * no digit shortcut (the palette still reaches it).
   *
   * `0` is the tenth key on the row, not a zeroth screen. There is no
   * application menu, so Electron registers no zoom accelerator to collide with
   * it — the browser preview is the one place the host may still steal it.
   */
  key?: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The Targets nav glyph: a pennant flying from a pole (a goal flag), drawn inline
 * in `currentColor` so it tracks the nav item's colour and active state — the same
 * technique as {@link ../components/roleIcon}. Deliberately distinct from Review's
 * wavy `⚑` text glyph so the two never read as the same icon.
 */
function goalFlagIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.setAttribute('aria-hidden', 'true');
  const pole = document.createElementNS(SVG_NS, 'line');
  for (const [k, v] of Object.entries({ x1: 6, y1: 3, x2: 6, y2: 21, stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' })) {
    pole.setAttribute(k, String(v));
  }
  const pennant = document.createElementNS(SVG_NS, 'path');
  pennant.setAttribute('d', 'M6 4l11 3.2L6 11z');
  pennant.setAttribute('fill', 'currentColor');
  svg.appendChild(pole);
  svg.appendChild(pennant);
  return svg;
}
/**
 * The Players nav glyph: two overlapping head-and-shoulders marks. Drawn inline
 * in `currentColor` like {@link goalFlagIcon} rather than picked from the text
 * glyph set — every unused geometric candidate (⊚, ⊛, ◍) either collides with an
 * existing icon at 15px or is not guaranteed in the bundled font.
 */
function peopleIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.setAttribute('aria-hidden', 'true');
  const back = document.createElementNS(SVG_NS, 'path');
  back.setAttribute('d', 'M16.5 11a3 3 0 100-6 3 3 0 000 6zm0 1.6c-1 0-1.9.2-2.6.5 1.2.9 2 2.2 2.2 3.9H22v-1c0-2-2.5-3.4-5.5-3.4z');
  back.setAttribute('fill', 'currentColor');
  back.setAttribute('opacity', '0.55');
  const front = document.createElementNS(SVG_NS, 'path');
  front.setAttribute('d', 'M9 12a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm0 1.8c-3.3 0-7 1.7-7 3.9V19h14v-1.3c0-2.2-3.7-3.9-7-3.9z');
  front.setAttribute('fill', 'currentColor');
  svg.appendChild(back);
  svg.appendChild(front);
  return svg;
}

// Regrouped by moment (K6) rather than the old Workspace/Insights/App split,
// which mixed screens by "kind of thing" instead of when you'd reach for
// them — Focus and Targets are one workflow but sat three items apart under
// Insights, Readiness sat under Insights despite rendering without the filter
// bar, and Live sat between Overview and Review despite being neither.
const NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: 'Now',
    items: [
      // Digits are pinned per screen (see NavItem.key), so this list can be
      // reordered or added to without moving anyone's muscle memory. Players
      // takes Ctrl+0 — the tenth key — rather than displacing Maps..Trends.
      { id: 'overview', label: 'Overview', icon: '◈', key: 1 },
      { id: 'live', label: 'Live', icon: '◉', key: 2 },
    ],
  },
  {
    group: 'After the session',
    items: [
      { id: 'review', label: 'Review', icon: '⚑', key: 3 },
      { id: 'matches', label: 'Matches', icon: '▤', key: 4 },
      { id: 'players', label: 'Players', icon: peopleIcon(), key: 0 },
    ],
  },
  {
    // Focus kept as its own screen next to Targets rather than folded into
    // it — the spec's "Overview teases → Focus prioritizes → Targets
    // commits" hierarchy needs Focus to still be reachable on its own.
    group: 'Improve',
    items: [
      { id: 'focus', label: 'Focus', icon: '◎', key: 7 },
      { id: 'targets', label: 'Targets', icon: goalFlagIcon() },
      { id: 'mental', label: 'Mental', icon: '◐', key: 8 },
      { id: 'readiness', label: 'Readiness', icon: '◆' },
    ],
  },
  {
    group: 'Reference',
    items: [
      { id: 'heroes', label: 'Heroes', icon: '◍', key: 6 },
      { id: 'maps', label: 'Maps', icon: '◇', key: 5 },
      { id: 'trends', label: 'Trends', icon: '◔', key: 9 },
    ],
  },
  {
    // Data and App were separate groups until the nav outgrew the sidebar. They
    // were a thin distinction to begin with — "your data lives here" vs "the app
    // lives here" is not a split anyone navigates by — and merging them buys back
    // a whole group header without hiding anything.
    group: 'App',
    items: [
      { id: 'notion', label: 'Notion sync', icon: '⟳' },
      { id: 'logs', label: 'Logs', icon: '≡' },
      { id: 'settings', label: 'Settings', icon: '⚙' },
      { id: 'about', label: 'About', icon: 'ⓘ' },
      { id: 'faq', label: 'FAQ', icon: '?' },
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
  /** Collapse/expand the rail (Ctrl B does the same). A full-width bar of its
   *  own, directly below the account chip, so it reads as a clear control
   *  rather than a small corner glyph — see .sidebar-collapse in app.css.
   *  Persistent like every other sidebar node — applyCollapsed mutates the
   *  icon/label spans in place, the button is never rebuilt per state. */
  private readonly collapseIcon = h('span', { class: 'sidebar-collapse-icon' }, '«');
  private readonly collapseLabel = h('span', { class: 'sidebar-collapse-label' }, 'Collapse');
  private readonly collapseToggle = h('button', {
    class: 'sidebar-collapse',
    on: { click: () => this.toggleCollapsed() },
  }, this.collapseIcon, this.collapseLabel) as HTMLButtonElement;
  private sidebarBuilt = false;
  private readonly gepBanner = h('div', { class: 'gep-banner hidden' });
  private readonly filterHost = h('div', { class: 'filterbar-wrap hidden' });
  private readonly contentHost = h('main', { class: 'content' });
  private readonly statusLabel = h('span', { class: 'status-label' }, 'Loading…');
  private readonly busySpin = h('span', { class: 'busy-indicator hidden', title: 'Refreshing…' });
  private readonly staleLink = h('button', {
    class: 'stale-link hidden',
    title: 'The last refresh failed — click to retry',
    on: { click: () => void store.refresh() },
  }, '⚠ stale — retry');
  // A real button (F2), not a span with a click handler — so it's keyboard-
  // reachable and its cursor and intent are honest before you even click.
  private readonly demoBadge = h('button', {
    class: 'badge badge--demo hidden',
    style: { border: 'none', cursor: 'pointer', font: 'inherit' },
    title: 'Sample season — click to turn demo data off',
    on: { click: () => store.setView('settings', { section: 'appBehavior' }) },
  }, 'Demo data');
  private readonly devBadge = h('span', { class: 'badge badge--dev hidden' });
  private readonly gepDot = h('span', { class: 'status-dot' });
  private readonly gepLabel = h('span', { class: 'gep-label' }, '');
  /** What the content host currently shows — re-render only when this changes. */
  private lastRendered: { data: DashboardData; view: ViewId; matchId?: string; highlight?: string; day?: string; flag?: string; map?: string; prefillName?: string; prefillRole?: string; prefillHeroes?: string[]; playerName?: string; targetId?: string; editTargetId?: string; epoch: number } | null = null;
  /** The snapshot the filter bar was last built for. Background refreshes patch
   *  `refreshing`/`status` without changing `data`, so re-rendering the bar then
   *  would tear down its live controls mid-click and swallow the click — the
   *  same class of bug as the sidebar rebuild. Only rebuild on a new snapshot. */
  private lastFilterData: DashboardData | null = null;
  private lastFilterView: ViewId | null = null;
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
    subscribeGepStatus(() => { this.renderGepIndicator(); this.renderGepBanner(); });
    this.renderGepIndicator();
    this.renderGepBanner();
    // The live-match feed. The nav dot is mutated in place (never rebuilt), so
    // a push landing mid-click can't swallow the click — the same discipline
    // the rest of the sidebar follows.
    initLiveMatch();
    subscribeLiveMatch(() => this.renderLiveNav());
    this.renderLiveNav();
    // Start the log feed at shell mount, not on Logs' first render (W5) — the
    // error/warning counter should reflect the whole session, since a player
    // usually opens Logs BECAUSE something already went wrong, not before.
    ensureLogFeed();
    subscribeLogStats((stats) => this.renderLogsNav(stats));
    initDevModeAuthStatus();
    subscribeDevModeAuthStatus(() => this.renderDevBadge());
    this.renderDevBadge();
    // Live logging: a just-tracked match refetches the open dashboard (composes
    // with the focus-refresh below for pushes dropped while the window was closed).
    bridge.onGameLogged(() => void store.refresh());
    // A no-outcome match held (or resolved) refetches so the Review "Needs
    // result" section stays in step with the pending store.
    bridge.onPendingChanged(() => void store.refresh());
    // Any write that moves the dashboard — a review's ±SR, a rank anchor, a
    // placement run, an import — refetches, so the top-left rank chip can never
    // sit on a pre-write value. Covers writes this window didn't make itself
    // (the MCP server acting for the user), which is why it's a push and not a
    // rule each view has to remember.
    bridge.onDataChanged(() => void store.refresh());
    // Keep "updated Xm" honest while the app idles.
    setInterval(() => {
      const s = store.get();
      if (s.data && !s.stale && !s.error) this.statusLabel.textContent = statusText(s.data);
    }, 60_000);
    void store.refresh();
    // Follow onto the account a newly logged competitive match landed on (F4).
    bridge.onGameLogged((payload) => this.onGameLogged(payload));
    // The first-run demo prompt + tour are driven from onState once real data
    // has loaded (so the persisted demo choice is known before we decide).
  }

  /**
   * A competitive match was just recorded (live or hand-logged). When the view
   * is scoped to a specific account and the match landed on a DIFFERENT
   * configured/known account, switch the account filter onto it so the dashboard
   * follows the account being played — never from "All accounts", never for an
   * Unknown/unmapped account (see {@link shouldAutoSwitch}). Otherwise just pull
   * the fresh data in so the new match shows without waiting for a window focus.
   */
  private onGameLogged(payload: GameLoggedPayload): void {
    if (shouldAutoSwitch(store.get().filters.account, payload)) {
      store.setFilters({ account: payload.account }); // persists + refreshes
      // L3: this silently changes the WHOLE dashboard's account scope — worth
      // a notice on its own, distinct from the log card's own save toast
      // (which already names the account it stored). Live-tracked switches
      // are excluded: they land while the player is still in Overwatch,
      // looking at neither Vantage nor a toast either way.
      if (payload.source === 'manual') toast(`Now showing ${payload.account}`);
    } else {
      void store.refresh();
    }
    // An auto-tracked match never passes through the log form, which is the only
    // place that used to ask about placements — so a player who queued into
    // their first ranked game on a fresh account was never offered a run
    // (issue #200). Manual logs are excluded: the form asks for itself.
    //
    // Deliberately NOT gated on `document.hasFocus()`. This fires the moment a
    // live match ends, when the player is still in Overwatch and Vantage is
    // behind it by definition — a focus gate would skip exactly the case this
    // exists for. The modal simply waits until they alt-tab back.
    if (payload.source === 'gep') {
      void maybeOfferPlacements(payload.account, payload.role, () => void store.refresh());
    }
  }

  /**
   * Catch-up for offers whose push never arrived: `DashboardWindow.push`
   * silently drops when no window is open, so a match tracked while Vantage was
   * closed (or minimized to tray) reaches no `onGameLogged` handler at all.
   * Asking again for the most recently played track on focus costs one IPC call
   * that answers `null` almost every time, and is what keeps the fix from
   * depending on the player happening to open Review.
   */
  private catchUpPlacementOffer(): void {
    const latest = store.get().data?.matches?.find((m) => classifyGameType(m.gameType) === 'competitive');
    if (!latest) return;
    void maybeOfferPlacements(latest.account, latest.role, () => void store.refresh());
  }

  private build(): HTMLElement {
    return h('div', { class: 'app' },
      this.titlebar(),
      h('div', { class: 'body' },
        this.sidebarHost,
        h('div', { class: 'content-col' }, this.gepBanner, this.filterHost, this.contentHost),
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
          title: 'Help & FAQ — the intro tour is still one click away from there',
          on: { click: () => store.setView('faq') },
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
          h('span', { class: 'kbd' }, 'Ctrl K'), 'Search'),
        // L1: logging a match is the app's primary write, yet the only route
        // used to be Ctrl+K then typing/picking it, or this pill opening the
        // palette and still needing Enter — a real button + its own global
        // key (Ctrl+L, bound in bindGlobals) reaches it in one step from
        // anywhere.
        h('button', { class: 'titlebar-search titlebar-log', on: { click: () => openLogMatch(this.context()) } },
          '+ Log match', h('span', { class: 'kbd' }, 'Ctrl L')),
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
  /** The `isSample` this shell last observed — `undefined` until the first snapshot, so that one never itself reads as a transition (F2). */
  private lastIsSample: boolean | undefined;

  private onState(state: AppState): void {
    // Compare BEFORE overwriting — demoTransition needs the value from the
    // PREVIOUS call, not this one.
    const transition = demoTransition(this.lastIsSample, state.data?.isSample ?? false);
    this.lastIsSample = state.data?.isSample ?? false;
    if (transition === 'demo-retired') this.announceDemoRetired();

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
   * The demo season just retired (F2) — the moment history gains its first
   * real game, `effectiveDemo` flips every 150 sample games, 4 sample
   * accounts and however many sample targets over to whatever the player
   * actually has, with nothing said about it before this. A toast marks the
   * moment; resetting the dismissed pref re-arms the Overview unlock-ladder
   * card even if a PRIOR demo-retirement's card was already dismissed (rare,
   * but deleting your only real game brings demo back, and a later first
   * real game deserves the same announcement, not permanent silence).
   */
  private announceDemoRetired(): void {
    toast('Your first tracked game is in — the demo season retired. Everything from here is yours.', {
      action: { label: 'View Overview', run: () => store.setView('overview') },
    });
    prefs.set('firstRealGameBannerDismissed', false);
  }

  /**
   * Once, after the first real snapshot: ask where to keep data (only on a
   * fresh install — `needsFirstRunChoice`), then the demo question (if never
   * asked), then the tour, then (only if the tour didn't just run) "What's
   * new". The data-location step runs first because it must complete before
   * meaningful data is written (spec C1/C4).
   */
  private maybeFirstRun(state: AppState): void {
    if (this.firstRunHandled || !state.data) return;
    this.firstRunHandled = true;
    const openTour = (): void => {
      if (shouldOnboard()) {
        openOnboarding(store.get().data?.isSample ?? false);
        // Never show "What's new" on the same launch as the intro tour — a
        // brand-new (or still-touring) user doesn't need release notes on top.
      } else {
        this.maybeWhatsNew();
      }
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

  /**
   * "What's new" — the two rules that decide this live in `src/core/whatsNew.ts`:
   * a fresh install (`lastSeenVersion` unset) shows nothing, but this is the one
   * place that fact is recorded, so the *next* update has something to compare
   * against — skip recording and the feature never fires for this user, ever.
   * An upgrade shows the modal and records `version` on dismissal (any dismissal
   * counts — see {@link openWhatsNewPrompt}). Everything else (same version,
   * older version, unparseable version) shows nothing and records nothing.
   */
  private maybeWhatsNew(): void {
    void Promise.all([bridge.getAppSettings(), bridge.getAppInfo()]).then(([settings, info]) => {
      const { lastSeenVersion } = settings;
      const { version } = info;
      if (lastSeenVersion === undefined) {
        // Fresh install: nothing to show, but record silently so an upgrade
        // from here on has a baseline to compare against.
        void bridge.setAppSettings({ lastSeenVersion: version });
        return;
      }
      if (!shouldShowWhatsNew(lastSeenVersion, version)) return;
      const entries = changelogSince(CHANGELOG, lastSeenVersion);
      if (entries.length === 0) {
        // A showable version with no usable notes (e.g. only an unstamped
        // "Unreleased" heading) — record it so it isn't retried forever, but
        // don't pop an empty modal.
        void bridge.setAppSettings({ lastSeenVersion: version });
        return;
      }
      openWhatsNewPrompt(entries, () => void bridge.setAppSettings({ lastSeenVersion: version }));
    });
  }

  /** The one global filter bar — persistent above every screen, unified look.
   *  A {@link FILTERLESS_VIEWS} screen keeps the same bar mounted but swaps in
   *  its {@link FILTERLESS_REASON}, so the content column never jumps by the
   *  bar's height switching to and from one (K5) — only the cold-start skeleton
   *  (no data yet) hides it outright, since there's nothing to say yet either. */
  private renderFilters(state: AppState): void {
    this.filterHost.classList.toggle('hidden', !state.data);
    if (!state.data) return;
    // Reruns on a fresh snapshot (new filter options) or a view change that
    // flips the reason text; otherwise keeps the DOM (and any open <select>).
    if (this.lastFilterData === state.data && this.lastFilterView === state.view) return;
    const reason = FILTERLESS_VIEWS.has(state.view) ? FILTERLESS_REASON[state.view] : undefined;
    render(this.filterHost, reason ? filterBarReason(reason) : filterBar(state.data, (patch) => store.setFilters(patch)));
    this.lastFilterData = state.data;
    this.lastFilterView = state.view;
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
      map: state.params.map,
      prefillName: state.params.prefillName,
      prefillRole: state.params.prefillRole,
      prefillHeroes: state.params.prefillHeroes,
      playerName: state.params.playerName,
      targetId: state.params.targetId,
      editTargetId: state.params.editTargetId,
      epoch: state.renderEpoch,
    };
    const last = this.lastRendered;
    if (last && last.data === key.data && last.view === key.view
      && last.matchId === key.matchId && last.highlight === key.highlight
      && last.day === key.day && last.flag === key.flag && last.map === key.map
      && last.prefillName === key.prefillName
      && last.prefillRole === key.prefillRole && sameStrings(last.prefillHeroes, key.prefillHeroes)
      && last.playerName === key.playerName
      && last.targetId === key.targetId && last.editTargetId === key.editTargetId
      && last.epoch === key.epoch) return;
    // Having passed the equality check with every non-`data` field equal means
    // only the snapshot changed — a background refresh. If the user is pressing
    // inside the content host, defer it: replacing the pressed element mid-click
    // makes the browser drop the click (down/up must share a target), which is
    // how an in-content navigation click gets swallowed. Flushed on release
    // (see bindGlobals). Route/epoch changes fall through and render at once.
    if (this.contentPressed && last && last.view === key.view && last.matchId === key.matchId
      && last.highlight === key.highlight && last.day === key.day && last.flag === key.flag
      && last.map === key.map
      && last.prefillName === key.prefillName
      && last.prefillRole === key.prefillRole && sameStrings(last.prefillHeroes, key.prefillHeroes)
      && last.playerName === key.playerName
      && last.targetId === key.targetId && last.editTargetId === key.editTargetId && last.epoch === key.epoch) {
      this.pendingContentRender = true;
      return;
    }
    // Remember where the outgoing route was scrolled; restore it when a
    // navigation (not a data refresh on the same route) returns here.
    if (last) this.scrollMemory.set(routeKey(last.view, last.matchId, last.playerName, last.targetId), this.contentHost.scrollTop);
    const navigated = !last || last.view !== key.view || last.matchId !== key.matchId
      || last.playerName !== key.playerName || last.targetId !== key.targetId;
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
      this.contentHost.scrollTop = this.scrollMemory.get(routeKey(key.view, key.matchId, key.playerName, key.targetId)) ?? 0;
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
    // The chip doubles as the account switcher. PINNED, it is that account — a
    // manual choice is never silently overridden. Unpinned it says "All
    // accounts" outright (it used to borrow the most recently played account's
    // name, which named ONE account over a dashboard showing every one) and its
    // sub-line attributes the rank to whichever account it belongs to. The
    // wording lives in sidebarChip.ts; this only paints it.
    const chip = sidebarChip(d);
    this.avatarEl.textContent = chip.glyph;
    this.avatarEl.classList.toggle('is-all', chip.scope === 'all');
    this.accountNameEl.textContent = chip.name;
    this.accountSubEl.textContent = chip.sub;
    // One line with an ellipsis (app.css); the full line is the tooltip.
    // The FULL form — the sub-line is clamped to two lines, so the tooltip is
    // the escape hatch that clamp depends on and must not shrink with it.
    this.accountSubEl.title = chip.subFull;
    // The collapsed rail (Ctrl B) hides `accountNameEl`/`accountSubEl` entirely,
    // leaving only the avatar glyph — this is the one place that still says
    // which account and rank are pinned there (K6).
    this.accountChip.title = `${chip.name} · ${chip.subFull} — click to switch account`;

    // Saving a review doesn't refetch, so subtract the games graded since the
    // last snapshot (only those the snapshot still counts as pending) — scoped
    // to the same recency window pendingReviewsRecent itself counts over (R1),
    // so a session spent grading week-old games can't under-subtract a badge
    // that was never counting them in the first place.
    const now = Date.now();
    const gradedOverlapRecent = d
      ? d.reviewInbox.filter((m) => gradedThisSession.has(m.matchId) && now - m.timestamp < RECENT_REVIEW_WINDOW_MS).length
      : 0;
    const pendingReviews = d ? Math.max(0, d.pendingReviewsRecent - gradedOverlapRecent) : 0;
    // Parameterized views highlight their parent list in the sidebar. Read from
    // DETAIL_PARENT rather than a second hand-written branch chain, so the
    // parenting is expressed exactly once (it also drives relaunch restore).
    const activeNav: ViewId = DETAIL_PARENT[state.view as keyof typeof DETAIL_PARENT] ?? state.view;
    for (const [id, btn] of this.navButtons) btn.classList.toggle('is-active', id === activeNav);
    this.updateReviewBadge(pendingReviews, d?.pendingReviews ?? 0, d?.isSample ?? false);

    render(this.sessionBody, this.sessionSummary(state));
  }

  /**
   * Build the sidebar skeleton once — account chip, nav buttons, session card —
   * as stable DOM nodes. Everything that changes per snapshot is mutated in
   * place afterwards; the nodes themselves are never recreated, so a background
   * refresh can't destroy a nav button under an in-progress click.
   */
  private buildSidebar(): void {
    // The nav lives in its own scrollable box between the top row (account chip
    // + rail toggle) and the session card, both of which stay pinned. Without
    // it the sidebar's flex children simply overflow their container — at the
    // app's own 1300×840 spec size the nav is already taller than the space it
    // has, so the session card was being pushed straight down over the status
    // bar. Every nav item added since made that worse, and would again.
    const navChildren: Array<Node> = [];
    for (const section of NAV) {
      navChildren.push(h('div', { class: 'nav-group' }, section.group));
      for (const item of section.items) {
        const btn = h('button', {
          class: 'nav-item',
          // Always set, not only while collapsed: the rail hides the label, and
          // a title that appears and disappears with the rail is a title nobody
          // learns to expect.
          title: item.label,
          on: { click: () => store.setView(item.id) },
        },
          // icon is a text glyph or a prebuilt SVG node; h() appends a Node as-is
          // and stringifies a glyph, so both render correctly.
          h('span', { class: 'nav-icon' }, item.icon),
          // Wrapped rather than a bare text node so the rail can hide the words
          // without hiding the icon beside them.
          h('span', { class: 'nav-label' }, item.label),
        );
        this.navButtons.set(item.id, btn);
        navChildren.push(btn);
      }
    }
    render(
      this.sidebarHost,
      this.accountChip,
      // Its own full-width bar between the chip and the nav — a bigger,
      // harder-to-miss target than a small corner glyph, and it reads as the
      // seam between "who I am" and "where I'm going" that it actually is.
      this.collapseToggle,
      h('nav', { class: 'sidebar-nav' }, ...navChildren),
      // Last on purpose: the session card is the bottom-most thing in the sidebar.
      this.sessionCardEl,
    );
    this.applyCollapsed();
    this.sidebarBuilt = true;
  }

  /**
   * Collapse the sidebar to an icon-only rail, and back.
   *
   * The scroll box below already guarantees the nav can never push anything out
   * of the sidebar, so this is not a second fix for that — it is for the case
   * scrolling handles correctly but unpleasantly: a short window where the nav
   * is technically fine and practically a keyhole. Collapsed, all of it fits.
   */
  private toggleCollapsed(): void {
    prefs.set('sidebarCollapsed', !(prefs.get('sidebarCollapsed') ?? false));
    this.applyCollapsed();
  }

  private applyCollapsed(): void {
    const collapsed = prefs.get('sidebarCollapsed') ?? false;
    this.sidebarHost.classList.toggle('is-collapsed', collapsed);
    this.collapseIcon.textContent = collapsed ? '»' : '«';
    this.collapseLabel.textContent = collapsed ? 'Expand' : 'Collapse';
    this.collapseToggle.title = collapsed ? 'Expand the sidebar (Ctrl B)' : 'Collapse the sidebar (Ctrl B)';
    this.collapseToggle.setAttribute('aria-label', this.collapseToggle.title);
    this.collapseToggle.setAttribute('aria-expanded', String(!collapsed));
  }

  /** Reflect the pending-review count on the Review nav item in place, so the
   *  button (a live click target) is never rebuilt. */
  /**
   * A live dot on the Live nav item while a match is running, so the screen
   * advertises itself without stealing focus. Mutated in place for the same
   * reason every other sidebar update is: a rebuilt button between mousedown
   * and mouseup swallows the click.
   */
  private renderLiveNav(): void {
    const btn = this.navButtons.get('live');
    if (!btn) return;
    const p = getLiveMatch();
    const isLive = p?.live === true;
    const existing = btn.querySelector<HTMLElement>('.nav-live-indicator');
    if (!isLive) {
      existing?.remove();
      return;
    }
    // "Ilios · 12:34 · 4-3 eliminations" once both the map and the kill feed
    // have reported in; a plain "A match is in progress" before then.
    const clock = p!.startedAt ? matchClock(p!.startedAt) : undefined;
    const title = [p!.map, clock, p!.kills.known ? `${p!.kills.yours}–${p!.kills.theirs} eliminations` : undefined]
      .filter(Boolean).join(' · ') || 'A match is in progress';
    // A small mono kill chip beside the dot, only once the feed has actually
    // said which side an attacker was on — the same `known` gate the Live
    // screen's own tally uses, so the two can never disagree on a number.
    const chipText = p!.kills.known ? `${p!.kills.yours}–${p!.kills.theirs}` : null;
    if (existing) {
      existing.title = title;
      const dot = existing.querySelector('.nav-live-dot')!;
      const chip = existing.querySelector('.nav-live-kills');
      if (chipText) {
        if (chip) chip.textContent = chipText;
        else dot.before(h('span', { class: 'nav-live-kills mono' }, chipText));
      } else {
        chip?.remove();
      }
    } else {
      btn.append(h('span', { class: 'nav-live-indicator', title },
        chipText ? h('span', { class: 'nav-live-kills mono' }, chipText) : null,
        h('span', { class: 'nav-live-dot' }),
      ));
    }
  }

  /**
   * A dot on the Logs nav item once an error has been logged this session
   * (W5) — the same mutate-in-place idiom as {@link renderLiveNav}. Warnings
   * are routine (e.g. the startup "notion shape validation skipped" warn), so
   * only errors light it — a warning-only session should stay quiet.
   */
  private renderLogsNav(stats: LogStats): void {
    const btn = this.navButtons.get('logs');
    if (!btn) return;
    const existing = btn.querySelector('.nav-live-dot');
    const title = `${stats.errors} error${stats.errors === 1 ? '' : 's'} logged this session`;
    if (stats.errors > 0 && existing) {
      existing.setAttribute('title', title);
    } else if (stats.errors > 0) {
      btn.append(h('span', { class: 'nav-live-dot', title }));
    } else {
      existing?.remove();
    }
  }

  /** `pending` is the recency-scoped count the badge shows (R1); `total` is the
   *  full lifetime backlog, named only in the title — the badge itself only
   *  ever shows "this week", never a number that only ever grows. */
  private updateReviewBadge(pending: number, total: number, isSample: boolean): void {
    const btn = this.navButtons.get('review');
    if (!btn) return;
    const existing = btn.querySelector<HTMLElement>('.nav-badge');
    // The collapsed rail (app.css `.sidebar.is-collapsed .nav-badge`) shrinks
    // this to a bare dot with no visible number — the title is the only place
    // "how many" survives there, so it's set even though the expanded rail's
    // own visible digits make it redundant there.
    // Demo mode (F3): grading these never saves, so the badge shouldn't read
    // like a real backlog either — muted styling, and the title says so.
    const title = isSample
      ? `${pending} demo games — grading them is practice only, nothing is saved`
      : `${pending} from this week · ${total} in total`;
    const shown = pending > 99 ? '99+' : String(pending);
    const cls = `nav-badge${isSample ? ' nav-badge--muted' : ''}`;
    if (pending > 0) {
      if (existing) { existing.textContent = shown; existing.title = title; existing.className = cls; }
      else btn.append(h('span', { class: cls, title }, shown));
    } else {
      existing?.remove();
    }
  }

  /** The top-left chip's account switcher: scope the dashboard to an account (or all), or jump to account management. */
  private openAccountSwitcher(anchor: HTMLElement, d: DashboardData): void {
    const current = d.filters.account;
    openPopover(anchor, (close) => {
      // A per-account rank line, when that account has an anchor set. Same shared
      // parts as every other surface (no movement arrow — Overview KPI only), so
      // protection reads identically here. "All accounts" has no single rank.
      //
      // A placement run APPENDS to that rank, it does not replace it. This used to
      // take the first open run on the account regardless of role, so one stale
      // Support run hid an account's real rank behind `Placements N/10` — the menu
      // then contradicted the header chip above it, which is the second half of
      // #184. `accountRanks` is the same role-aggregated, suppression-aware value
      // the header shows, so leading with it keeps the two in agreement, and
      // `accountPlacementNote` says what the open runs are doing in a few words.
      const rankSub = (account: string): HTMLElement | null => {
        const note = accountPlacementNote(d.placements.filter((p) => p.account === account));
        const rk = d.accountRanks[account];
        if (!rk) {
          // No rank to lead with — a track mid-placements with nothing behind it.
          return note ? h('span', { class: 'acct-menu-rank u-dim' }, note) : null;
        }
        // Short: this sits in the popover's content-sized third track, where a
        // long rank steals width from the account NAME beside it (a collapsible
        // minmax(0, 1fr)) rather than clipping.
        const p = rankParts({ tier: rk.tier, division: rk.division, progressPct: rk.progressPct, protected: rk.protected, short: true });
        const rank = `${p.rankLabel} · ${p.bufferPctText}${p.shield ? ' 🛡' : ''}`;
        return h('span', { class: 'acct-menu-rank u-dim' }, note ? `${rank} · ${note}` : rank);
      };
      // The ACTIVE account expands into one line per role it tracks — everything
      // else stays the single collapsed line above, so the popover doesn't turn
      // into every account's full roster at once (that's what Settings is for).
      const roleRows = (account: string): HTMLElement | null => {
        const perRole = d.accountRoleRanks[account];
        const runs = d.placements.filter((p) => p.account === account);
        const roles = SWITCHER_ROLES.filter((role) => perRole?.[role] || runs.some((p) => p.role === role));
        if (!roles.length) return null;
        // A two-column grid of its own (role | status) so the labels and the
        // texts line up across rows; each row is `display: contents`.
        return h('div', { class: 'acct-menu-roles' },
          ...roles.map((role) => {
            const openRun = runs.find((p) => p.role === role && !p.completed);
            // Short: a ~168px status column at the panel's 320px minimum, where
            // "Placements 4/10 · Platinum 4 (predicted)" wraps to two lines.
            const status = roleStatus(perRole?.[role], openRun, false, true);
            return h('div', { class: 'acct-menu-role-row' },
              h('span', null, roleLabel(role)),
              h('span', { class: status.tone === 'placement' ? 'acct-menu-role-accent' : undefined }, status.text),
            );
          }),
        );
      };
      // A muted "N games · last played Xd" line under the name (W2) — games
      // from the already-filtered byAccount breakdown (the same number every
      // other by-X split on this payload uses), last-played from the
      // UNFILTERED accountActivity map so a Role filter can't hide that this
      // account was just played on a different role tonight.
      const activityLine = (account: string): HTMLElement | null => {
        const games = d.byAccount.find((g) => g.key === account)?.games ?? 0;
        const lastPlayed = d.accountActivity[account];
        if (!games && lastPlayed === undefined) return null;
        const parts = [`${games} game${games === 1 ? '' : 's'}`];
        if (lastPlayed !== undefined) parts.push(`last played ${relTime(lastPlayed)}`);
        return h('span', { class: 'acct-menu-activity' }, parts.join(' · '));
      };
      // Every row is one grid (see .acct-menu-item): check | name | rank, with
      // the active account's per-role table spanning the name and rank columns
      // beneath. Flat children rather than nested flex columns, so names, rank
      // texts and role lines share the same column edges across every row.
      const item = (label: string, active: boolean, run: () => void, account?: string): HTMLElement => {
        return h('button', { class: `acct-menu-item${active ? ' is-active' : ''}`, on: { click: () => { run(); close(); } } },
          active ? h('span', { class: 'acct-menu-check' }, '✓') : null,
          h('span', { class: 'acct-menu-name' }, label),
          account ? rankSub(account) : null,
          account ? activityLine(account) : null,
          active && account ? roleRows(account) : null,
        );
      };
      // Tonight's account first (W2) — most-recently-played account leads the
      // list instead of the alphabetical order `options.accounts` is sorted
      // in; an account never played (no accountActivity entry, shouldn't
      // happen for a real one) sorts last rather than crashing the compare.
      const byRecency = [...d.options.accounts].sort(
        (a, b) => (d.accountActivity[b] ?? -Infinity) - (d.accountActivity[a] ?? -Infinity),
      );
      return h('div', { class: 'acct-menu' },
        item('All accounts', current === 'all', () => store.setFilters({ account: 'all' })),
        ...byRecency.map((a) => item(a, current === a, () => store.setFilters({ account: a }), a)),
        h('div', { class: 'acct-menu-sep' }),
        item('Manage accounts →', false, () => store.setView('settings')),
      );
    }, { panelClass: 'popover-panel--wide' });
  }

  /** The "Current session" body, re-rendered into the persistent session card. */
  private sessionSummary(state: AppState): HTMLElement {
    const s = state.data?.session;
    const gapMinutes = state.data?.sessionSettings.gapMinutes ?? 180;
    const gapText = gapMinutes % 60 === 0 ? `${gapMinutes / 60}h` : `${gapMinutes}m`;
    const tip = `A sitting is games with no gap longer than ${gapText} between them — follows the account switcher, not the role/date filter.`;
    if (!s || !s.games) {
      // S3: named the actual rule instead of a bare "no session yet" — the
      // gap threshold is a real, user-configurable number nothing here used
      // to surface.
      return h('div', { class: 'u-muted', style: { fontSize: '11.5px', marginTop: '4px', lineHeight: '1.4' }, title: tip },
        `No games in the last ${gapText} — your next game starts a new sitting`);
    }
    const topMap = s.topMaps[0];
    return h('div', {
      style: { marginTop: '5px', cursor: 'pointer' },
      title: tip,
      ...clickableRow(() => store.setView('matches', { day: s.date })),
    },
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px' } },
        h('span', { class: 'mono', style: { fontSize: '17px', fontWeight: '600' } }, `${s.wins}–${s.losses}`),
        h('span', { style: { fontSize: '11px', color: 'var(--win-text)' } }, `${signed(s.wins - s.losses)} net`),
        h('span', { class: 'u-muted', style: { fontSize: '11px' } }, `· ${pct(s.winrate)}`),
      ),
      // Streak + top map (S3) — the Session payload always carried these;
      // nothing here used to read them.
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '3px' } },
        h('span', { class: `mono ${s.streak.type === 'W' ? 'is-win' : s.streak.type === 'L' ? 'is-loss' : 'u-dim'}`, style: { fontSize: '11px' } }, streakText(s.streak)),
        topMap ? h('span', { class: 'u-dim', style: { fontSize: '11px' } }, `${topMap.key} ×${topMap.games}`) : null,
      ),
    );
  }

  /** The status-bar connection indicator: dot color + short truthful label. */
  private renderGepIndicator(): void {
    const s = getGepStatus();
    const state = s && s.sensor === 'gep' ? s.state : 'no-game';
    this.gepDot.className = `status-dot is-${state}`;
    this.gepLabel.textContent = gepLabelText(s);
  }

  /**
   * The status-bar "Dev mode" badge: hidden while no attempt was made or the
   * outcome is still pending (so it never flashes the authenticated look ahead
   * of a real confirmation), green once the runtime confirms the dev-mode
   * launch, red if it failed — with the failure detail (when the main process
   * sent one) surfaced in the tooltip.
   */
  private renderDevBadge(): void {
    const s = getDevModeAuthStatus();
    // No pull has resolved yet: same as an unattempted run for display purposes
    // (classifyDevModeBadge maps this to 'hidden' either way).
    const state = classifyDevModeBadge({ attempted: s?.attempted ?? false, outcome: s?.outcome ?? 'pending' });
    if (state !== 'failed') {
      this.devBadge.className = `badge badge--dev${state === 'authenticated' ? '' : ' hidden'}`;
      this.devBadge.textContent = 'Dev mode';
      this.devBadge.title = 'Running in ow-electron Dev Mode — live GEP data via your Overwolf dev key';
      return;
    }
    this.devBadge.className = 'badge badge--dev-failed';
    this.devBadge.textContent = 'Dev mode failed';
    this.devBadge.title = s?.detail
      ? `Dev Mode authentication failed: ${s.detail}`
      : 'Dev Mode authentication failed — GEP will not attach. Check the terminal/log for details.';
  }

  /**
   * The app-wide GEP banner (top of content), mutated in place so it never tears
   * down the active view. Shows a "restart to apply" prompt when a fixed GEP
   * package is staged, an outage explanation while Overwolf's service is
   * degraded/down, or — lowest priority, since the other two are the more
   * actionable Overwolf-side reads — a heads-up that the feed has gone quiet
   * mid-match (S6), so a stalled scoreboard on Live doesn't read as broken.
   * Hidden when none of that applies — an outage is never asserted without an
   * authoritative feed reading.
   */
  private renderGepBanner(): void {
    const s = getGepStatus();
    const outage = s?.serviceStatus === 'down' || s?.serviceStatus === 'degraded';
    const staged = Boolean(s?.updateStaged);
    const stale = s?.state === 'stale';
    if (!outage && !staged && !stale) {
      this.gepBanner.className = 'gep-banner hidden';
      render(this.gepBanner);
      return;
    }
    if (staged) {
      this.gepBanner.className = 'gep-banner is-update';
      render(this.gepBanner,
        h('span', { class: 'gep-banner-text' },
          'A fix for Overwatch game events is ready. Restart Vantage to apply it.'),
        h('button', {
          class: 'gep-banner-action',
          on: { click: () => void bridge.applyGepUpdate() },
        }, 'Restart to apply'),
      );
      return;
    }
    if (outage) {
      this.gepBanner.className = 'gep-banner is-outage';
      render(this.gepBanner,
        h('span', { class: 'gep-banner-text' },
          s?.serviceMessage
            ? `Overwatch game events are down — Overwolf: ${s.serviceMessage}. Vantage resumes tracking automatically when it's fixed.`
            : "Overwatch game events are down on Overwolf's side (not a Vantage bug). Vantage resumes tracking automatically once it's fixed."),
        h('button', {
          class: 'gep-banner-link',
          title: 'Open Overwolf’s game-events status page',
          on: { click: () => void bridge.openExternal('https://support.overwolf.com/support/solutions/9000115816') },
        }, 'Overwolf status ↗'),
      );
      return;
    }
    this.gepBanner.className = 'gep-banner is-stale';
    render(this.gepBanner,
      h('span', { class: 'gep-banner-text' },
        'No data from the game for a while — the scoreboard on Live may be behind. Vantage keeps listening; this clears itself once events resume.'),
      h('button', {
        class: 'gep-banner-link',
        title: 'Open the log viewer',
        on: { click: () => store.setView('logs') },
      }, 'Open Logs →'),
    );
  }

  /**
   * Click-for-details: live-updating popover with the feed's vitals (S6).
   * `lastError` leads, in a warning tone, since a reader scanning top-down for
   * "what's wrong" used to find it dead last; a footer of next steps replaces
   * what was otherwise a diagnostic dead end.
   */
  private openGepPopover(anchor: HTMLElement): void {
    const body = h('div', { class: 'gep-popover' });
    const paint = (): void => {
      const s = getGepStatus();
      const rows: Array<[string, string, boolean?]> = s
        ? [
            ...(s.lastError ? [['Last error', s.lastError, true] as [string, string, boolean]] : []),
            ['State', gepLabelText(s)],
            ['Source', s.sensor === 'gep' ? 'Overwolf GEP' : 'Counterwatch'],
            ...(s.gepPackageVersion ? [['GEP package', s.gepPackageVersion] as [string, string]] : []),
            ['Last event', s.lastEventAt ? relTime(s.lastEventAt) : '—'],
            ['Events this session', String(s.eventsThisSession)],
            ['Match in progress', s.matchInProgress ? 'Yes' : 'No'],
            ['Attached', s.attachedAt ? `${relTime(s.attachedAt)} ago` : 'Not attached'],
          ]
        : [['State', 'Unknown — no status received yet']];
      render(body,
        h('div', { class: 'gep-popover-title' }, 'Game feed'),
        ...rows.map(([k, v, warn]) =>
          h('div', { class: `gep-popover-row${warn ? ' is-warn' : ''}` },
            h('span', { class: 'u-muted' }, k),
            h('span', { class: 'mono' }, v),
          ),
        ),
        h('div', { class: 'gep-popover-actions' },
          h('button', { class: 'gep-banner-link', on: { click: () => store.setView('logs') } }, 'Logs →'),
          h('button', { class: 'gep-banner-link', on: { click: () => store.setView('settings') } }, 'Alerts…'),
          s?.matchInProgress
            ? h('button', { class: 'gep-banner-link', on: { click: () => store.setView('live') } }, 'Open Live →')
            : null,
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

  /**
   * Ctrl+K — palette (guarded against double-open via the mounted panel).
   * Settings/Logs current state is fetched once per open (M5) so their
   * palette hints read "currently on/off" instead of a bare action name —
   * cheap, since these are already-loaded main-process config, not a disk read.
   */
  private openPalette(): void {
    if (!store.get().data || document.querySelector('.palette')) return;
    const ctx = this.context();
    void Promise.all([bridge.getAppSettings(), bridge.getLogLevel(), bridge.getBreakReminder()])
      .then(([appSettings, logLevel, breakReminder]) => {
        if (!store.get().data || document.querySelector('.palette')) return;
        openPalette(ctx, {
          nav: NAV.flatMap((g) => g.items.map((i) => ({
            id: i.id, label: i.label,
            kbd: i.key !== undefined ? comboLabel(`ctrl+${i.key}`) : undefined,
          }))),
          actions: [
            { label: 'Log match', kbd: 'Ctrl L', run: () => openLogMatch(ctx) },
            { label: 'Keyboard shortcuts', kbd: '?', run: () => this.openCheatsheet() },
            { label: 'Replay the intro tour', hint: 'also on the FAQ screen', run: () => openOnboarding(store.get().data?.isSample ?? false) },
            { label: 'Report a bug', hint: 'on the About screen', run: () => store.setView('about') },
            ...settingsActions(appSettings, logLevel, breakReminder),
            ...WINRATE_SCHEME_OPTIONS.map((opt) => ({
              label: `Winrate colours: ${opt.label}`,
              hint: getWinrateScheme() === opt.value ? 'currently on' : undefined,
              run: () => {
                setWinrateScheme(opt.value);
                store.rerender();
                toast(`Winrate colours: ${opt.label}`);
              },
            })),
          ],
        });
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
    // L1: reachable from anywhere in one step, like Ctrl+K — but unlike
    // Ctrl+K (which may reasonably reach OVER another overlay to search),
    // this directly opens a modal, so it stays gated behind !overlayCapturing()
    // to never stack a second dialog on top of an open one.
    registerShortcut({
      combo: 'ctrl+l', description: 'Log a match', group: 'Global',
      allowInInput: true, when: () => !overlayCapturing(), run: () => openLogMatch(this.context()),
    });
    registerShortcut({ combo: '?', description: 'This cheatsheet', group: 'Global', run: () => this.openCheatsheet() });
    registerShortcut({
      combo: 'ctrl+b', description: 'Collapse / expand the sidebar', group: 'Global',
      allowInInput: true, run: () => this.toggleCollapsed(),
    });
    // Explicit keys only — a screen without one simply has no digit shortcut
    // (the palette still reaches it). Duplicates would be a typo, so the first
    // wins and the rest are dropped rather than shadowing each other by
    // registration order.
    const claimed = new Set<number>();
    for (const item of NAV.flatMap((g) => g.items)) {
      if (item.key === undefined || claimed.has(item.key)) continue;
      claimed.add(item.key);
      registerShortcut({
        combo: `ctrl+${item.key}`, description: `Go to ${item.label}`, group: 'Navigate',
        run: () => store.setView(item.id),
      });
    }
    registerShortcut({
      combo: 'escape', description: 'Back — the previous screen', group: 'Navigate',
      // No allowInInput, deliberately: the dispatcher's overlay probe is exactly
      // what leaves Escape to an open modal/drawer/popover/palette for its own
      // dismissal, and its typing guard keeps Escape usable inside a field.
      when: () => store.backLabel() !== null, run: () => { store.goBack(); },
    });
    registerShortcut({
      combo: 'alt+arrowleft', description: 'Back — the previous screen', group: 'Navigate', hidden: true,
      when: () => store.backLabel() !== null, run: () => { store.goBack(); },
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
    window.addEventListener('focus', () => void store.refresh().then(() => this.catchUpPlacementOffer()));
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
    // Thumb buttons: MouseEvent.button 3 = Back, 4 = Forward. Only Back is bound
    // — there is no forward stack. BOTH are preventDefault()ed so the embedding
    // Chromium can't start its own history navigation underneath: a no-op in the
    // packaged app (one page load, empty history), but `npm run preview` runs in
    // a real browser where it would navigate away from the harness entirely. We
    // ACT on mouseup so a press that ends elsewhere doesn't navigate.
    const thumb = (e: MouseEvent): boolean => e.button === 3 || e.button === 4;
    window.addEventListener('mousedown', (e) => { if (thumb(e)) e.preventDefault(); }, true);
    window.addEventListener('auxclick', (e) => { if (thumb(e)) e.preventDefault(); }, true);
    window.addEventListener('mouseup', (e) => {
      if (e.button !== 3) return;
      e.preventDefault();
      // An open modal/drawer/popover/palette owns dismissal. No isTyping guard:
      // a click is not typing. preventDefault on mousedown does not cancel the
      // paired pointer events, so contentPressed still clears above.
      if (overlayCapturing()) return;
      store.goBack();
    }, true);
    // Safety net: if the window loses focus mid-press (app switch, focus theft),
    // a pointerup might never reach us. Clearing the flag on blur guarantees a
    // same-route refresh can never be held back indefinitely — and the focus
    // handler above refetches on return anyway.
    window.addEventListener('blur', releasePress);
  }
}

/** Value equality for the `prefillHeroes` (H1) render-memo key — a freshly
 *  built array on every navigation would never `===` the previous one. */
function sameStrings(a?: string[], b?: string[]): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function routeKey(view: ViewId, matchId?: string, playerName?: string, targetId?: string): string {
  if (matchId) return `${view}:${matchId}`;
  if (playerName) return `${view}:@${playerName}`;
  if (targetId) return `${view}:#${targetId}`;
  return view;
}

/** Keys whose cheatsheet label needs more than first-letter capitalization. */
const KEY_LABELS: Record<string, string> = { pageup: 'PageUp', pagedown: 'PageDown' };

function comboLabel(combo: string): string {
  return combo.split('+').map((part) =>
    part === 'ctrl' ? 'Ctrl'
      : KEY_LABELS[part] ?? (part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)),
  ).join(' ');
}

/**
 * Palette actions for the frequently-flipped Settings/Logs toggles (M5) —
 * "turn the MCP endpoint off" used to mean navigating to Settings and
 * scrolling to the App behavior card. Each reuses the exact bridge setter its
 * own Settings/Logs card calls (so the two can never drift), applies against
 * the state `App`'s own `openPalette` already fetched (the hint below), and
 * toasts the result the same way flipping the chip on its own card would.
 */
function settingsActions(
  appSettings: AppUiSettings,
  logLevel: LogLevel,
  breakReminder: BreakReminderSettings,
): Array<{ label: string; hint?: string; run: () => void }> {
  const onOff = (on: boolean): string => (on ? 'currently on' : 'currently off');
  return [
    {
      label: 'Settings: MCP endpoint', hint: onOff(appSettings.mcpEnabled),
      run: () => {
        void bridge.setAppSettings({ mcpEnabled: !appSettings.mcpEnabled })
          .then((s) => toast(`MCP endpoint: ${s.mcpEnabled ? 'on' : 'off'}`));
      },
    },
    {
      label: 'Settings: Live kill feed', hint: onOff(appSettings.liveKillFeed),
      run: () => {
        void bridge.setAppSettings({ liveKillFeed: !appSettings.liveKillFeed })
          .then((s) => toast(`Live kill feed: ${s.liveKillFeed ? 'on' : 'off'}`));
      },
    },
    {
      label: 'Settings: Break reminder', hint: onOff(breakReminder.enabled),
      run: () => {
        void bridge.setBreakReminder({ ...breakReminder, enabled: !breakReminder.enabled })
          .then((s) => toast(`Break reminder: ${s.enabled ? 'on' : 'off'}`));
      },
    },
    {
      label: 'Settings: Demo data', hint: onOff(appSettings.demoPreference === 'on'),
      run: () => {
        const next = appSettings.demoPreference === 'on' ? 'off' : 'on';
        // demoPreference changes the dashboard payload itself (badge, targets,
        // KPIs) — same refetch appBehavior.ts's own toggle triggers.
        void bridge.setAppSettings({ demoPreference: next }).then((s) => {
          toast(`Demo data: ${s.demoPreference === 'on' ? 'on' : 'off'}`);
          void store.refresh();
        });
      },
    },
    {
      label: 'Logs: Debug detail', hint: onOff(logLevel === 'debug'),
      run: () => {
        const next: LogLevel = logLevel === 'debug' ? 'info' : 'debug';
        void bridge.setLogLevel(next).then((l) => toast(`Debug detail: ${l === 'debug' ? 'on' : 'off'}`));
      },
    },
  ];
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
