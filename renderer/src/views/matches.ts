/** Matches — the recent game log, grouped by day (my interpretation of the Matches screen). */
import { h } from '../dom';
import type { MatchFlagKey, MatchRow, TargetGrade } from '../../../src/shared/contract';
import { aggregateGrade, dayKey, groupByDay } from '../../../src/core/analytics';
import { relTime, signed } from '../format';
import { roleIcon } from '../components/roleIcon';
import { button, card, chip, emptyState, pill, RESULT_LETTER, RESULT_STATE, segmented, type PillState } from '../components/primitives';
import { wrHsl } from '../theme';
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
const FIELD_ORDER: MatchColumnKey[] = [
  'role', 'heroes', 'account', 'srDelta', 'duration', 'finalScore',
  'performance', 'measuredGrades', 'flags',
];

const FIELD_LABELS: Record<MatchColumnKey, string> = {
  role: 'Role',
  heroes: 'Heroes',
  account: 'Account',
  srDelta: 'SR delta',
  duration: 'Duration',
  finalScore: 'Final score',
  performance: 'Performance',
  measuredGrades: 'Target grades',
  flags: 'Flags',
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
      return m.role ? h('span', { class: 'tag tag--role' }, roleIcon(m.role)) : null;
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
    default:
      return null;
  }
}

/** Hit/Partial/Missed pill vocabulary — the Review card's grade tones (spec F1 extension, #68). */
const GRADE_PILLS: Record<TargetGrade, { label: string; state: PillState }> = {
  hit: { label: 'Hit', state: 'win' },
  partial: { label: 'Partial', state: 'draw' },
  missed: { label: 'Missed', state: 'loss' },
};

/**
 * One aggregate grade pill for a row from the match's **stored self-grades**
 * (`targetGrades`) — a match can be graded on several targets, so we collapse
 * them into a single grade via {@link aggregateGrade} (floor of the average,
 * rounding toward the worse grade) rather than a run of pills. These grades are
 * stored on the match, so they stay put regardless of later target changes; the
 * tooltip lists each target's own grade (name falling back to a placeholder for
 * a since-deleted target) so the summary stays explainable.
 */
function gradePills(m: MatchRow, ctx: ViewContext): HTMLElement | null {
  const entries = Object.entries(m.targetGrades ?? {});
  if (!entries.length) return null;
  const summary = aggregateGrade(entries.map(([, grade]) => grade));
  if (!summary) return null;
  const nameOf = (id: string): string => ctx.data.targets.find((t) => t.id === id)?.name ?? 'target';
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
