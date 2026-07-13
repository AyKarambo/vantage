/**
 * Wilson score interval for a binomial proportion — a small-sample-honest
 * confidence band for a winrate. Unlike the naive ±√(p(1−p)/n), it stays inside
 * [0, 1] and widens sharply when n is small, so "5 of 6 wins" reads as genuinely
 * uncertain rather than a confident 83%. Pure; no I/O.
 */
export function wilson(wins: number, n: number, z = 1.96): { low: number; high: number } {
  if (n <= 0) return { low: 0, high: 1 };
  const p = wins / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const clamp = (x: number): number => Math.max(0, Math.min(1, x));
  return { low: clamp(center - margin), high: clamp(center + margin) };
}
