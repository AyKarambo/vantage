/** Winrate-over-time trend chart. */
import { h } from '../../dom';
import { PALETTE } from '../../theme';
import { pct } from '../../format';
import { svgEl, svgRoot, svgText } from '../svg';
import { tooltipLayer } from '../tooltip';
import { emptyChart, type WrPoint } from './shared';

/** Winrate trend over time. Returns an HTML wrapper (SVG + tooltip layer). */
export function lineChart(points: WrPoint[]): HTMLElement {
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

  // Area under the curve for a touch of depth.
  let area = `M${xAt(0)} ${bot} `;
  points.forEach((p, i) => (area += `L${xAt(i)} ${yAt(p.winrate)} `));
  area += `L${xAt(points.length - 1)} ${bot} Z`;
  s.appendChild(svgEl('path', { d: area, fill: 'rgba(124,108,245,0.10)' }));

  let path = '';
  points.forEach((p, i) => (path += (i ? 'L' : 'M') + xAt(i) + ' ' + yAt(p.winrate) + ' '));
  s.appendChild(svgEl('path', { d: path, fill: 'none', stroke: PALETTE.accent, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  const tips = tooltipLayer(wrap);
  points.forEach((p, i) => {
    s.appendChild(svgEl('circle', { cx: xAt(i), cy: yAt(p.winrate), r: 3, fill: PALETTE.accentBright }));
    // Generous invisible hit area so hovering the thin line is easy.
    const hit = svgEl('circle', { cx: xAt(i), cy: yAt(p.winrate), r: 11, fill: 'transparent' });
    hit.style.cursor = 'pointer';
    tips.attach(hit, `${p.label} · ${pct(p.winrate)} · ${p.games}g`);
    s.appendChild(hit);
  });

  // Tick labels at a regular step plus the final point — but drop a stepped label
  // that would sit right next to the last one (they'd overprint, e.g. "06-3007-01").
  const step = Math.ceil(points.length / 8);
  const last = points.length - 1;
  points.forEach((p, i) => {
    const stepped = i % step === 0 && last - i >= step / 2;
    if (stepped || i === last) s.appendChild(svgText(xAt(i), bot + 16, p.label.slice(5), { size: 9 }));
  });
  wrap.append(s, tips.tip);
  return wrap;
}
