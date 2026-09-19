import { describe, it, expect } from 'vitest';
import { effectiveDemo, demoTransition, type DemoPreference } from '../src/core/demoPreference';

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

describe('demoTransition (F2)', () => {
  it('reports demo-retired when isSample flips true → false', () => {
    expect(demoTransition(true, false)).toBe('demo-retired');
  });

  it('reports demo-restored when isSample flips false → true', () => {
    expect(demoTransition(false, true)).toBe('demo-restored');
  });

  it('reports no transition when isSample stays the same', () => {
    expect(demoTransition(true, true)).toBeNull();
    expect(demoTransition(false, false)).toBeNull();
  });

  it('never reports a transition on the very first observation (nothing to compare against)', () => {
    expect(demoTransition(undefined, true)).toBeNull();
    expect(demoTransition(undefined, false)).toBeNull();
  });
});
