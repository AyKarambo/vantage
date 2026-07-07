/**
 * Small pure statistics helpers for the readiness model: rolling mean/SD for
 * personal baselines and winsorized z-scores for per-game metric comparison.
 * Kept dependency-free and total — degenerate inputs return safe values.
 */

export interface MeanSd {
  n: number;
  mean: number;
  /** Population SD (n divisor). 0 when n < 2. */
  sd: number;
}

/** Mean and population standard deviation of a series. Empty input → zeros. */
export function meanSd(values: number[]): MeanSd {
  const n = values.length;
  if (n === 0) return { n: 0, mean: 0, sd: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { n, mean, sd: 0 };
  const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
  return { n, mean, sd: Math.sqrt(variance) };
}

/**
 * Z-score of `value` against a baseline, with the SD floored so ultra-consistent
 * stats cannot produce z blow-ups, and the result winsorized to ±`limit` so a
 * single absurd game cannot dominate any accumulator.
 */
export function winsorizedZ(
  value: number,
  baseline: MeanSd,
  sdFloorFrac: number,
  limit: number,
): number {
  const floor = Math.max(baseline.sd, Math.abs(baseline.mean) * sdFloorFrac, 1e-6);
  const z = (value - baseline.mean) / floor;
  return Math.max(-limit, Math.min(limit, z));
}

/** Clamp helper shared by the subscore math. */
export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
