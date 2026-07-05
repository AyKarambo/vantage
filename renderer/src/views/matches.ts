/** Matches — the recent game log, grouped by day (my interpretation of the Matches screen). */
import { h } from '../dom';
import type { MatchFlagKey, MatchRow } from '../../../src/shared/contract';
import { dayKey, groupByDay } from '../../../src/core/analytics';
import { relTime, roleLabel, signed } from '../format';
import { button, card, chip, emptyState, pill, RESULT_LETTER, RESULT_STATE } from '../components/primitives';
import { openHeroDrawer } from './heroes';
import { viewHead, type ViewContext } from './view';

/** Human labels for the drill-down chip, matching Mental's "Flags this range" card. */
const FLAG_LABELS: Record<MatchFlagKey, string> = {
  tilt: 'tilt-flagged',
  toxicMates: 'toxic-mates-flagged',
  leaver: 'leaver-flagged',
  positiveComms: 'positive-comms',
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

  return h('div', { class: 'view' },
    viewHead('Matches', `${rows.length} games in range · newest first · click a match for details`),
    scopeChip,
    card({ class: 'card--flush', style: { padding: '8px' } },
      rows.length
        ? h('div', null, ...groups.flatMap((g) => [
            dayHeader(g.label, g.wins, g.losses),
            ...g.items.map((m) => matchRow(m, ctx)),
          ]))
        : (day || flag) ? emptyState('No games match this drill-down — clear the scope above to see everything.') : emptyActions(ctx),
    ),
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

function matchRow(m: MatchRow, ctx: ViewContext): HTMLElement {
  const open = (): void => ctx.navigate('matchDetail', { matchId: m.matchId });
  const state = RESULT_STATE[m.result];
  // Hero/map are inline cross-links: stopPropagation keeps the row click intact.
  const heroLinks = m.heroes.length
    ? m.heroes.flatMap((hero, i) => [
        i ? ', ' : '',
        h('button', {
          class: 'inline-link',
          title: `Open ${hero}'s drill-down`,
          on: { click: (e) => { e.stopPropagation(); openHeroDrawer(ctx, hero); } },
        }, hero),
      ])
    : ['—'];
  return h('div', { class: 'match-row is-clickable', on: { click: open } },
    h('div', { class: `match-result is-${state}` }, RESULT_LETTER[m.result]),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-name' },
        h('button', {
          class: 'inline-link inline-link--strong',
          title: `Find ${m.map} on the Maps screen`,
          on: { click: (e) => { e.stopPropagation(); ctx.navigate('maps', { highlight: m.map }); } },
        }, m.map),
      ),
      h('div', { class: 'row-meta' }, `${roleLabel(m.role)} · `, ...heroLinks, ` · ${m.account}`),
    ),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
      pill(m.mapType, 'accent'),
      h('span', { class: 'u-dim', style: { fontSize: '11px' } }, m.gameType),
    ),
    h('div', { class: 'mono u-muted', style: { fontSize: '11px', minWidth: '46px', textAlign: 'right' } }, relTime(m.timestamp)),
  );
}
