/**
 * Readiness charts — dependency-free SVG, colours from PALETTE.
 *
 * `readinessChart` plots the recent readiness score with green/amber/red band
 * zones behind it (the player's real trajectory). `supercompensationSchematic`
 * is a small, fixed, illustrative curve — labelled as such — of the training-
 * theory idea the feature borrows.
 */
import { h } from '../../dom';
import type { ReadinessTrendPoint } from '../../../../src/shared/contract';
import { PALETTE } from '../../theme';
import { svgEl, svgRoot, svgText } from '../svg';

export function readinessChart(points: ReadinessTrendPoint[]): HTMLElement {
  const wrap = h('div', { class: 'chart-wrap' });
  const scored = points.filter((p) => p.score !== null);
  if (scored.length < 2) {
    wrap.append(h('div', { class: 'empty', style: { padding: '18px 0' } }, 'Not enough history yet for a readiness trend.'));
    return wrap;
  }

  const padL = 26, padR = 12, padT = 10, padB = 18, W = 720, H = 190;
  const n = points.length;
  const s = svgRoot(W, H);
  const xAt = (i: number): number => padL + (n === 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const yAt = (v: number): number => padT + (1 - v / 100) * (H - padT - padB);

  // Band zones: red (0–40), amber (40–70), green (70–100).
  const zones: Array<{ from: number; to: number; color: string }> = [
    { from: 70, to: 100, color: PALETTE.win },
    { from: 40, to: 70, color: PALETTE.mid },
    { from: 0, to: 40, color: PALETTE.loss },
  ];
  for (const z of zones) {
    s.appendChild(svgEl('rect', {
      x: padL, y: yAt(z.to), width: W - padL - padR, height: yAt(z.from) - yAt(z.to),
      fill: z.color, 'fill-opacity': 0.07,
    }));
  }
  for (const v of [0, 50, 100]) {
    s.appendChild(svgEl('line', { x1: padL, y1: yAt(v), x2: W - padR, y2: yAt(v), stroke: PALETTE.grid }));
    s.appendChild(svgText(padL - 6, yAt(v) + 3, String(v), { anchor: 'end', size: 9, fill: PALETTE.dim }));
  }

  const line = points
    .map((p, i) => (p.score !== null ? `${xAt(i).toFixed(1)},${yAt(p.score).toFixed(1)}` : null))
    .filter((v): v is string => v !== null)
    .join(' ');
  s.appendChild(svgEl('polyline', {
    points: line, fill: 'none', stroke: PALETTE.accentBright, 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  }));

  points.forEach((p, i) => {
    if (p.score === null) return;
    const dot = svgEl('circle', { cx: xAt(i), cy: yAt(p.score), r: 2.6, fill: PALETTE.accentBright });
    const title = svgEl('title');
    title.textContent = `${p.date} · readiness ${p.score} · ${p.games} game${p.games === 1 ? '' : 's'}`;
    dot.appendChild(title);
    s.appendChild(dot);
  });

  wrap.append(s);
  return wrap;
}

/** A small, purely illustrative supercompensation curve (dip → rebound above baseline). */
export function supercompensationSchematic(): SVGSVGElement {
  const W = 260, H = 92, base = 50;
  const s = svgRoot(W, H);
  s.appendChild(svgEl('line', { x1: 8, y1: base, x2: W - 8, y2: base, stroke: PALETTE.grid, 'stroke-dasharray': '3 3' }));
  s.appendChild(svgText(10, base - 4, 'baseline', { anchor: 'start', size: 8, fill: PALETTE.dim }));
  // Baseline → fatigue dip → rebound above baseline → decay back to baseline.
  s.appendChild(svgEl('path', {
    d: 'M8,50 L42,50 C62,84 92,82 112,64 C136,42 152,24 176,28 C202,33 218,44 252,50',
    fill: 'none', stroke: PALETTE.accentBright, 'stroke-width': 2,
  }));
  s.appendChild(svgText(70, 80, 'fatigue', { anchor: 'middle', size: 8, fill: PALETTE.loss }));
  s.appendChild(svgText(176, 18, 'supercompensation', { anchor: 'middle', size: 8, fill: PALETTE.win }));
  return s;
}
