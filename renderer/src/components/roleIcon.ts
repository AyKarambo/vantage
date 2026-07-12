/**
 * Role icons — one shared, bundled inline-SVG component every role *badge* routes
 * through (scoreboard, Heroes table, target scope, …). Recreated in Overwatch's
 * visual language (a shield / a target reticle / a support cross), NOT Blizzard's
 * own art, plus a neutral "unknown role" mark. Drawn with `currentColor` so the
 * badge's text colour drives them; carries a <title> + aria-label for a11y.
 */
import type { Role } from '../../../src/shared/contract';
import { roleLabel } from '../format';

const NS = 'http://www.w3.org/2000/svg';

function el(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

const fill = (d: string): SVGElement => el('path', { d, fill: 'currentColor' });
const ring = (cx: number, cy: number, r: number): SVGElement =>
  el('circle', { cx, cy, r, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 });
const dot = (cx: number, cy: number, r: number): SVGElement => el('circle', { cx, cy, r, fill: 'currentColor' });
const bar = (x1: number, y1: number, x2: number, y2: number): SVGElement =>
  el('line', { x1, y1, x2, y2, stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' });

type IconKey = 'tank' | 'damage' | 'support' | 'unknown';

const SHAPES: Record<IconKey, () => SVGElement[]> = {
  // Shield.
  tank: () => [fill('M12 2l8 3v6.2C20 16 16.4 20 12 22 7.6 20 4 16 4 11.2V5z')],
  // Target reticle (offense).
  damage: () => [ring(12, 12, 8), bar(12, 1, 12, 6), bar(12, 18, 12, 23), bar(1, 12, 6, 12), bar(18, 12, 23, 12), dot(12, 12, 2.4)],
  // Support cross.
  support: () => [fill('M9.5 3h5v6h6v5h-6v6h-5v-6h-6V9h6z')],
  // Neutral unknown.
  unknown: () => [ring(12, 12, 8), bar(8.5, 12, 15.5, 12)],
};

function iconKey(role: Role | undefined): IconKey {
  return role === 'tank' || role === 'damage' || role === 'support' ? role : 'unknown';
}

/**
 * Build a role icon. `role` undefined or `openQ` renders the neutral unknown mark
 * (we never imply a specific role we don't know). `title` overrides the a11y label.
 */
export function roleIcon(role: Role | undefined, opts: { size?: number; title?: string } = {}): SVGSVGElement {
  const key = iconKey(role);
  const size = opts.size ?? 16;
  const label = opts.title ?? (role && role !== 'openQ' ? roleLabel(role) : role === 'openQ' ? 'Open queue' : 'Role not reported');

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', `role-icon role-icon--${key}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);

  const title = document.createElementNS(NS, 'title');
  title.textContent = label;
  svg.appendChild(title);
  for (const shape of SHAPES[key]()) svg.appendChild(shape);
  return svg;
}
