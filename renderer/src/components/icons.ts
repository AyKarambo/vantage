/**
 * The sidebar's inline-SVG nav icon set (K6) — one distinct silhouette per
 * screen, built the same way `roleIcon.ts`'s icons already are: a handful of
 * `currentColor` primitives in a 24×24 viewBox, no font, no CDN, CSP-safe.
 * Replaces 15 of the sidebar's 17 icons, which used to be Unicode text
 * glyphs (`◈ ◉ ⚑ ▤ ◇ ◍ ◎ ◐ ◔ ◆ ⟳ ≡ ⚙ ⓘ ?`) — nine of them geometric shapes
 * from the same small alphabet, five of those circles differing only by
 * fill, and none of them covered by the bundled font's unicode-range, so
 * they fell through to a system symbol font at an inconsistent weight next
 * to the two real SVG icons (`goalFlagIcon`, `peopleIcon` in `shell.ts`).
 *
 * Purely decorative (`aria-hidden`) — the surrounding `.nav-item` button
 * already carries the accessible name via its own `title`/text, matching
 * `goalFlagIcon`/`peopleIcon`'s existing convention.
 */

const NS = 'http://www.w3.org/2000/svg';

function el(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

const fillPath = (d: string): SVGElement => el('path', { d, fill: 'currentColor' });
const strokePath = (d: string, width = 2): SVGElement =>
  el('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
const ring = (cx: number, cy: number, r: number, width = 2): SVGElement =>
  el('circle', { cx, cy, r, fill: 'none', stroke: 'currentColor', 'stroke-width': width });
const dot = (cx: number, cy: number, r: number): SVGElement => el('circle', { cx, cy, r, fill: 'currentColor' });
const bar = (x1: number, y1: number, x2: number, y2: number, width = 2): SVGElement =>
  el('line', { x1, y1, x2, y2, stroke: 'currentColor', 'stroke-width': width, 'stroke-linecap': 'round' });
const rect = (x: number, y: number, w: number, h: number, rx = 1.5): SVGElement =>
  el('rect', { x, y, width: w, height: h, rx, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 });

function icon(...shapes: SVGElement[]): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.setAttribute('aria-hidden', 'true');
  for (const s of shapes) svg.appendChild(s);
  return svg;
}

/** Overview — a small 2×2 dashboard grid ("everything at a glance"). */
export function overviewIcon(): SVGSVGElement {
  return icon(rect(3, 3, 8, 8), rect(13, 3, 8, 8), rect(3, 13, 8, 8), rect(13, 13, 8, 8));
}

/** Live — a heartbeat/pulse line, the same "something is happening right now" read as the live-match dot. */
export function liveIcon(): SVGSVGElement {
  return icon(strokePath('M2 13h4.5l2-6 3 12 2.5-9 1.5 3H22'));
}

/** Review — a rectangular banner flag, deliberately distinct from Targets' triangular pennant (`goalFlagIcon`) so the two never read as the same icon. */
export function reviewIcon(): SVGSVGElement {
  return icon(bar(6, 3, 6, 21), strokePath('M6 4.5h11.5L14 8l3.5 3.5H6'));
}

/** Matches — a simple row list, the game log. */
export function matchesIcon(): SVGSVGElement {
  return icon(bar(4, 6, 20, 6), bar(4, 12, 20, 12), bar(4, 18, 20, 18));
}

/** Focus — a crosshair/reticle ("aim here first"). */
export function focusIcon(): SVGSVGElement {
  return icon(ring(12, 12, 7), dot(12, 12, 1.6), bar(12, 2, 12, 5), bar(12, 19, 12, 22), bar(2, 12, 5, 12), bar(19, 12, 22, 12));
}

/** Mental — a crescent moon (calm/tilt state read at a glance). */
export function mentalIcon(): SVGSVGElement {
  return icon(fillPath('M13 3a9 9 0 108 12.9A7.2 7.2 0 0113 3z'));
}

/** Readiness — a battery, half-charged (the training-load read). */
export function readinessIcon(): SVGSVGElement {
  return icon(rect(2, 8, 17, 8, 2), rect(6, 10.5, 7, 3, 0.5), bar(21, 10.5, 21, 13.5, 2.5));
}

/** Heroes — a mask (the per-hero table), two eye cutouts on a rounded shell. */
export function heroesIcon(): SVGSVGElement {
  return icon(strokePath('M4 10c0-4 3.5-7 8-7s8 3 8 7-3.5 9-8 9-8-5-8-9z'), dot(9, 10.5, 1.3), dot(15, 10.5, 1.3));
}

/** Maps — a map pin. */
export function mapsIcon(): SVGSVGElement {
  return icon(strokePath('M12 21s7-7.6 7-12.5A7 7 0 105 8.5C5 13.4 12 21 12 21z'), dot(12, 8.5, 2));
}

/** Trends — an upward trend line with an arrowhead. */
export function trendsIcon(): SVGSVGElement {
  return icon(strokePath('M3 17l6-6 4 4 8-9'), strokePath('M15 6h6v6'));
}

/** Notion sync — two curved arrows forming a cycle. */
export function notionSyncIcon(): SVGSVGElement {
  return icon(
    strokePath('M4.5 11.5A7.5 7.5 0 0118.7 7.3'),
    strokePath('M18.7 7.3l.3-3.8 3.5 1.3'),
    strokePath('M19.5 12.5A7.5 7.5 0 015.3 16.7'),
    strokePath('M5.3 16.7l-.3 3.8-3.5-1.3'),
  );
}

/** Logs — a terminal window: a prompt chevron and a cursor line. */
export function logsIcon(): SVGSVGElement {
  return icon(rect(2.5, 4.5, 19, 15, 2), strokePath('M6 10l3 2.5L6 15'), bar(11, 15, 15, 15));
}

/** Settings — a gear: a ring hub with 8 evenly-spaced teeth. */
export function settingsIcon(): SVGSVGElement {
  const teeth: SVGElement[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const x1 = 12 + Math.cos(a) * 7.2;
    const y1 = 12 + Math.sin(a) * 7.2;
    const x2 = 12 + Math.cos(a) * 10;
    const y2 = 12 + Math.sin(a) * 10;
    teeth.push(bar(x1, y1, x2, y2, 2.5));
  }
  return icon(...teeth, ring(12, 12, 5.5), dot(12, 12, 1.8));
}

/** About — an info glyph: a ring with a dot and a stem, "i". */
export function aboutIcon(): SVGSVGElement {
  return icon(ring(12, 12, 9), dot(12, 7.5, 1.4), bar(12, 11, 12, 16.5, 2.2));
}

/** FAQ — a question mark in a ring, paired visually with the About icon's info ring. */
export function faqIcon(): SVGSVGElement {
  return icon(ring(12, 12, 9), strokePath('M9.5 9.3a2.6 2.6 0 015.1.8c0 1.7-2.6 1.9-2.6 3.9', 2), dot(12, 17, 1.3));
}

/**
 * Targets — a pennant flying from a pole (a goal flag). The original real
 * SVG nav icon, predating this module; deliberately distinct from Review's
 * rectangular banner (`reviewIcon`) so the two never read as the same icon.
 */
export function targetsIcon(): SVGSVGElement {
  return icon(bar(6, 3, 6, 21), fillPath('M6 4l11 3.2L6 11z'));
}

/**
 * Players — two overlapping head-and-shoulders marks. The other original
 * real SVG nav icon, predating this module.
 */
export function playersIcon(): SVGSVGElement {
  const back = fillPath('M16.5 11a3 3 0 100-6 3 3 0 000 6zm0 1.6c-1 0-1.9.2-2.6.5 1.2.9 2 2.2 2.2 3.9H22v-1c0-2-2.5-3.4-5.5-3.4z');
  back.setAttribute('opacity', '0.55');
  const front = fillPath('M9 12a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm0 1.8c-3.3 0-7 1.7-7 3.9V19h14v-1.3c0-2.2-3.7-3.9-7-3.9z');
  return icon(back, front);
}
