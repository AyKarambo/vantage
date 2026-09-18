/** Winrate-over-time trend chart, with a rolling-average overlay. */
import { h } from '../../dom';
import type { SeasonEntry } from '../../../../src/shared/contract';
import { PALETTE } from '../../theme';
import { pct } from '../../format';
import { svgEl, svgRoot, svgText } from '../svg';
import { tooltipLayer } from '../tooltip';
import { emptyChart, type WrPoint } from './shared';

/** The X position for a real timestamp, interpolated between the two bracketing points' dates — `undefined` outside the plotted range. */
function xForDate(points: WrPoint[], xAt: (i: number) => number, ts: number): number | undefined {
  const times = points.map((p) => Date.parse(p.label));
  const first = times[0], last = times[times.length - 1];
  if (ts < first || ts > last) return undefined;
  for (let i = 0; i < times.length - 1; i++) {
    if (ts >= times[i] && ts <= times[i + 1]) {
      const span = times[i + 1] - times[i];
      const frac = span > 0 ? (ts - times[i]) / span : 0;
      return xAt(i) + frac * (xAt(i + 1) - xAt(i));
    }
  }
  return xAt(times.length - 1);
}

/**
 * Winrate trend over time. Returns an HTML wrapper (SVG + tooltip layer).
 * `onSelect` (C7) makes each point open the day/week behind it — pass it only
 * in daily mode; a weekly bucket's label isn't a Matches-recognized day yet.
 * `seasons` (C5) draws a thin vertical marker for each season whose start
 * falls inside the plotted range — otherwise nothing on the chart ever marks
 * a season or ladder-reset boundary, though the data is on the same payload.
 */
export function lineChart(points: WrPoint[], onSelect?: (label: string) => void, seasons: SeasonEntry[] = []): HTMLElement {
  const wrap = h('div', { class: 'chart-wrap' });
  if (points.length < 2) {
    wrap.append(emptyChart());
    return wrap;
  }
  const padL = 34, padR = 14, padT = 14, padB = 24, W = 720, H = 190;
  const top = padT, bot = H - padB, plotH = bot - top, plotW = W - padL - padR;
  const s = svgRoot(W, H);

  for (const g of [0, 0.5, 1]) {
    const y = bot - g * plotH;
    s.appendChild(svgEl('line', { x1: padL, y1: y, x2: W - padR, y2: y, stroke: PALETTE.grid, 'stroke-dasharray': g === 0.5 ? '4 4' : '0' }));
    s.appendChild(svgText(padL - 6, y + 4, `${Math.round(g * 100)}%`, { anchor: 'end', mono: true }));
  }

  const xAt = (i: number) => padL + (i / (points.length - 1)) * plotW;
  const yAt = (wr: number) => bot - wr * plotH;

  // Season boundaries (C5) — quiet vertical markers, heavier for a ladder
  // reset (isReset), labelled with the season name so a long "All time" view
  // reads as more than an unlabelled wall of points.
  for (const season of seasons) {
    const x = xForDate(points, xAt, season.start);
    if (x === undefined) continue;
    s.appendChild(svgEl('line', {
      x1: x, y1: top, x2: x, y2: bot,
      stroke: season.isReset ? PALETTE.info : PALETTE.grid,
      'stroke-width': season.isReset ? 1.5 : 1,
      opacity: season.isReset ? 0.5 : 0.35,
    }));
    // Anchored near the plot's bottom, rotated to read bottom-to-top growing
    // upward — an anchor near the TOP would rotate the label straight off
    // the top of the viewBox instead of into the available vertical space.
    const label = svgText(x + 3, bot - 4, season.label, { anchor: 'start', size: 7, fill: PALETTE.dim });
    label.setAttribute('transform', `rotate(-90 ${x + 3} ${bot - 4})`);
    s.appendChild(label);
  }

  // Area under the raw curve for a touch of depth.
  let area = `M${xAt(0)} ${bot} `;
  points.forEach((p, i) => (area += `L${xAt(i)} ${yAt(p.winrate)} `));
  area += `L${xAt(points.length - 1)} ${bot} Z`;
  s.appendChild(svgEl('path', { d: area, fill: 'rgba(124,108,245,0.10)' }));

  // Raw per-bucket line (thin, semi-transparent) under the rolling average —
  // same two-series treatment as the self-rating trend, so day-to-day noise
  // doesn't hide the general direction.
  let path = '';
  points.forEach((p, i) => (path += (i ? 'L' : 'M') + xAt(i) + ' ' + yAt(p.winrate) + ' '));
  s.appendChild(svgEl('path', { d: path, fill: 'none', stroke: PALETTE.accent, 'stroke-width': 1.5, opacity: 0.55, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

  // Calendar-true, game-weighted (C6) — precomputed in core (`rollingWinrate`)
  // over every bucket in the trailing window, not just the last N array
  // entries, since `points` is sparse (only days/weeks with games exist).
  let smooth = '';
  points.forEach((p, i) => (smooth += (i ? 'L' : 'M') + xAt(i) + ' ' + yAt(p.rolling ?? p.winrate) + ' '));
  s.appendChild(svgEl('path', { d: smooth, fill: 'none', stroke: PALETTE.accentBright, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

  // Generous invisible hit area so hovering the thin line is easy — but
  // capped to just under half the point spacing (C5) so on a dense "All
  // time" chart (weekly points ~9px apart) adjacent hit circles stop
  // overlapping and stealing the hover from whichever point was drawn last.
  const hitR = Math.max(3, Math.min(11, plotW / (points.length - 1) / 2 - 0.5));
  const tips = tooltipLayer(wrap);
  points.forEach((p, i) => {
    s.appendChild(svgEl('circle', { cx: xAt(i), cy: yAt(p.winrate), r: 3, fill: PALETTE.accentBright }));
    // tabindex so Tab reaches every point (K8) — the styled tooltip now shows
    // on keyboard focus too, where before a keyboard user had no way to read
    // a chart point's value at all.
    const hit = svgEl('circle', { cx: xAt(i), cy: yAt(p.winrate), r: hitR, fill: 'transparent', tabindex: 0 });
    hit.style.cursor = 'pointer';
    tips.attach(hit, `${p.label} · ${pct(p.winrate)} · ${p.games}g${onSelect ? ' · click to open' : ''}`);
    if (onSelect) {
      // The hit circle already had cursor:pointer before there was anything
      // to click (C7) — this is the click that promise was missing.
      hit.addEventListener('click', () => onSelect(p.label));
      hit.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p.label); }
      });
    }
    s.appendChild(hit);
  });

  // Tick labels at a regular step plus the final point — but drop a stepped label
  // that would sit right next to the last one (they'd overprint, e.g. "06-3007-01").
  // The year prints once at each year boundary among the DRAWN ticks (C5),
  // not on every tick — a year-plus "All time" chart used to never show a
  // year anywhere, just an endless "MM-DD" run with no way to tell them apart.
  const step = Math.ceil(points.length / 8);
  const last = points.length - 1;
  let lastYear: string | null = null;
  points.forEach((p, i) => {
    const stepped = i % step === 0 && last - i >= step / 2;
    if (!(stepped || i === last)) return;
    const year = p.label.slice(0, 4);
    const text = year !== lastYear ? p.label : p.label.slice(5);
    lastYear = year;
    s.appendChild(svgText(xAt(i), bot + 16, text, { size: 9 }));
  });
  wrap.append(s, tips.tip);
  return wrap;
}
