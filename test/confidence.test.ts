import { describe, it, expect } from 'vitest';
import { confidenceTier } from '../src/core/confidence';

describe('confidenceTier', () => {
  it('reads none at zero', () => {
    expect(confidenceTier(0, 8)).toBe('none');
  });

  it('reads none below zero (defensive — should never happen upstream)', () => {
    expect(confidenceTier(-1, 8)).toBe('none');
  });

  it('reads low below the floor', () => {
    expect(confidenceTier(1, 8)).toBe('low');
    expect(confidenceTier(7, 8)).toBe('low');
  });

  it('reads ok at exactly the floor', () => {
    expect(confidenceTier(8, 8)).toBe('ok');
  });

  it('reads ok above the floor', () => {
    expect(confidenceTier(50, 8)).toBe('ok');
  });
});
