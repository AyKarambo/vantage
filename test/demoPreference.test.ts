import { describe, it, expect } from 'vitest';
import { effectiveDemo, type DemoPreference } from '../src/core/demoPreference';

describe('effectiveDemo', () => {
  it('shows the demo season only when opted in AND there is no real history (A6)', () => {
    // Opted in + empty history → demo shows.
    expect(effectiveDemo('on', 0)).toBe(true);
    // Opted in but real matches exist → demo yields to real data.
    expect(effectiveDemo('on', 1)).toBe(false);
    // Declined → never shows, regardless of history.
    expect(effectiveDemo('off', 0)).toBe(false);
    expect(effectiveDemo('off', 5)).toBe(false);
    // Not yet asked → behaves as off behind the first-run prompt (no fabricated data).
    expect(effectiveDemo('unset', 0)).toBe(false);
    expect(effectiveDemo('unset', 5)).toBe(false);
  });

  it('covers every preference value exhaustively for an empty history', () => {
    const cases: Array<[DemoPreference, boolean]> = [['unset', false], ['on', true], ['off', false]];
    for (const [pref, expected] of cases) expect(effectiveDemo(pref, 0)).toBe(expected);
  });
});
