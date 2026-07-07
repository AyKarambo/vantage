/** Matches — the recent game log, grouped by day (my interpretation of the Matches screen). */
import { h } from '../dom';
import type { MatchFlagKey, MatchRow } from '../../../src/shared/contract';
import { dayKey, groupByDay } from '../../../src/core/analytics';
import { relTime, roleLabel, signed } from '../format';
import { button, card, chip, emptyState, pill, RESULT_LETTER, RESULT_STATE, segmented } from '../components/primitives';
import { openPopover } from '../components/popover';
import { openHeroDrawer } from './heroes';
import { viewHead, type ViewContext } from './view';
import { prefs, MATCH_COLUMNS_DEFAULT, type MatchColumnKey, type MatchColumnsPref, type MatchFieldMode } from '../prefs';
import { store } from '../store';

/** Human labels for the drill-down chip, matching Mental's "Flags this range" card. */
const FLAG_LABELS: Record<MatchFlagKey, string> = {
  tilt: 'tilt-flagged',
  toxicMates: 'toxic-mates-flagged',
  leaver: 'leaver-flagged',
  positiveComms: 'positive-comms',
  abusive: 'abusive-comms',
};

/** Canonical field order — both the "Customize view" popover and rendering follow this (spec F1). */
const FIELD_ORDER: MatchColumnKey[] = ['role', 'heroes', 'account', 'srDelta', 'duration', 'finalScore'];

const FIELD_LABELS: Record<MatchColumnKey, string> = {
  role: 'Role',
  heroes: 'Heroes',
  account: 'Account',
  srDelta: 'SR delta',
  duration: 'Duration',
  finalScore: 'Final score',
};

export function matches(ctx: ViewContext): HTMLElement {
  const { day, flag } = ctx.params;
  const rows = day
    ? ctx.data.matches.filter((m) => dayKey(m.timestamp) === day)
    : flag
      ? ctx.data.matches.filter((m) => m.flags?.[flag])
      : ctx.data.matches;
  const groups = groupByDay(rows);
  const scopeChip = day || flag ? drillDownChip(ctx, day, flag) : null;
  const columns = prefs.get('matchColumns') ?? MATCH_COLUMNS_DEFAULT;

  return h('div', { class: 'view' },
    viewHead('Matches', `${rows.length} games in range · newest first · click a match for details`,
      customizeViewButton()),
    scopeChip,
    card({ class: 'card--flush', style: { padding: '8px' } },
      rows.length
        ? h('div', null, ...groups.flatMap((g) => [
            dayHeader(g.label, g.wins, g.losses),
            ...g.items.map((m) => matchRow(m, ctx, columns)),
          ]))
        : (day || flag) ? emptyState('No games match this drill-down — clear the scope above to see everything.') : emptyActions(ctx),
    ),
  );
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

/** Dismissible "Only <scope> ✕" chip shown while a day/flag drill-down is active. */
function drillDownChip(ctx: ViewContext, day: string | undefined, flag: MatchFlagKey | undefined): HTMLElement {
  const label = day ? prettyDay(day) : FLAG_LABELS[flag as MatchFlagKey];
  return h('div', { style: { margin: '0 0 12px' } },
    chip(`Only ${label} ✕`, true, () => ctx.navigate('matches')),
  );
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

function dayHeader(label: string, wins: number, losses: number): HTMLElement {
  return h('div', { class: 'day-header' },
    h('span', { class: 'day-header-label' }, prettyDay(label)),
    h('span', { class: 'mono u-muted', style: { fontSize: '11px' } }, `${wins}–${losses}`),
    h('span', { class: 'u-dim', style: { fontSize: '11px' } }, `${signed(wins - losses)} net`),
  );
}

/** 'Today'/'Yesterday' pass through; raw day keys render as a friendly date. */
function prettyDay(label: string): string {
  if (label === 'Today' || label === 'Yesterday') return label;
  const d = new Date(`${label}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? label
    : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** A field's rendered value for `m`, or `null` when it has nothing to show (spec F3). */
function fieldNode(key: MatchColumnKey, m: MatchRow, ctx: ViewContext): Node | null {
  switch (key) {
    case 'role':
      return m.role ? document.createTextNode(roleLabel(m.role)) : null;
    case 'heroes':
      return m.heroes.length ? heroLinks(m, ctx) : null;
    case 'account':
      return m.account ? document.createTextNode(m.account) : null;
    case 'srDelta':
      return m.srDelta != null
        ? h('span', { class: 'mono', style: { color: m.srDelta >= 0 ? 'var(--win-text)' : 'var(--loss-text)' } }, signed(m.srDelta))
        : null;
    case 'duration':
      return m.durationMinutes != null ? document.createTextNode(`${m.durationMinutes}m`) : null;
    case 'finalScore':
      return m.finalScore ? document.createTextNode(m.finalScore) : null;
    default:
      return null;
  }
}

/** Hero cross-links, comma-joined; stopPropagation keeps the row click intact. */
function heroLinks(m: MatchRow, ctx: ViewContext): HTMLElement {
  return h('span', null, ...m.heroes.flatMap((hero, i) => [
    i ? ', ' : '',
    h('button', {
      class: 'inline-link',
      title: `Open ${hero}'s drill-down`,
      on: { click: (e) => { e.stopPropagation(); openHeroDrawer(ctx, hero); } },
    }, hero),
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
    .map((key) => fieldNode(key, m, ctx))
    .filter((node): node is Node => node != null);
  const metaLine = inlineSegments.length
    ? h('div', { class: 'row-meta' }, ...joinWithDot(inlineSegments))
    : null;

  const columnKeys = FIELD_ORDER.filter((key) => columns[key] === 'column');
  const columnCells = columnKeys
    .map((key) => h('div', { class: `match-col match-col--${key}` }, fieldNode(key, m, ctx) ?? ''));

  return h('div', {
    class: 'match-row is-clickable',
    // `.match-row` is a fixed grid (44px 1fr | ...column cells... | 84px 46px);
    // set the middle track count to match how many fields are in 'column' mode
    // this render, so extra column cells get their own tracks instead of
    // wrapping onto an implicit second row (spec F1 layout fix). CSP-safe:
    // plain element-style assignment via the h() style option, no <style> tag.
    style: { gridTemplateColumns: matchRowGridTemplate(columnKeys.length) },
    on: { click: open },
  },
    h('div', { class: `match-result is-${state}` }, RESULT_LETTER[m.result]),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-name' },
        h('button', {
          class: 'inline-link inline-link--strong',
          title: `Find ${m.map} on the Maps screen`,
          on: { click: (e) => { e.stopPropagation(); ctx.navigate('maps', { highlight: m.map }); } },
        }, m.map),
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
    h('div', { class: 'mono u-muted', style: { fontSize: '11px', width: '46px', textAlign: 'right' } }, relTime(m.timestamp)),
  );
}

/**
 * `.match-row`'s grid template for `columnCount` active 'column' fields: fixed
 * result-badge + main-content tracks, one `auto` track per column cell (each
 * cell's own width comes from its `.match-col--<key>` class so same-key cells
 * still line up across rows), then the two fixed always-visible trailing
 * tracks (map-type pill, relative time) — unchanged from before this fix.
 */
function matchRowGridTemplate(columnCount: number): string {
  const columnTracks = Array(columnCount).fill('auto').join(' ');
  return ['44px', '1fr', columnTracks, '84px', '46px'].filter(Boolean).join(' ');
}

/** Interleave ` · ` only between present segments — never leading/trailing/doubled. */
function joinWithDot(nodes: Node[]): Node[] {
  return nodes.flatMap((node, i) => (i ? [document.createTextNode(' · '), node] : [node]));
}
