/** Trends — winrate over time, splits by role/mode/account, and when you play. */
import { h } from '../dom';
import type { Group, PerformanceStats, Role, RankSeriesPoint } from '../../../src/shared/contract';
import { sessionFade } from '../../../src/core/analytics';
import { shortRankLabelOf } from '../../../src/core/rankDisplay';
import { roleLabel, signed } from '../format';
import { horizontalBars, lineChart, ratingChart, rankChart, type WrPoint, type RankSeries } from '../charts/plots';
import { card, emptyState, statBox } from '../components/primitives';
import { chartCard } from '../components/chartCard';
import { pct } from '../format';
import { viewHead, type ViewContext } from './view';

export function trends(ctx: ViewContext): HTMLElement {
  const d = ctx.data;
  const byWeek = d.filters.days === 'all' || (typeof d.filters.days === 'number' && d.filters.days > 90);
  return h('div', { class: 'view' },
    viewHead('Trends', 'Momentum over time and where your winrate concentrates'),
    rankTrendCard(ctx),
    chartCard({
      title: 'Winrate over time',
      sub: `${byWeek ? 'by week' : 'by day'} · bold line = 7-${byWeek ? 'week' : 'day'} rolling average`,
      columns: [
        { key: 'label', label: byWeek ? 'Week' : 'Day' },
        { key: 'winrate', label: 'WR', render: (v) => pct(v as number) },
        { key: 'games', label: 'Games' },
      ],
      // Raw winrate (0..1), not a pre-formatted '54%' string (K1) — `render`
      // above formats it, so sorting the WR column compares numbers, not text.
      rows: d.trend.map((g) => ({ label: g.key, winrate: g.winrate, games: g.games })),
      // Chronological, oldest first — the order the table already opened in.
      initialSort: { key: 'label', dir: 1 },
    }, lineChart(d.trend.map(toPoint))),
    h('div', { class: 'grid-3' },
      card({ title: 'By role' }, breakdown(d.byRole, roleLabel)),
      card({ title: 'By game mode' }, breakdown(d.byMapType)),
      card({ title: 'By account' }, breakdown(d.byAccount)),
    ),
    h('div', { class: 'grid-2' },
      timeOfDayCard(d.timeOfDay),
      sessionPositionCard(d.sessionPosition),
    ),
    performanceCard(d.performance),
  );
}

/**
 * Rank over time (C1) — the flagship chart for "am I climbing?", above
 * everything else on Trends. Already scoped to the active role/account
 * filters by `DashboardData.rankTrend` itself (built from the same filtered
 * game set every other Trends card reads), so this just shapes what's
 * already there — no extra client-side narrowing.
 */
function rankTrendCard(ctx: ViewContext): HTMLElement | null {
  const d = ctx.data;
  const entries = Object.entries(d.rankTrend);
  if (!entries.length) return null;
  const multi = entries.length > 1;
  const series: RankSeries[] = entries.map(([key, points]) => {
    const [account, role] = key.split('::');
    return { key, label: multi ? `${account} · ${roleLabel(role as Role)}` : roleLabel(role as Role), points };
  });

  const dateLabel = (ts: number): string => {
    const dt = new Date(ts);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };
  const rows = series.flatMap((s) =>
    s.points.map((p: RankSeriesPoint, i: number) => ({
      // Sorts correctly as a plain string (YYYY-MM-DD) — no separate numeric
      // sort key needed, and dataTable requires every sort key to name an
      // actual column.
      label: dateLabel(p.timestamp),
      ...(multi ? { track: s.label } : {}),
      rank: shortRankLabelOf(p.tier, p.division),
      change: i === 0 ? null : p.points - s.points[i - 1].points,
    })));

  // "Net this range" only reads cleanly for one series — with several, a
  // single number would silently pick a winner among tracks the chart itself
  // shows side by side, so the stat box stays reserved for the common case.
  const single = !multi ? series[0] : null;
  const net = single && single.points.length >= 2
    ? single.points[single.points.length - 1].points - single.points[0].points
    : null;

  return chartCard({
    title: 'Rank',
    sub: multi ? 'per account · role, this range' : 'this range',
    columns: [
      { key: 'label', label: 'Date' },
      ...(multi ? [{ key: 'track', label: 'Track' }] : []),
      { key: 'rank', label: 'Rank' },
      { key: 'change', label: '±', render: (v) => (v == null ? '—' : signed(v as number)) },
    ],
    rows,
    initialSort: { key: 'label', dir: 1 },
  },
  h('div', null,
    rankChart(series),
    net !== null
      ? h('div', { style: { marginTop: '10px' } }, statBox(signed(net), 'net this range'))
      : null,
  ));
}

/** Best/worst window callout only when the sample is worth reading (≥10 decided games)
 *  AND that best bucket is actually a winning one — a 38% bucket topping the
 *  pack is still a losing window, not one worth queuing ranked into. */
function timeOfDayCard(groups: Group[]): HTMLElement {
  const solid = groups.filter((g) => g.wins + g.losses >= 10);
  const best = solid.length >= 2 ? [...solid].sort((a, b) => b.winrate - a.winrate)[0] : null;
  return card({ title: 'Time of day', sub: 'when you actually win' },
    breakdownOrdered(groups),
    h('div', { class: 'hint', style: { marginTop: '10px', lineHeight: '1.5' } },
      best
        ? best.winrate >= 0.5
          ? h('span', null, 'Your best window is ', h('span', { class: 'is-win' }, best.key.toLowerCase()),
              ` (${pct(best.winrate)} over ${best.wins + best.losses} decided games). Queue ranked when you're sharp, not just when you're free.`)
          : 'No winning window in this range yet — every day-part is under 50%.'
        : 'Log more games to see when you play your best Overwatch.'),
  );
}

/** The fatigue curve: winrate by game number within a sitting + the stop-point read. */
function sessionPositionCard(groups: Group[]): HTMLElement {
  const fade = sessionFade(groups);
  return card({ title: 'Game # in session', sub: 'the fatigue curve — winrate by position in a sitting' },
    breakdownOrdered(groups.map((g) => ({ ...g, key: `Game ${g.key}` }))),
    h('div', { class: 'hint', style: { marginTop: '10px', lineHeight: '1.5' } },
      fade
        ? h('span', null, 'You fade from ', h('span', { class: 'is-loss' }, `game ${fade.position}`),
            ` on — ${pct(fade.winrate)} vs ${pct(fade.baseline)} in games 1–2. Ending sessions earlier is free rank.`)
        : 'No late-session fade detected yet — sample sizes are small until you log more games.'),
  );
}

/** Like {@link breakdown} but keeps the caller's order (1 → 6+, morning → night). */
function breakdownOrdered(groups: Group[]): HTMLElement {
  return horizontalBars(groups.map((g) => ({ label: g.key, winrate: g.winrate, games: g.games })), { compact: true });
}

const toPoint = (g: Group): WrPoint => ({ label: g.key, winrate: g.winrate, games: g.games });

/**
 * Self-rated performance over time (issue #44): the rating trend with a rolling
 * average, plus the "does your self-read track results?" win/loss split.
 */
function performanceCard(p: PerformanceStats): HTMLElement {
  if (p.ratedGames === 0) {
    return card({ title: 'Your self-rating', sub: 'rate matches when logging or reviewing to unlock this' },
      emptyState('No rated games in this range yet — the 0–100 performance slider lives on Log Match and Review.'));
  }
  const gap = p.winAvg !== null && p.lossAvg !== null ? Math.round((p.winAvg - p.lossAvg) * 10) / 10 : null;
  return chartCard({
    title: 'Your self-rating',
    sub: `0–100 per match · ${p.ratedGames} rated game${p.ratedGames === 1 ? '' : 's'} · line = 7-day rolling average`,
    columns: [
      { key: 'label', label: 'Day' },
      // Raw average (can carry decimals) — render rounds for display, same as
      // the table used to do implicitly for every numeric column before K1.
      { key: 'avg', label: 'Avg rating', render: (v) => (v == null ? '–' : String(Math.round(v as number))) },
      { key: 'games', label: 'Rated' },
    ],
    rows: p.trend.map((t) => ({ label: t.date, avg: t.avg, games: t.games })),
    initialSort: { key: 'label', dir: 1 },
  },
  h('div', null,
    ratingChart(p.trend.map((t) => ({ label: t.date, rating: t.avg, games: t.games }))),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginTop: '10px' } },
      statBox(p.winAvg !== null ? String(p.winAvg) : '–', 'avg rating on wins'),
      statBox(p.lossAvg !== null ? String(p.lossAvg) : '–', 'avg rating on losses'),
      statBox(gap !== null ? (gap > 0 ? `+${gap}` : String(gap)) : '–', 'win − loss gap'),
    ),
    gap !== null
      ? h('div', { class: 'hint', style: { marginTop: '8px', lineHeight: '1.5' } },
          gap >= 15
            ? 'Your self-read tracks results closely — you rate wins much higher than losses. Worth asking: are you grading the outcome instead of your play?'
            : gap <= 2
              ? 'You rate wins and losses about the same — a self-read that ignores the scoreboard is exactly what review is for.'
              : 'A modest win/loss gap — your self-rating mostly reflects your play, with a little scoreboard bleed.')
      : null,
  ));
}

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
