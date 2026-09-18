import { describe, it, expect } from 'vitest';
import { resolveNearMiss } from '../renderer/src/fuzzy';

/**
 * `resolveNearMiss`: the strict map combobox's last-resort resolver (L4) — a
 * typo or a missing apostrophe/accent should resolve onto its one confident
 * match rather than silently reverting the field to empty.
 */
describe('resolveNearMiss', () => {
  const MAPS = ["King's Row", 'Esperança', 'Ilios', 'Oasis', 'Junkertown', 'Circuit Royal'];

  it('resolves a missing apostrophe onto its one candidate', () => {
    expect(resolveNearMiss('kings row', MAPS)).toBe("King's Row");
  });

  it('resolves a dropped accent onto its one candidate', () => {
    expect(resolveNearMiss('esperanca', MAPS)).toBe('Esperança');
  });

  it('is null for text with no plausible match at all', () => {
    expect(resolveNearMiss('xyzxyzxyz', MAPS)).toBeNull();
  });

  it('is null for empty text', () => {
    expect(resolveNearMiss('', MAPS)).toBeNull();
  });

  it('is null when two candidates are too close to call unambiguously', () => {
    // Two lookalike names starting the same way, differing after the point
    // "junk" commits to — picking either silently would be a guess.
    expect(resolveNearMiss('junk', ['Junkertown', 'Junk City'])).toBeNull();
  });

  it('refuses to commit a short prefix even when it scores cleanly', () => {
    // A single letter can score high against a name that happens to start
    // with it ("o" vs "Oasis") without the player having typed enough to
    // mean it — length is its own floor, not just score and margin.
    expect(resolveNearMiss('o', MAPS)).toBeNull();
    expect(resolveNearMiss('oas', MAPS)).toBeNull();
  });
});
