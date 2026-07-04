/** Donut ring for categorical distributions (e.g. games played per map). */
import { h } from '../../dom';
import { PALETTE } from '../../theme';
import { svgEl } from '../svg';

/** One ring segment in {@link donutChart}. */
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
