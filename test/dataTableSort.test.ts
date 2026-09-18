import { describe, it, expect } from 'vitest';
import { compareCells } from '../renderer/src/components/table';

/**
 * `compareCells` (K1): dataTable's local sort comparator used to sort `dir:
 * -1` ASCENDING while the header drew a descending arrow for it — Heroes
 * opened with the least-played heroes under "G ↓". These lock in the fixed
 * direction mapping, that nulls always sort last, and that numbers compare
 * numerically rather than as strings.
 */
describe('compareCells', () => {
  it('dir 1 (ascending, header shows no arrow-down) sorts smaller first', () => {
    const rows = [5, 1, 3].sort((a, b) => compareCells(a, b, 1));
    expect(rows).toEqual([1, 3, 5]);
  });

  it('dir -1 (descending, header shows ↓) sorts larger first', () => {
    const rows = [5, 1, 3].sort((a, b) => compareCells(a, b, -1));
    expect(rows).toEqual([5, 3, 1]);
  });

  it('reproduces the reported bug directly: Heroes\' G column (dir -1, "↓") must NOT be ascending', () => {
    // The exact symptom: Heroes opens with initialSort { key: 'games', dir: -1 }
    // (heroes.ts) — under the old comparator this produced 3,3,3,4,4… (least
    // played first) although the header drew '↓'.
    const games = [8, 3, 12, 5].sort((a, b) => compareCells(a, b, -1));
    expect(games).toEqual([12, 8, 5, 3]);
    expect(games[0]).toBeGreaterThan(games[games.length - 1]); // most-played first, not least
  });

  it('sorts strings case-insensitively', () => {
    const rows = ['banana', 'Apple', 'cherry'].sort((a, b) => compareCells(a, b, 1));
    expect(rows).toEqual(['Apple', 'banana', 'cherry']);
  });

  it('compares numbers numerically, not as strings ("100" > "25")', () => {
    // The Maps 'Table' toggle bug: pre-formatted percent/signed strings sort
    // lexically ('100%' < '25%'). Raw numbers must not have this problem.
    const rows = [100, 25, 67].sort((a, b) => compareCells(a, b, -1));
    expect(rows).toEqual([100, 67, 25]);
  });

  it('sorts null/undefined last regardless of direction', () => {
    expect([3, null, 1].sort((a, b) => compareCells(a, b, 1))).toEqual([1, 3, null]);
    expect([3, null, 1].sort((a, b) => compareCells(a, b, -1))).toEqual([3, 1, null]);
    expect([undefined, 2].sort((a, b) => compareCells(a, b, 1))).toEqual([2, undefined]);
  });

  it('is stable (0) for two equal values, leaving relative order to the caller', () => {
    expect(compareCells(5, 5, 1)).toBe(0);
    expect(compareCells('x', 'x', -1)).toBe(0);
    expect(compareCells(null, null, 1)).toBe(0);
  });
});
