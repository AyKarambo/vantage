import { describe, it, expect } from 'vitest';
import { padShortlist } from '../renderer/src/components/heroPicker';

/**
 * `padShortlist` (L4): an account+role with no "most played" history handed
 * `paintHeroChips` an empty shortlist, which it treated as a valid (empty)
 * pool — the first log on a new account, or a never-queued role, showed no
 * chips at all and forced typing every hero. This is the fix: top a
 * shortlist shorter than the caller's intended size up with the rest of the
 * role-eligible pool, alphabetically.
 */
describe('padShortlist (L4)', () => {
  const eligible = ['Zenyatta', 'Ana', 'Lucio', 'Baptiste', 'Moira'];

  it('leaves a ranked pool that already meets the limit unchanged', () => {
    expect(padShortlist(['Ana', 'Baptiste', 'Zenyatta'], 3, eligible)).toEqual(['Ana', 'Baptiste', 'Zenyatta']);
  });

  it('pads a short ranked pool with the rest of eligible, alphabetically', () => {
    expect(padShortlist(['Zenyatta'], 3, eligible)).toEqual(['Zenyatta', 'Ana', 'Baptiste']);
  });

  it('pads an entirely empty ranked pool — the new-account/never-queued-role case', () => {
    expect(padShortlist([], 3, eligible)).toEqual(['Ana', 'Baptiste', 'Lucio']);
  });

  it('never duplicates an already-ranked hero when padding', () => {
    const result = padShortlist(['Lucio'], 3, eligible);
    expect(result).toEqual(['Lucio', 'Ana', 'Baptiste']);
    expect(new Set(result).size).toBe(result.length);
  });

  it('never exceeds the limit even when eligible has plenty more to offer', () => {
    expect(padShortlist([], 2, eligible)).toHaveLength(2);
  });

  it('is a no-op when the eligible pool itself has nothing left to add', () => {
    expect(padShortlist(['Ana'], 5, ['Ana'])).toEqual(['Ana']);
  });
});
