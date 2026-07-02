/** Maps — by game mode, games-played share, and every map ranked best → worst. */
import { h } from '../dom';
import type { DashboardData, Group } from '../../../src/shared/contract';
import { pct, signed } from '../format';
import { wrColor, CATEGORICAL, OTHER_COLOR } from '../theme';
import { donutChart, horizontalBars, type DonutSlice } from '../charts/plots';
import { card, statBar } from '../components/primitives';
import { viewHead, type ViewContext } from './view';

const MIN_MAP_GAMES = 3;
const TOP_SLICES = 10;

export function maps(ctx: ViewContext): HTMLElement {
  const d = ctx.data;
  return h('div', { class: 'view' },
    viewHead('Maps', 'Where the games actually go — by mode, then map by map'),
    h('div', { class: 'grid-3' }, ...d.byMapType.map(modeCard)),
    card({ title: 'Maps played', sub: 'share of games in range' },
      donutChart(mapsPlayed(d)),
    ),
    card({ title: 'Winrate by map', sub: 'best to worst · 3+ games' },
      horizontalBars(rankedMaps(d).map((m) => ({ label: m.key, winrate: m.winrate, games: m.games }))),
    ),
  );
}

function modeCard(g: Group): HTMLElement {
  return card({ style: { padding: '13px 15px' } },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '9px' } },
      h('div', { style: { fontWeight: '600', fontSize: '13.5px' } }, g.key),
      h('div', { class: 'mono', style: { fontSize: '15px', color: wrColor(g.winrate) } }, pct(g.winrate)),
    ),
    statBar({ label: `${g.games}g`, frac: g.winrate, color: wrColor(g.winrate), valueText: signed(g.wins - g.losses) }),
  );
}

/** Games-played distribution: the top maps individually, the rest as "Other". */
function mapsPlayed(d: DashboardData): DonutSlice[] {
  const sorted = [...d.byMap].sort((a, b) => b.games - a.games);
  const top = sorted.slice(0, TOP_SLICES);
  const rest = sorted.slice(TOP_SLICES);
  const slices: DonutSlice[] = top.map((m, i) => ({ label: m.key, value: m.games, color: CATEGORICAL[i % CATEGORICAL.length] }));
  const other = rest.reduce((sum, m) => sum + m.games, 0);
  if (other > 0) slices.push({ label: `Other (${rest.length} maps)`, value: other, color: OTHER_COLOR });
  return slices;
}

function rankedMaps(d: DashboardData): Group[] {
  let list = d.byMap.filter((m) => m.games >= MIN_MAP_GAMES);
  if (!list.length) list = [...d.byMap];
  return list.sort((a, b) => b.winrate - a.winrate);
}
