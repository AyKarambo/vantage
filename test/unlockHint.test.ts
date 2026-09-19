import { describe, it, expect } from 'vitest';
import { unlockProgress } from '../renderer/src/components/primitives/unlock';

/**
 * `unlockProgress` (F1) is the pure half of the shared unlock-gate readout —
 * `unlockHint`/`unlockPartRow` need a DOM, so the clamp fix itself is
 * covered here instead (mirrors `padShortlist`'s split in heroPicker.ts).
 */
describe('unlockProgress (F1)', () => {
  it('reports met: false and a fraction below 1 while under the floor', () => {
    expect(unlockProgress({ have: 2, need: 3, label: 'games' })).toEqual({ met: false, frac: 2 / 3 });
  });

  it('reports met: true exactly at the floor', () => {
    expect(unlockProgress({ have: 5, need: 5, label: 'flagged games' })).toEqual({ met: true, frac: 1 });
  });

  it('clamps the fraction to 1 and stays met once past the floor — never a fraction over 100% (the "12/5" overshoot bug)', () => {
    expect(unlockProgress({ have: 12, need: 5, label: 'calm' })).toEqual({ met: true, frac: 1 });
  });

  it('treats zero have as unmet with a zero fraction', () => {
    expect(unlockProgress({ have: 0, need: 15, label: 'games' })).toEqual({ met: false, frac: 0 });
  });

  it('never divides by zero for a zero-need part (degenerate but should not throw or go negative/NaN)', () => {
    expect(unlockProgress({ have: 0, need: 0, label: 'games' })).toEqual({ met: true, frac: 1 });
  });
});
