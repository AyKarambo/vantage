/**
 * The chart set — dependency-free SVG, composed from the builders in ./svg.
 * Each function takes plain data and returns an <svg> ready to mount. Colours
 * come from the shared palette so charts and the rest of the UI stay in step.
 */
import { h } from '../dom';
import { PALETTE, wrColor } from '../theme';
import { pct } from '../format';
import { svgEl, svgRoot, svgText } from './svg';

export interface WrPoint {
  label: string;
  winrate: number;
  games: number;
}

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

/** Winrate trend over time. */
export function lineChart(points: WrPoint[]): SVGElement {
  if (points.length < 2) return emptyChart();
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
  points.forEach((p, i) => s.appendChild(svgEl('circle', { cx: xAt(i), cy: yAt(p.winrate), r: 3, fill: PALETTE.accentBright })));

  // Tick labels at a regular step plus the final point — but drop a stepped label
  // that would sit right next to the last one (they'd overprint, e.g. "06-3007-01").
  const step = Math.ceil(points.length / 8);
  const last = points.length - 1;
  points.forEach((p, i) => {
    const stepped = i % step === 0 && last - i >= step / 2;
    if (stepped || i === last) s.appendChild(svgText(xAt(i), bot + 16, p.label.slice(5), { size: 9 }));
  });
  return s;
}

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

/** Responsive horizontal winrate bars (maps best → worst) — HTML, not SVG, so
 *  rows keep a fixed height regardless of container width. */
export function horizontalBars(data: WrPoint[], opts: { compact?: boolean } = {}): HTMLElement {
  if (!data.length) return h('div', { class: 'empty' }, 'Not enough data yet.');
  return h('div', { class: `hbars${opts.compact ? ' hbars--compact' : ''}` },
    ...data.map((d) => {
      const fill = h('div', { class: 'hbar-fill', style: { width: `${Math.max(3, Math.round(d.winrate * 100))}%`, background: wrColor(d.winrate) } });
      return h('div', { class: 'hbar-row' },
        h('div', { class: 'hbar-label', title: d.label }, d.label),
        h('div', { class: 'hbar-track' }, fill),
        h('div', { class: 'hbar-value' }, `${pct(d.winrate)}  ${d.games}g`),
      );
    }),
  );
}

/**
 * Tiny inline trend line, styled to match the full line chart (thin stroke,
 * rounded joins, faint area fill). Fixed pixel size so it never stretches to
 * fill a flex row.
 */
export function sparkline(
  values: number[],
  opts: { width?: number; height?: number; color?: string; fill?: boolean } = {},
): SVGElement {
  const W = opts.width ?? 120, H = opts.height ?? 30, color = opts.color ?? PALETTE.accent;
  const s = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
  s.style.display = 'block';
  s.style.flex = '0 0 auto';
  if (values.length < 2) return s;

  const mn = Math.min(...values), mx = Math.max(...values), d = mx === mn ? 1 : mx - mn;
  const xAt = (i: number) => (i / (values.length - 1)) * (W - 2) + 1;
  const yAt = (v: number) => H - 3 - ((v - mn) / d) * (H - 6);

  if (opts.fill !== false) {
    let area = `M${xAt(0).toFixed(1)} ${H} `;
    values.forEach((v, i) => (area += `L${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)} `));
    area += `L${xAt(values.length - 1).toFixed(1)} ${H} Z`;
    s.appendChild(svgEl('path', { d: area, fill: color, 'fill-opacity': '0.12' }));
  }
  const pts = values.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
  s.appendChild(svgEl('polyline', { points: pts, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  return s;
}

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

/**
 * Donut of a categorical distribution (e.g. games played per map). Fixed-size
 * ring + a legend, with the total in the middle and a hover tooltip per slice.
 */
export function donutChart(slices: DonutSlice[], opts: { size?: number; thickness?: number } = {}): HTMLElement {
  const size = opts.size ?? 184, thickness = opts.thickness ?? 26;
  const wrap = h('div', { class: 'donut-wrap' });
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (!total) {
    wrap.append(h('div', { class: 'empty' }, 'No games in range yet.'));
    return wrap;
  }

  const cx = size / 2, cy = size / 2, r = (size - thickness) / 2, C = 2 * Math.PI * r;
  const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size });
  svg.style.flex = '0 0 auto';
  svg.appendChild(svgEl('circle', { cx, cy, r, fill: 'none', stroke: PALETTE.track, 'stroke-width': thickness }));

  const tip = h('div', { class: 'chart-tooltip' });
  const moveTip = (e: MouseEvent) => {
    const rc = wrap.getBoundingClientRect();
    tip.style.left = `${e.clientX - rc.left}px`;
    tip.style.top = `${e.clientY - rc.top}px`;
  };

  const ring = svgEl('g', { transform: `rotate(-90 ${cx} ${cy})` });
  let offset = 0;
  for (const s of slices) {
    const len = (s.value / total) * C;
    const seg = svgEl('circle', {
      cx, cy, r, fill: 'none', stroke: s.color, 'stroke-width': thickness,
      'stroke-dasharray': `${len.toFixed(2)} ${(C - len).toFixed(2)}`,
      'stroke-dashoffset': `${(-offset).toFixed(2)}`,
      'pointer-events': 'stroke',
    });
    seg.style.cursor = 'pointer';
    const label = `${s.label} · ${s.value}g · ${Math.round((s.value / total) * 100)}%`;
    seg.addEventListener('mouseenter', (e) => { tip.textContent = label; tip.classList.add('is-visible'); moveTip(e); });
    seg.addEventListener('mousemove', moveTip);
    seg.addEventListener('mouseleave', () => tip.classList.remove('is-visible'));
    const title = svgEl('title');
    title.textContent = label;
    seg.appendChild(title);
    ring.appendChild(seg);
    offset += len;
  }
  svg.appendChild(ring);

  const donutBox = h('div', { class: 'donut-box' }, svg,
    h('div', { class: 'donut-center' },
      h('div', { class: 'donut-center-val' }, String(total)),
      h('div', { class: 'donut-center-lbl' }, 'games'),
    ),
  );

  const legend = h('div', { class: 'donut-legend' },
    ...slices.map((s) => h('div', { class: 'legend-item' },
      h('span', { class: 'legend-dot', style: { background: s.color } }),
      h('span', { style: { flex: '1', minWidth: '0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, s.label),
      h('span', { class: 'mono u-dim' }, `${Math.round((s.value / total) * 100)}%`),
    )),
  );

  wrap.append(donutBox, legend, tip);
  return wrap;
}

function emptyChart(): SVGElement {
  const s = svgRoot(240, 60);
  s.appendChild(svgText(12, 34, 'Not enough data yet.', { anchor: 'start', fill: PALETTE.muted, size: 12 }));
  return s;
}

const clampN = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
