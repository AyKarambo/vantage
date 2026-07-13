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
const bar = (x1: number, y1: number, x2: number, y2: number): SVGElement =>
  el('line', { x1, y1, x2, y2, stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' });

type IconKey = 'tank' | 'damage' | 'support' | 'unknown';

const SHAPES: Record<IconKey, () => SVGElement[]> = {
  // Shield.
  tank: () => [fill('M12 2l8 3v6.2C20 16 16.4 20 12 22 7.6 20 4 16 4 11.2V5z')],
  // Damage — Overwatch's offensive glyph: three pointed vertical bars (centre tallest).
  damage: () => [
    fill('M5 11 L6.5 8.5 L8 11 L8 19.5 L5 19.5 Z'),
    fill('M10.4 8.5 L12 5 L13.6 8.5 L13.6 19.5 L10.4 19.5 Z'),
    fill('M16 11 L17.5 8.5 L19 11 L19 19.5 L16 19.5 Z'),
  ],
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
