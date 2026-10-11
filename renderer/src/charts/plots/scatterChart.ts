/** The map-priority scatter — winrate × volume, the dashboard's flagship chart. */
import { h } from '../../dom';
import { wrHsl } from '../../theme';
import { pct } from '../../format';
import { svgEl, svgText } from '../svg';
import { tooltipLayer, type TooltipLayer } from '../tooltip';
import { emptyChart } from './shared';
import { placeLabels, type LabelItem, type Rect } from './labelLayout';

/** One dot in {@link scatterChart}: a map's winrate/volume/net-impact summary. */
export interface ScatterPoint {
  /** Full map name — what a click hands to `onPick` and what the tooltip prints. */
  name: string;
  /** The compact name drawn beside the dot. */
  short: string;
  winrate: number;
  /** Games played on the map (the X axis and the dot's area). */
  volume: number;
  wins: number;
  losses: number;
  /** Losses − wins: how many games the map is costing you. */
  net: number;
  /** A net-losing map worth fixing first — its label reads brighter. */
  focus: boolean;
}

/** SVG text is drawn at real pixel size (the SVG is laid out at its container's width), so these ARE the CSS type scale: `--fs-caption`. */
const TEXT_PX = 11;
const LABEL_H = 15;
const PAD = { l: 42, r: 14, t: 22, b: 48 };
/** Used until the wrapper has a measured width (first paint off-DOM, tests). */
const DEFAULT_W = 720;
/** Floor on the drawn width — below it a chart can't hold its axes; the SVG is then laid out at this width and scaled down. */
const MIN_W = 300;
const R_MIN = 3.5;
const R_MAX = 9;
const FONT = "Geist, system-ui, -apple-system, 'Segoe UI', sans-serif";

const clampN = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

let measurer: CanvasRenderingContext2D | null | undefined;
/** Width of `text` at the chart's label size; a character-count estimate where canvas is unavailable. */
function textWidth(text: string): number {
  if (measurer === undefined) {
    try { measurer = document.createElement('canvas').getContext('2d'); } catch { measurer = null; }
  }
  if (!measurer) return text.length * 6.3;
  measurer.font = `${TEXT_PX}px ${FONT}`;
  return measurer.measureText(text).width;
}

/** Round volume ticks the X axis may use, picked left to right while they stay readable. */
const VOLUME_TICKS = [1, 2, 3, 5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000];

/**
 * The flagship: every map plotted by winrate (Y) × volume (X), each one named.
 * Below the 50% line is the focus band — losing maps you can't avoid. Dot
 * AREA scales with games played and dot colour is the winrate (the same
 * `wrHsl` hue as the Top-priority rows beside it); it is deliberately NOT
 * grouped by game mode — every map is its own dot with its own label, so each
 * one is identifiable without a legend. Labels are placed by
 * {@link placeLabels}: collision-free, with a thin leader line where a label
 * had to move off its dot. The X axis is logarithmic, spanning just the
 * range of volumes present: play counts are heavy-tailed (a few busy maps, a
 * long tail of rare ones), and on a linear axis that tail piles into a
 * column at the left edge where no label can be told from its neighbour. Its
 * ticks say how many games each position means. The winrate axis auto-fits
 * the data. Hovering or focusing a dot highlights it and its label and shows
 * map · winrate · games · W–L; `onPick` makes dots and labels clickable (the
 * Overview uses it to open the map's games on Matches).
 *
 * The SVG is rebuilt at the wrapper's measured width (ResizeObserver) so its
 * text is always real pixels rather than a scaled viewBox — that is what keeps
 * labels the same size at every window width.
 *
 * Returns an HTML wrapper (SVG + tooltip layer) rather than a bare SVG.
 */
export function scatterChart(points: ScatterPoint[], onPick?: (name: string) => void): HTMLElement {
  const wrap = h('div', { class: 'scatter-wrap' });
  if (!points.length) {
    wrap.append(emptyChart());
    return wrap;
  }

  const tips = tooltipLayer(wrap);
  let svg: SVGSVGElement | null = null;
  let drawnWidth = 0;

  const draw = (): void => {
    const width = Math.max(MIN_W, Math.round(wrap.clientWidth || DEFAULT_W));
    if (svg && width === drawnWidth) return;
    const focused = svg && document.activeElement && svg.contains(document.activeElement)
      ? document.activeElement.getAttribute('data-map')
      : null;
    const next = buildSvg(points, width, tips, onPick);
    if (svg) svg.replaceWith(next); else wrap.prepend(next);
    svg = next;
    drawnWidth = width;
    // A redraw (window resize, late font load) must not drop keyboard focus.
    if (focused) next.querySelector<SVGElement>(`[data-map="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  };

  wrap.append(tips.tip);
  draw();

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      if (!wrap.isConnected) { observer.disconnect(); return; }
      draw();
    });
    observer.observe(wrap);
  }
  // Label widths depend on the real font; once it has loaded, lay out again.
  void document.fonts?.ready.then(() => {
    if (!wrap.isConnected) return;
    drawnWidth = 0;
    draw();
  });
  return wrap;
}

function buildSvg(points: ScatterPoint[], W: number, tips: TooltipLayer, onPick?: (name: string) => void): SVGSVGElement {
  const H = clampN(Math.round(W * 0.54), 360, 450);
  const left = PAD.l, right = W - PAD.r, top = PAD.t, bot = H - PAD.b;
  const plotW = right - left, plotH = bot - top;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', class: 'scatter-svg', role: 'group', 'aria-label': 'Every map: winrate against games played' });
  svg.style.aspectRatio = `${W} / ${H}`;

  const vMax = Math.max(...points.map((p) => p.volume), 1);
  // Log axis from just under the rarest map to the busiest.
  const vLo = Math.max(1, Math.min(...points.map((p) => p.volume)) / 1.3);
  const vSpan = Math.log(Math.max(vMax / vLo, 1.0001));
  const wrs = points.map((p) => p.winrate);
  // Whole-10% domain that always shows the 50% line with room either side.
  const wrLo = Math.max(0, Math.floor(Math.min(...wrs, 0.42) * 10) / 10);
  const wrHi = Math.min(1, Math.ceil(Math.max(...wrs, 0.58) * 10) / 10);
  const insetX = R_MAX + 6;
  const insetY = R_MAX + 4;
  const xAt = (v: number): number => left + insetX + clampN(Math.log(Math.max(v, vLo) / vLo) / vSpan, 0, 1) * (plotW - 2 * insetX);
  const yAt = (wr: number): number => top + insetY + ((wrHi - clampN(wr, wrLo, wrHi)) / (wrHi - wrLo)) * (plotH - 2 * insetY);
  const radiusOf = (v: number): number => R_MIN + Math.sqrt(v / vMax) * (R_MAX - R_MIN);

  // Focus band (< 50%) — a tinted region under a dashed 50% line.
  const y50 = yAt(0.5);
  svg.append(svgEl('rect', { class: 'scatter-band', x: left, y: y50, width: plotW, height: bot - y50 }));

  // Winrate gridlines + tick labels, every 10% (every 20% on a very tall domain).
  const step = wrHi - wrLo > 0.55 ? 0.2 : 0.1;
  for (let wr = Math.ceil(wrLo / step - 1e-9) * step; wr <= wrHi + 1e-9; wr += step) {
    const y = yAt(wr);
    svg.append(svgEl('line', { class: 'scatter-grid', x1: left, y1: y, x2: right, y2: y }));
    svg.append(svgText(left - 8, y + 4, `${Math.round(wr * 100)}%`, { anchor: 'end', size: TEXT_PX, mono: true, class: 'scatter-tick' }));
  }
  svg.append(svgEl('line', { class: 'scatter-baseline', x1: left, y1: y50, x2: right, y2: y50 }));

  // Games-played ticks on the log axis: round numbers, kept ≥ 52px apart.
  let lastX = -Infinity;
  for (const v of VOLUME_TICKS) {
    if (v < vLo) continue;
    if (v > vMax) break;
    const x = xAt(v);
    if (x - lastX < 52) continue;
    lastX = x;
    svg.append(svgEl('line', { class: 'scatter-grid scatter-grid--v', x1: x, y1: top, x2: x, y2: bot }));
    svg.append(svgText(x, bot + 16, String(v), { anchor: 'middle', size: TEXT_PX, mono: true, class: 'scatter-tick' }));
  }
  svg.append(svgText(left, bot + 38, 'Games played (log scale) →', { anchor: 'start', size: TEXT_PX, class: 'scatter-axis-title' }));
  svg.append(svgText(2, top - 8, 'Winrate', { anchor: 'start', size: TEXT_PX, class: 'scatter-axis-title' }));

  const items: LabelItem[] = points.map((p) => ({
    id: p.name,
    cx: xAt(p.volume),
    cy: yAt(p.winrate),
    r: radiusOf(p.volume),
    w: Math.ceil(textWidth(p.short)) + 4,
    h: LABEL_H,
  }));

  // The "FOCUS BAND" caption sits wherever it doesn't cover a dot: just under
  // the line at the left or right end, else just above it.
  const bandText = 'FOCUS BAND · < 50%';
  // Semi-bold with 0.06em tracking (see .scatter-band-label) runs wider than the measured regular text.
  const bandW = Math.ceil(textWidth(bandText) * 1.08 + bandText.length * 0.7) + 6;
  const bandSpots: Rect[] = [
    { x: left + 6, y: y50 + 4, w: bandW, h: LABEL_H },
    { x: right - bandW - 6, y: y50 + 4, w: bandW, h: LABEL_H },
    { x: left + 6, y: y50 - LABEL_H - 4, w: bandW, h: LABEL_H },
    { x: right - bandW - 6, y: y50 - LABEL_H - 4, w: bandW, h: LABEL_H },
  ];
  const bandBox = bandSpots.find((b) => !items.some((it) => dotHitsRect(it, b))) ?? bandSpots[0];
  const band = svgText(bandBox.x, bandBox.y + 11, bandText, { anchor: 'start', size: TEXT_PX, class: 'scatter-band-label' });
  svg.append(band);

  const placed = new Map(placeLabels(
    items,
    { x: left + 2, y: 2, w: W - left - 4, h: bot - 2 },
    [bandBox],
  ).map((p) => [p.id, p]));

  // Biggest dots first, so a small dot is never buried under a big one — and
  // that is also the Tab order: most-played map first.
  for (const p of [...points].sort((a, b) => b.volume - a.volume)) {
    const it = items.find((i) => i.id === p.name)!;
    const spot = placed.get(p.name)!;
    const color = wrHsl(p.winrate);
    const record = `${p.wins}W–${p.losses}L`;
    const tipText = `${p.name} · ${pct(p.winrate)} · ${p.volume} game${p.volume === 1 ? '' : 's'} · ${record}`;

    const g = svgEl('g', {
      class: `scatter-pt${p.focus ? ' is-focus' : ''}`,
      'data-map': p.name,
      tabindex: 0,
      role: 'button',
      'aria-label': `${tipText}. Open its matches.`,
    });
    g.append(
      svgEl('circle', { class: 'scatter-halo', cx: it.cx, cy: it.cy, r: it.r + 3, fill: color }),
      svgEl('circle', { class: 'scatter-ring', cx: it.cx, cy: it.cy, r: it.r + 5 }),
    );
    if (spot.leader) {
      g.append(svgEl('line', { class: 'scatter-leader', x1: spot.leader.x1, y1: spot.leader.y1, x2: spot.leader.x2, y2: spot.leader.y2 }));
    }
    g.append(svgEl('circle', { class: 'scatter-dot', cx: it.cx, cy: it.cy, r: it.r, fill: color }));
    const label = svgText(spot.box.x + 2, spot.box.y + LABEL_H - 4, p.short, { anchor: 'start', size: TEXT_PX, class: 'scatter-label' });
    label.setAttribute('data-map-label', p.name);
    g.append(label);

    tips.attach(g, tipText);
    const activate = (on: boolean): void => {
      g.classList.toggle('is-active', on);
      svg.classList.toggle('is-hovering', svg.querySelector('.scatter-pt.is-active') !== null);
    };
    g.addEventListener('mouseenter', () => activate(true));
    g.addEventListener('mouseleave', () => activate(false));
    g.addEventListener('focusin', () => activate(true));
    g.addEventListener('focusout', () => activate(false));
    if (onPick) {
      g.addEventListener('click', () => onPick(p.name));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(p.name); }
      });
    }
    svg.append(g);
  }
  return svg;
}

/** Does this point's dot (plus its halo) touch the box? */
function dotHitsRect(it: LabelItem, b: Rect): boolean {
  const dx = it.cx - clampN(it.cx, b.x, b.x + b.w);
  const dy = it.cy - clampN(it.cy, b.y, b.y + b.h);
  return dx * dx + dy * dy < (it.r + 4) * (it.r + 4);
}
