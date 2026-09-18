/** Self-rated performance (0–100) over time, with a rolling average overlay. */
import { h } from '../../dom';
import { PALETTE } from '../../theme';
import { svgEl, svgRoot, svgText } from '../svg';
import { tooltipLayer } from '../tooltip';
import { emptyChart } from './shared';

export interface RatingPoint {
  /** YYYY-MM-DD day label. */
  label: string;
  /** Mean self-rating for the day, 0–100. */
  rating: number;
  /** Rated games behind the point. */
  games: number;
  /** Trailing 7-calendar-day, rated-game-weighted rolling mean (C6), precomputed in core. */
  rolling?: number;
}

/**
 * Two-series chart: per-day average dots/line plus a smoother rolling-average
 * polyline — the "is my self-read drifting?" view. 0–100 y-scale (same as the
 * readiness trend), dependency-free SVG. `onSelect` (C7) makes each point
 * open that day's matches.
 */
export function ratingChart(points: RatingPoint[], onSelect?: (label: string) => void): HTMLElement {
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
    s.appendChild(svgText(padL - 6, y + 4, String(Math.round(g * 100)), { anchor: 'end', mono: true }));
  }

  const xAt = (i: number) => padL + (i / (points.length - 1)) * plotW;
  const yAt = (rating: number) => bot - (rating / 100) * plotH;

  // Per-day series (thin, dotted feel) under the rolling average (bold).
  let daily = '';
  points.forEach((p, i) => (daily += (i ? 'L' : 'M') + xAt(i) + ' ' + yAt(p.rating) + ' '));
  s.appendChild(svgEl('path', { d: daily, fill: 'none', stroke: PALETTE.accent, 'stroke-width': 1.5, opacity: 0.55, 'stroke-linejoin': 'round' }));

  // Calendar-true, rated-game-weighted (C6) — precomputed in core.
  let smooth = '';
  points.forEach((p, i) => (smooth += (i ? 'L' : 'M') + xAt(i) + ' ' + yAt(p.rolling ?? p.rating) + ' '));
  s.appendChild(svgEl('path', { d: smooth, fill: 'none', stroke: PALETTE.accentBright, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

  // Capped to just under half the point spacing (C5) so a long history's
  // dense daily points don't overlap each other's hit target.
  const hitR = Math.max(3, Math.min(11, plotW / (points.length - 1) / 2 - 0.5));
  const tips = tooltipLayer(wrap);
  points.forEach((p, i) => {
    s.appendChild(svgEl('circle', { cx: xAt(i), cy: yAt(p.rating), r: 3, fill: PALETTE.accentBright }));
    const hit = svgEl('circle', { cx: xAt(i), cy: yAt(p.rating), r: hitR, fill: 'transparent', tabindex: 0 }); // K8
    hit.style.cursor = 'pointer';
    tips.attach(hit, `${p.label} · rated ${Math.round(p.rating)} · ${p.games}g${onSelect ? ' · click to open' : ''}`);
    if (onSelect) {
      hit.addEventListener('click', () => onSelect(p.label));
      hit.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p.label); }
      });
    }
    s.appendChild(hit);
  });

  // Year once at each boundary among the drawn ticks (C5) — a long history
  // used to run an endless "MM-DD" strip with no year anywhere.
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
