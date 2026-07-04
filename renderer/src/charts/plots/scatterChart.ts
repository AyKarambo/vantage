/** The map-priority scatter — winrate × volume, the dashboard's flagship chart. */
import { h } from '../../dom';
import { PALETTE } from '../../theme';
import { pct } from '../../format';
import { svgEl, svgRoot, svgText } from '../svg';
import { emptyChart } from './shared';

/** One dot in {@link scatterChart}: a map's winrate/volume/net-impact summary. */
export interface ScatterPoint {
  name: string;
  short: string;
  mode: string;
  color: string; // per-map dot colour, matching the legend swatch
  winrate: number;
  volume: number;
  net: number;
  focus: boolean;
}

const clampN = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * The flagship: every map plotted by winrate (Y) × volume (X). Below the 50%
 * line is the focus band — losing maps you can't avoid. Dot size scales with
 * how often you play the map; dot colour encodes the game mode (see the legend).
 * The winrate axis auto-fits the data so maps below 40% stay separated instead
 * of piling on one line. Hovering a dot reveals the exact map.
 *
 * Returns an HTML wrapper (SVG + tooltip layer) rather than a bare SVG.
 */
export function scatterChart(points: ScatterPoint[]): HTMLElement {
  const wrap = h('div', { class: 'scatter-wrap' });
  if (!points.length) {
    wrap.append(emptyChart());
    return wrap;
  }

  const padL = 40, padR = 16, padT = 16, padB = 32, W = 640, H = 300;
  const left = padL, right = W - padR, top = padT, bot = H - padB;
  const plotW = right - left, plotH = bot - top;

  const vMax = Math.max(...points.map((p) => p.volume), 1);
  const wrs = points.map((p) => p.winrate);
  const wrLo = Math.max(0, Math.min(...wrs, 0.42) - 0.04);
  const wrHi = Math.min(1, Math.max(...wrs, 0.58) + 0.04);
  // Inset both axes so edge dots (and their glow) never clip the frame.
  const xAt = (v: number) => left + plotW * 0.05 + (v / vMax) * plotW * 0.9;
  const yAt = (wr: number) => top + ((wrHi - clampN(wr, wrLo, wrHi)) / (wrHi - wrLo)) * plotH;
  const s = svgRoot(W, H);

  // Focus band (< 50%).
  const y50 = yAt(0.5);
  s.appendChild(svgEl('rect', { x: left, y: y50, width: plotW, height: bot - y50, fill: 'rgba(209,104,95,0.06)' }));
  s.appendChild(svgEl('line', { x1: left, y1: y50, x2: right, y2: y50, stroke: 'rgba(209,104,95,0.4)', 'stroke-dasharray': '5 4' }));
  s.appendChild(svgText(right - 4, y50 - 6, 'FOCUS BAND · < 50%', { anchor: 'end', fill: '#c98079', size: 9.5 }));

  // Y ticks — the domain extremes plus the 50% line.
  for (const wr of [wrHi, 0.5, wrLo]) {
    s.appendChild(svgText(left - 8, yAt(wr) + 3, `${Math.round(wr * 100)}%`, { anchor: 'end', size: 9.5, fill: PALETTE.dim, mono: true }));
  }
  s.appendChild(svgText(left, bot + 20, '← fewer games · more games →', { anchor: 'start', size: 9.5, fill: PALETTE.dim, mono: true }));

  // Tooltip layer.
  const tip = h('div', { class: 'chart-tooltip' });
  const moveTip = (e: MouseEvent) => {
    const r = wrap.getBoundingClientRect();
    tip.style.left = `${e.clientX - r.left}px`;
    tip.style.top = `${e.clientY - r.top}px`;
  };

  // Dots — larger = played more; drawn small-to-large so big dots don't hide small.
  for (const p of [...points].sort((a, b) => a.volume - b.volume)) {
    const r = 4 + (p.volume / vMax) * 7;
    const cx = xAt(p.volume), cy = yAt(p.winrate);
    const color = p.color;
    s.appendChild(svgEl('circle', { cx, cy, r: r + 3, fill: color, 'fill-opacity': '0.16' }));
    const dot = svgEl('circle', { cx, cy, r, fill: color, stroke: 'rgba(255,255,255,0.2)', 'stroke-width': 1 });
    dot.style.cursor = 'pointer';
    const label = `${p.name} · ${p.mode} · ${pct(p.winrate)} · ${p.volume}g`;
    dot.addEventListener('mouseenter', (e) => { tip.textContent = label; tip.classList.add('is-visible'); moveTip(e); });
    dot.addEventListener('mousemove', moveTip);
    dot.addEventListener('mouseleave', () => tip.classList.remove('is-visible'));
    // Native title as a no-JS fallback.
    const title = svgEl('title');
    title.textContent = label;
    dot.appendChild(title);
    s.appendChild(dot);
  }

  wrap.append(s, tip);
  return wrap;
}
