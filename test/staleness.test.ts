import { describe, it, expect } from 'vitest';
import { isStale, normalizeStaleness, DEFAULT_STALENESS } from '../src/core/staleness';

const DAY = 86_400_000;
const NOW = 1_000_000_000_000;

describe('normalizeStaleness', () => {
  it('fills defaults for missing fields', () => {
    expect(normalizeStaleness(undefined)).toEqual(DEFAULT_STALENESS);
    expect(normalizeStaleness({})).toEqual(DEFAULT_STALENESS);
  });

  it('clamps out-of-range and rounds fractional values', () => {
    expect(normalizeStaleness({ staleAfterDays: 0, staleAfterMatches: 0 }))
      .toEqual({ staleAfterDays: 1, staleAfterMatches: 1 });
    expect(normalizeStaleness({ staleAfterDays: 9999, staleAfterMatches: 9999 }))
      .toEqual({ staleAfterDays: 365, staleAfterMatches: 500 });
    expect(normalizeStaleness({ staleAfterDays: 14.6, staleAfterMatches: 29.4 }))
      .toEqual({ staleAfterDays: 15, staleAfterMatches: 29 });
  });
});

describe('isStale — days OR matches, whichever first', () => {
  const settings = { staleAfterDays: 14, staleAfterMatches: 30 };

  it('is not stale below both thresholds', () => {
    expect(isStale(NOW - 5 * DAY, 5, NOW, settings)).toBe(false);
  });

  it('is stale once active at least the day threshold', () => {
    expect(isStale(NOW - 14 * DAY, 0, NOW, settings)).toBe(true);
    expect(isStale(NOW - 13.9 * DAY, 0, NOW, settings)).toBe(false);
  });

  it('is stale once active across at least the match threshold', () => {
    expect(isStale(NOW, 30, NOW, settings)).toBe(true);
    expect(isStale(NOW, 29, NOW, settings)).toBe(false);
  });

  it('missing activatedAt is not stale on the day axis but can be on matches', () => {
    expect(isStale(undefined, 5, NOW, settings)).toBe(false);
    expect(isStale(undefined, 30, NOW, settings)).toBe(true);
  });

  it('missing match count is not stale on the match axis but can be on days', () => {
    expect(isStale(NOW - 20 * DAY, undefined, NOW, settings)).toBe(true);
    expect(isStale(NOW - 2 * DAY, undefined, NOW, settings)).toBe(false);
  });
});
