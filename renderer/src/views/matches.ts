/** Matches — the recent game log, grouped by day (my interpretation of the Matches screen). */
import { h, render } from '../dom';
import type { DashboardFilters, MatchFlagKey, MatchRow, Result, TargetGrade } from '../../../src/shared/contract';
import { bridge } from '../bridge';
import { aggregateGrade, dayKey, groupByDay, groupBySitting } from '../../../src/core/analytics';
import { matchInTargetScope } from '../../../src/core/targets';
import { pct, prettyDay, rankLabel, relTime, roleLabel, signed, time } from '../format';
import { shortRankLabelOf } from '../../../src/core/rankDisplay';
import { roleIcon } from '../components/roleIcon';
import { button, card, chip, confirmButton, emptyState, pill, RESULT_LETTER, RESULT_STATE, segmented, type PillState } from '../components/primitives';
import { wrHsl } from '../theme';
import { openPopover } from '../components/popover';
import { clickableRow } from '../components/clickableRow';
import { inlineLink } from '../components/inlineLink';
import { openHeroDrawer } from './heroes';
import { viewHead, type ViewContext } from './view';
import { prefs, MATCH_COLUMNS_DEFAULT, type MatchColumnKey, type MatchColumnsPref, type MatchFieldMode } from '../prefs';
import { store } from '../store';
import { deleteMatch } from '../matchActions';
import { openMatchEditorById } from './matchDetail';
import { MATCHES_PAGE_SIZE, matchesFilter, type MatchesTextFilter } from '../../../src/core/dashboardData';

/** Human labels for the drill-down chip, matching Mental's "Flags this range" card. */
const FLAG_LABELS: Record<MatchFlagKey, string> = {
  tilt: 'tilt-flagged',
  toxicMates: 'toxic-mates-flagged',
  leaver: 'leaver-flagged',
  positiveComms: 'positive-comms',
  abusive: 'abusive-comms',
};

/** Canonical field order — both the "Customize view" popover and rendering follow this (spec F1). */
const FIELD_ORDER: MatchColumnKey[] = [
  'role', 'heroes', 'account', 'srDelta', 'rankAtStart', 'duration', 'finalScore',
  'performance', 'measuredGrades', 'flags', 'party',
];

const FIELD_LABELS: Record<MatchColumnKey, string> = {
  role: 'Role',
  heroes: 'Heroes',
  account: 'Account',
  srDelta: 'SR delta',
  rankAtStart: 'Rank at start',
  duration: 'Duration',
  finalScore: 'Final score',
  performance: 'Performance',
  measuredGrades: 'Target grades',
  flags: 'Flags',
  party: 'Party',
};

/**
 * "Show older games" (M1) — rows loaded past `DashboardData.matches`'s own
 * capped page, appended client-side. Keyed to the current filters so a role/
 * account/date change (a genuinely different filtered set) drops any extra
 * page instead of mixing rows from two different scopes; a background
 * refresh under the SAME filters (a new live match landing) leaves it alone
 * — the older rows already loaded are still exactly as valid.
 */
let extraOlderMatches: MatchRow[] = [];
let extraOlderFiltersKey: string | null = null;
let loadingOlder = false;

/**
 * The in-list filter row (M2) — result, map type, and a map/hero/account
 * search, all client-side and reset on navigating away from Matches (never
 * persisted — Reset up top already covers the "real" range/role/account
 * filters). `store.subscribe` below is the same "leaving the view" idiom
 * `views/settings/index.ts` uses for its own reset-on-navigate state.
 */
let matchResultFilter = new Set<Result>();
let matchTypeFilter = new Set<string>();
let matchSearch = '';
let onMatches = false;
store.subscribe((state) => {
  if (state.view !== 'matches' && onMatches) {
    onMatches = false;
    matchResultFilter = new Set();
    matchTypeFilter = new Set();
    matchSearch = '';
  } else if (state.view === 'matches') {
    onMatches = true;
  }
});

function filtersKey(f: DashboardFilters): string {
  return JSON.stringify(f);
}

/**
 * The client-side half of the in-list filter (M2) — deliberately a separate,
 * small function rather than reusing core's `matchesFilter`: `MatchRow`
 * already carries a resolved `mapType`, so there is no `mapModeOf` to thread
 * through, and `MatchRow` isn't structurally a `GameRecord`. Mirrors
 * `matchesFilter`'s exact semantics (multi-select OR within a dimension, AND
 * across dimensions) so the two never visibly disagree.
 */
function textFilterRows(rows: MatchRow[], f: { results: Set<Result>; mapTypes: Set<string>; search: string }): MatchRow[] {
  let out = rows;
  if (f.results.size) out = out.filter((m) => f.results.has(m.result));
  if (f.mapTypes.size) out = out.filter((m) => f.mapTypes.has(m.mapType));
  const q = f.search.trim().toLowerCase();
  if (q) {
    out = out.filter((m) =>
      m.map.toLowerCase().includes(q)
      || m.account.toLowerCase().includes(q)
      || m.heroes.some((h) => h.toLowerCase().includes(q)));
  }
  return out;
}

export function matches(ctx: ViewContext): HTMLElement {
  const { day, flag, map } = ctx.params;
  const key = filtersKey(ctx.data.filters);
  if (extraOlderFiltersKey !== key) {
    extraOlderMatches = [];
    extraOlderFiltersKey = key;
    loadingOlder = false;
  }

  // The shell rebuilds the whole view on every new snapshot — a background
  // refresh, a tracked match, the window-focus refetch — which would replace
  // the search input and drop the caret mid-typing (same concern players.ts
  // already works around). The factory runs BEFORE `replaceChildren`, so the
  // outgoing input is still the active element here.
  const outgoing = document.activeElement;
  const hadFocus = outgoing instanceof HTMLInputElement && outgoing.classList.contains('matches-search-input');
  const caret = hadFocus ? outgoing.selectionStart : null;

  const host = h('div', { class: 'view view--wide' });
  const headHost = h('div');
  const scopeHost = h('div');
  const listHost = h('div');
  const clearHost = h('span');

  // In-list filter row (M2): result + map-type chips and a search box, all
  // client-side over what's already loaded and reset the moment you leave
  // this screen (the `store.subscribe` near the module state above).
  const searchInput = h('input', {
    class: 'search-input matches-search-input',
    type: 'search',
    placeholder: 'Search map, hero or account…',
    value: matchSearch,
    'aria-label': 'Search matches by map, hero, or account',
  }) as HTMLInputElement;
  searchInput.addEventListener('input', () => {
    matchSearch = searchInput.value;
    render(clearHost, clearLink());
    repaint();
  });

  const resultChipsHost = h('div', { style: { display: 'flex', gap: '6px' } });
  const typeChipsHost = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
  const paintResultChips = (): void => {
    render(resultChipsHost, ...(['Win', 'Loss', 'Draw'] as Result[]).map((r) =>
      chip(RESULT_LETTER[r], matchResultFilter.has(r), () => {
        if (matchResultFilter.has(r)) matchResultFilter.delete(r); else matchResultFilter.add(r);
        paintResultChips();
        render(clearHost, clearLink());
        repaint();
      })));
  };
  const paintTypeChips = (): void => {
    render(typeChipsHost, ...ctx.data.byMapType.map((g) =>
      chip(g.key, matchTypeFilter.has(g.key), () => {
        if (matchTypeFilter.has(g.key)) matchTypeFilter.delete(g.key); else matchTypeFilter.add(g.key);
        paintTypeChips();
        render(clearHost, clearLink());
        repaint();
      })));
  };
  const hasTextFilter = (): boolean =>
    matchResultFilter.size > 0 || matchTypeFilter.size > 0 || matchSearch.trim() !== '';
  const clearLink = (): HTMLElement | null =>
    hasTextFilter()
      ? inlineLink('Clear filter', {
          onClick: () => {
            matchResultFilter = new Set();
            matchTypeFilter = new Set();
            matchSearch = '';
            searchInput.value = '';
            paintResultChips();
            paintTypeChips();
            render(clearHost, clearLink());
            repaint();
          },
        })
      : null;
  paintResultChips();
  paintTypeChips();
  render(clearHost, clearLink());

  const repaint = (): void => {
    // Drill-downs (day/flag/map) scope to what's ALREADY loaded — "show
    // older" only makes sense on the unscoped list, since a drill-down's own
    // scope can't be expressed in the paging IPC call.
    const allMatches = day || flag || map ? ctx.data.matches : [...ctx.data.matches, ...extraOlderMatches];
    const scoped = day
      ? allMatches.filter((m) => dayKey(m.timestamp) === day)
      : flag
        ? allMatches.filter((m) => m.flags?.[flag])
        : map
          ? allMatches.filter((m) => m.map === map)
          : allMatches;
    const textActive = hasTextFilter();
    const rows = textActive
      ? textFilterRows(scoped, { results: matchResultFilter, mapTypes: matchTypeFilter, search: matchSearch })
      : scoped;

    // By day / by sitting (S4) — a single-day drill-down (from the heatmap)
    // keeps calendar grouping; grouping any further by sitting inside one
    // already-picked day would be a distinction with no real difference.
    const grouping = day ? 'day' : (prefs.get('matchGrouping') ?? 'day');
    const bySitting = grouping === 'sitting';
    const groups = bySitting
      ? groupBySitting(rows, ctx.data.sessionSettings.gapMinutes)
      : groupByDay(rows);
    // A flag drill-down shows why each row is actually in the list even when
    // the player's own column setup hides Flags (M4) — an effective-only
    // override, never written back to the stored pref, so leaving the
    // drill-down restores whatever the player actually configured.
    const storedColumns = prefs.get('matchColumns') ?? MATCH_COLUMNS_DEFAULT;
    const columns = flag ? { ...storedColumns, flags: 'inline' as const } : storedColumns;

    // Honesty (M1): `matches` itself silently caps at MATCHES_PAGE_SIZE rows,
    // so the header used to claim a count that could flatly disagree with
    // the status bar's own (uncapped) one on any range past 150 games.
    const loadedTotal = allMatches.length;
    const moreToLoad = !day && !flag && !map && loadedTotal < ctx.data.matchesTotal;

    // Truthful drill-down subtitles (M3): a day/flag chip used to sit right
    // above a headline that still read the generic "N games in range" — for
    // `day` that flatly repeated the chip's own date, and neither scope's
    // subtitle stated its own tally even though every row already carries it.
    let headline: string;
    if (day) {
      const tally = groupByDay(scoped)[0] ?? { wins: 0, losses: 0, draws: 0, srNet: undefined };
      headline = textActive
        ? `${rows.length} of ${scoped.length} games on ${prettyDay(day)} match your filter · ${tallyText(tally)}`
        : `${scoped.length} game${scoped.length === 1 ? '' : 's'} on ${prettyDay(day)} · ${tallyText(tally)}`;
    } else if (flag) {
      const flagLabel = FLAG_LABELS[flag];
      headline = textActive
        ? `${rows.length} of ${scoped.length} ${flagLabel} games match your filter`
        : `${scoped.length} ${flagLabel} game${scoped.length === 1 ? '' : 's'} in range`;
    } else {
      headline = textActive
        ? `${rows.length} of ${allMatches.length} loaded games match your filter${moreToLoad ? ` (${ctx.data.matchesTotal} total in range)` : ''} · click a match for details`
        : moreToLoad
          ? `Showing the ${loadedTotal} most recent of ${ctx.data.matchesTotal} games in range · newest first · click a match for details`
          : `${rows.length} games in range · newest first · click a match for details`;
    }

    const headActions: Node[] = [];
    if (!day) headActions.push(groupingToggle(grouping));
    headActions.push(customizeViewButton());
    render(headHost, viewHead('Matches', headline, headActions));

    render(scopeHost, day || flag || map ? drillDownChip(ctx, day, flag, map, allMatches) : null);

    render(listHost,
      rows.length
        ? h('div', null,
            // A day drill-down's single group would just repeat the chip's own
            // date directly under it (M3) — the header stays for every other
            // grouping (all days, and every sitting).
            ...groups.flatMap((g) => [
              day ? null : dayHeader(g.label, g),
              ...g.items.map((m) => matchRow(m, ctx, columns)),
            ]),
            moreToLoad ? showOlderRow(ctx, repaint) : null,
          )
        : (day || flag || map)
          ? emptyState('No games match this drill-down — clear the scope above to see everything.')
          : textActive
            ? emptyState('No loaded games match this filter — try Show older games, or clear the filter.')
            : emptyActions(ctx),
    );
  };
  repaint();

  render(host,
    headHost,
    h('div', { class: 'matches-filter-row' },
      resultChipsHost, typeChipsHost, searchInput, clearHost,
    ),
    scopeHost,
    card({ class: 'card--flush', style: { padding: '8px' } }, listHost),
  );

  // After the shell mounts this tree (the factory returns first, `render`
  // replaces the children right after), put the caret back where it was.
  if (hadFocus) {
    setTimeout(() => {
      if (!host.isConnected) return;
      searchInput.focus();
      const at = caret ?? searchInput.value.length;
      searchInput.setSelectionRange(at, at);
    }, 0);
  }

  return host;
}

/**
 * "Show older games" (M1) — fetches the next page via `bridge.matchesPage`
 * and appends it client-side; no data refetch, so the rest of the dashboard
 * (KPIs, Focus, etc.) stays exactly as it was. Carries the active in-list
 * filter (M2), when one is set, so a search reaches past what's currently
 * loaded instead of only ever searching the first capped page — the server
 * applies the SAME filter before capping the page, so "Show older games"
 * under a search returns up to a full page of actual matches, not mostly
 * rows the client would immediately filter back out.
 */
function showOlderRow(ctx: ViewContext, repaint: () => void): HTMLElement {
  const oldest = [...ctx.data.matches, ...extraOlderMatches]
    .reduce((min, m) => Math.min(min, m.timestamp), Infinity);
  const btn = button(loadingOlder ? 'Loading…' : 'Show older games', {
    variant: 'ghost', class: 'btn--block',
    disabled: loadingOlder || !Number.isFinite(oldest),
    onClick: () => {
      if (loadingOlder || !Number.isFinite(oldest)) return;
      loadingOlder = true;
      repaint();
      const text = (matchResultFilter.size || matchTypeFilter.size || matchSearch.trim())
        ? { results: [...matchResultFilter], mapTypes: [...matchTypeFilter], search: matchSearch }
        : undefined;
      void bridge.matchesPage({ filters: ctx.data.filters, before: oldest, limit: MATCHES_PAGE_SIZE, text })
        .then((page) => {
          extraOlderMatches = [...extraOlderMatches, ...page];
          loadingOlder = false;
          repaint();
        })
        .catch(() => { loadingOlder = false; repaint(); });
    },
  });
  return h('div', { style: { padding: '10px' } }, btn);
}

/** "By day / By sitting" (S4) — persisted, triggers a full re-render since regrouping needs the whole list re-walked. */
function groupingToggle(value: 'day' | 'sitting'): HTMLElement {
  return segmented({
    options: [{ value: 'day', label: 'By day' }, { value: 'sitting', label: 'By sitting' }],
    value,
    onChange: (v) => { prefs.set('matchGrouping', v); store.rerender(); },
  });
}

/** "Customize view" affordance — opens the per-field hidden/inline/column popover (spec F1). */
function customizeViewButton(): HTMLElement {
  const btn = button('Customize view', { variant: 'soft' });
  btn.addEventListener('click', () => openCustomizeViewPopover(btn));
  return btn;
}

function openCustomizeViewPopover(anchor: HTMLElement): void {
  openPopover(anchor, () => {
    const current = { ...MATCH_COLUMNS_DEFAULT, ...(prefs.get('matchColumns') ?? MATCH_COLUMNS_DEFAULT) };
    return h('div', { class: 'stack', style: { gap: '10px', minWidth: '260px' } },
      h('div', { class: 'gep-popover-title' }, 'Customize view'),
      ...FIELD_ORDER.map((key) => customizeViewRow(key, current)),
    );
  });
}

function customizeViewRow(key: MatchColumnKey, current: MatchColumnsPref): HTMLElement {
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
    h('span', { style: { fontSize: '11px', color: 'var(--muted-2)' } }, FIELD_LABELS[key]),
    segmented<MatchFieldMode>({
      options: [
        { value: 'hidden', label: 'Hidden' },
        { value: 'inline', label: 'Inline' },
        { value: 'column', label: 'Column' },
      ],
      value: current[key],
      fill: true,
      onChange: (mode) => {
        const next: MatchColumnsPref = { ...(prefs.get('matchColumns') ?? MATCH_COLUMNS_DEFAULT), [key]: mode };
        prefs.set('matchColumns', next);
        store.rerender();
      },
    }),
  );
}

/**
 * Dismissible "Only <scope> ✕" chip shown while a day/flag/map drill-down is
 * active. A day drill-down additionally gets ‹ › day-stepping (M3) — before
 * this, the only way to look at the day before was back to Overview, find
 * the heatmap cell, click again. Stepping is scoped to days actually present
 * in `allMatches` (the loaded page, same list the drill-down itself reads
 * from) rather than `ctx.data.calendar`, which only spans the last 35 days.
 */
function drillDownChip(
  ctx: ViewContext,
  day: string | undefined,
  flag: MatchFlagKey | undefined,
  map: string | undefined,
  allMatches: MatchRow[],
): HTMLElement {
  const label = day ? prettyDay(day) : map ? map : FLAG_LABELS[flag as MatchFlagKey];
  const scopeChip = chip(`Only ${label} ✕`, true, () => ctx.navigate('matches'));
  if (!day) return h('div', { style: { margin: '0 0 12px' } }, scopeChip);

  const dayKeys = groupByDay(allMatches).map((g) => g.key); // newest first
  const idx = dayKeys.indexOf(day);
  const olderDay = idx >= 0 && idx + 1 < dayKeys.length ? dayKeys[idx + 1] : null;
  const newerDay = idx > 0 ? dayKeys[idx - 1] : null;
  return h('div', { style: { margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '6px' } },
    dayStepButton('‹', olderDay, ctx, 'Previous day with games'),
    scopeChip,
    dayStepButton('›', newerDay, ctx, 'Next day with games'),
  );
}

function dayStepButton(label: string, target: string | null, ctx: ViewContext, hint: string): HTMLElement {
  return button(label, {
    variant: 'ghost',
    disabled: !target,
    title: target ? hint : undefined,
    onClick: () => { if (target) ctx.navigate('matches', { day: target }); },
  });
}

/** Empty in range — offer the next step instead of a dead end. */
function emptyActions(ctx: ViewContext): HTMLElement {
  const hasOlderGames = ctx.data.totalGamesAllTime > 0 && ctx.data.filters.days !== 'all';
  return h('div', { style: { padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'flex-start' } },
    emptyState('No matches in this range yet.'),
    h('div', { style: { display: 'flex', gap: '10px' } },
      hasOlderGames
        ? button(`Show all time (${ctx.data.totalGamesAllTime} games)`, {
            variant: 'soft',
            onClick: () => ctx.setFilter({ days: 'all' }),
          })
        : null,
      button('Log a match', { variant: 'soft', onClick: () => ctx.openLogMatch() }),
    ),
  );
}

/** `wins–losses`, extended `wins–losses–draws` only when the group actually has a draw (M3) — a draw used to vanish from the tally entirely. */
function winLossText(g: { wins: number; losses: number; draws: number }): string {
  return g.draws > 0 ? `${g.wins}–${g.losses}–${g.draws}` : `${g.wins}–${g.losses}`;
}

/** {@link winLossText} plus the group's SR net, when any row in it logged one — never a fabricated 0%. */
function tallyText(g: { wins: number; losses: number; draws: number; srNet?: number }): string {
  const wl = winLossText(g);
  return g.srNet !== undefined ? `${wl} · ${signed(Math.round(g.srNet))}%` : wl;
}

/**
 * A day/sitting header used to read "0–1" then a redundant "−1 net" restating
 * the same subtraction, with the day's own SR swing never shown even though
 * every row carries `srDelta` (M3). Now: the tally (draws only when present),
 * the SR net tinted win/loss like the row's own srDelta cell, and the day's
 * winrate moved into the header's title instead of a third inline number.
 */
function dayHeader(label: string, g: { wins: number; losses: number; draws: number; srNet?: number }): HTMLElement {
  const decided = g.wins + g.losses;
  const title = decided > 0 ? `${pct(g.wins / decided)} winrate` : undefined;
  return h('div', { class: 'day-header', title },
    h('span', { class: 'day-header-label' }, prettyDay(label)),
    h('span', { class: 'mono u-muted', style: { fontSize: '11px' } }, winLossText(g)),
    g.srNet !== undefined
      ? h('span', {
          class: 'mono',
          style: { fontSize: '11px', color: g.srNet >= 0 ? 'var(--win-text)' : 'var(--loss-text)' },
        }, `${signed(Math.round(g.srNet))}%`)
      : null,
  );
}

/** A field's rendered value for `m`, or `null` when it has nothing to show (spec F3). */
function fieldNode(key: MatchColumnKey, m: MatchRow, ctx: ViewContext, mode: MatchFieldMode = 'inline'): Node | null {
  switch (key) {
    case 'role':
      return m.role ? h('span', { class: 'tag tag--role' }, roleIcon(m.role)) : null;
    case 'heroes':
      return m.heroes.length ? heroLinks(m, ctx) : null;
    case 'account':
      return m.account ? document.createTextNode(m.account) : null;
    case 'srDelta':
      return m.srDelta != null
        ? h('span', { class: 'mono', style: { color: m.srDelta >= 0 ? 'var(--win-text)' : 'var(--loss-text)' } }, signed(m.srDelta))
        : null;
    case 'rankAtStart':
      // The rank you were sitting at going INTO this match — a stored snapshot,
      // so a later correction to an older game never restates it. Only present
      // when the match records a ±%; blank otherwise, rather than repeating the
      // previous match's rank as if it were evidence.
      // Short in COLUMN mode (a fixed 84px cell), full inline — the inline form
      // lands in the free-flowing `1fr` meta track and has all the room it needs.
      return m.rankAtStart
        ? h('span', {
            class: 'mono u-dim',
            title: `The rank you had when this match started — ${rankLabel(m.rankAtStart.tier, m.rankAtStart.division)}`,
          }, `${(mode === 'column' ? shortRankLabelOf : rankLabel)(m.rankAtStart.tier, m.rankAtStart.division)} · ${Math.round(m.rankAtStart.progressPct)}%`)
        : null;
    case 'duration':
      return m.durationMinutes != null ? document.createTextNode(`${m.durationMinutes}m`) : null;
    case 'finalScore':
      return m.finalScore ? document.createTextNode(m.finalScore) : null;
    case 'performance':
      // The 0-100 self-rating as a small stat, tinted with the same continuous
      // ramp the performance slider uses, so the colour language matches.
      return m.performance != null
        ? h('span', { class: 'mono', title: 'Self-rated performance', style: { color: wrHsl(m.performance / 100) } }, String(m.performance))
        : null;
    case 'measuredGrades':
      return gradePills(m, ctx);
    case 'flags':
      return flagPills(m);
    case 'party':
      return m.groupSize != null ? document.createTextNode(partyLabel(m.groupSize)) : null;
    default:
      return null;
  }
}

/** "Solo" / "Duo" / "5-stack" — the Matches-list Party field (H9). */
function partyLabel(size: number): string {
  if (size <= 1) return 'Solo';
  if (size === 2) return 'Duo';
  return `${size}-stack`;
}

/** Hit/Partial/Missed pill vocabulary — the Review card's grade tones (spec F1 extension, #68). */
const GRADE_PILLS: Record<TargetGrade, { label: string; state: PillState }> = {
  hit: { label: 'Hit', state: 'win' },
  partial: { label: 'Partial', state: 'draw' },
  missed: { label: 'Missed', state: 'loss' },
};

/**
 * One aggregate grade pill for a row, **mode-aware** per target: a measured (⚡)
 * target shows its auto-calculated grade (`measuredGrades`), a self (◎) target
 * shows the player's stored grade (`targetGrades`). A measured target the match
 * can't measure (`'no-stat'`) is skipped — neutral, never counted as a miss.
 * Several targets collapse into a single grade via {@link aggregateGrade} (floor
 * of the average, toward the worse grade) rather than a run of pills; the tooltip
 * lists each target's own grade (name falling back to a placeholder for a
 * since-deleted target) so the summary stays explainable.
 */
function gradePills(m: MatchRow, ctx: ViewContext): HTMLElement | null {
  const targetsById = new Map(ctx.data.targets.map((t) => [t.id, t]));
  const ids = new Set([...Object.keys(m.measuredGrades ?? {}), ...Object.keys(m.targetGrades ?? {})]);
  const entries: Array<[string, TargetGrade]> = [];
  for (const id of ids) {
    if (targetsById.get(id)?.mode === 'measured') {
      const mg = m.measuredGrades?.[id];
      if (mg && mg !== 'no-stat') entries.push([id, mg.grade]);
    } else {
      const sg = m.targetGrades?.[id];
      const t = targetsById.get(id);
      // A self grade stored before the target picked up a scope that now
      // excludes this match no longer counts — mirrors the Review screen.
      // A since-deleted target (t undefined) has no scope to check, so its
      // grade still shows, same as before.
      if (sg && (!t || matchInTargetScope(m, t))) entries.push([id, sg]);
    }
  }
  if (!entries.length) return null;
  const summary = aggregateGrade(entries.map(([, grade]) => grade));
  if (!summary) return null;
  const nameOf = (id: string): string => targetsById.get(id)?.name ?? 'target';
  const p = pill(GRADE_PILLS[summary].label, GRADE_PILLS[summary].state);
  const lines = entries.map(([id, grade]) => `${nameOf(id)}: ${GRADE_PILLS[grade].label}`);
  p.title = entries.length > 1
    ? `${lines.join('\n')}\n→ ${GRADE_PILLS[summary].label} (average)`
    : lines[0];
  return pillRow([p]);
}

/** Per-row flag pill vocabulary — compact labels, tones matching the match-detail header pills. */
const FLAG_PILLS: Array<{ key: MatchFlagKey; label: string; state: PillState }> = [
  { key: 'tilt', label: 'Tilt', state: 'loss' },
  { key: 'toxicMates', label: 'Toxic', state: 'loss' },
  { key: 'leaver', label: 'Leaver', state: 'draw' },
  { key: 'positiveComms', label: '+Comms', state: 'win' },
  { key: 'abusive', label: 'Abusive', state: 'loss' },
];

/** Compact leaver/mental flag pills for a row, or `null` when unflagged (spec F3). */
function flagPills(m: MatchRow): HTMLElement | null {
  const set = FLAG_PILLS.filter((f) => m.flags?.[f.key]);
  return set.length
    ? pillRow(set.map((f) => {
        const p = pill(f.label, f.state);
        p.title = FLAG_LABELS[f.key];
        return p;
      }))
    : null;
}

/** A run of pills — shared by the grades and flags fields. Wraps (right-aligned)
 *  rather than ellipsis-clipping when a row carries more than the column fits. */
function pillRow(pills: HTMLElement[]): HTMLElement {
  return h('span', { style: { display: 'inline-flex', flexWrap: 'wrap', maxWidth: '100%', gap: '4px', alignItems: 'center', justifyContent: 'flex-end', verticalAlign: 'middle' } }, ...pills);
}

/** Hero cross-links, comma-joined; stopPropagation keeps the row click intact. */
function heroLinks(m: MatchRow, ctx: ViewContext): HTMLElement {
  return h('span', null, ...m.heroes.flatMap((hero, i) => [
    i ? ', ' : '',
    inlineLink(hero, {
      title: `Open ${hero}'s drill-down`,
      onClick: (e) => { e.stopPropagation(); openHeroDrawer(ctx, hero); },
    }),
  ]));
}

function matchRow(m: MatchRow, ctx: ViewContext, columns: MatchColumnsPref): HTMLElement {
  const open = (): void => ctx.navigate('matchDetail', { matchId: m.matchId });
  const state = RESULT_STATE[m.result];

  // Inline segments: only fields whose mode is 'inline' AND non-empty (spec F3) — no
  // '—' placeholder, no leading/trailing/doubled separators; omit `.row-meta` entirely
  // when nothing qualifies.
  const inlineSegments = FIELD_ORDER
    .filter((key) => columns[key] === 'inline')
    .map((key) => fieldNode(key, m, ctx, 'inline'))
    .filter((node): node is Node => node != null);
  const metaLine = inlineSegments.length
    ? h('div', { class: 'row-meta' }, ...joinWithDot(inlineSegments))
    : null;

  const columnKeys = FIELD_ORDER.filter((key) => columns[key] === 'column');
  const columnCells = columnKeys
    .map((key) => h('div', { class: `match-col match-col--${key}` }, fieldNode(key, m, ctx, 'column') ?? ''));

  return h('div', {
    class: 'match-row is-clickable',
    // `.match-row` is a fixed grid (44px 1fr | ...column cells... | 84px 46px);
    // set the middle track count to match how many fields are in 'column' mode
    // this render, so extra column cells get their own tracks instead of
    // wrapping onto an implicit second row (spec F1 layout fix). CSP-safe:
    // plain element-style assignment via the h() style option, no <style> tag.
    style: { gridTemplateColumns: matchRowGridTemplate(columnKeys.length) },
    ...clickableRow(open),
  },
    h('div', { class: `match-result is-${state}` }, RESULT_LETTER[m.result]),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-name' },
        inlineLink(m.map, {
          strong: true,
          title: `Find ${m.map} on the Maps screen`,
          onClick: (e) => { e.stopPropagation(); ctx.navigate('maps', { highlight: m.map }); },
        }),
      ),
      metaLine,
    ),
    ...columnCells,
    // Fixed widths (not just min) on the two always-visible trailing cells: the grid's
    // `auto` tracks otherwise size to content (pill label / relTime length), which drifts
    // row-to-row and throws off the `.match-col` alignment inserted before them.
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', width: '84px' } },
      pill(m.mapType, 'accent'),
    ),
    // Clock time, not a relative age (M3) — a day header already carries the
    // date, so "1d, 1d, 1d" under a "YESTERDAY" header told you nothing a
    // row's own pacing within the day couldn't; the relative age still lives
    // in the title for a quick hover. Widened from 46px to fit the locale's
    // longest clock form ("12:34 PM").
    h('div', {
      class: 'mono u-muted', style: { fontSize: '11px', width: '64px', textAlign: 'right' },
      title: relTime(m.timestamp),
    }, time(m.timestamp)),
    rowMenuButton(m, ctx),
  );
}

/**
 * The per-row overflow (⋯) — today just Delete.
 *
 * Always visible rather than revealed on `.match-row:hover`, and a popover
 * rather than an inline confirm: this row is itself a click target that
 * navigates, so a control that appears under the cursor mid-scroll, or that a
 * double-click could arm and commit in one gesture, would put an irreversible
 * delete one stray gesture away. Going through the popover means nothing
 * destructive is reachable without a deliberate, aimed click.
 */
function rowMenuButton(m: MatchRow, ctx: ViewContext): HTMLElement {
  const btn = h('button', {
    class: 'match-row-menu',
    title: 'More actions',
    'aria-label': `More actions for your ${m.map} ${m.result.toLowerCase()}`,
  }, '⋯');
  btn.addEventListener('click', (e) => {
    // Never let opening the menu also navigate into the match.
    e.stopPropagation();
    openRowMenu(btn, m, ctx);
  });
  return btn;
}

function openRowMenu(anchor: HTMLElement, m: MatchRow, ctx: ViewContext): void {
  openPopover(anchor, (close) =>
    h('div', { class: 'stack', style: { gap: '10px', minWidth: '250px' } },
      // Name the match being acted on. A bare "Delete?" on a dense list tells
      // the user nothing about which game they are about to lose.
      h('div', { class: 'gep-popover-title' }, `${m.map} · ${m.result}`),
      h('div', { class: 'hint' },
        `${m.heroes[0] ?? '—'} · ${roleLabel(m.role)} · ${relTime(m.timestamp)}`),
      button('Open match', {
        variant: 'ghost',
        class: 'btn--block',
        onClick: () => { close(); ctx.navigate('matchDetail', { matchId: m.matchId }); },
      }),
      // Only offered while ungraded (R4) — the same "point straight at the
      // job" shortcut the match detail header now offers too, so a game
      // doesn't need to be opened, read, then re-found in the Review inbox
      // just to grade it.
      !m.reviewed
        ? button('Grade on Review', {
            variant: 'ghost',
            class: 'btn--block',
            onClick: () => { close(); ctx.navigate('review', { matchId: m.matchId }); },
          })
        : null,
      button('Edit match…', {
        variant: 'ghost',
        class: 'btn--block',
        onClick: () => { close(); openMatchEditorById(ctx, m.matchId); },
      }),
      confirmButton({
        label: 'Delete match',
        confirmLabel: "Delete permanently — can't be undone",
        variant: 'ghost',
        class: 'btn--block',
        title: 'Remove this match from your history',
        confirmTitle: `Permanently deletes your ${m.map} ${m.result.toLowerCase()} from ${relTime(m.timestamp)} ago`,
        onConfirm: (reset) => {
          close();
          void deleteMatch(m, reset);
        },
      }),
    ));
}

/**
 * `.match-row`'s grid template for `columnCount` active 'column' fields: fixed
 * result-badge + main-content tracks, one `auto` track per column cell (each
 * cell's own width comes from its `.match-col--<key>` class so same-key cells
 * still line up across rows), then the three fixed always-visible trailing
 * tracks (map-type pill, relative time, the ⋯ row menu).
 */
function matchRowGridTemplate(columnCount: number): string {
  const columnTracks = Array(columnCount).fill('auto').join(' ');
  return ['44px', '1fr', columnTracks, '84px', '64px', '24px'].filter(Boolean).join(' ');
}

/** Interleave ` · ` only between present segments — never leading/trailing/doubled. */
function joinWithDot(nodes: Node[]): Node[] {
  return nodes.flatMap((node, i) => (i ? [document.createTextNode(' · '), node] : [node]));
}
