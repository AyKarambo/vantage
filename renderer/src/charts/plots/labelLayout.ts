/**
 * Collision-free label placement for a point chart — pure geometry, no DOM, so
 * it unit-tests in node (see test/labelLayout.test.ts).
 *
 * Every point gets a text label. Each label tries the eight spots hugging its
 * dot first, then rings of progressively farther spots (joined to the dot by a
 * thin leader line) until one clears every label already placed and every other
 * dot. Placement is greedy, most-crowded dot first, then refined: each label is
 * lifted out and re-placed against all the others a few times, which settles
 * the cases where an early greedy choice boxed a later label in.
 */

/** An axis-aligned box in chart pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One point that needs a label: its centre, dot radius and the label's measured size. */
export interface LabelItem {
  id: string;
  cx: number;
  cy: number;
  r: number;
  /** Measured text width (include any padding wanted around it). */
  w: number;
  h: number;
}

/** Where a label landed; `leader` is the dot-edge → label-edge line, null when the label touches its dot. */
export interface PlacedLabel {
  id: string;
  box: Rect;
  leader: { x1: number; y1: number; x2: number; y2: number } | null;
  /** True when no clear spot existed and the label overlaps another label or an obstacle. */
  collides: boolean;
}

interface Candidate {
  box: Rect;
  /** Distance of the label from the dot edge; 0 = hugging the dot (no leader). */
  dist: number;
  /** Preference cost — lower is nicer (reads left-to-right, close to the dot). */
  cost: number;
}

/** Gap (px) between a hugging label and its dot. */
const GAP = 3;
/** Distances (px, from the dot edge) of the leader-line rings tried after the hugging spots. */
const RING_DISTANCES = [10, 20, 32, 46, 62, 80, 102, 128, 160];
const RING_ANGLES = 16;
/** Soft penalty for a label box that lands on another point's dot. */
const DOT_HIT = 500;
/** Soft penalty for a label hugging its dot that sits about as close to a different dot — you couldn't tell whose it is. */
const AMBIGUOUS = 9;
const REFINE_PASSES = 3;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

const overlaps = (a: Rect, b: Rect, pad = 0): boolean =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

const inside = (inner: Rect, outer: Rect): boolean =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/** Distance from a point to the nearest point of a box (0 inside it). */
const distanceToRect = (px: number, py: number, b: Rect): number =>
  Math.hypot(px - clamp(px, b.x, b.x + b.w), py - clamp(py, b.y, b.y + b.h));

const circleHitsRect = (cx: number, cy: number, r: number, b: Rect): boolean => {
  const dx = cx - clamp(cx, b.x, b.x + b.w);
  const dy = cy - clamp(cy, b.y, b.y + b.h);
  return dx * dx + dy * dy < r * r;
};

/** Liang–Barsky: does the segment (x1,y1)→(x2,y2) pass through the box? */
function segmentHitsRect(x1: number, y1: number, x2: number, y2: number, b: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, x1 - b.x) && clip(dx, b.x + b.w - x1) && clip(-dy, y1 - b.y) && clip(dy, b.y + b.h - y1) && t0 <= t1;
}

type Segment = { x1: number; y1: number; x2: number; y2: number };

const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number =>
  Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));

const segmentsCross = (a: Segment, b: Segment): boolean =>
  orient(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1) !== orient(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2)
  && orient(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1) !== orient(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);

/** Shortest distance from point (px,py) to the segment. */
function pointSegmentDistance(px: number, py: number, s: Segment): number {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((px - s.x1) * dx + (py - s.y1) * dy) / len2, 0, 1);
  return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
}

/** The leader for a label box: from the dot's edge to the box's nearest point. */
function leaderFor(it: LabelItem, box: Rect): Segment | null {
  const tx = clamp(it.cx, box.x, box.x + box.w);
  const ty = clamp(it.cy, box.y, box.y + box.h);
  const dist = Math.hypot(tx - it.cx, ty - it.cy);
  if (dist <= it.r + GAP + 4) return null; // hugging the dot — no line needed
  const ux = (tx - it.cx) / dist;
  const uy = (ty - it.cy) / dist;
  return { x1: it.cx + ux * (it.r + 1), y1: it.cy + uy * (it.r + 1), x2: tx - ux * 1, y2: ty - uy * 1 };
}

function candidatesFor(it: LabelItem): Candidate[] {
  const { cx, cy, r, w, h } = it;
  const out: Candidate[] = [];
  // The eight spots hugging the dot, in reading-order preference: right first.
  const hug: Array<[number, number, number]> = [
    [cx + r + GAP, cy - h / 2, 0], // E
    [cx - r - GAP - w, cy - h / 2, 1], // W
    [cx + r * 0.7, cy - r * 0.7 - h - 1, 1.5], // NE
    [cx + r * 0.7, cy + r * 0.7 + 1, 1.5], // SE
    [cx - r * 0.7 - w, cy - r * 0.7 - h - 1, 2.5], // NW
    [cx - r * 0.7 - w, cy + r * 0.7 + 1, 2.5], // SW
    [cx - w / 2, cy - r - GAP - h, 3], // N
    [cx - w / 2, cy + r + GAP, 3], // S
  ];
  for (const [x, y, cost] of hug) out.push({ box: { x, y, w, h }, dist: 0, cost });
  for (const d of RING_DISTANCES) {
    for (let k = 0; k < RING_ANGLES; k++) {
      const theta = (k / RING_ANGLES) * Math.PI * 2;
      const ux = Math.cos(theta);
      const uy = Math.sin(theta);
      // Push the box centre out so its NEAREST edge sits `d` from the dot edge.
      const mx = cx + ux * (r + d + (w / 2) * Math.abs(ux));
      const my = cy + uy * (r + d + (h / 2) * Math.abs(uy));
      out.push({
        box: { x: mx - w / 2, y: my - h / 2, w, h },
        dist: d,
        cost: 4 + d * 0.3 + (1 - ux) * 0.8,
      });
    }
  }
  return out;
}

/**
 * Places one label per item inside `bounds`, clear of each other, of every dot
 * and of the extra `obstacles` (e.g. a chart annotation). Results come back in
 * the input order. Deterministic.
 */
export function placeLabels(items: LabelItem[], bounds: Rect, obstacles: Rect[] = []): PlacedLabel[] {
  const cands = items.map(candidatesFor);
  const placed: Array<{ box: Rect; leader: Segment | null; collides: boolean } | null> = items.map(() => null);

  /** Cost of putting item `i` at `c`, given everything else placed; Infinity = not allowed. */
  const costOf = (i: number, c: Candidate): number => {
    if (!inside(c.box, bounds)) return Infinity;
    for (const o of obstacles) if (overlaps(c.box, o, 1)) return Infinity;
    let cost = c.cost;
    for (let j = 0; j < items.length; j++) {
      if (j === i) continue;
      const other = placed[j];
      if (other && overlaps(c.box, other.box, 2)) return Infinity;
      if (circleHitsRect(items[j].cx, items[j].cy, items[j].r + 2, c.box)) cost += DOT_HIT;
    }
    // A hugging label (no leader to say whose it is) must be clearly nearer its own dot than any other.
    if (c.dist === 0) {
      const own = distanceToRect(items[i].cx, items[i].cy, c.box) - items[i].r;
      for (let j = 0; j < items.length; j++) {
        if (j !== i && distanceToRect(items[j].cx, items[j].cy, c.box) - items[j].r < own + 6) { cost += AMBIGUOUS; break; }
      }
    }
    const leader = c.dist > 0 ? leaderFor(items[i], c.box) : null;
    if (leader) {
      for (let j = 0; j < items.length; j++) {
        if (j === i) continue;
        if (pointSegmentDistance(items[j].cx, items[j].cy, leader) < items[j].r + 1) cost += 40;
        const other = placed[j];
        if (!other) continue;
        if (segmentHitsRect(leader.x1, leader.y1, leader.x2, leader.y2, other.box)) cost += 120;
        if (other.leader && segmentsCross(leader, other.leader)) cost += 40;
      }
    }
    // The new box must not sit on top of a leader that is already drawn.
    for (let j = 0; j < items.length; j++) {
      const other = placed[j];
      if (j !== i && other?.leader && segmentHitsRect(other.leader.x1, other.leader.y1, other.leader.x2, other.leader.y2, c.box)) cost += 120;
    }
    return cost;
  };

  const place = (i: number): void => {
    let best: Candidate | null = null;
    let bestCost = Infinity;
    for (const c of cands[i]) {
      const cost = costOf(i, c);
      if (cost < bestCost) { best = c; bestCost = cost; }
    }
    if (best) {
      placed[i] = { box: best.box, leader: best.dist > 0 ? leaderFor(items[i], best.box) : null, collides: false };
      return;
    }
    // Nothing clear: take the least-bad spot inside the bounds and flag it.
    const fallback = cands[i].find((c) => inside(c.box, bounds)) ?? cands[i][0];
    placed[i] = { box: fallback.box, leader: fallback.dist > 0 ? leaderFor(items[i], fallback.box) : null, collides: true };
  };

  // Most-crowded dots first (they have the fewest good spots), bigger dots breaking ties.
  const crowd = items.map((a, i) => items.reduce((n, b, j) => n + (i !== j && Math.hypot(a.cx - b.cx, a.cy - b.cy) < 90 ? 1 : 0), 0));
  const order = items.map((_, i) => i).sort((a, b) => crowd[b] - crowd[a] || items[b].r - items[a].r || a - b);
  for (const i of order) place(i);
  for (let pass = 0; pass < REFINE_PASSES; pass++) {
    for (const i of order) {
      placed[i] = null;
      place(i);
    }
  }

  return items.map((it, i) => {
    const p = placed[i]!;
    const clash = p.collides
      || placed.some((o, j) => j !== i && o !== null && overlaps(p.box, o.box, 0))
      || obstacles.some((o) => overlaps(p.box, o, 0));
    return { id: it.id, box: p.box, leader: p.leader, collides: clash };
  });
}
