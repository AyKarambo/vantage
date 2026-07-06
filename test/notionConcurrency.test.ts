import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from '../src/notion/concurrency';

describe('mapWithConcurrency', () => {
  it('runs every item exactly once', async () => {
    const seen: number[] = [];
    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      seen.push(item);
    });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('never runs more than `limit` items concurrently', async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // proves it isn't accidentally serial
  });

  it('is a no-op on an empty list', async () => {
    await expect(mapWithConcurrency([], 3, async () => {})).resolves.toBeUndefined();
  });

  it('propagates a throw from fn', async () => {
    await expect(
      mapWithConcurrency([1], 3, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});
