/** Trends — winrate over time, splits by role/mode/account, and activity. */
import { h } from '../dom';
import type { Group } from '../../../src/shared/contract';
import { roleLabel } from '../format';
import { horizontalBars, lineChart, type WrPoint } from '../charts/plots';
import { calendarHeatmap, card } from '../components/primitives';
import { chartCard } from '../components/chartCard';
import { pct } from '../format';
import { viewHead, type ViewContext } from './view';

export function trends(ctx: ViewContext): HTMLElement {
  const d = ctx.data;
  const byWeek = d.filters.days === 'all' || (typeof d.filters.days === 'number' && d.filters.days > 90);
  return h('div', { class: 'view' },
    viewHead('Trends', 'Momentum over time and where your winrate concentrates'),
    chartCard({
      title: 'Winrate over time',
      sub: byWeek ? 'by week' : 'by day',
      columns: [
        { key: 'label', label: byWeek ? 'Week' : 'Day' },
        { key: 'winrate', label: 'WR' },
        { key: 'games', label: 'Games' },
      ],
      rows: d.trend.map((g) => ({ label: g.key, winrate: pct(g.winrate), games: g.games })),
    }, lineChart(d.trend.map(toPoint))),
    h('div', { class: 'grid-3' },
      card({ title: 'By role' }, breakdown(d.byRole, roleLabel)),
      card({ title: 'By game mode' }, breakdown(d.byMapType)),
      card({ title: 'By account' }, breakdown(d.byAccount)),
    ),
    card({ title: 'Activity', sub: 'games/day · colour = winrate' }, calendarHeatmap(d.calendar)),
  );
}

const toPoint = (g: Group): WrPoint => ({ label: g.key, winrate: g.winrate, games: g.games });

/**
 * A compact winrate-bar list for a categorical split — one row per group, ranked
 * best → worst. Uses the same responsive horizontal bars as the Maps view so the
 * breakdowns read cleanly whether there's one row or many (vertical SVG bars
 * ballooned when a card had only a single category).
 */
function breakdown(groups: Group[], label: (key: string) => string = (k) => k): HTMLElement {
  const data = [...groups]
    .sort((a, b) => b.winrate - a.winrate)
    .map((g) => ({ label: label(g.key), winrate: g.winrate, games: g.games }));
  return horizontalBars(data, { compact: true });
}
