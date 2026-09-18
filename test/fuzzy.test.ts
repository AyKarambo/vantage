import { describe, it, expect } from 'vitest';
import { fuzzyScore, fuzzyRank } from '../renderer/src/fuzzy';

describe('fuzzyScore', () => {
  it('matches a plain subsequence', () => {
    expect(fuzzyScore('r66', 'Route 66')).not.toBeNull();
  });

  it('returns null when a query character never appears', () => {
    expect(fuzzyScore('xyz', 'Route 66')).toBeNull();
  });

  it('scores a text-prefix match higher than a mid-string match', () => {
    const prefix = fuzzyScore('rou', 'Route 66')!;
    const mid = fuzzyScore('sap', 'Runasapi')!;
    expect(prefix).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(0);
  });

  /**
   * L4: a query typed without accents still matches text that has them —
   * subsequence matching alone tolerates a SKIPPED character (an apostrophe
   * the query never types), but an accent is a DIFFERENT character at that
   * position, which needs the explicit diacritic fold.
   */
  it('folds diacritics both ways, so an unaccented query matches an accented name', () => {
    expect(fuzzyScore('esperanca', 'Esperança')).not.toBeNull();
    expect(fuzzyScore('esperança', 'Esperanca')).not.toBeNull();
  });

  it('still matches an apostrophe-free query against a name that has one', () => {
    expect(fuzzyScore('kings row', "King's Row")).not.toBeNull();
  });
});

describe('fuzzyRank', () => {
  it('ranks the best match first and drops non-matches', () => {
    const ranked = fuzzyRank('row', ["King's Row", 'Route 66', 'Oasis'], (m) => m);
    expect(ranked[0]).toBe("King's Row");
    expect(ranked).not.toContain('Oasis');
  });
});
