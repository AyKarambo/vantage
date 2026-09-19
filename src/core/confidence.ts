/**
 * How much a sample size backs a claim (F6) — a tiny, reusable gate for the
 * handful of verdict sentences across the app that used to fire on whatever
 * sample happened to exist (as few as 3-4 rated games either side of a
 * self-rating "gap", or 2 tilt flags calling a trend "Worsening"). Pure and
 * generic on purpose: every caller already has its own floor constant
 * (`COST_MIN_SAMPLE`, a per-side rated-game floor, a flagged-game floor); this
 * just turns `count` vs `floor` into the same three-way read everywhere
 * instead of each call site re-deriving its own boolean.
 */
export type ConfidenceTier = 'none' | 'low' | 'ok';

/** `'none'` at zero, `'low'` below `floor`, `'ok'` at or past it. */
export function confidenceTier(count: number, floor: number): ConfidenceTier {
  if (count <= 0) return 'none';
  return count >= floor ? 'ok' : 'low';
}
