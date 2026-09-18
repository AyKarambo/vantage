import { describe, it, expect } from 'vitest';
import { toppedUpShortlist } from '../renderer/src/components/heroPicker';

/**
 * `toppedUpShortlist` (L4): a fresh account/role has no most-played history at
 * all, so the caller's shortlist arrives empty — the grid must not go empty
 * with search as the only way in.
 */
describe('toppedUpShortlist', () => {
  const ELIGIBLE = ['Ana', 'Baptiste', 'Illari', 'Juno', 'Kiriko', 'Lifeweaver', 'Mercy', 'Moira'];

  it('tops up an empty shortlist to the limit, alphabetically', () => {
    expect(toppedUpShortlist([], 6, ELIGIBLE)).toEqual(['Ana', 'Baptiste', 'Illari', 'Juno', 'Kiriko', 'Lifeweaver']);
  });

  it('tops up a partial shortlist without duplicating an already-listed hero', () => {
    const result = toppedUpShortlist(['Mercy', 'Ana'], 6, ELIGIBLE);
    expect(result).toEqual(['Mercy', 'Ana', 'Baptiste', 'Illari', 'Juno', 'Kiriko']);
  });

  it('leaves a shortlist already at (or over) the limit untouched', () => {
    const full = ['Mercy', 'Ana', 'Juno', 'Kiriko', 'Moira', 'Baptiste'];
    expect(toppedUpShortlist(full, 6, ELIGIBLE)).toBe(full); // same reference: no top-up work done
  });

  it('with no shortlist at all, falls back to the full eligible pool (today\'s full-grid behaviour)', () => {
    expect(toppedUpShortlist(undefined, 6, ELIGIBLE)).toBe(ELIGIBLE);
  });

  it('never exceeds the eligible pool even if the limit is larger', () => {
    expect(toppedUpShortlist([], 999, ELIGIBLE)).toEqual([...ELIGIBLE].sort((a, b) => a.localeCompare(b)));
  });
});
