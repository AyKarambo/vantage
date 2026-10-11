import { describe, it, expect } from 'vitest';
import { placeLabels, type LabelItem, type PlacedLabel, type Rect } from '../renderer/src/charts/plots/labelLayout';

/**
 * The Overview scatter names every map, so the label placer has to keep ~30
 * labels from landing on each other, on a neighbouring dot, or outside the
 * plot — however the maps cluster. These pin that contract on the shapes real
 * histories produce (a tight clump of similar maps, a long tail, one outlier).
 */

const BOUNDS: Rect = { x: 44, y: 2, w: 700, h: 330 };

const overlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const hitsDot = (b: Rect, it: LabelItem): boolean => {
  const dx = it.cx - Math.max(b.x, Math.min(it.cx, b.x + b.w));
  const dy = it.cy - Math.max(b.y, Math.min(it.cy, b.y + b.h));
  return dx * dx + dy * dy < it.r * it.r;
};

/** Seeded PRNG so the clumps are the same on every run. */
function rng(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function item(id: string, cx: number, cy: number, r = 5, w = 60): LabelItem {
  return { id, cx, cy, r, w, h: 15 };
}

function expectClean(items: LabelItem[], placed: PlacedLabel[], bounds: Rect = BOUNDS): void {
  expect(placed.map((p) => p.id)).toEqual(items.map((i) => i.id)); // input order, one each
  for (let i = 0; i < placed.length; i++) {
    const a = placed[i];
    expect(a.collides, `${a.id} flagged as colliding`).toBe(false);
    // inside the bounds
    expect(a.box.x).toBeGreaterThanOrEqual(bounds.x);
    expect(a.box.y).toBeGreaterThanOrEqual(bounds.y);
    expect(a.box.x + a.box.w).toBeLessThanOrEqual(bounds.x + bounds.w);
    expect(a.box.y + a.box.h).toBeLessThanOrEqual(bounds.y + bounds.h);
    // not on top of any dot
    for (const it of items) expect(hitsDot(a.box, it), `${a.id} covers the ${it.id} dot`).toBe(false);
    // not on top of another label
    for (let j = i + 1; j < placed.length; j++) {
      expect(overlap(a.box, placed[j].box), `${a.id} overlaps ${placed[j].id}`).toBe(false);
    }
  }
}

describe('placeLabels', () => {
  it('puts a lone label right beside its dot, with no leader', () => {
    const [p] = placeLabels([item('a', 300, 150)], BOUNDS);
    expect(p.leader).toBeNull();
    expect(p.box.x).toBeGreaterThanOrEqual(300); // to the right of the dot
    expect(p.collides).toBe(false);
  });

  it('keeps a label inside the bounds for a dot hard against the right edge', () => {
    const it = item('edge', BOUNDS.x + BOUNDS.w - 8, 100, 8, 80);
    const [p] = placeLabels([it], BOUNDS);
    expectClean([it], [p]);
    expect(p.box.x + p.box.w).toBeLessThanOrEqual(it.cx); // flipped to the left of the dot
  });

  it('separates a tight clump of similar maps (the case that used to print labels on top of each other)', () => {
    const rand = rng(7);
    const items = Array.from({ length: 12 }, (_, i) => item(`clump${i}`, 250 + rand() * 40, 120 + rand() * 40, 4 + rand() * 4, 40 + rand() * 40));
    expectClean(items, placeLabels(items, BOUNDS));
  });

  it('places a full ~34-map pool with a heavy-tailed spread without a single collision', () => {
    const rand = rng(42);
    const items = Array.from({ length: 34 }, (_, i) => {
      // x piles toward the left (rarely played maps), y spreads over winrates.
      const x = BOUNDS.x + 16 + Math.pow(rand(), 1.6) * (BOUNDS.w - 40);
      const y = BOUNDS.y + 22 + rand() * (BOUNDS.h - 50);
      return item(`map${i}`, x, y, 3.5 + rand() * 5.5, 38 + Math.round(rand() * 60));
    });
    const placed = placeLabels(items, BOUNDS);
    expectClean(items, placed);
    // every label that moved off its dot is tied back to it by a leader
    for (const p of placed) {
      const it = items.find((i) => i.id === p.id)!;
      const gap = Math.hypot(
        it.cx - Math.max(p.box.x, Math.min(it.cx, p.box.x + p.box.w)),
        it.cy - Math.max(p.box.y, Math.min(it.cy, p.box.y + p.box.h)),
      );
      if (gap > it.r + 12) expect(p.leader, `${p.id} floats ${Math.round(gap)}px from its dot with no leader`).not.toBeNull();
    }
  });

  it('routes around an obstacle (the chart\'s own caption)', () => {
    const caption: Rect = { x: 250, y: 140, w: 120, h: 15 };
    const items = [item('under', 300, 147, 4, 50), item('beside', 380, 150, 4, 50)];
    const placed = placeLabels(items, BOUNDS, [caption]);
    for (const p of placed) expect(overlap(p.box, caption), `${p.id} sits on the caption`).toBe(false);
  });

  it('is deterministic', () => {
    const rand = rng(3);
    const items = Array.from({ length: 20 }, (_, i) => item(`m${i}`, 80 + rand() * 600, 20 + rand() * 300, 4 + rand() * 4, 40 + rand() * 40));
    expect(placeLabels(items, BOUNDS)).toEqual(placeLabels(items, BOUNDS));
  });

  it('flags — rather than throws on — a label that has nowhere to go', () => {
    // Bounds barely taller than the label, and a dot in the middle with a label wider than the room.
    const tiny: Rect = { x: 0, y: 0, w: 40, h: 16 };
    const [p] = placeLabels([item('cramped', 20, 8, 4, 200)], tiny);
    expect(p.collides).toBe(true);
  });
});
