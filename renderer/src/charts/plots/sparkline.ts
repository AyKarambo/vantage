/** Tiny fixed-size inline trend line for compact KPI/table cells. */
import { PALETTE } from '../../theme';
import { svgEl } from '../svg';

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
