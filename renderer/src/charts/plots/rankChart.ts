/**
 * Rank-over-time (C1) — one or more {@link RankSeriesPoint} series plotted by
 * real timestamp (never by index, unlike {@link ../../charts/plots/lineChart
 * lineChart}'s evenly-spaced buckets): a run of matches with no plottable
 * entering rank — an open placement run, a pre-reset match, a stretch with no
 * anchor — simply isn't there, so the segment either side of it visibly
 * stretches across real time instead of pretending nothing happened. Nothing
 * is interpolated; the two real points on either side of a gap are joined by
 * a straight line, same as every other chart here draws between samples.
 */
import { h } from '../../dom';
import { CATEGORICAL, PALETTE } from '../../theme';
import { pointsToRank } from '../../../../src/core/rank/scalar';
import { shortRankLabelOf } from '../../../../src/core/rankDisplay';
import type { RankAdjustmentMark, RankSeriesPoint } from '../../../../src/shared/contract';
import { svgEl, svgRoot, svgText } from '../svg';
import { tooltipLayer } from '../tooltip';
import { emptyChart } from './shared';

export interface RankSeries {
  /** `rankKey(account, role)` — a stable per-series identity for colouring. */
  key: string;
  /** What the legend and tooltip call this track, e.g. "Karambo · Dmg". */
  label: string;
  points: RankSeriesPoint[];
  /**
   * Rank adjustments on this track (cheater compensation…) — drawn as small
   * diamonds on the line, never as match points (#341).
   */
  marks?: RankAdjustmentMark[];
}

const mmdd = (ts: number): string => {
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** "Nice" y-axis ticks at division boundaries (100-point steps) spanning `[lo, hi]`. */
function divisionTicks(lo: number, hi: number, maxTicks = 5): number[] {
  const span = Math.max(1, hi - lo);
  const rawStep = span / maxTicks;
  // Round the step up to the nearest 100 (one division) or, for a very wide
  // span (many tiers), a round multiple of it — never a fractional division.
  const step = Math.max(100, Math.ceil(rawStep / 100) * 100);
  const start = Math.ceil(lo / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= hi; v += step) ticks.push(v);
  return ticks.length ? ticks : [lo];
}

/** The line's plotted value at `ts` — linear between the bracketing points, flat beyond either end. */
function lineValueAt(points: RankSeriesPoint[], ts: number): number {
  if (ts <= points[0].timestamp) return points[0].points;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (ts <= b.timestamp) {
      const span = b.timestamp - a.timestamp;
      return span > 0 ? a.points + ((ts - a.timestamp) / span) * (b.points - a.points) : b.points;
    }
  }
  return points[points.length - 1].points;
}

/** Rank trend over time, one line per (account, role) series. */
export function rankChart(series: RankSeries[]): HTMLElement {
  const wrap = h('div', { class: 'chart-wrap' });
  const withPoints = series.filter((s) => s.points.length >= 2);
  if (!withPoints.length) {
    wrap.append(emptyChart());
    return wrap;
  }

  const padL = 40, padR = 14, padT = 14, padB = 24, W = 720, H = 190;
  const top = padT, bot = H - padB, plotH = bot - top, plotW = W - padL - padR;
  const s = svgRoot(W, H);

  const allPoints = withPoints.flatMap((series) => series.points);
  const minTs = Math.min(...allPoints.map((p) => p.timestamp));
  // Adjustment markers widen the time domain so one landing after the last
  // match is still on the chart.
  const markTs = withPoints.flatMap((series) => (series.marks ?? []).map((m) => m.at));
  const maxTs = Math.max(...allPoints.map((p) => p.timestamp), ...markTs);
  const tsSpan = Math.max(1, maxTs - minTs);
  const minPts = Math.min(...allPoints.map((p) => p.points));
  const maxPts = Math.max(...allPoints.map((p) => p.points));
  // Pad the y-domain so a flat or narrow-range series isn't pinned to the
  // plot's very top/bottom edge; a floor keeps a single-division span legible.
  const padPts = Math.max(50, (maxPts - minPts) * 0.15);
  const lo = minPts - padPts, hi = maxPts + padPts;

  const xAt = (ts: number) => padL + ((ts - minTs) / tsSpan) * plotW;
  const yAt = (pts: number) => bot - ((pts - lo) / (hi - lo)) * plotH;

  for (const tick of divisionTicks(lo, hi)) {
    const y = yAt(tick);
    s.appendChild(svgEl('line', { x1: padL, y1: y, x2: W - padR, y2: y, stroke: PALETTE.grid }));
    s.appendChild(svgText(padL - 6, y + 4, shortRankLabelOf(pointsToRank(tick).tier, pointsToRank(tick).division), { anchor: 'end', mono: true, size: 9 }));
  }

  const tips = tooltipLayer(wrap);

  withPoints.forEach((series, i) => {
    const color = CATEGORICAL[i % CATEGORICAL.length];
    let path = '';
    series.points.forEach((p, j) => (path += (j ? 'L' : 'M') + xAt(p.timestamp) + ' ' + yAt(p.points) + ' '));
    s.appendChild(svgEl('path', { d: path, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

    for (const p of series.points) {
      const cx = xAt(p.timestamp), cy = yAt(p.points);
      // Estimated (backward-reconstructed) points draw hollow — a stored or
      // forward-calculated one is filled solid.
      s.appendChild(svgEl('circle', {
        cx, cy, r: 3, fill: p.estimated ? 'var(--card)' : color, stroke: color, 'stroke-width': p.estimated ? 1.5 : 0,
      }));
      const hit = svgEl('circle', { cx, cy, r: 10, fill: 'transparent', tabindex: 0 });
      hit.style.cursor = 'pointer';
      const label = `${mmdd(p.timestamp)} · ${series.label} · ${shortRankLabelOf(p.tier, p.division)}${p.estimated ? ' · est.' : ''}`;
      tips.attach(hit, label);
      s.appendChild(hit);
    }

    // Adjustment markers: a hollow diamond where the line stands at that
    // instant (the rank AFTER the refund shows on the next match point).
    for (const m of series.marks ?? []) {
      const cx = xAt(m.at), cy = yAt(lineValueAt(series.points, m.at));
      const r = 4.5;
      s.appendChild(svgEl('path', {
        class: 'rank-adj-mark',
        d: `M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z`,
        fill: 'var(--card)', stroke: color, 'stroke-width': 1.5,
      }));
      const hit = svgEl('circle', { cx, cy, r: 10, fill: 'transparent', tabindex: 0 });
      const what = m.reason === 'cheater-compensation' ? 'cheater compensation' : 'rank adjustment';
      tips.attach(hit, `${mmdd(m.at)} · ${series.label} · ${what} ${m.deltaPct > 0 ? '+' : ''}${m.deltaPct}%`);
      s.appendChild(hit);
    }
  });

  // A handful of date ticks across the real time span, not one per point.
  const tickCount = 6;
  for (let i = 0; i <= tickCount; i++) {
    const ts = minTs + (i / tickCount) * tsSpan;
    s.appendChild(svgText(xAt(ts), bot + 16, mmdd(ts), { size: 9 }));
  }

  wrap.append(s, tips.tip);
  if (withPoints.length > 1) {
    wrap.append(h('div', { class: 'chart-legend' },
      ...withPoints.map((series, i) =>
        h('span', { class: 'legend-item' },
          h('span', { class: 'legend-dot', style: { background: CATEGORICAL[i % CATEGORICAL.length] } }),
          series.label)),
    ));
  }
  return wrap;
}
