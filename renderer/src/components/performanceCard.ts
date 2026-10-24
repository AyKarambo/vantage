/** "How you played" over time — the self-rating card, shared by Mental's practice and stats layouts (#321). */
import { h } from '../dom';
import type { PerformanceStats } from '../../../src/shared/contract';
import { confidenceTier } from '../../../src/core/confidence';
import { signed } from '../format';
import { ratingChart } from '../charts/plots';
import { card, emptyState, statBox } from './primitives';
import { chartCard } from './chartCard';
import type { ViewContext } from '../views/view';

/** Rated games needed on the THINNER win/loss side before the self-rating gap sentence speaks with confidence (F6). */
const GAP_MIN_PER_SIDE = 8;

/**
 * Self-rated performance over time (issue #44): the rating trend with a rolling
 * average, plus the "does your self-read track results?" win/loss split.
 * Lives on Mental since #321 — Trends shows only objective, tracked facts.
 */
export function performanceCard(ctx: ViewContext, p: PerformanceStats, title = 'Your self-rating'): HTMLElement {
  if (p.ratedGames === 0) {
    return card({ title, sub: 'rate matches when logging or reviewing to unlock this' },
      emptyState('No rated games in this range yet — the 0–100 performance slider lives on Log Match and Review.'));
  }
  const gap = p.winAvg !== null && p.lossAvg !== null ? Math.round((p.winAvg - p.lossAvg) * 10) / 10 : null;
  // F6: the interpretive read (including the "are you grading the outcome?"
  // accusation) needs both sides backed by a real sample — a non-null
  // average alone allows as few as 1 rated game per side. Gated on the
  // THINNER side, since a lopsided 40-vs-2 split is exactly as unreliable as
  // a thin-both-sides one.
  const thinnerSide = Math.min(p.winRated, p.lossRated);
  const gapConfident = confidenceTier(thinnerSide, GAP_MIN_PER_SIDE) === 'ok';
  // C7: always daily today (unlike the winrate chart, this trend has no
  // weekly-bucket mode yet), so the day click-through is unconditional.
  const openDay = (label: string): void => ctx.navigate('matches', { day: label });
  return chartCard({
    title,
    sub: `0–100 per match · ${p.ratedGames} rated game${p.ratedGames === 1 ? '' : 's'} · line = 7-day rolling average`,
    columns: [
      { key: 'label', label: 'Day' },
      // Raw average (can carry decimals) — render rounds for display, same as
      // the table used to do implicitly for every numeric column before K1.
      { key: 'avg', label: 'Avg rating', render: (v) => (v == null ? '–' : String(Math.round(v as number))) },
      { key: 'games', label: 'Rated' },
      { key: 'rolling', label: '7d avg', render: (v) => (v == null ? '–' : String(Math.round(v as number))) },
    ],
    rows: p.trend.map((t) => ({ label: t.date, avg: t.avg, games: t.games, rolling: t.rolling })),
    initialSort: { key: 'label', dir: 1 },
    onRowClick: (row) => openDay(row.label as string),
  },
  h('div', null,
    ratingChart(p.trend.map((t) => ({ label: t.date, rating: t.avg, games: t.games, rolling: t.rolling })), openDay),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginTop: '10px' } },
      statBox(p.winAvg !== null ? String(p.winAvg) : '–', 'avg rating on wins'),
      statBox(p.lossAvg !== null ? String(p.lossAvg) : '–', 'avg rating on losses'),
      statBox(gap !== null ? (gap > 0 ? `+${gap}` : String(gap)) : '–', 'win − loss gap'),
    ),
    gap !== null && gapConfident
      ? h('div', { class: 'hint', style: { marginTop: '8px', lineHeight: '1.5' } },
          gap >= 15
            ? 'Your self-read tracks results closely — you rate wins much higher than losses. Worth asking: are you grading the outcome instead of your play?'
            : gap <= 2
              ? 'You rate wins and losses about the same — a self-read that ignores the scoreboard is exactly what review is for.'
              : 'A modest win/loss gap — your self-rating mostly reflects your play, with a little scoreboard bleed.')
      : null,
    gap !== null && !gapConfident
      ? h('div', { class: 'hint', style: { marginTop: '8px', lineHeight: '1.5' } },
          `${signed(gap)} win − loss gap over ${thinnerSide} rated game${thinnerSide === 1 ? '' : 's'} on your thinner ` +
          `side — a read needs ${GAP_MIN_PER_SIDE} per side.`)
      : null,
  ));
}
