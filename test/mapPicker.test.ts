import { describe, it, expect } from 'vitest';
import { notKnownMapHint } from '../renderer/src/components/mapPicker';
import { fuzzyRank } from '../renderer/src/fuzzy';
import { MAP_MODES } from '../src/core/maps';

const ALL_MAPS = Object.keys(MAP_MODES);

describe('notKnownMapHint (L4)', () => {
  it('names the typed text when something was typed', () => {
    expect(notKnownMapHint('kings row')).toBe('"kings row" isn\'t a known map — pick one from the list.');
  });

  it('asks the player to start typing when the field is blank', () => {
    expect(notKnownMapHint('')).toBe('Pick the map — start typing and choose from the list.');
    expect(notKnownMapHint('   ')).toBe('Pick the map — start typing and choose from the list.');
  });
});

/**
 * The near-miss resolution `typeahead.ts`'s strict-blur handler performs —
 * "does the typed text resolve to exactly one fuzzy candidate" — reproduced
 * here as a pure computation over the real map pool (L4), since the DOM-side
 * blur/setTimeout behavior itself isn't practically unit-testable under this
 * project's node test environment (no jsdom).
 */
const uniqueCandidate = (typed: string): string | undefined => {
  const candidates = fuzzyRank(typed, ALL_MAPS, (m) => m);
  return candidates.length === 1 ? candidates[0] : undefined;
};

describe('fuzzy map resolution (L4)', () => {
  it('resolves a missing apostrophe to the real map', () => {
    expect(uniqueCandidate('kings row')).toBe("King's Row");
  });

  it('resolves a missing accent (cedilla) to the real map', () => {
    expect(uniqueCandidate('esperanca')).toBe('Esperança');
  });

  it('resolves a missing accent (acute) to the real map', () => {
    expect(uniqueCandidate('paraiso')).toBe('Paraíso');
  });

  it('does not force-resolve genuinely ambiguous text', () => {
    // A single generic letter plausibly subsequence-matches most of the pool —
    // exactly the case that must fall through to the "pick one" hint, not
    // silently commit to a guess.
    const candidates = fuzzyRank('a', ALL_MAPS, (m) => m);
    expect(candidates.length).toBeGreaterThan(1);
    expect(uniqueCandidate('a')).toBeUndefined();
  });

  it('matches nothing for text unrelated to any map', () => {
    expect(fuzzyRank('xyzxyz', ALL_MAPS, (m) => m)).toEqual([]);
  });
});
