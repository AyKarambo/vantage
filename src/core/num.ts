/** Round to one decimal place. */
export const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Clamp `n` into `[lo, hi]`. */
export const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
