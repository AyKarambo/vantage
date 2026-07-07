import { describe, it, expect } from 'vitest';
import { meanSd, winsorizedZ, clamp } from '../src/core/readiness/stats';

describe('meanSd', () => {
  it('empty input → zeros, no NaN', () => {
    expect(meanSd([])).toEqual({ n: 0, mean: 0, sd: 0 });
  });
  it('single value → mean, sd 0', () => {
    expect(meanSd([7])).toEqual({ n: 1, mean: 7, sd: 0 });
  });
  it('computes population mean/SD', () => {
    const { n, mean, sd } = meanSd([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(n).toBe(8);
    expect(mean).toBe(5);
    expect(sd).toBe(2); // classic population-SD example
  });
});

describe('winsorizedZ', () => {
  const base = { n: 20, mean: 100, sd: 20 }; // sd above the 0.15×mean floor
  it('plain z inside the limit', () => {
    expect(winsorizedZ(120, base, 0.15, 2.5)).toBe(1);
    expect(winsorizedZ(80, base, 0.15, 2.5)).toBe(-1);
  });
  it('winsorizes to ±limit', () => {
    expect(winsorizedZ(1000, base, 0.15, 2.5)).toBe(2.5);
    expect(winsorizedZ(-1000, base, 0.15, 2.5)).toBe(-2.5);
  });
  it('floors the SD at sdFloorFrac × mean (ultra-consistent baseline cannot blow up)', () => {
    const tight = { n: 20, mean: 100, sd: 0.001 };
    // floor = max(0.001, 15, 1e-6) = 15 → z = 15/15 = 1
    expect(winsorizedZ(115, tight, 0.15, 2.5)).toBe(1);
  });
  it('zero-mean zero-sd baseline stays finite', () => {
    const degenerate = { n: 20, mean: 0, sd: 0 };
    const z = winsorizedZ(1, degenerate, 0.15, 2.5);
    expect(Number.isFinite(z)).toBe(true);
    expect(z).toBe(2.5); // clipped, not Infinity
  });
});

describe('clamp', () => {
  it('clamps both ends', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});
