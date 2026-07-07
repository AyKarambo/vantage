import { describe, it, expect } from 'vitest';
import { stepFor, COARSE_FACTOR } from '../src/core/targets';

describe('stepFor — per-stat threshold step size', () => {
  it('counts step by 1', () => {
    for (const stat of ['Deaths', 'Eliminations', 'Assists']) {
      expect(stepFor(stat)).toBe(1);
    }
  });

  it('KDA steps by 0.1', () => {
    expect(stepFor('KDA')).toBe(0.1);
  });

  it('per-10 volume stats step by 250', () => {
    for (const stat of ['Damage', 'Healing', 'Mitigation']) {
      expect(stepFor(stat)).toBe(250);
    }
  });

  it('unknown stats default to 1', () => {
    expect(stepFor('Nonsense')).toBe(1);
  });

  it('Shift coarse factor is 10', () => {
    expect(COARSE_FACTOR).toBe(10);
    expect(stepFor('Damage') * COARSE_FACTOR).toBe(2500);
  });
});
