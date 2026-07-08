/**
 * Readiness charts — dependency-free SVG, colours from PALETTE.
 *
 * `readinessChart` plots the recent readiness score in the house line-chart style
 * (accent line + soft area fill + hover tooltips), over a faint green/amber/red
 * band tint that marks the fresh→in-the-hole ranges. `supercompensationSchematic`
 * is a small, fixed, illustrative curve — labelled as such — of the training-
 * theory idea the feature borrows.
 */
import { h } from '../../dom';
import type { ReadinessTrendPoint } from '../../../../src/shared/contract';
import { PALETTE } from '../../theme';
import { svgEl, svgRoot, svgText } from '../svg';
import { tooltipLayer } from '../tooltip';

export function readinessChart(points: ReadinessTrendPoint[]): HTMLElement {
  const wrap = h('div', { class: 'chart-wrap' });
  const scored = points.filter((p) => p.score !== null);
  if (scored.length < 2) {
    wrap.append(h('div', { class: 'empty', style: { padding: '18px 0' } }, 'Not enough history yet for a readiness trend.'));
    return wrap;
  }

  const padL = 30, padR = 14, padT = 12, padB = 24, W = 720, H = 190;
  const n = points.length;
  const s = svgRoot(W, H);
  const xAt = (i: number): number => padL + (n === 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const yAt = (v: number): number => padT + (1 - v / 100) * (H - padT - padB);

  // Faint band zones — a quiet fresh→in-the-hole reference behind the line, not a
  // dominant backdrop: red (0–40), amber (40–70), green (70–100).
  const zones: Array<{ from: number; to: number; color: string }> = [
    { from: 70, to: 100, color: PALETTE.win },
    { from: 40, to: 70, color: PALETTE.mid },
    { from: 0, to: 40, color: PALETTE.loss },
  ];
  for (const z of zones) {
    s.appendChild(svgEl('rect', {
      x: padL, y: yAt(z.to), width: W - padL - padR, height: yAt(z.from) - yAt(z.to),
      fill: z.color, 'fill-opacity': 0.05,
    }));
  }

  for (const v of [0, 50, 100]) {
    s.appendChild(svgEl('line', { x1: padL, y1: yAt(v), x2: W - padR, y2: yAt(v), stroke: PALETTE.grid }));
    s.appendChild(svgText(padL - 6, yAt(v) + 3, String(v), { anchor: 'end', size: 9, fill: PALETTE.dim }));
  }

  // Coordinates of the scored points (skipping no-history days), shared by the
  // area fill and the line so they trace the same path.
  const coords = points
    .map((p, i) => (p.score !== null ? { x: xAt(i), y: yAt(p.score) } : null))
    .filter((c): c is { x: number; y: number } => c !== null);

  // Soft area fill beneath the line — accent at 0.10, matching the house line chart.
  const base = yAt(0);
  const area = `M${coords[0].x.toFixed(1)} ${base.toFixed(1)} `
    + coords.map((c) => `L${c.x.toFixed(1)} ${c.y.toFixed(1)} `).join('')
    + `L${coords[coords.length - 1].x.toFixed(1)} ${base.toFixed(1)} Z`;
  s.appendChild(svgEl('path', { d: area, fill: 'rgba(124,108,245,0.10)' }));

  const line = coords.map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  s.appendChild(svgEl('path', {
    d: line, fill: 'none', stroke: PALETTE.accent, 'stroke-width': 2.5,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  }));

  // Dots + generous invisible hit targets wired to the shared app tooltip.
  const tips = tooltipLayer(wrap);
  points.forEach((p, i) => {
    if (p.score === null) return;
    const cx = xAt(i), cy = yAt(p.score);
    s.appendChild(svgEl('circle', { cx, cy, r: 3, fill: PALETTE.accentBright }));
    const hit = svgEl('circle', { cx, cy, r: 11, fill: 'transparent' });
    hit.style.cursor = 'pointer';
    tips.attach(hit, `${p.date} · readiness ${p.score} · ${p.games} game${p.games === 1 ? '' : 's'}`);
    s.appendChild(hit);
  });

  // X-axis date labels at a regular step plus the latest point (house strategy);
  // drop a stepped label that would overprint the always-drawn last one.
  const step = Math.ceil(n / 8);
  const last = n - 1;
  points.forEach((p, i) => {
    const stepped = i % step === 0 && last - i >= step / 2;
    if (stepped || i === last) s.appendChild(svgText(xAt(i), H - padB + 16, p.date.slice(5), { size: 9 }));
  });

  wrap.append(s, tips.tip);
  return wrap;
}

/** A small, purely illustrative supercompensation curve (dip → rebound above baseline). */
export function supercompensationSchematic(): SVGSVGElement {
  const W = 260, H = 92, base = 50;
  const s = svgRoot(W, H);
  // svgRoot is fluid (width:100%), which would let this fixed illustration balloon
  // to its flex container's width (and, via the aspect ratio, its height). Cap it
  // at its design size; it still shrinks below 260px on a narrow layout.
  s.style.width = `${W}px`;
  s.style.maxWidth = '100%';
  s.style.height = 'auto';
  s.appendChild(svgEl('line', { x1: 8, y1: base, x2: W - 8, y2: base, stroke: PALETTE.grid, 'stroke-dasharray': '3 3' }));
  s.appendChild(svgText(10, base - 4, 'baseline', { anchor: 'start', size: 8, fill: PALETTE.dim }));
  // Baseline → fatigue dip → rebound above baseline → decay back to baseline.
  s.appendChild(svgEl('path', {
    d: 'M8,50 L42,50 C62,84 92,82 112,64 C136,42 152,24 176,28 C202,33 218,44 252,50',
    fill: 'none', stroke: PALETTE.accentBright, 'stroke-width': 2,
  }));
  // The decay tail past the rebound — keep resting and the gains detrain away.
  s.appendChild(svgEl('path', {
    d: 'M218,44 C232,48 244,54 252,58',
    fill: 'none', stroke: PALETTE.info, 'stroke-width': 1.5, 'stroke-dasharray': '3 3',
  }));
  s.appendChild(svgText(70, 80, 'fatigue', { anchor: 'middle', size: 8, fill: PALETTE.loss }));
  s.appendChild(svgText(176, 18, 'supercompensation', { anchor: 'middle', size: 8, fill: PALETTE.win }));
  s.appendChild(svgText(250, 70, 'rust', { anchor: 'end', size: 8, fill: PALETTE.info }));
  return s;
}
