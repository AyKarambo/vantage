/** The map-priority scatter — winrate × volume, the dashboard's flagship chart. */
import { h } from '../../dom';
import { PALETTE, withAlpha } from '../../theme';
import { pct } from '../../format';
import { svgEl, svgRoot, svgText } from '../svg';
import { emptyChart } from './shared';

/** One dot in {@link scatterChart}: a map's winrate/volume/net-impact summary. */
export interface ScatterPoint {
  name: string;
  short: string;
  mode: string;
  color: string; // dot colour, encoding the game mode (O2) — matches the legend swatch
  winrate: number;
  volume: number;
  net: number;
  focus: boolean;
}

const clampN = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * The flagship: every map plotted by winrate (Y) × volume (X). Below the 50%
 * line is the focus band — losing maps you can't avoid. Dot size scales with
 * how often you play the map; dot colour encodes the game mode (O2, see the
 * legend) — the one encoding a full ~30-map pool can actually tell apart.
 * A short name label sits beside every FOCUS dot (net ≥ 3, O2) so the
 * bottom-right dots the card copy says to "fix first" are identifiable
 * without a hover. The winrate axis auto-fits the data so maps below 40%
 * stay separated instead of piling on one line; the X axis gets numeric
 * ticks (O2) alongside its caption. Hovering a dot reveals the exact map;
 * `onPick` makes dots clickable (the Overview uses it to jump to the map's
 * row on Matches).
 *
 * Returns an HTML wrapper (SVG + tooltip layer) rather than a bare SVG.
 */
export function scatterChart(points: ScatterPoint[], onPick?: (name: string) => void): HTMLElement {
  const wrap = h('div', { class: 'scatter-wrap' });
  if (!points.length) {
    wrap.append(emptyChart());
    return wrap;
  }

  const padL = 40, padR = 16, padT = 16, padB = 40, W = 640, H = 300;
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

  // Focus band (< 50%) — PALETTE.loss (scheme-aware; K4) rather than a
  // hard-coded literal, which used to stay red under the colour-blind scheme
  // even once every dot and axis label had switched to orange. The label
  // sits at the LEFT edge, not the right: the top-right corner is where the
  // most-played, highest-winrate maps cluster, and a right-anchored label
  // there used to sit directly under a dot.
  const y50 = yAt(0.5);
  s.appendChild(svgEl('rect', { x: left, y: y50, width: plotW, height: bot - y50, fill: withAlpha(PALETTE.loss, 0.06) }));
  s.appendChild(svgEl('line', { x1: left, y1: y50, x2: right, y2: y50, stroke: withAlpha(PALETTE.loss, 0.4), 'stroke-dasharray': '5 4' }));
  s.appendChild(svgText(left + 4, y50 - 6, 'FOCUS BAND · < 50%', { anchor: 'start', fill: PALETTE.lossText, size: 9.5 }));

  // Y ticks — the domain extremes plus the 50% line.
  for (const wr of [wrHi, 0.5, wrLo]) {
    s.appendChild(svgText(left - 8, yAt(wr) + 3, `${Math.round(wr * 100)}%`, { anchor: 'end', size: 9.5, fill: PALETTE.dim, mono: true }));
  }
  // X ticks (O2) — the caption alone ("fewer ↔ more games") never said HOW
  // many; faint gridlines + the three round numbers give the axis a scale.
  for (const v of [0, Math.round(vMax / 2), vMax]) {
    const x = xAt(v);
    s.appendChild(svgEl('line', { x1: x, y1: top, x2: x, y2: bot, stroke: withAlpha(PALETTE.dim, 0.08) }));
    s.appendChild(svgText(x, bot + 12, String(v), { anchor: 'middle', size: 9, fill: PALETTE.dim, mono: true }));
  }
  s.appendChild(svgText(left, bot + 26, '← fewer games · more games →', { anchor: 'start', size: 9.5, fill: PALETTE.dim, mono: true }));

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
    // tabindex so every dot is Tab-reachable, not just mouse-hoverable (K8) —
    // focus shows the same styled tip, pinned to the dot's own position since
    // there's no cursor to follow it with. No second native <title> tooltip
    // any more either: Chromium rendered that AND the styled one together.
    const dot = svgEl('circle', { cx, cy, r, fill: color, stroke: 'rgba(255,255,255,0.2)', 'stroke-width': 1, tabindex: 0 });
    dot.style.cursor = 'pointer';
    const label = `${p.name} · ${p.mode} · ${pct(p.winrate)} · ${p.volume}g`;
    const showTip = (): void => { tip.textContent = label; tip.classList.add('is-visible'); };
    dot.addEventListener('mouseenter', (e) => { showTip(); moveTip(e); });
    dot.addEventListener('mousemove', moveTip);
    dot.addEventListener('mouseleave', () => tip.classList.remove('is-visible'));
    dot.addEventListener('focusin', () => {
      showTip();
      const r2 = dot.getBoundingClientRect(), wrapR = wrap.getBoundingClientRect();
      tip.style.left = `${r2.left + r2.width / 2 - wrapR.left}px`;
      tip.style.top = `${r2.top + r2.height / 2 - wrapR.top}px`;
    });
    dot.addEventListener('focusout', () => tip.classList.remove('is-visible'));
    if (onPick) {
      dot.addEventListener('click', () => onPick(p.name));
      dot.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(p.name); }
      });
    }
    s.appendChild(dot);
    // Focus dots (net ≥ 3, O2) get an always-visible short name — these are
    // exactly the "fix the bottom-right first" dots the card copy points at,
    // which otherwise carried no label until hovered. Anchored away from
    // whichever edge the dot sits nearest, so the label never clips.
    if (p.focus) {
      const nearRight = cx > right - 60;
      s.appendChild(svgText(
        nearRight ? cx - r - 5 : cx + r + 5,
        cy + 3,
        p.short,
        { anchor: nearRight ? 'end' : 'start', size: 9.5, fill: PALETTE.text },
      ));
    }
  }

  wrap.append(s, tip);
  return wrap;
}
